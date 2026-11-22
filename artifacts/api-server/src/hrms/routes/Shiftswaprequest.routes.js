const express = require('express');
const { hrmsAppUrl } = require('../core/config');
const router = express.Router();

const ShiftSwapRequest = require('../models/Shiftswaprequest.model');
const ShiftAssignment  = require('../models/ShiftAssignment.model');
const User             = require('../models/User.model');

const { protect, hrAndAbove } = require('../middleware/auth.middleware');
const { sendEmail } = require('../services/notification/email.service');
const { createNotificationsForRoles } = require('../services/notification/notification.service');

const ADMIN_NOTIFICATION_TARGET_ROLES = ['super_admin', 'admin', 'senior_manager', 'hr_recruiter'];

const POPULATE_EMPLOYEE  = 'firstName lastName employeeId email department';
const POPULATE_ASSIGNMENT = {
  path: 'shiftType',
  select: 'name startTime endTime crossDay workMode iconKey',
};

// ─────────────────────────────────────────────────────────────────────────────
// Notify all super_admin users that a new swap request was submitted.
// Mirrors how leave requests notify admins on submission — failures here are
// logged/swallowed so a down mail server never blocks the swap request itself.
// ─────────────────────────────────────────────────────────────────────────────
const notifySuperAdminsOfSwapRequest = async (populatedSwapRequest) => {
  try {
    const superAdmins = await User.find({ role: 'super_admin' }).select('email firstName lastName');
    if (!superAdmins.length) return;

    const requesterName = populatedSwapRequest.requester
      ? `${populatedSwapRequest.requester.firstName} ${populatedSwapRequest.requester.lastName}`
      : 'An employee';

    const data = {
      requesterName,
      targetEmployeeName: populatedSwapRequest.targetEmployeeName,
      requestedDate: new Date(populatedSwapRequest.requestedDate).toDateString(),
      reason: populatedSwapRequest.reason,
      reviewUrl: `${hrmsAppUrl()}/admin/shift-swap-requests`,
    };

    await Promise.all(
      superAdmins.map((super_admin) =>
        sendEmail({ to: super_admin.email, template: 'shiftSwapSubmitted', data })
      )
    );
  } catch (err) {
    // Swallow — email failures shouldn't fail the swap request submission.
    console.error('Failed to notify super_admin(s) of new swap request:', err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/shift-swap-requests
// Employee submits a new swap request.
//   Body: { requesterAssignment, targetEmployee (ID), requestedDate, reason }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', protect, async (req, res) => {
  try {
    const requesterId = req.user?._id || req.user?.id;
    const { requesterAssignment, targetEmployee, requestedDate, reason } = req.body;

    if (!requesterAssignment || !targetEmployee || !requestedDate) {
      return res.status(400).json({
        message: 'requesterAssignment, targetEmployee, and requestedDate are required.',
      });
    }

    // ── Make sure the assignment belongs to the requester ────────────────
    const ownAssignment = await ShiftAssignment.findById(requesterAssignment);
    if (!ownAssignment) {
      return res.status(404).json({ message: 'Shift assignment not found.' });
    }
    if (String(ownAssignment.employee) !== String(requesterId)) {
      return res.status(403).json({ message: 'You can only request a swap on your own shift.' });
    }

    // ── Validate target employee exists ──────────────────────────────────
    const targetUser = await User.findById(targetEmployee).select('firstName lastName department');
    if (!targetUser) {
      return res.status(404).json({ message: 'Target employee not found.' });
    }

    // ── Department check: requester and target must be in the same dept ──
    const requesterUser = await User.findById(requesterId).select('department');
    const requesterDept = String(requesterUser?.department || '');
    const targetDept    = String(targetUser?.department || '');

    if (!requesterDept || !targetDept || requesterDept !== targetDept) {
      return res.status(403).json({
        message: 'You can only request a shift swap with someone in your own department.',
      });
    }

    // ── Prevent duplicate pending requests for the same assignment ───────
    const existingPending = await ShiftSwapRequest.findOne({
      requesterAssignment,
      status: 'pending',
    });
    if (existingPending) {
      return res.status(409).json({
        message: 'A pending swap request already exists for this shift.',
      });
    }

    const swapRequest = await ShiftSwapRequest.create({
      requester:           requesterId,
      requesterAssignment,
      targetEmployee,
      targetEmployeeName:  `${targetUser.firstName} ${targetUser.lastName}`,
      requestedDate:       new Date(requestedDate),
      reason,
    });

    const populated = await ShiftSwapRequest.findById(swapRequest._id)
      .populate('requester',       POPULATE_EMPLOYEE)
      .populate('targetEmployee',  POPULATE_EMPLOYEE)
      .populate({ path: 'requesterAssignment', populate: POPULATE_ASSIGNMENT });

    const requesterName = req.user
      ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || 'An employee'
      : 'An employee';

    // Fire-and-forget notification to super_admin(s) — doesn't block the response.
    notifySuperAdminsOfSwapRequest(populated);

    try {
      await createNotificationsForRoles({
        roles: ADMIN_NOTIFICATION_TARGET_ROLES,
        title: 'New shift swap request submitted',
        message: `${requesterName} requested a shift swap with ${targetUser.firstName} ${targetUser.lastName}.`,
        type: 'shift_swap',
        link: `/admin/shift-swap-requests`,
      });
      if (req.io) {
        ADMIN_NOTIFICATION_TARGET_ROLES.forEach((role) =>
          req.io.to(`role:${role}`).emit('notification:new', {
            title: 'New shift swap request submitted',
            message: `${requesterName} requested a shift swap with ${targetUser.firstName} ${targetUser.lastName}.`,
            type: 'shift_swap',
            link: `/admin/shift-swap-requests`,
            requestId: swapRequest._id,
          })
        );
      }
    } catch (err) {
      console.error('Failed to persist shift swap notification:', err.message);
    }

    res.status(201).json({ message: 'Swap request submitted.', data: populated });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Unable to create swap request.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/shift-swap-requests/mine
// Employee: requests I've sent
// ─────────────────────────────────────────────────────────────────────────────
router.get('/mine', protect, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const requests = await ShiftSwapRequest.find({ requester: userId })
      .sort({ createdAt: -1 })
      .populate('requester',      POPULATE_EMPLOYEE)
      .populate('targetEmployee', POPULATE_EMPLOYEE)
      .populate({ path: 'requesterAssignment', populate: POPULATE_ASSIGNMENT });

    res.json({ data: requests });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Unable to load swap requests.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/shift-swap-requests
// Admin: all requests, optional ?status=pending filter
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', protect, hrAndAbove, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const requests = await ShiftSwapRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate('requester',      POPULATE_EMPLOYEE)
      .populate('targetEmployee', POPULATE_EMPLOYEE)
      .populate({ path: 'requesterAssignment', populate: POPULATE_ASSIGNMENT })
      .populate('resolvedBy',     POPULATE_EMPLOYEE);

    res.json({ data: requests });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Unable to load swap requests.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/shift-swap-requests/:id/status
// Admin: approve or reject.
// Body: { status: 'approved' | 'rejected', adminNotes? }
//
// When APPROVED the backend automatically:
//   1. Finds both employees' recurring assignments for the requested date's weekday
//   2. Creates a one-day non-recurring swap assignment for each (date-specific override)
//   This means only that particular day's attendance is swapped — recurring schedules
//   are left untouched.
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/status', protect, hrAndAbove, async (req, res) => {
  try {
    const { id }               = req.params;
    const { status, adminNotes } = req.body;
    const adminId              = req.user?._id || req.user?.id;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: "status must be 'approved' or 'rejected'." });
    }

    const swapRequest = await ShiftSwapRequest.findById(id)
      .populate('requesterAssignment');

    if (!swapRequest) {
      return res.status(404).json({ message: 'Swap request not found.' });
    }
    if (swapRequest.status !== 'pending') {
      return res.status(409).json({ message: `Request already ${swapRequest.status}.` });
    }

    // ── Automatic shift swap on approval ──────────────────────────────────
    if (status === 'approved') {
      const requesterAssignment = swapRequest.requesterAssignment;

      if (!requesterAssignment) {
        return res.status(400).json({ message: 'Requester assignment details could not be loaded.' });
      }

      // The specific date the employee chose for this one-time swap
      const swapDate    = new Date(swapRequest.requestedDate);
      const swapWeekday = swapDate.getDay(); // JS getDay(): 0=Sun … 6=Sat

      // Build a normalised date-only copy for startDate/endDate (midnight UTC)
      const swapDateOnly = new Date(
        Date.UTC(swapDate.getFullYear(), swapDate.getMonth(), swapDate.getDate())
      );

      // ── Find the target employee's recurring assignment for that weekday ─
      const targetAssignment = await ShiftAssignment.findOne({
        employee: swapRequest.targetEmployee,
        status:   'active',
        recurring: true,
        weekday:  swapWeekday,
      });

      if (!targetAssignment) {
        return res.status(400).json({
          message:
            `The target employee has no recurring shift on that day ` +
            `(${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][swapWeekday]}). ` +
            `Cannot complete the swap automatically.`,
        });
      }

      // ── Create a one-day assignment for the REQUESTER with the target's shift ─
      // We use ShiftAssignment.create() directly (bypassing the route-level
      // conflict check) so the date-specific override can coexist with an
      // existing recurring assignment. The attendance system should prefer the
      // most specific (date-range) assignment over a recurring one for the same day.
      await ShiftAssignment.create({
        employee:            swapRequest.requester,
        shiftType:           targetAssignment.shiftType,
        recurring:           false,
        startDate:           swapDateOnly,
        endDate:             swapDateOnly,
        startTime:           targetAssignment.startTime,
        endTime:             targetAssignment.endTime,
        crossDay:            targetAssignment.crossDay,
        workMode:            targetAssignment.workMode,
        breakEnabled:        targetAssignment.breakEnabled,
        breakDurationMinutes: targetAssignment.breakDurationMinutes,
        status:              'active',
        notes:               `Swap override — approved swap with employee ${swapRequest.targetEmployee}`,
      });

      // ── Create a one-day assignment for the TARGET with the requester's shift ─
      await ShiftAssignment.create({
        employee:            swapRequest.targetEmployee,
        shiftType:           requesterAssignment.shiftType,
        recurring:           false,
        startDate:           swapDateOnly,
        endDate:             swapDateOnly,
        startTime:           requesterAssignment.startTime,
        endTime:             requesterAssignment.endTime,
        crossDay:            requesterAssignment.crossDay,
        workMode:            requesterAssignment.workMode,
        breakEnabled:        requesterAssignment.breakEnabled,
        breakDurationMinutes: requesterAssignment.breakDurationMinutes,
        status:              'active',
        notes:               `Swap override — approved swap with employee ${swapRequest.requester}`,
      });
    }

    // ── Save the swap request status ──────────────────────────────────────
    swapRequest.status    = status;
    swapRequest.adminNotes = adminNotes || swapRequest.adminNotes;
    swapRequest.resolvedBy = adminId;
    swapRequest.resolvedAt = new Date();
    await swapRequest.save();

    const populated = await ShiftSwapRequest.findById(swapRequest._id)
      .populate('requester',      POPULATE_EMPLOYEE)
      .populate('targetEmployee', POPULATE_EMPLOYEE)
      .populate({ path: 'requesterAssignment', populate: POPULATE_ASSIGNMENT })
      .populate('resolvedBy',     POPULATE_EMPLOYEE);

    res.json({
      message:
        status === 'approved'
          ? 'Swap approved — one-day shift assignments have been created for both employees.'
          : 'Swap request rejected.',
      data: populated,
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Unable to update swap request.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/shift-swap-requests/:id
// Requester: cancel their own pending request
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    const { id }   = req.params;
    const userId   = req.user?._id || req.user?.id;

    const swapRequest = await ShiftSwapRequest.findById(id);
    if (!swapRequest) {
      return res.status(404).json({ message: 'Swap request not found.' });
    }
    if (String(swapRequest.requester) !== String(userId)) {
      return res.status(403).json({ message: 'You can only cancel your own request.' });
    }
    if (swapRequest.status !== 'pending') {
      return res.status(409).json({
        message: `Request already ${swapRequest.status}, cannot cancel.`,
      });
    }

    swapRequest.status = 'cancelled';
    await swapRequest.save();

    res.json({ message: 'Swap request cancelled.', data: swapRequest });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Unable to cancel swap request.' });
  }
});

module.exports = router;

// Mount in your main app/server file:
// app.use('/api/shift-swap-requests', require('./routes/Shiftswaprequest.routes'));