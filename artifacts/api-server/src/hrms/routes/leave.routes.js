const express = require('express');
const { hrmsAppUrl } = require('../core/config');
const router = express.Router();
const { protect, managementOnly } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const Leave = require('../models/Leave.model');
const User = require('../models/User.model');
const { sendEmail } = require('../services/notification/email.service');
const { createNotificationsForRoles } = require('../services/notification/notification.service');
const logger = require('../utils/logger');

const ADMIN_NOTIFICATION_TARGET_ROLES = ['super_admin', 'admin', 'senior_manager', 'hr_recruiter'];

const ALLOWED_LEAVE_TYPES = ['sick', 'casual', 'unpaid'];
const CASUAL_ANNUAL_QUOTA = 10;

const calculateDays = (start, end) => {
  const diff = (new Date(end) - new Date(start)) / 86400000 + 1;
  return Math.max(1, Math.round(diff));
};

const formatDate = (d) => new Date(d).toLocaleDateString('en-US', {
  year: 'numeric', month: 'short', day: 'numeric',
});

// Fire-and-forget notification to every super_admin when a leave is submitted.
// Deliberately not awaited by the caller before responding — email delivery
// shouldn't slow down or block the leave submission itself. Errors are logged,
// not thrown, so a mail-server hiccup never surfaces as a failed leave request.
const notifySuperAdminsOfLeave = async (leave, employee) => {
  try {
    const superAdmins = await User.find({ role: 'super_admin' }).select('email');
    if (!superAdmins.length) {
      logger.warn('Leave submitted but no super_admin recipients found to notify.');
      return;
    }

    const employeeName = [employee.firstName, employee.lastName].filter(Boolean).join(' ')
      || employee.name
      || employee.email;

    const data = {
      employeeName,
      leaveType: leave.leaveType,
      from: formatDate(leave.startDate),
      to: formatDate(leave.endDate),
      totalDays: leave.totalDays,
      reason: leave.reason,
      reviewUrl: `${hrmsAppUrl()}/leaves`,
    };
    console.log(`Notifying super_admin(s) of new leave request from ${employeeName}:`, data);
    await Promise.all(
      superAdmins.map((super_admin) =>
        sendEmail({ to: super_admin.email, template: 'leaveSubmitted', data })
          .catch((err) => logger.error(`Leave notification email failed for ${super_admin.email}: ${err.message}`))
      )
    );
    console.log(`Notified ${superAdmins.length} super_admin(s) of new leave request from ${employeeName}.`);
  } catch (err) {
    logger.error(`Failed to notify super_admins of new leave request: ${err.message}`);
  }
};

// @route   GET /api/v1/leaves   (unchanged)
router.get('/', protect, asyncHandler(async (req, res) => {
  const query = {};
  if (req.user.role === 'employee') {
    query.employee = req.user._id;
  } else if (req.query.employeeId) {
    query.employee = req.query.employeeId;
  }

  const leaves = await Leave.find(query)
    .populate({
      path: 'employee',
      select: 'firstName lastName email department position avatar',
      populate: { path: 'department', select: 'name code' },
    })
    .populate('approvedBy', 'firstName lastName')
    .sort({ createdAt: -1 });

  res.json({ success: true, data: leaves });
}));

// @route   POST /api/v1/leaves   (unchanged from last time)
router.post('/', protect, asyncHandler(async (req, res) => {
  const { leaveType, reason, startDate, endDate } = req.body;

  if (!leaveType || !reason || !startDate || !endDate) {
    return res.status(400).json({ success: false, message: 'Please provide all required fields' });
  }

  const normalizedType = leaveType.toLowerCase();
  if (!ALLOWED_LEAVE_TYPES.includes(normalizedType)) {
    return res.status(400).json({
      success: false,
      message: `Leave type must be one of: ${ALLOWED_LEAVE_TYPES.join(', ')}`,
    });
  }

  const rawStart = new Date(startDate);
  const rawEnd   = new Date(endDate);
  if (isNaN(rawStart) || isNaN(rawEnd) || rawEnd < rawStart) {
    return res.status(400).json({ success: false, message: 'Invalid date range' });
  }

  // Normalize to UTC-day boundaries — matches how Attendance.date is stored
  // elsewhere in the app, so a leave day always lines up with the attendance
  // check for that same day regardless of what time-of-day component (if any)
  // the client sent.
  const start = new Date(Date.UTC(rawStart.getUTCFullYear(), rawStart.getUTCMonth(), rawStart.getUTCDate()));
  const end   = new Date(Date.UTC(rawEnd.getUTCFullYear(),   rawEnd.getUTCMonth(),   rawEnd.getUTCDate()));

  const totalDays = calculateDays(start, end);

  if (normalizedType === 'casual') {
    const year = start.getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

    const result = await Leave.aggregate([
      {
        $match: {
          employee: req.user._id,
          leaveType: 'casual',
          status: { $in: ['pending', 'approved'] },
          startDate: { $gte: yearStart, $lte: yearEnd },
        },
      },
      { $group: { _id: null, total: { $sum: '$totalDays' } } },
    ]);

    const used = result[0]?.total || 0;

    if (used + totalDays > CASUAL_ANNUAL_QUOTA) {
      return res.status(400).json({
        success: false,
        message: `Insufficient Casual leave balance. You have ${Math.max(0, CASUAL_ANNUAL_QUOTA - used)} day(s) left for ${year}.`,
      });
    }
  }

  const leave = await Leave.create({
    employee: req.user._id,
    leaveType: normalizedType,
    reason,
    startDate: start,
    endDate: end,
    totalDays,
    status: 'pending',
  });

  const employeeName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.email;

  // Not awaited on purpose — see notifySuperAdminsOfLeave's comment above.
  notifySuperAdminsOfLeave(leave, req.user);

  try {
    await createNotificationsForRoles({
      roles: ADMIN_NOTIFICATION_TARGET_ROLES,
      title: 'New leave request submitted',
      message: `${employeeName} has submitted a ${leave.leaveType} leave request.`,
      type: 'leave',
      link: `/manager/leaves`,
    });
    if (req.io) {
      ADMIN_NOTIFICATION_TARGET_ROLES.forEach((role) =>
        req.io.to(`role:${role}`).emit('notification:new', {
          title: 'New leave request submitted',
          message: `${employeeName} has submitted a ${leave.leaveType} leave request.`,
          type: 'leave',
          link: `/manager/leaves`,
          leaveId: leave._id,
        })
      );
    }
  } catch (err) {
    logger.error(`Failed to persist leave notification: ${err.message}`);
  }

  res.status(201).json({ success: true, data: leave, message: 'Leave request submitted successfully' });
}));

// @route   PATCH /api/v1/leaves/:id/approve
router.patch('/:id/approve', protect, managementOnly, asyncHandler(async (req, res) => {
  const leave = await Leave.findById(req.params.id);
  if (!leave) return res.status(404).json({ success: false, message: 'Leave request not found' });

  leave.status = 'approved';
  leave.approvedBy = req.user._id;
  leave.approvedAt = new Date();
  leave.comments = req.body.comments || 'Approved. Enjoy your time off!';
  await leave.save();

  res.json({ success: true, data: leave, message: 'Leave approved successfully' });
}));

// @route   PATCH /api/v1/leaves/:id/reject
router.patch('/:id/reject', protect, managementOnly, asyncHandler(async (req, res) => {
  const leave = await Leave.findById(req.params.id);
  if (!leave) return res.status(404).json({ success: false, message: 'Leave request not found' });

  leave.status = 'rejected';
  leave.approvedBy = req.user._id;
  leave.approvedAt = new Date();
  leave.comments = req.body.comments || 'Rejected';
  await leave.save();

  res.json({ success: true, data: leave, message: 'Leave rejected successfully' });
}));

// @route   PATCH /api/v1/leaves/:id/convert-unpaid
// @desc    Convert a leave (typically Sick) into Unpaid leave and approve it in the same step
router.patch('/:id/convert-unpaid', protect, managementOnly, asyncHandler(async (req, res) => {
  const leave = await Leave.findById(req.params.id);
  if (!leave) {
    return res.status(404).json({ success: false, message: 'Leave request not found' });
  }

  if (leave.status !== 'pending') {
    return res.status(400).json({
      success: false,
      message: 'Only pending leave requests can be converted to unpaid',
    });
  }

  leave.leaveType = 'unpaid';
  leave.status = 'approved';
  leave.approvedBy = req.user._id;
  leave.approvedAt = new Date();
  leave.comments = req.body.comments || 'Approved as Unpaid Leave';
  await leave.save();

  res.json({ success: true, data: leave, message: 'Leave converted to unpaid and approved successfully' });
}));

module.exports = router;