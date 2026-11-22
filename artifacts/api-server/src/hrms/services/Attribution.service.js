const Station = require('../models/Station.model');
const Attendance = require('../models/Attendance.model');
const Employee = require('../models/Employee.model');
const AttributionOverride = require('../models/AttributionOverride.model');
const ShiftAssignment = require('../models/ShiftAssignment.model');

// Matches "[2026-08-04 09:15:23] | Process: ... | Window: ..."
const LINE_TIMESTAMP_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/;

const parseLogLine = (line) => {
  const match = line.match(LINE_TIMESTAMP_RE);
  if (!match) return null;
  // logger.py writes local PC time with no timezone; treat it as-is (server
  // and PCs are expected to be on the same local timezone — PKT here).
  return { timestamp: new Date(match[1].replace(' ', 'T')), raw: line };
};

const monthBounds = (month) => {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));
  return { start, end };
};

// Attendance/ShiftAssignment queries are padded a day past each edge of the
// month. A cross-day shift starting on the last day of one month (e.g.
// Jul 31, 11 PM -> Aug 1, 6 AM) is stored/keyed against Jul 31, but its
// window can still cover an Aug 1 log line. Without this padding, that
// record wouldn't be fetched when attributing August.
const paddedMonthBounds = (month) => {
  const { start, end } = monthBounds(month);
  const paddedStart = new Date(start);
  paddedStart.setUTCDate(paddedStart.getUTCDate() - 1);
  const paddedEnd = new Date(end);
  paddedEnd.setUTCDate(paddedEnd.getUTCDate() + 1);
  return { start: paddedStart, end: paddedEnd };
};

// ─── Tier 1: actual Attendance punches (ground truth) ─────────────────────────

/**
 * Finds every employee whose Attendance window covers `ts`, restricted to
 * `candidateIds`. An "open" record (no checkOut yet) counts as covering
 * everything from checkIn.time to now.
 */
const findCoveringEmployees = (attendanceRecords, ts) =>
  attendanceRecords
    .filter((rec) => {
      if (!rec.checkIn?.time) return false;
      const inTime = new Date(rec.checkIn.time);
      const outTime = rec.checkOut?.time ? new Date(rec.checkOut.time) : null;
      return inTime <= ts && (!outTime || outTime >= ts);
    })
    .map((rec) => rec.employee.toString());

// ─── Tier 2: scheduled shift, used ONLY when Attendance can't resolve it ──────
// This answers "who was *supposed* to be here" — not "who actually was".
// Anything attributed this way is tagged `scheduleInferred: true` all the way
// out to the API response so it is never displayed as if it were confirmed.

const timeStringToMinutes = (t) => {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Mirrors attendance_routes.js getShiftForDate — which assignment (if any) applies on a given date. */
const getShiftForDate = (assignments, targetDate) => {
  // Use local calendar dates (server+PCs are expected to be on the same local TZ).
  const dayOfWeek = targetDate.getDay();
  const dateOnly = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

  for (const a of assignments) {
    if (!a.recurring && a.startDate && a.endDate) {
      const sDate = new Date(a.startDate);
      const eDate = new Date(a.endDate);
      const s = new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate());
      const e = new Date(eDate.getFullYear(), eDate.getMonth(), eDate.getDate());
      if (dateOnly >= s && dateOnly <= e) return a;
    }
  }
  for (const a of assignments) {
    if (a.recurring && typeof a.weekday === 'number' && a.weekday === dayOfWeek) return a;
  }
  return null;
};

/**
 * Builds { start, end } Date windows for one employee covering `ts`'s
 * calendar day AND the previous day (to catch a cross-day shift that started
 * yesterday and is still running through early this morning) — mirrors the
 * cross-day handling in attendance_routes.js.
 */
const getScheduledWindowsForDay = (assignments, ts) => {
  // Use local calendar day boundaries so shift windows align with local log timestamps.
  const day = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
  const prevDay = new Date(day);
  prevDay.setDate(prevDay.getDate() - 1);

  const windows = [];

  const todayShift = getShiftForDate(assignments, day);
  if (todayShift?.startTime) {
    const startMin = timeStringToMinutes(todayShift.startTime);
    const endMin = timeStringToMinutes(todayShift.endTime);
    const startDate = new Date(day.getTime() + startMin * 60000);
    let endDate = new Date(day.getTime() + endMin * 60000);
    if (todayShift.crossDay || endMin <= startMin) {
      endDate = new Date(endDate.getTime() + 24 * 3600000); // rolls into tomorrow
    }
    windows.push({ start: startDate, end: endDate });
  }

  // Yesterday's shift, if it was cross-day, can still be running now.
  const yesterdayShift = getShiftForDate(assignments, prevDay);
  if (yesterdayShift?.crossDay && yesterdayShift?.startTime) {
    const startMin = timeStringToMinutes(yesterdayShift.startTime);
    const endMin = timeStringToMinutes(yesterdayShift.endTime);
    const startDate = new Date(prevDay.getTime() + startMin * 60000);
    const endDate = new Date(prevDay.getTime() + (endMin <= startMin ? endMin + 1440 : endMin) * 60000);
    windows.push({ start: startDate, end: endDate });
  }

  return windows;
};

const findScheduledEmployees = (scheduleByEmployee, ts) =>
  Object.entries(scheduleByEmployee)
    .filter(([, windows]) => windows.some((w) => w.start <= ts && ts <= w.end))
    .map(([employeeId]) => employeeId);

// ─── Tier 3: manual admin overrides for anything still ambiguous ─────────────

const findOverride = (overrides, ts) =>
  overrides.find((o) => o.rangeStart <= ts && o.rangeEnd >= ts);

/**
 * Attributes every line of a station's raw log text to an employee for the
 * given month, in three tiers:
 *   1. Attendance punches (confirmed — someone was actually clocked in)
 *   2. Scheduled shift (inferred — nobody/multiple people clocked in, but
 *      exactly one candidate was scheduled to be on this station then)
 *   3. Manual admin override (for whatever's still ambiguous after 1 & 2)
 *
 * Returns:
 *   {
 *     byEmployee: { [employeeId]: { confirmed: string[], scheduleInferred: string[] } },
 *     unattributed: { raw, timestamp, candidateCount, reason: 'idle'|'ambiguous' }[]
 *   }
 */
const attributeStationMonth = async (stationId, month, rawText) => {
  const station = await Station.findOne({ stationId });
  const candidateIds = (station?.assignedEmployees || []).map((id) => id.toString());

  const byEmployee = {};
  const unattributed = [];
  const addLine = (employeeId, raw, source) => {
    if (!byEmployee[employeeId]) byEmployee[employeeId] = { confirmed: [], scheduleInferred: [] };
    byEmployee[employeeId][source].push(raw);
  };

  if (!rawText) return { byEmployee, unattributed };

  const lines = rawText.split('\n').filter(Boolean);
  const parsed = lines.map(parseLogLine).filter(Boolean);
  if (parsed.length === 0) return { byEmployee, unattributed };

  if (candidateIds.length === 0) {
    // Nobody registered for this station yet — everything is unattributed
    // until an admin assigns employees to it (see Station admin screen).
    parsed.forEach((p) => unattributed.push({ ...p, candidateCount: 0, reason: 'idle' }));
    return { byEmployee, unattributed };
  }

  const { start, end } = paddedMonthBounds(month);

  const attendanceRecords = await Attendance.find({
    employee: { $in: candidateIds },
    date: { $gte: start, $lt: end },
  }).select('employee checkIn checkOut date');

  const overrides = await AttributionOverride.find({
    station: stationId,
    rangeStart: { $lt: end },
    rangeEnd: { $gte: start },
  });

  // Pre-load each candidate's active shift assignments once (cheap — small
  // list per employee), then compute per-line schedule windows on demand.
  const assignmentsByEmployee = {};
  // NOTE: `ShiftAssignment.employee` is a ref to `User` in the current schema.
  // Stations store `assignedEmployees` as Employee _ids. To handle both shapes
  // without changing the model, resolve each Employee and query assignments
  // by either the Employee._id or the Employee.user (if present).
  for (const employeeId of candidateIds) {
    const emp = await Employee.findById(employeeId).lean();
    const possibleRefs = [employeeId];
    if (emp?.user) possibleRefs.push(emp.user.toString());

    assignmentsByEmployee[employeeId] = await ShiftAssignment.find({
      employee: { $in: possibleRefs },
      status: 'active',
    }).sort({ recurring: -1 });
  }
  for (const { raw, timestamp } of parsed) {
    // Tier 1: attendance
    const attendanceMatches = findCoveringEmployees(attendanceRecords, timestamp);
    if (attendanceMatches.length === 1) {
      addLine(attendanceMatches[0], raw, 'confirmed');
      continue;
    }

    // Tier 2: schedule (only meaningful when tier 1 didn't already resolve it)
    const scheduleByEmployee = {};
    for (const employeeId of candidateIds) {
      scheduleByEmployee[employeeId] = getScheduledWindowsForDay(assignmentsByEmployee[employeeId], timestamp);
    }
    const scheduleMatches = findScheduledEmployees(scheduleByEmployee, timestamp);
    if (scheduleMatches.length === 1) {
      addLine(scheduleMatches[0], raw, 'scheduleInferred');
      continue;
    }

    // Tier 3: manual override
    const override = findOverride(overrides, timestamp);
    if (override) {
      addLine(override.employee.toString(), raw, 'confirmed'); // admin-confirmed
      continue;
    }

    const candidateCount = Math.max(attendanceMatches.length, scheduleMatches.length);
    unattributed.push({
      raw,
      timestamp,
      candidateCount,
      reason: candidateCount === 0 ? 'idle' : 'ambiguous',
    });
  }

  return { byEmployee, unattributed };
};

module.exports = {
  parseLogLine,
  monthBounds,
  attributeStationMonth,
};