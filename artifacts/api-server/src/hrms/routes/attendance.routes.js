const express = require('express');
const { tzOffsetMs } = require('../core/time');
const router = express.Router();
const multer = require('multer');
const upload = multer({
  limits: { fileSize: 2 * 1024 * 1024, files: 5, fields: 50 },
});
const { protect, hrAndAbove } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const Attendance = require('../models/Attendance.model');
const User = require('../models/User.model');
const Employee = require('../models/Employee.model');
const ShiftAssignment = require('../models/ShiftAssignment.model');
const Leave = require('../models/Leave.model');
const LateRequest = require('../models/Laterequest.model');

// ─── UTC helpers ──────────────────────────────────────────────────────────────
function utcToday() {
  const n = new Date();
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()),
  );
}
function utcTomorrow() {
  const n = new Date();
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1),
  );
}
function utcYesterday() {
  const n = new Date();
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - 1),
  );
}

// ─── PKT-anchored day helpers ─────────────────────────────────────────────────
// attendance.date is always stored via getBusinessDateForPunch, which shifts
// the punch by +5h before reading its calendar day — i.e. every stored record
// is keyed to the PKT calendar day, not the raw server/UTC calendar day.
// utcToday()/utcYesterday()/utcTomorrow() above are NOT PKT-shifted, so during
// PKT 00:00–05:00 (UTC 19:00–00:00 the previous day) they land one full day
// behind the business dates actually being stored. Routes that need to find
// "today's" (or "yesterday's" open) attendance record must use these instead.
// Originally fixed to Pakistan time (UTC+5); now the workspace's time zone.
function pktToday() {
  const n = new Date(Date.now() + tzOffsetMs());
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()),
  );
}
function pktTomorrow() {
  const d = pktToday();
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
function pktYesterday() {
  const d = pktToday();
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

// Minutes of grace after shift start before a check-in counts as 'late'.
// e.g. with a 9:00 PM shift: checking in at 9:05 PM is still on time,
// checking in at 9:06 PM or later is marked late.
const LATE_GRACE_MINUTES = 0;

// How far ahead of shift start a check-in has to be before it's flagged as
// an "early" check-in — keeps a normal 2-3 minutes early from being flagged.
const EARLY_THRESHOLD_MINUTES = 15;

// How many minutes past (shift start + grace) the punch was. 0 if on time.
// Single source of truth — computeIsLate is just "> 0" on top of this, so
// the lateness boundary and the displayed duration can never drift apart.
function computeLateMinutes(
  punchMinutes,
  shiftStartMinutes,
  isCrossDayShift = false,
) {
  let effectivePunch = punchMinutes;
  if (isCrossDayShift && shiftStartMinutes > 1200 && punchMinutes < 300) {
    effectivePunch = punchMinutes + 1440;
  }
  const diff = effectivePunch - (shiftStartMinutes + LATE_GRACE_MINUTES);
  return diff > 0 ? diff : 0;
}

function computeIsLate(
  punchMinutes,
  shiftStartMinutes,
  isCrossDayShift = false,
) {
  return (
    computeLateMinutes(punchMinutes, shiftStartMinutes, isCrossDayShift) > 0
  );
}

// How many minutes ahead of (shift start - threshold) the punch was. 0 if
// not early enough to flag. Same cross-day wraparound as computeLateMinutes
// so the two never disagree about which calendar day the punch belongs to.
function computeEarlyMinutes(
  punchMinutes,
  shiftStartMinutes,
  isCrossDayShift = false,
) {
  let effectivePunch = punchMinutes;
  if (isCrossDayShift && shiftStartMinutes > 1200 && punchMinutes < 300) {
    effectivePunch = punchMinutes + 1440;
  }
  const diff = shiftStartMinutes - EARLY_THRESHOLD_MINUTES - effectivePunch;
  return diff > 0 ? diff : 0;
}

// ─── Get shift assignment for a specific date ──────────────────────────
async function getShiftForDate(employeeId, targetDate) {
  const dayOfWeek = targetDate.getUTCDay();
  const dateOnly = new Date(
    Date.UTC(
      targetDate.getUTCFullYear(),
      targetDate.getUTCMonth(),
      targetDate.getUTCDate(),
    ),
  );

  const assignments = await ShiftAssignment.find({
    employee: employeeId,
    status: 'active',
  }).sort({ recurring: -1 });

  // 1. Check specific date-range shifts first
  for (const a of assignments) {
    if (!a.recurring && a.startDate && a.endDate) {
      const s = new Date(
        Date.UTC(
          new Date(a.startDate).getUTCFullYear(),
          new Date(a.startDate).getUTCMonth(),
          new Date(a.startDate).getUTCDate(),
        ),
      );
      const e = new Date(
        Date.UTC(
          new Date(a.endDate).getUTCFullYear(),
          new Date(a.endDate).getUTCMonth(),
          new Date(a.endDate).getUTCDate(),
        ),
      );
      if (dateOnly >= s && dateOnly <= e) return a;
    }
  }

  // 2. Check recurring weekday shifts
  for (const a of assignments) {
    if (a.recurring && typeof a.weekday === 'number' && a.weekday === dayOfWeek)
      return a;
  }

  return null;
}

// ─── Get cross-day shift from previous day ───────────────────────────────
async function _getCrossDayShiftFromYesterday(employeeId, todayDate) {
  const yesterday = new Date(todayDate);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const yesterdayShift = await getShiftForDate(employeeId, yesterday);

  if (yesterdayShift?.crossDay) {
    return yesterdayShift;
  }
  return null;
}

// ─── Determine which "business date" a punch belongs to ──────────────────
function getBusinessDateForPunch(
  punchTime,
  shiftStartTime = '09:00',
  isCrossDay = false,
) {
  const localPunch = new Date(punchTime.getTime() + tzOffsetMs(punchTime)); // workspace wall-clock time
  const [shiftHour] = shiftStartTime.split(':').map(Number);

  let businessDate = new Date(
    Date.UTC(
      localPunch.getUTCFullYear(),
      localPunch.getUTCMonth(),
      localPunch.getUTCDate(),
    ),
  );

  // Cross-day shift: if punch is before 5 AM and shift starts at/after 6 PM
  // → belongs to PREVIOUS day
  if (isCrossDay && localPunch.getUTCHours() < 5 && shiftHour >= 18) {
    businessDate.setUTCDate(businessDate.getUTCDate() - 1);
  }

  return businessDate;
}

// ─── Approved-leave helpers ───────────────────────────────────────────────────
async function getApprovedLeaveIntervals(employeeIds, rangeStart, rangeEnd) {
  const leaves = await Leave.find({
    employee: { $in: employeeIds },
    status: 'approved',
    startDate: { $lte: rangeEnd },
    endDate: { $gte: rangeStart },
  }).select('employee startDate endDate leaveType');

  const map = {};
  leaves.forEach((l) => {
    const key = l.employee.toString();
    if (!map[key]) map[key] = [];
    map[key].push({
      start: new Date(l.startDate),
      end: new Date(l.endDate),
      leaveType: l.leaveType,
    });
  });
  return map;
}

function isDateOnLeave(intervals, date) {
  if (!intervals || !intervals.length) return false;
  const d = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return intervals.some(({ start, end }) => {
    const s = Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
    );
    const e = Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth(),
      end.getUTCDate(),
    );
    return d >= s && d <= e;
  });
}

function getLeaveTypeOnDate(intervals, date) {
  if (!intervals || !intervals.length) return null;
  const d = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const match = intervals.find(({ start, end }) => {
    const s = Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
    );
    const e = Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth(),
      end.getUTCDate(),
    );
    return d >= s && d <= e;
  });
  return match?.leaveType || null;
}

// ─── Late-request helpers ───────────────────────────────────────────────────
// Builds a map of "employeeId|yyyy-mm-dd" → the LateRequest doc, for every
// late request (any status) that overlaps the given range. Used to decide,
// for any attendance record whose status is 'late', whether it should
// render as "Approved" or "Unapproved".
async function getLateRequestMap(employeeIds, rangeStart, rangeEnd) {
  const requests = await LateRequest.find({
    employee: { $in: employeeIds },
    date: { $gte: rangeStart, $lte: rangeEnd },
  }).select('employee date lateFrom lateTo status reviewNote');

  const map = {};
  requests.forEach((r) => {
    const key = `${r.employee.toString()}|${new Date(r.date).toISOString().split('T')[0]}`;
    map[key] = r;
  });
  return map;
}

// Only meaningful when the attendance status is 'late'. Returns:
//  'approved'   — a matching LateRequest exists and was approved
//  'unapproved' — no request, a pending request, or a rejected request
function getLateApproval(lateRequestMap, employeeId, date) {
  const key = `${employeeId.toString()}|${new Date(date).toISOString().split('T')[0]}`;
  const req = lateRequestMap[key];
  return req?.status === 'approved' ? 'approved' : 'unapproved';
}

// ─── 1. STATIC NAMED ROUTES ───────────────────────────────────────────────────

// GET /attendance/today — Employee self view
router.get(
  '/today',
  protect,
  asyncHandler(async (req, res) => {
    const todayUTC = pktToday();
    const tomorrowUTC = pktTomorrow();
    const yesterdayUTC = pktYesterday();

    const record = await Attendance.findOne({
      employee: req.user._id,
      $or: [
        { date: { $gte: todayUTC, $lt: tomorrowUTC } },
        {
          date: { $gte: yesterdayUTC, $lt: todayUTC },
          'checkIn.time': { $exists: true },
          'checkOut.time': { $exists: false },
        },
      ],
    }).sort({ 'checkIn.time': -1 });

    let liveHours = null;
    let isWorking = false;

    if (record?.checkIn?.time && !record?.checkOut?.time) {
      liveHours = parseFloat(
        (
          (Date.now() - new Date(record.checkIn.time).getTime()) /
          3600000
        ).toFixed(1),
      );
      isWorking = true;
    }

    const businessDate = record ? record.date : todayUTC;
    const currentWeekday = businessDate.getUTCDay();

    const todayAssignment = await ShiftAssignment.findOne({
      employee: req.user._id,
      status: 'active',
      $or: [
        { recurring: true, weekday: currentWeekday },
        {
          recurring: false,
          startDate: { $lte: businessDate },
          endDate: { $gte: businessDate },
        },
      ],
    });

    res.json({
      success: true,
      data: record
        ? {
            ...record.toObject(),
            liveHours,
            isWorking,
            isCheckedOut: !!record.checkOut?.time,
          }
        : null,
      assignedWorkMode: todayAssignment?.workMode || 'office',
      shiftStart: todayAssignment?.startTime || '09:00',
      shiftEnd: todayAssignment?.endTime || '18:00',
      isCrossDay: todayAssignment?.crossDay || false,
    });
  }),
);

// GET /attendance/report
router.get(
  '/report',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const {
      month = new Date().getUTCMonth() + 1,
      year = new Date().getUTCFullYear(),
    } = req.query;
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const stats = await Attendance.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgHours: { $avg: '$totalHours' },
        },
      },
    ]);

    res.json({ success: true, data: { stats, month, year } });
  }),
);

// GET /attendance/my-stats
router.get(
  '/my-stats',
  protect,
  asyncHandler(async (req, res) => {
    const now = new Date();
    const month = parseInt(req.query.month) || now.getUTCMonth() + 1;
    const year = parseInt(req.query.year) || now.getUTCFullYear();

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const records = await Attendance.find({
      employee: req.user._id,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: -1 });

    const lateRequestMap = await getLateRequestMap(
      [req.user._id],
      startDate,
      endDate,
    );
    const recordsWithApproval = records.map((r) => {
      const obj = r.toObject();
      obj.lateApproval =
        r.status === 'late'
          ? getLateApproval(lateRequestMap, req.user._id, r.date)
          : null;
      return obj;
    });

    const presentDays = records.filter((r) =>
      ['present', 'work_from_home', 'working'].includes(r.status),
    ).length;
    const lateDays = records.filter((r) => r.status === 'late').length;
    const lateDaysApproved = recordsWithApproval.filter(
      (r) => r.lateApproval === 'approved',
    ).length;
    const lateDaysUnapproved = lateDays - lateDaysApproved;
    const absentDays = records.filter((r) => r.status === 'absent').length;
    const totalHours = records.reduce((sum, r) => {
      if (r.totalHours > 0) return sum + r.totalHours;
      if (r.checkIn?.time && !r.checkOut?.time)
        return (
          sum + (Date.now() - new Date(r.checkIn.time).getTime()) / 3600000
        );
      return sum;
    }, 0);

    const weeklyMap = {};
    records.forEach((r) => {
      const d = new Date(r.date);
      const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const week = Math.ceil(
        ((d - jan1) / 86400000 + jan1.getUTCDay() + 1) / 7,
      );
      const key = `W${week}`;
      weeklyMap[key] = (weeklyMap[key] || 0) + (r.totalHours || 0);
    });

    const weeklyHours = Object.entries(weeklyMap)
      .map(([week, hours]) => ({ week, hours: parseFloat(hours.toFixed(1)) }))
      .reverse();

    res.json({
      success: true,
      data: {
        records: recordsWithApproval,
        stats: {
          presentDays,
          lateDays,
          lateDaysApproved,
          lateDaysUnapproved,
          absentDays,
          totalHours: parseFloat(totalHours.toFixed(1)),
        },
        weeklyHours,
        month,
        year,
      },
    });
  }),
);

// GET /attendance/admin/today
router.get(
  '/admin/today',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const allActiveUsers = await User.find({
      isActive: true,
      deletedAt: null,
      // Terminated and resigned employees are soft-kept as isActive:true for
      // record-keeping, but they should never appear in Live Attendance or be
      // counted toward today's stats/total — they're no longer part of the
      // active workforce.
      status: { $nin: ['terminated', 'resigned'] },
      role: { $nin: ['admin', 'super_admin'] },
    })
      .populate('department', 'name')
      .select('firstName lastName employeeId department position avatar');

    const eligibleUserIds = allActiveUsers.map((u) => u._id);
    const todayUTC = utcToday();
    const yesterdayUTC = utcYesterday();

    const leaveMap = await getApprovedLeaveIntervals(
      eligibleUserIds,
      todayUTC,
      todayUTC,
    );
    const lateRequestMap = await getLateRequestMap(
      eligibleUserIds,
      yesterdayUTC,
      todayUTC,
    );

    const todayRecords = await Attendance.find({
      employee: { $in: eligibleUserIds },
      $or: [
        { date: { $gte: todayUTC, $lt: utcTomorrow() } },
        {
          date: { $gte: yesterdayUTC, $lt: todayUTC },
          'checkIn.time': { $exists: true },
          'checkOut.time': { $exists: false },
        },
      ],
    }).populate(
      'employee',
      'firstName lastName employeeId department position avatar',
    );

    const yesterdayShiftMap = {};
    for (const u of allActiveUsers) {
      const shift = await getShiftForDate(u._id, yesterdayUTC);
      if (shift?.crossDay) {
        yesterdayShiftMap[u._id.toString()] = shift;
      }
    }

    const employeeRows = await Promise.all(
      allActiveUsers.map(async (u) => {
        const userRecords = todayRecords
          .filter((r) => r.employee?._id?.toString() === u._id.toString())
          .sort(
            (a, b) =>
              new Date(b.checkIn?.time || 0) - new Date(a.checkIn?.time || 0),
          );

        let record = userRecords.find(
          (r) =>
            new Date(r.date).toISOString().split('T')[0] ===
            todayUTC.toISOString().split('T')[0],
        );

        if (!record && yesterdayShiftMap[u._id.toString()]) {
          record = userRecords.find(
            (r) =>
              new Date(r.date).toISOString().split('T')[0] ===
                yesterdayUTC.toISOString().split('T')[0] && !r.checkOut?.time,
          );
        }

        const hasActualPunch = !!record?.checkIn?.time;
        const onLeaveToday =
          !hasActualPunch &&
          isDateOnLeave(leaveMap[u._id.toString()], todayUTC);
        const leaveTypeToday = onLeaveToday
          ? getLeaveTypeOnDate(leaveMap[u._id.toString()], todayUTC)
          : null;

        let displayStatus = 'absent';
        let displayDate = todayUTC;

        if (onLeaveToday) {
          displayStatus = 'on_leave';
        } else if (record) {
          displayDate = record.date;
          if (record.checkOut?.time) {
            displayStatus = record.status || 'present';
          } else if (record.status === 'late') {
            displayStatus = 'late';
          } else if (['present', 'work_from_home'].includes(record.status)) {
            displayStatus = 'working';
          } else {
            displayStatus = record.status || 'working';
          }
        }

        const shift = await getShiftForDate(u._id, displayDate);
        const shiftStart = shift?.startTime || '09:00';

        // An employee with no shift assigned for the relevant date was never
        // scheduled to work that day, so they shouldn't be flagged 'absent'.
        // (If they actually have a record — present/late/working — or are on
        // approved leave, we still show them; this only suppresses the
        // false-absent case caused by a missing shift assignment.)
        if (!shift && displayStatus === 'absent') {
          return null;
        }

        return {
          userId: u._id,
          name: `${u.firstName} ${u.lastName}`,
          employeeId: u.employeeId,
          dept: u.department?.name || '—',
          position: u.position || '—',
          avatar: u.avatar || null,
          checkIn: record?.checkIn?.time || null,
          checkOut: record?.checkOut?.time || null,
          hours: record?.totalHours || 0,
          totalHours: record?.totalHours || 0,
          status: displayStatus,
          leaveType: leaveTypeToday,
          lateMinutes: record?.lateMinutes || 0,
          earlyMinutes: record?.earlyMinutes || 0,
          // Only meaningful when displayStatus is 'late' — tells the UI whether
          // to render "Approved" or "Unapproved" next to the late badge.
          lateApproval:
            displayStatus === 'late'
              ? getLateApproval(lateRequestMap, u._id, displayDate)
              : null,
          mode: record?.workMode || shift?.workMode || '—',
          shiftStart,
          isCrossDay: shift?.crossDay || false,
          liveHours:
            record && !record.checkOut?.time && record.checkIn?.time
              ? parseFloat(
                  (
                    (Date.now() - new Date(record.checkIn.time).getTime()) /
                    3600000
                  ).toFixed(1),
                )
              : null,
          businessDate: displayDate,
        };
      }),
    );

    // Employees with no shift assigned (and no real attendance/leave) were
    // filtered to `null` above — drop them so they don't appear in the table
    // and don't get counted in the stat cards.
    const visibleEmployeeRows = employeeRows.filter(Boolean);

    const stats = {
      // Present = actually showed up today, whether on time, late, or still
      // clocked in. Being late or currently working doesn't make someone
      // "not present" — the Late card still shows the late-specific count.
      present: visibleEmployeeRows.filter((r) =>
        ['present', 'late', 'working'].includes(r.status),
      ).length,
      working: visibleEmployeeRows.filter((r) => r.status === 'working').length,
      late: visibleEmployeeRows.filter((r) => r.status === 'late').length,
      absent: visibleEmployeeRows.filter((r) => r.status === 'absent').length,
      on_leave: visibleEmployeeRows.filter((r) => r.status === 'on_leave')
        .length,
      remote: visibleEmployeeRows.filter(
        (r) => r.mode === 'remote' || r.mode === 'hybrid',
      ).length,
      total: visibleEmployeeRows.length,
    };

    res.json({
      success: true,
      data: { stats, employees: visibleEmployeeRows },
    });
  }),
);

// GET /attendance/admin/weekly
router.get(
  '/admin/weekly',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const now = new Date();
    const day = now.getUTCDay();
    const mon = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - (day === 0 ? 6 : day - 1),
      ),
    );
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    sun.setUTCHours(23, 59, 59, 999);

    const nonAdminUsers = await User.find({
      role: { $nin: ['admin', 'super_admin'] },
    }).select('_id');
    const nonAdminIds = nonAdminUsers.map((u) => u._id);

    const records = await Attendance.find({
      date: { $gte: mon, $lte: sun },
      employee: { $in: nonAdminIds },
    });

    const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weeklyMap = Object.fromEntries(
      DAY_LABELS.map((d) => [
        d,
        {
          day: d,
          present: 0,
          late: 0,
          absent: 0,
          on_leave: 0,
          working: 0,
        },
      ]),
    );

    records.forEach((r) => {
      const jsDay = new Date(r.date).getUTCDay();
      const label = DAY_LABELS[jsDay === 0 ? 6 : jsDay - 1];
      if (!weeklyMap[label]) return;
      if (['present', 'work_from_home'].includes(r.status))
        weeklyMap[label].present++;
      else if (r.status === 'late') weeklyMap[label].late++;
      else if (r.status === 'absent') weeklyMap[label].absent++;
      else if (r.status === 'on_leave') weeklyMap[label].on_leave++;
      else if (r.status === 'working') weeklyMap[label].working++;
    });

    res.json({ success: true, data: DAY_LABELS.map((d) => weeklyMap[d]) });
  }),
);

// GET /attendance/admin/range
router.get(
  '/admin/range',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const { startDate, endDate, page = 1, limit = 50 } = req.query;
    if (!startDate || !endDate)
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required',
      });

    const start = new Date(startDate);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);
    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const pageLimit = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));

    const allActiveUsers = await User.find({
      isActive: true,
      deletedAt: null,
      status: { $nin: ['terminated', 'resigned'] },
      role: { $nin: ['admin', 'super_admin'] },
    })
      .populate('department', 'name')
      .select('firstName lastName employeeId department position avatar');

    const eligibleUserIds = allActiveUsers.map((u) => u._id);

    const attendanceRecords = await Attendance.find({
      employee: { $in: eligibleUserIds },
      date: { $gte: start, $lte: end },
    })
      .populate(
        'employee',
        'firstName lastName employeeId department position avatar',
      )
      .lean();

    const leaveMap = await getApprovedLeaveIntervals(
      eligibleUserIds,
      start,
      end,
    );
    const lateRequestMap = await getLateRequestMap(eligibleUserIds, start, end);
    const assignments = await ShiftAssignment.find({
      employee: { $in: eligibleUserIds },
      status: 'active',
    }).lean();

    const assignmentsByUser = {};
    assignments.forEach((a) => {
      const uid = a.employee.toString();
      if (!assignmentsByUser[uid]) assignmentsByUser[uid] = [];
      assignmentsByUser[uid].push(a);
    });

    const getShiftForDateFromCache = (employeeId, targetDate) => {
      const uid = employeeId.toString();
      const userAssignments = assignmentsByUser[uid] || [];
      const dayOfWeek = targetDate.getUTCDay();
      const dateOnly = new Date(
        Date.UTC(
          targetDate.getUTCFullYear(),
          targetDate.getUTCMonth(),
          targetDate.getUTCDate(),
        ),
      );

      for (const a of userAssignments) {
        if (!a.recurring && a.startDate && a.endDate) {
          const s = new Date(
            Date.UTC(
              new Date(a.startDate).getUTCFullYear(),
              new Date(a.startDate).getUTCMonth(),
              new Date(a.startDate).getUTCDate(),
            ),
          );
          const e = new Date(
            Date.UTC(
              new Date(a.endDate).getUTCFullYear(),
              new Date(a.endDate).getUTCMonth(),
              new Date(a.endDate).getUTCDate(),
            ),
          );
          if (dateOnly >= s && dateOnly <= e) return a;
        }
      }

      for (const a of userAssignments) {
        if (
          a.recurring &&
          typeof a.weekday === 'number' &&
          a.weekday === dayOfWeek
        )
          return a;
      }

      return null;
    };

    const recordMap = {};
    attendanceRecords.forEach((r) => {
      const uid = r.employee?._id?.toString();
      if (!uid) return;
      const dayKey = new Date(r.date).toISOString().split('T')[0];
      if (!recordMap[uid]) recordMap[uid] = {};
      recordMap[uid][dayKey] = r;
    });

    const rows = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dayKey = d.toISOString().split('T')[0];
      for (const u of allActiveUsers) {
        const uid = u._id.toString();
        const shift = getShiftForDateFromCache(u._id, d);
        const leaveType = getLeaveTypeOnDate(leaveMap[uid], d);
        const hasLeave = !!leaveType;
        const record = recordMap[uid]?.[dayKey];

        if (!shift && !hasLeave && !record) continue;

        const row = {
          userId: u._id,
          name: `${u.firstName} ${u.lastName}`,
          employeeId: u.employeeId,
          dept: u.department?.name || '—',
          position: u.position || '—',
          avatar: u.avatar || null,
          date: new Date(
            Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
          ),
          checkIn: null,
          checkOut: null,
          hours: 0,
          totalHours: 0,
          liveHours: null,
          mode: shift?.workMode || 'office',
          status: 'absent',
          leaveType: leaveType || null,
          lateMinutes: 0,
          earlyMinutes: 0,
          lateApproval: null,
        };

        if (record) {
          row.checkIn = record.checkIn?.time || null;
          row.checkOut = record.checkOut?.time || null;
          row.hours = record.totalHours || 0;
          row.totalHours = record.totalHours || 0;
          row.mode = record.workMode || row.mode;
          row.lateMinutes = record.lateMinutes || 0;
          row.earlyMinutes = record.earlyMinutes || 0;
          row.lateApproval =
            record.status === 'late'
              ? getLateApproval(lateRequestMap, uid, record.date)
              : null;

          if (record.checkOut?.time) {
            row.status = record.status || 'present';
          } else if (record.status === 'late') {
            row.status = 'late';
          } else if (['present', 'work_from_home'].includes(record.status)) {
            row.status = 'working';
          } else {
            row.status = record.status || 'working';
          }
          if (record.checkIn?.time) {
            row.liveHours = parseFloat(
              (
                (Date.now() - new Date(record.checkIn.time).getTime()) /
                3600000
              ).toFixed(1),
            );
          }
        } else if (hasLeave) {
          row.status = 'on_leave';
        } else {
          row.status = 'absent';
        }

        rows.push(row);
      }
    }

    rows.sort((a, b) => {
      if (a.date.getTime() !== b.date.getTime()) return b.date - a.date;
      return a.name.localeCompare(b.name);
    });

    const total = rows.length;
    const pagedRows = rows.slice(
      (pageNumber - 1) * pageLimit,
      pageNumber * pageLimit,
    );

    const stats = {
      present: rows.filter((r) =>
        ['present', 'late', 'working'].includes(r.status),
      ).length,
      working: rows.filter((r) => r.status === 'working').length,
      late: rows.filter((r) => r.status === 'late').length,
      absent: rows.filter((r) => r.status === 'absent').length,
      on_leave: rows.filter((r) => r.status === 'on_leave').length,
      remote: rows.filter((r) => r.mode === 'remote' || r.mode === 'hybrid')
        .length,
      total: rows.length,
    };

    res.json({ success: true, data: { records: pagedRows, total, stats } });
  }),
);

// ─── 2. COLLECTION ROUTE ──────────────────────────────────────────────────────

// GET /attendance (history)
router.get(
  '/',
  protect,
  asyncHandler(async (req, res) => {
    const { employeeId, startDate, endDate, page = 1, limit = 31 } = req.query;
    const query = {};

    if (req.user.role === 'employee') query.employee = req.user._id;
    else if (employeeId) query.employee = employeeId;

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const [records, total] = await Promise.all([
      Attendance.find(query)
        .populate('employee', 'firstName lastName employeeId')
        .sort({ date: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit)),
      Attendance.countDocuments(query),
    ]);

    // Attach lateApproval so callers (e.g. the admin employee-detail modal,
    // or an employee viewing their own history) can render Approved/Unapproved
    // next to any 'late' day without a second round trip.
    const involvedEmployeeIds = [
      ...new Set(
        records.map((r) => r.employee?._id?.toString()).filter(Boolean),
      ),
    ];
    const lateRequestMap = involvedEmployeeIds.length
      ? await getLateRequestMap(
          involvedEmployeeIds,
          records.length
            ? new Date(Math.min(...records.map((r) => new Date(r.date))))
            : new Date(0),
          records.length
            ? new Date(Math.max(...records.map((r) => new Date(r.date))))
            : new Date(0),
        )
      : {};

    const recordsWithApproval = records.map((r) => {
      const obj = r.toObject();
      obj.lateApproval =
        r.status === 'late'
          ? getLateApproval(lateRequestMap, r.employee?._id, r.date)
          : null;
      return obj;
    });

    res.json({ success: true, data: recordsWithApproval, total });
  }),
);

// ─── 3. MUTATION ROUTES ───────────────────────────────────────────────────────

function normalizeLocation(loc, fallback = 'web') {
  if (!loc) return { address: fallback };
  if (typeof loc === 'string') return { address: loc };
  return loc;
}

// POST /attendance/checkin
router.post(
  '/checkin',
  protect,
  asyncHandler(async (req, res) => {
    // 1. Find any open session for this employee
    const openRecord = await Attendance.findOne({
      employee: req.user._id,
      'checkIn.time': { $exists: true },
      'checkOut.time': { $exists: false },
    }).sort({ 'checkIn.time': -1 });

    if (openRecord && openRecord.checkIn?.time) {
      return res
        .status(400)
        .json({ success: false, message: 'Already checked in (open session)' });
    }

    const userEmployee = await Employee.findOne({ user: req.user._id }).lean();
    if (!userEmployee) {
      return res
        .status(404)
        .json({ success: false, message: 'Employee profile not found.' });
    }

    const now = new Date();
    const localPunch = new Date(now.getTime() + tzOffsetMs(now)); // workspace wall-clock time

    // 2. Find applicable shift assignment
    let assignment = await getShiftForDate(req.user._id, localPunch);

    if (!assignment && localPunch.getUTCHours() < 5) {
      const yesterday = new Date(localPunch);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayShift = await getShiftForDate(req.user._id, yesterday);
      if (yesterdayShift?.crossDay) {
        assignment = yesterdayShift;
      }
    }

    const shiftStart =
      assignment?.startTime || userEmployee?.shift?.startTime || '09:00';
    const isCrossDayShift = assignment
      ? assignment.crossDay
      : userEmployee?.shift?.crossDay || false;

    const [shiftHour, shiftMinute] = shiftStart
      .split(':')
      .map((p) => Number(p) || 0);
    const punchMinutes =
      localPunch.getUTCHours() * 60 + localPunch.getUTCMinutes();
    const shiftStartMinutes = shiftHour * 60 + shiftMinute;

    let isLate = computeIsLate(
      punchMinutes,
      shiftStartMinutes,
      isCrossDayShift,
    );
    const lateMinutes = computeLateMinutes(
      punchMinutes,
      shiftStartMinutes,
      isCrossDayShift,
    );
    const earlyMinutes = computeEarlyMinutes(
      punchMinutes,
      shiftStartMinutes,
      isCrossDayShift,
    );

    // Business date this punch belongs to (mirrors the biometric-webhook logic) —
    // required below; was missing before, which made every /checkin call throw
    // "ReferenceError: recordDate is not defined".
    const recordDate = getBusinessDateForPunch(
      now,
      shiftStart,
      isCrossDayShift,
    );

    // ── FIX: Check for ANY existing record on this business date (open OR completed) ──
    const existingRecord = await Attendance.findOne({
      employee: req.user._id,
      date: recordDate,
    });

    if (existingRecord) {
      if (existingRecord.checkOut?.time) {
        return res.status(400).json({
          success: false,
          message: `You have already completed attendance for ${recordDate.toISOString().split('T')[0]}`,
        });
      } else {
        return res.status(400).json({
          success: false,
          message: 'Already checked in (existing session found)',
        });
      }
    }

    const record = new Attendance({
      employee: req.user._id,
      date: recordDate,
      status: isLate ? 'late' : 'present',
      lateMinutes,
      earlyMinutes,
      workMode:
        req.body.workMode ||
        assignment?.workMode ||
        userEmployee?.shift?.workMode ||
        'office',
    });

    record.checkIn = {
      time: now,
      method: req.body.method || 'manual',
      location: normalizeLocation(req.body.location),
    };

    await record.save();

    if (req.io)
      req.io.to('role:admin').emit('attendance:live', {
        userId: req.user._id,
        action: 'checkin',
        time: now,
        businessDate: recordDate,
      });

    res.json({
      success: true,
      data: record,
      message: `Checked in successfully at ${now.toLocaleTimeString()}`,
    });
  }),
);

// POST /attendance/checkout
router.post(
  '/checkout',
  protect,
  asyncHandler(async (req, res) => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);

    const record = await Attendance.findOne({
      employee: req.user._id,
      'checkIn.time': { $exists: true },
      'checkOut.time': { $exists: false },
      date: { $gte: yesterday },
    }).sort({ 'checkIn.time': -1 });

    if (!record?.checkIn?.time)
      return res
        .status(400)
        .json({ success: false, message: 'No open check-in session found' });
    if (record.checkOut?.time)
      return res
        .status(400)
        .json({ success: false, message: 'Already checked out' });

    const now = new Date();
    record.checkOut = {
      time: now,
      method: req.body.method || 'manual',
      location: normalizeLocation(req.body.location),
    };
    record.totalHours = parseFloat(
      ((now - new Date(record.checkIn.time)) / 3600000).toFixed(2),
    );

    if (record.status === 'working') {
      record.status = 'present';
    }

    await record.save();

    if (req.io)
      req.io.to('role:admin').emit('attendance:live', {
        userId: req.user._id,
        action: 'checkout',
        time: now,
        businessDate: record.date,
      });

    res.json({
      success: true,
      data: record,
      message: `Checked out at ${now.toLocaleTimeString()}`,
    });
  }),
);

// POST /attendance/biometric-webhook
// ─────────────────────────────────────────────────────────────────────────────
// BUGS FIXED:
//
// FIX 1 — Stale-session close before new insert
//   Old code: flagged openRecord but never set checkOut, then tried to INSERT
//   a new record for the same employee+date → E11000 duplicate key.
//   Fix: auto-close the stale session with checkOut = punchTime before creating
//   a new record.
//
// FIX 2 — Duplicate check missed open records
//   Old code: `{ 'checkOut.time': { $exists: true } }` — only blocked completed
//   records. If an open record already existed for the same date (e.g. the device
//   sent a second check-in event), the check passed and INSERT crashed.
//   Fix: look for ANY existing record (open OR completed) for that business date.
//
// FIX 3 — absoluteCheckInIntent with non-stale open record
//   Old code: entered the check-in branch whenever the device said "checkIn",
//   even when an open non-stale session existed. It then hit FIX 2's bug path.
//   Fix: when the device says check-in but a fresh open session already exists,
//   treat it as a duplicate punch and skip silently.
//
// FIX 4 — Race-condition safety net
//   Two near-simultaneous punches can both pass every check before either write
//   commits. Wrap the insert in a try-catch for error code 11000 and skip
//   gracefully instead of crashing the webhook (which would drop the 200 OK
//   and cause the Hikvision device to keep retrying).
//
// FIX 5 — Debounce checked only checkIn.time
//   Old code: `openRecord.checkIn.time` for debounce. If the previous event was
//   a checkout (no openRecord), debounce was skipped entirely.
//   Fix: track the most recent event time from both checkIn and checkOut across
//   all records in the last 5 minutes.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/biometric-webhook',
  upload.any(),
  asyncHandler(async (req, res) => {
    console.log('[Biometric:INCOMING] New request received');

    // The HR router accepted this request only with a valid per-workspace
    // device key (?key=… or the legacy ?secret=…) and set the workspace.
    if (req.hrmsAuthKind !== 'device') {
      console.log('[Biometric:REJECTED] Bad/missing device key');
      return res.status(200).send('OK');
    }

    const rawLog = req.body?.event_log;
    if (!rawLog) {
      console.log(
        '[Biometric:NO_EVENT_LOG] Keys in body:',
        Object.keys(req.body || {}),
      );
      return res.status(200).send('OK');
    }

    let outer;
    try {
      outer = JSON.parse(rawLog);
    } catch (err) {
      console.error('[Biometric:PARSE_ERROR]', err.message);
      return res.status(200).send('OK');
    }

    const event = outer?.AccessControllerEvent;
    if (!event) {
      console.log('[Biometric:NO_ACCESS_EVENT] Skipping non-access event');
      return res.status(200).send('OK');
    }

    const deviceEmployeeId = String(event.employeeNoString || '').trim();
    const deviceTimeStr = outer.dateTime;

    if (!deviceEmployeeId || !deviceTimeStr) {
      console.log(
        '[Biometric:NON_PUNCH] Door/system event, no employeeId — skipping',
      );
      return res.status(200).send('OK');
    }

    console.log(
      `[Biometric:PUNCH_RECEIVED] employeeId="${deviceEmployeeId}" time="${deviceTimeStr}" status="${event.attendanceStatus}" name="${event.name || 'n/a'}"`,
    );

    const punchTime = new Date(deviceTimeStr);
    if (isNaN(punchTime.getTime())) {
      console.error(`[Biometric:INVALID_TIME] "${deviceTimeStr}"`);
      return res.status(200).send('OK');
    }

    // 1. Fetch User and Profile
    let user = await User.findOne({
      employeeId: deviceEmployeeId,
      isActive: true,
      deletedAt: null,
    });
    if (!user) {
      const strippedId = deviceEmployeeId.replace(/^0+/, '') || '0';
      if (strippedId !== deviceEmployeeId) {
        user = await User.findOne({
          employeeId: strippedId,
          isActive: true,
          deletedAt: null,
        });
      }
    }
    if (!user) {
      console.warn(
        `[Biometric:USER_NOT_FOUND] employeeId="${deviceEmployeeId}"`,
      );
      return res.status(200).send('OK');
    }
    const employeeProfile = await Employee.findOne({ user: user._id }).lean();
    if (!employeeProfile) {
      console.warn(`[Biometric:PROFILE_NOT_FOUND] user="${user._id}"`);
      return res.status(200).send('OK');
    }

    // 2. Find shift assignment for this punch
    const localPunch = new Date(punchTime.getTime() + tzOffsetMs(punchTime)); // workspace wall-clock time
    let assignment = await getShiftForDate(user._id, localPunch);

    if (!assignment && localPunch.getUTCHours() < 5) {
      const yesterday = new Date(localPunch);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayShift = await getShiftForDate(user._id, yesterday);
      if (yesterdayShift?.crossDay) {
        assignment = yesterdayShift;
      }
    }

    const activeShiftStart =
      assignment?.startTime || employeeProfile?.shift?.startTime || '09:00';
    const isCrossDayShift = assignment
      ? assignment.crossDay
      : employeeProfile?.shift?.crossDay || false;
    const [shiftHour, shiftMinute] = activeShiftStart
      .split(':')
      .map((part) => Number(part) || 0);

    // Capture hardware intent
    const deviceStatusIntent = String(
      event.attendanceStatus || '',
    ).toLowerCase();
    const absoluteCheckInIntent = ['checkin', 'check_in'].includes(
      deviceStatusIntent,
    );
    const absoluteCheckOutIntent = ['checkout', 'check_out'].includes(
      deviceStatusIntent,
    );

    // 3. Fetch the last open session (look back to yesterday for cross-day)
    const yesterdayForLookup = new Date();
    yesterdayForLookup.setUTCDate(yesterdayForLookup.getUTCDate() - 1);
    yesterdayForLookup.setUTCHours(0, 0, 0, 0);

    const openRecord = await Attendance.findOne({
      employee: user._id,
      'checkIn.time': { $exists: true },
      'checkOut.time': { $exists: false },
      date: { $gte: yesterdayForLookup },
    }).sort({ 'checkIn.time': -1 });

    // ── FIX 5: Debounce — check against the most recent punch of any kind (90s) ──
    const recentCutoff = new Date(punchTime.getTime() - 90000);
    const recentRecord = await Attendance.findOne({
      employee: user._id,
      $or: [
        { 'checkIn.time': { $gte: recentCutoff } },
        { 'checkOut.time': { $gte: recentCutoff } },
      ],
    }).sort({ 'checkIn.time': -1 });

    if (recentRecord) {
      const lastEventTime = recentRecord.checkOut?.time
        ? Math.max(
            new Date(recentRecord.checkOut.time).getTime(),
            new Date(recentRecord.checkIn.time).getTime(),
          )
        : new Date(recentRecord.checkIn.time).getTime();

      if (punchTime.getTime() - lastEventTime < 90000) {
        console.log(
          `[Biometric:DEBOUNCED] ${user.firstName} ${user.lastName} — punch within 90s of last event`,
        );
        return res.status(200).send('OK');
      }
    }

    const MAX_OPEN_HOURS = 16;
    const openTooLong = openRecord
      ? (punchTime - new Date(openRecord.checkIn.time)) / 3600000 >
        MAX_OPEN_HOURS
      : false;

    // Helper to close an open session
    const closeSession = async (record, note = null) => {
      record.checkOut = {
        time: punchTime,
        method: 'biometric',
        location: { address: 'Office Terminal' },
      };
      if (note) record.notes = note;

      const diffMs =
        punchTime.getTime() - new Date(record.checkIn.time).getTime();
      record.totalHours = parseFloat((diffMs / 3600000).toFixed(2));

      if (record.status === 'working') record.status = 'present';
      if (
        !['late', 'present', 'work_from_home', 'half_day'].includes(
          record.status,
        )
      ) {
        record.status = 'present';
      }

      await record.save();
      if (req.io)
        req.io.to('role:admin').emit('attendance:live', {
          userId: user._id,
          action: 'checkout',
          time: punchTime,
          businessDate: record.date,
        });
    };

    // 4. DETERMINE ACTION
    if (absoluteCheckOutIntent) {
      // ── Device explicitly says CHECK-OUT ──
      if (openRecord) {
        console.log(
          `[Biometric:CHECKOUT] Closing session for ${user.firstName} ${user.lastName}`,
        );
        await closeSession(openRecord);
      } else {
        console.log(
          `[Biometric:ORPHAN_OUT_PUNCH] No open session for ${user.firstName} ${user.lastName} — skipping checkout punch safely.`,
        );
      }
    } else if (absoluteCheckInIntent) {
      // ── Device explicitly says CHECK-IN ──

      if (openRecord && !openTooLong) {
        // ── FIX 3: A fresh open session already exists — don't create a duplicate ──
        console.log(
          `[Biometric:CHECK_IN_DUPLICATE] ${user.firstName} ${user.lastName} already has an open session from ${new Date(openRecord.checkIn.time).toISOString()}. Skipping extra check-in punch.`,
        );
        return res.status(200).send('OK');
      }

      if (openTooLong && openRecord) {
        // ── FIX 1: Actually close the stale session before creating a new one ──
        console.warn(
          `[Biometric:STALE_SESSION] Auto-closing ${MAX_OPEN_HOURS}h+ open session for ${user.firstName} ${user.lastName}. Flagged for review.`,
        );
        openRecord.flaggedForReview = true;
        await closeSession(
          openRecord,
          `Auto-closed after ${MAX_OPEN_HOURS}h — stale session`,
        );
      }

      // Calculate business date for this check-in
      const recordDate = getBusinessDateForPunch(
        punchTime,
        activeShiftStart,
        isCrossDayShift,
      );

      // ── FIX 2: Check for ANY existing record on this date (open OR completed) ──
      const existingRecord = await Attendance.findOne({
        employee: user._id,
        date: recordDate,
      });

      if (existingRecord) {
        if (existingRecord.checkOut?.time) {
          console.log(
            `[Biometric:EXTRA_PUNCH_IGNORED] ${user.firstName} ${user.lastName} already has a completed record for ${recordDate.toISOString().split('T')[0]}. Skipping.`,
          );
        } else {
          console.log(
            `[Biometric:OPEN_RECORD_EXISTS] ${user.firstName} ${user.lastName} already has an open record for ${recordDate.toISOString().split('T')[0]}. Skipping.`,
          );
        }
        return res.status(200).send('OK');
      }

      // Calculate lateness
      const localHour = localPunch.getUTCHours();
      const localMinute = localPunch.getUTCMinutes();
      const punchMinutes = localHour * 60 + localMinute;
      const shiftStartMinutes = shiftHour * 60 + shiftMinute;

      let isLate = computeIsLate(
        punchMinutes,
        shiftStartMinutes,
        isCrossDayShift,
      );
      const lateMinutes = computeLateMinutes(
        punchMinutes,
        shiftStartMinutes,
        isCrossDayShift,
      );
      const earlyMinutes = computeEarlyMinutes(
        punchMinutes,
        shiftStartMinutes,
        isCrossDayShift,
      );

      const attendanceRecord = new Attendance({
        employee: user._id,
        date: recordDate,
        status: isLate ? 'late' : 'present',
        lateMinutes,
        earlyMinutes,
        workMode:
          assignment?.workMode || employeeProfile?.shift?.workMode || 'office',
      });
      attendanceRecord.checkIn = {
        time: punchTime,
        method: 'biometric',
        location: { address: 'Office Terminal' },
      };

      // ── FIX 4: Race-condition safety net — catch E11000 gracefully ──
      try {
        await attendanceRecord.save();
      } catch (err) {
        if (err.code === 11000) {
          console.warn(
            `[Biometric:RACE_CONDITION] Duplicate key on insert for ${user.firstName} ${user.lastName} — another punch won the race. Skipping safely.`,
          );
          return res.status(200).send('OK');
        }
        throw err; // Re-throw unexpected errors
      }

      console.log(
        `[Biometric:CHECKED_IN] ${user.firstName} ${user.lastName} checked in at ${punchTime.toISOString()} (${isLate ? 'LATE' : 'on time'})`,
      );
      if (req.io)
        req.io.to('role:admin').emit('attendance:live', {
          userId: user._id,
          action: 'checkin',
          time: punchTime,
          businessDate: recordDate,
        });
    } else {
      // ── No explicit device intent: use session state to infer ──
      if (!openRecord || openTooLong) {
        // Treat as check-in

        if (openTooLong && openRecord) {
          // ── FIX 1 (same fix, ambiguous path): close stale session first ──
          console.warn(
            `[Biometric:STALE_SESSION] Auto-closing stale session for ${user.firstName} ${user.lastName}`,
          );
          openRecord.flaggedForReview = true;
          await closeSession(
            openRecord,
            `Auto-closed after ${MAX_OPEN_HOURS}h — stale session`,
          );
        }

        const recordDate = getBusinessDateForPunch(
          punchTime,
          activeShiftStart,
          isCrossDayShift,
        );

        // ── FIX 2 (same fix, ambiguous path) ──
        const existingRecord = await Attendance.findOne({
          employee: user._id,
          date: recordDate,
        });

        if (existingRecord) {
          if (existingRecord.checkOut?.time) {
            console.log(
              `[Biometric:EXTRA_PUNCH_IGNORED] ${user.firstName} ${user.lastName} already has a completed record for ${recordDate.toISOString().split('T')[0]}. Skipping.`,
            );
          } else {
            console.log(
              `[Biometric:OPEN_RECORD_EXISTS] ${user.firstName} ${user.lastName} already has an open record for ${recordDate.toISOString().split('T')[0]}. Skipping.`,
            );
          }
          return res.status(200).send('OK');
        }

        const localHour = localPunch.getUTCHours();
        const localMinute = localPunch.getUTCMinutes();
        const punchMinutes = localHour * 60 + localMinute;
        const shiftStartMinutes = shiftHour * 60 + shiftMinute;

        let isLate = computeIsLate(
          punchMinutes,
          shiftStartMinutes,
          isCrossDayShift,
        );
        const lateMinutes = computeLateMinutes(
          punchMinutes,
          shiftStartMinutes,
          isCrossDayShift,
        );
        const earlyMinutes = computeEarlyMinutes(
          punchMinutes,
          shiftStartMinutes,
          isCrossDayShift,
        );

        const attendanceRecord = new Attendance({
          employee: user._id,
          date: recordDate,
          status: isLate ? 'late' : 'present',
          lateMinutes,
          earlyMinutes,
          workMode:
            assignment?.workMode ||
            employeeProfile?.shift?.workMode ||
            'office',
        });
        attendanceRecord.checkIn = {
          time: punchTime,
          method: 'biometric',
          location: { address: 'Office Terminal' },
        };

        // ── FIX 4 (same safety net, ambiguous path) ──
        try {
          await attendanceRecord.save();
        } catch (err) {
          if (err.code === 11000) {
            console.warn(
              `[Biometric:RACE_CONDITION] Duplicate key on insert for ${user.firstName} ${user.lastName} — skipping safely.`,
            );
            return res.status(200).send('OK');
          }
          throw err;
        }

        console.log(
          `[Biometric:CHECKED_IN] ${user.firstName} ${user.lastName} (inferred) checked in at ${punchTime.toISOString()}`,
        );
        if (req.io)
          req.io.to('role:admin').emit('attendance:live', {
            userId: user._id,
            action: 'checkin',
            time: punchTime,
            businessDate: recordDate,
          });
      } else {
        // Treat as check-out
        console.log(
          `[Biometric:CHECKOUT] Closing session (inferred) for ${user.firstName} ${user.lastName}`,
        );
        await closeSession(openRecord);
      }
    }

    return res.status(200).send('OK');
  }),
);

// PATCH /attendance/rectify
router.patch(
  '/rectify',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const { employeeId, date, checkIn, checkOut, status, workMode } = req.body;

    if (!employeeId || !date) {
      return res.status(400).json({
        success: false,
        message: 'employeeId and date are required.',
      });
    }

    const targetDate = new Date(date);
    const dayStart = new Date(
      Date.UTC(
        targetDate.getUTCFullYear(),
        targetDate.getUTCMonth(),
        targetDate.getUTCDate(),
      ),
    );
    const dayEnd = new Date(
      Date.UTC(
        targetDate.getUTCFullYear(),
        targetDate.getUTCMonth(),
        targetDate.getUTCDate() + 1,
      ),
    );

    let record = await Attendance.findOne({
      employee: employeeId,
      date: { $gte: dayStart, $lt: dayEnd },
    });

    if (!record) {
      record = new Attendance({
        employee: employeeId,
        date: dayStart,
        status: status || 'present',
        // 'Add Attendance' (from the admin dashboard, no biometric device
        // involved) explicitly passes workMode: 'manual'. Plain Rectify
        // edits that don't send workMode keep the old 'office' default.
        workMode: workMode || 'office',
      });
    } else if (workMode) {
      record.workMode = workMode;
    }

    if (checkIn) {
      record.checkIn = {
        time: new Date(checkIn),
        method: record.checkIn?.method || 'manual',
        location: {
          address: 'office',
        },
      };
    } else {
      record.checkIn = undefined;
    }

    if (checkOut) {
      record.checkOut = {
        time: new Date(checkOut),
        method: record.checkOut?.method || 'manual',
        location: {
          address: 'office',
        },
      };
    } else {
      record.checkOut = undefined;
    }

    if (record.checkIn?.time && record.checkOut?.time) {
      const diffMs =
        new Date(record.checkOut.time) - new Date(record.checkIn.time);
      record.totalHours = parseFloat((diffMs / 3600000).toFixed(2));
    } else {
      record.totalHours = 0;
    }

    if (status) record.status = status;
    record.rectifiedBy = req.user._id;
    record.rectifiedAt = new Date();

    await record.save();

    if (req.io) {
      req.io.to('role:admin').emit('attendance:rectified', {
        employeeId,
        date,
        updatedBy: req.user._id,
      });
    }

    res.json({
      success: true,
      message: 'Attendance record updated successfully.',
      data: record,
    });
  }),
);

module.exports = router;
