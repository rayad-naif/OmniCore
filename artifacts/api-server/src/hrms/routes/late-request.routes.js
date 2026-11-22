const express = require('express');
const { hrmsAppUrl } = require('../core/config');
const router = express.Router();
const { protect, hrAndAbove } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const LateRequest = require('../models/Laterequest.model');
const User = require('../models/User.model');
const { sendEmail } = require('../services/notification/email.service');
const { createNotificationsForRoles } = require('../services/notification/notification.service');

const ADMIN_NOTIFICATION_TARGET_ROLES = ['super_admin', 'admin', 'senior_manager', 'hr_recruiter'];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

// Business-date bucket — same convention as Attendance.date (UTC midnight).
function dayBucket(input) {
  const d = new Date(input);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ─── Notify all super_admin users that a new/revised late request came in ──
// Failures here are logged and swallowed so a down mail server never blocks
// the employee's submission itself.
async function _notifySuperAdminsOfLateRequest(request, employee) {
  try {
    const superAdmins = await User.find({ role: 'super_admin' }).select('email');
    if (!superAdmins.length) return;

    const employeeName = `${employee.firstName} ${employee.lastName}`;
    const data = {
      employeeName,
      date: request.date.toDateString(),
      lateFrom: request.lateFrom,
      lateTo: request.lateTo,
      reason: request.reason,
      reviewUrl: `${hrmsAppUrl()}/manager/laterequestsapprovals`,
    };

    await Promise.all(
      superAdmins.map((super_admin) =>
        sendEmail({ to: super_admin.email, template: 'lateRequestSubmitted', data })
      )
    );
  } catch (err) {
    console.error('Failed to notify super_admin(s) of new late request:', err.message);
  }
}

// ─── POST /late-requests ───────────────────────────────────────────────────
// Employee submits (or revises) a late request for a specific date.
router.post(
  '/',
  protect,
  asyncHandler(async (req, res) => {
    const { date, lateFrom, lateTo, reason } = req.body;

    if (!date || !lateFrom || !lateTo || !reason?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'date, lateFrom, lateTo and reason are all required.',
      });
    }
    if (!TIME_RE.test(lateFrom) || !TIME_RE.test(lateTo)) {
      return res.status(400).json({ success: false, message: 'lateFrom/lateTo must be in HH:MM format.' });
    }
    if (toMinutes(lateTo) <= toMinutes(lateFrom)) {
      return res.status(400).json({ success: false, message: 'lateTo must be after lateFrom.' });
    }

    const targetDate = dayBucket(date);
    let request = await LateRequest.findOne({ employee: req.user._id, date: targetDate });

    if (request) {
      if (request.status === 'approved') {
        return res.status(400).json({
          success: false,
          message: 'This date already has an approved late request. Contact HR if it needs to change.',
        });
      }
      // Revise an existing pending/rejected request and reset it to pending.
      request.lateFrom = lateFrom;
      request.lateTo = lateTo;
      request.reason = reason.trim();
      request.status = 'pending';
      request.reviewedBy = null;
      request.reviewedAt = null;
      request.reviewNote = '';
      await request.save();
    } else {
      request = await LateRequest.create({
        employee: req.user._id,
        date: targetDate,
        lateFrom,
        lateTo,
        reason: reason.trim(),
      });
    }

    const employeeName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.email;

    if (req.io) {
      ADMIN_NOTIFICATION_TARGET_ROLES.forEach((role) =>
        req.io.to(`role:${role}`).emit('notification:new', {
          title: 'New late request submitted',
          message: `${employeeName} submitted a late request for ${targetDate.toDateString()}.`,
          type: 'late',
          link: `/manager/laterequestsapprovals`,
          requestId: request._id,
        })
      );
    }

    // Fire-and-forget email notification to super_admin(s) — doesn't block the response.
    // notifySuperAdminsOfLateRequest(request, req.user);

    try {
      await createNotificationsForRoles({
        roles: ADMIN_NOTIFICATION_TARGET_ROLES,
        title: 'New late request submitted',
        message: `${employeeName} submitted a late request for ${targetDate.toDateString()}.`,
        type: 'late',
        link: `/manager/laterequestsapprovals`,
      });
    } catch (err) {
      console.error('Failed to persist late request notification:', err.message);
    }

    res.status(201).json({ success: true, message: 'Late request submitted.', data: request });
  })
);

// ─── GET /late-requests/mine ───────────────────────────────────────────────
// Employee's own requests — used to render status on MyLateRequests / MyAttendance.
router.get(
  '/mine',
  protect,
  asyncHandler(async (req, res) => {
    const { status, month, year } = req.query;
    const query = { employee: req.user._id };
    if (status) query.status = status;
    if (month && year) {
      query.date = {
        $gte: new Date(Date.UTC(year, month - 1, 1)),
        $lte: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
      };
    }
    const requests = await LateRequest.find(query).sort({ date: -1 });
    res.json({ success: true, data: requests });
  })
);

// ─── GET /late-requests ────────────────────────────────────────────────────
// Admin/HR — list all requests for the approvals screen. Defaults to
// showing pending ones first if no status filter is given.
router.get(
  '/',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const { status, startDate, endDate, employeeId } = req.query;
    const query = {};
    if (status) query.status = status;
    if (employeeId) query.employee = employeeId;
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = dayBucket(startDate);
      if (endDate) query.date.$lte = dayBucket(endDate);
    }

    const requests = await LateRequest.find(query)
      .populate('employee', 'firstName lastName employeeId department position avatar')
      .populate('reviewedBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: requests });
  })
);

// ─── PATCH /late-requests/:id/approve ──────────────────────────────────────
router.patch(
  '/:id/approve',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const request = await LateRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Late request not found.' });
    if (request.status === 'approved') {
      return res.status(400).json({ success: false, message: 'This request is already approved.' });
    }

    request.status = 'approved';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.reviewNote = req.body?.note?.trim() || '';
    await request.save();

    if (req.io) {
      req.io.to('role:admin').emit('late-request:updated', { requestId: request._id, status: 'approved' });
      req.io.to(`user:${request.employee}`).emit('late-request:approved', {
        requestId: request._id,
        date: request.date,
      });
    }

    res.json({ success: true, message: 'Late request approved.', data: request });
  })
);

// ─── PATCH /late-requests/:id/reject ───────────────────────────────────────
router.patch(
  '/:id/reject',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const request = await LateRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Late request not found.' });
    if (request.status === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'This request is already approved. Cancel/revoke it before rejecting.',
      });
    }

    request.status = 'rejected';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.reviewNote = req.body?.note?.trim() || '';
    await request.save();

    if (req.io) {
      req.io.to('role:admin').emit('late-request:updated', { requestId: request._id, status: 'rejected' });
      req.io.to(`user:${request.employee}`).emit('late-request:rejected', {
        requestId: request._id,
        date: request.date,
        reason: request.reviewNote,
      });
    }

    res.json({ success: true, message: 'Late request rejected.', data: request });
  })
);

// ─── DELETE /late-requests/:id ──────────────────────────────────────────────
// Employee cancels their own request, only while it's still pending.
router.delete(
  '/:id',
  protect,
  asyncHandler(async (req, res) => {
    const request = await LateRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Late request not found.' });
    if (request.employee.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'You can only cancel your own requests.' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending requests can be cancelled.' });
    }
    await request.deleteOne();
    res.json({ success: true, message: 'Late request cancelled.' });
  })
);

module.exports = router;