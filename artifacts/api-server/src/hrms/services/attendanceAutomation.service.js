const User = require('../models/User.model');
const Attendance = require('../models/Attendance.model');
const ShiftAssignment = require('../models/ShiftAssignment.model');
const Leave = require('../models/Leave.model');
const { tzOffsetMs } = require('../core/time');

// How many hours after shift start, with no check-in, before we mark absent.
const ABSENT_GRACE_HOURS = 4;

// How many calendar days (including today) to sweep on every run. >1 so that
// if the cron didn't run for a bit (deploy, restart, downtime) or a leave
// gets approved retroactively, we still catch up instead of leaving gaps.
const DAYS_TO_BACKFILL = 3;

// Originally fixed to Pakistan time (UTC+5); now the workspace's time zone.
function pktToday() {
  const n = new Date(Date.now() + tzOffsetMs());
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()),
  );
}

// Same shift-lookup logic as attendance_routes.js.
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

  for (const a of assignments) {
    if (a.recurring && typeof a.weekday === 'number' && a.weekday === dayOfWeek)
      return a;
  }

  return null;
}

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

function getShiftStartInstant(businessDate, shiftStartTime) {
  const [h, m] = shiftStartTime.split(':').map(Number);
  return new Date(
    Date.UTC(
      businessDate.getUTCFullYear(),
      businessDate.getUTCMonth(),
      businessDate.getUTCDate(),
      h,
      m,
    ) - tzOffsetMs(),
  );
}

async function runAttendanceSweep(io) {
  const results = { absentMarked: 0, onLeaveMarked: 0, errors: [] };

  const eligibleUsers = await User.find({
    isActive: true,
    deletedAt: null,
    status: { $nin: ['terminated', 'resigned'] },
    role: { $nin: ['admin', 'super_admin'] },
  }).select('_id firstName lastName');

  const employeeIds = eligibleUsers.map((u) => u._id);

  for (let dayOffset = DAYS_TO_BACKFILL - 1; dayOffset >= 0; dayOffset--) {
    const businessDate = pktToday();
    businessDate.setUTCDate(businessDate.getUTCDate() - dayOffset);
    const isToday = dayOffset === 0;

    const leaveMap = await getApprovedLeaveIntervals(
      employeeIds,
      businessDate,
      businessDate,
    );

    for (const user of eligibleUsers) {
      try {
        // Any existing record (present/late/absent/on_leave/manual rectify)
        // means this day is already accounted for — never overwrite it.
        const existing = await Attendance.findOne({
          employee: user._id,
          date: businessDate,
        }).select('_id');
        if (existing) continue;

        // 1. Approved leave wins over absent.
        if (isDateOnLeave(leaveMap[user._id.toString()], businessDate)) {
          try {
            await Attendance.create({
              employee: user._id,
              date: businessDate,
              status: 'on_leave',
              leaveType: getLeaveTypeOnDate(
                leaveMap[user._id.toString()],
                businessDate,
              ),
              workMode: 'off',
              totalHours: 0,
              autoGenerated: true,
            });
            results.onLeaveMarked++;
          } catch (err) {
            if (err.code !== 11000) throw err; // lost the race to a real check-in/rectify — fine
          }
          continue;
        }

        // 2. Otherwise, was this employee even scheduled to work this day?
        const shift = await getShiftForDate(user._id, businessDate);
        if (!shift) continue; // no shift assigned -> not flagged absent

        const cutoff = new Date(
          getShiftStartInstant(
            businessDate,
            shift.startTime || '09:00',
          ).getTime() +
            ABSENT_GRACE_HOURS * 3600000,
        );

        // For today, don't mark absent until the grace period has actually
        // elapsed. Past days are always past their cutoff.
        if (isToday && Date.now() < cutoff.getTime()) continue;

        try {
          await Attendance.create({
            employee: user._id,
            date: businessDate,
            status: 'absent',
            workMode: shift.workMode || 'office',
            totalHours: 0,
            autoGenerated: true,
          });
          results.absentMarked++;

          if (io) {
            io.to('role:admin').emit('attendance:live', {
              userId: user._id,
              action: 'auto_absent',
              businessDate,
            });
          }
        } catch (err) {
          if (err.code !== 11000) throw err;
        }
      } catch (err) {
        results.errors.push({
          employee: user._id.toString(),
          message: err.message,
        });
      }
    }
  }

  return results;
}

module.exports = { runAttendanceSweep };
