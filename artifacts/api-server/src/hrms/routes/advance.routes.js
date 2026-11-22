const express = require('express');
const advanceRouter = express.Router();
const { protect, hrAndAbove } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const Advance = require('../models/Advance.model');
const User    = require('../models/User.model');

// ─── GET /advances — list all (admin) or own (employee) ──────────────────────
advanceRouter.get('/', protect, asyncHandler(async (req, res) => {
  const { employeeId, status, page = 1, limit = 50 } = req.query;
  const query = {};

  if (req.user.role === 'employee') {
    query.employee = req.user._id;
  } else if (employeeId) {
    query.employee = employeeId;
  }

  if (status) query.status = status;

  const [records, total] = await Promise.all([
    Advance.find(query)
      .populate('employee', 'firstName lastName employeeId department salary')
      .populate('approvedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit)),
    Advance.countDocuments(query),
  ]);

  res.json({ success: true, data: records, total });
}));

// ─── GET /advances/summary/:employeeId — pending total for salary guard ───────
advanceRouter.get('/summary/:employeeId', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const user = await User.findOne({
    _id: req.params.employeeId,
    isActive: true,
    deletedAt: null,
  }).select('firstName lastName employeeId salary');

  if (!user) return res.status(404).json({ success: false, message: 'Employee not found' });

  // Sum all approved/pending advances not yet deducted
  const pendingAdvances = await Advance.find({
    employee: user._id,
    status: { $in: ['pending', 'approved'] },
  });

  const totalPending = pendingAdvances.reduce((s, a) => s + a.amount, 0);
  const basicSalary  = user.salary?.basic || 0;
  const remaining    = Math.max(0, basicSalary - totalPending);

  res.json({
    success: true,
    data: {
      employeeId:   user._id,
      name:         `${user.firstName} ${user.lastName}`,
      basicSalary,
      totalPending,
      remaining,       // how much more they can take
      canTakeAdvance:  remaining > 0,
      advances:        pendingAdvances,
    },
  });
}));

// ─── POST /advances — create new advance ──────────────────────────────────────
advanceRouter.post('/', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const { employeeId, amount, reason } = req.body;

  if (!employeeId || !amount) {
    return res.status(400).json({ success: false, message: 'employeeId and amount are required' });
  }

  const user = await User.findOne({ _id: employeeId, isActive: true, deletedAt: null })
    .select('firstName lastName employeeId salary');

  if (!user) {
    return res.status(404).json({ success: false, message: 'Employee not found or inactive' });
  }

  const basicSalary = user.salary?.basic || 0;

  if (basicSalary === 0) {
    return res.status(400).json({
      success: false,
      message: `No salary configured for ${user.firstName} ${user.lastName}. Set their basic salary first.`,
    });
  }

  // Check how much pending advance they already have
  const pendingAdvances = await Advance.find({
    employee: user._id,
    status: { $in: ['pending', 'approved'] },
  });
  const totalPending = pendingAdvances.reduce((s, a) => s + a.amount, 0);

  if (totalPending + amount > basicSalary) {
    return res.status(400).json({
      success: false,
      message: `Cannot grant ₹${amount.toLocaleString()} advance. ${user.firstName} already has ₹${totalPending.toLocaleString()} pending. Maximum allowed is ₹${basicSalary.toLocaleString()} (basic salary). Remaining limit: ₹${(basicSalary - totalPending).toLocaleString()}.`,
    });
  }

  const advance = await Advance.create({
    employee:    employeeId,
    amount:      parseFloat(amount),
    reason:      reason || '',
    status:      'approved',      // Admin-created advances are auto-approved
    approvedBy:  req.user._id,
    approvedAt:  new Date(),
    requestedAt: new Date(),
  });

  await advance.populate('employee', 'firstName lastName employeeId');
  await advance.populate('approvedBy', 'firstName lastName');

  res.status(201).json({
    success: true,
    data: advance,
    message: `Advance of $${amount.toLocaleString()} granted to ${user.firstName} ${user.lastName}`,
  });
}));

// ─── PATCH /advances/:id/approve ──────────────────────────────────────────────
advanceRouter.patch('/:id/approve', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const advance = await Advance.findById(req.params.id);
  if (!advance) return res.status(404).json({ success: false, message: 'Advance not found' });
  if (advance.status !== 'pending') {
    return res.status(400).json({ success: false, message: `Advance is already ${advance.status}` });
  }
  advance.status     = 'approved';
  advance.approvedBy = req.user._id;
  advance.approvedAt = new Date();
  await advance.save();
  res.json({ success: true, data: advance });
}));

// ─── PATCH /advances/:id/reject ───────────────────────────────────────────────
advanceRouter.patch('/:id/reject', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const advance = await Advance.findById(req.params.id);
  if (!advance) return res.status(404).json({ success: false, message: 'Advance not found' });
  advance.status        = 'rejected';
  advance.rejectedBy    = req.user._id;
  advance.rejectedAt    = new Date();
  advance.rejectionNote = req.body.note || '';
  await advance.save();
  res.json({ success: true, data: advance });
}));

// ─── DELETE /advances/:id — cancel (only if not yet deducted) ─────────────────
advanceRouter.delete('/:id', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const advance = await Advance.findById(req.params.id);
  if (!advance) return res.status(404).json({ success: false, message: 'Advance not found' });
  if (advance.status === 'deducted') {
    return res.status(400).json({ success: false, message: 'Cannot cancel an advance that has already been deducted from payroll' });
  }
  advance.status = 'cancelled';
  await advance.save();
  res.json({ success: true, message: 'Advance cancelled' });
}));

module.exports = advanceRouter;