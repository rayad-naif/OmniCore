const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth.middleware');
const { asyncHandler, AppError } = require('../utils/errorUtils');
const ShiftAssignment = require('../models/ShiftAssignment.model');

const overlaps = (aStart, aEnd, bStart, bEnd) => {
  return aStart <= bEnd && bStart <= aEnd;
};

function dateOnlyUTC(d) {
  const dt = new Date(d);
  return new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()),
  );
}

function rangeIncludesWeekday(start, end, weekday) {
  const s = dateOnlyUTC(start);
  const e = dateOnlyUTC(end);
  if (e < s) return false;
  // if range length >= 7 days it will include every weekday
  const diffDays = Math.floor((e - s) / 86400000) + 1;
  if (diffDays >= 7) return true;
  const startDay = s.getUTCDay();
  const offset = (weekday - startDay + 7) % 7;
  const candidate = new Date(
    Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + offset),
  );
  return candidate <= e;
}

router.get(
  '/',
  protect,
  asyncHandler(async (req, res) => {
    const { employee, page = 1, limit = 50 } = req.query;
    const query = {};
    if (employee) query.employee = employee;
    const assignments = await ShiftAssignment.find(query)
      .populate('shiftType')
      .sort({ startDate: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await ShiftAssignment.countDocuments(query);
    res.json({ success: true, data: assignments, total, page: Number(page) });
  }),
);

// Inside routes/shift-assignments.routes.js
router.post(
  '/',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const {
      employee,
      shiftType,
      recurring,
      weekday,
      startDate,
      endDate,
      notes,
    } = req.body;

    if (!employee || !shiftType) {
      throw new AppError('Employee ID and Shift Type ID are required.', 400);
    }

    // 1. Fetch details directly from the admin's created ShiftType document
    const ShiftType = require('../models/ShiftType.model');
    const selectedShift = await ShiftType.findById(shiftType);
    if (!selectedShift || !selectedShift.isActive) {
      throw new AppError('Active Shift Type not found.', 404);
    }

    // Parse custom parameters or inherit directly from the Shift Type configuration rules
    const startTime = selectedShift.startTime;
    const endTime = selectedShift.endTime;
    const crossDay = selectedShift.crossDay;
    const workMode = selectedShift.workMode;
    const breakEnabled = selectedShift.breakEnabled;
    const breakDurationMinutes = selectedShift.breakDurationMinutes;

    let assignmentStart = null;
    let assignmentEnd = null;

    if (recurring) {
      if (typeof weekday !== 'number' || weekday < 0 || weekday > 6) {
        throw new AppError(
          'Valid weekday (0-6) is required for recurring assignments.',
          400,
        );
      }
    } else {
      if (!startDate || !endDate) {
        throw new AppError(
          'Start date and end date are required for non-recurring assignments.',
          400,
        );
      }
      assignmentStart = dateOnlyUTC(startDate);
      assignmentEnd = dateOnlyUTC(endDate);
      if (assignmentEnd < assignmentStart) {
        throw new AppError('End date cannot be before start date.', 400);
      }
    }

    // Conflict Checking Loop
    const existing = await ShiftAssignment.find({ employee, status: 'active' });
    for (const item of existing) {
      if (recurring && item.recurring && item.weekday === weekday) {
        throw new AppError(
          'Employee already has a recurring shift assignment for this weekday.',
          409,
        );
      }
      if (!recurring && !item.recurring) {
        if (
          overlaps(
            assignmentStart,
            assignmentEnd,
            dateOnlyUTC(item.startDate),
            dateOnlyUTC(item.endDate),
          )
        ) {
          throw new AppError(
            'Date-range assignment overlaps with an existing assignment for this employee.',
            409,
          );
        }
      }
      if (recurring && !item.recurring) {
        if (rangeIncludesWeekday(item.startDate, item.endDate, weekday)) {
          throw new AppError(
            'Recurring assignment conflicts with an existing date-range assignment for this employee.',
            409,
          );
        }
      }
      if (!recurring && item.recurring && typeof item.weekday === 'number') {
        if (
          rangeIncludesWeekday(assignmentStart, assignmentEnd, item.weekday)
        ) {
          throw new AppError(
            'Date-range assignment conflicts with an existing recurring weekday assignment for this employee.',
            409,
          );
        }
      }
    }

    // Create Assignment using the automatically inherited shift specs
    const assignment = await ShiftAssignment.create({
      status: 'active', // FIX: getShiftForDate filters by status:'active' — must set it explicitly
      employee,
      shiftType,
      recurring,
      weekday,
      startDate: assignmentStart,
      endDate: assignmentEnd,
      startTime,
      endTime,
      crossDay, // Automatically computed safely here
      workMode,
      breakEnabled,
      breakDurationMinutes,
      notes,
    });

    res.status(201).json({ success: true, data: assignment });
  }),
);

router.put(
  '/:id',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const assignment = await ShiftAssignment.findById(req.params.id);
    if (!assignment) throw new AppError('Shift assignment not found.', 404);

    const updated = await ShiftAssignment.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true },
    );
    res.json({ success: true, data: updated });
  }),
);

router.delete(
  '/:id',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const assignment = await ShiftAssignment.findByIdAndDelete(req.params.id);
    if (!assignment) throw new AppError('Shift assignment not found.', 404);
    res.json({ success: true, message: 'Shift assignment deleted.' });
  }),
);

module.exports = router;
