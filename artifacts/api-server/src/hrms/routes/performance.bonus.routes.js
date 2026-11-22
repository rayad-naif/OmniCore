const express = require('express');
const bonusRouter = express.Router();
const { protect, adminOnly, hrAndAbove } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const PerformanceBonus = require('../models/PerformanceBonus.model');

// ─── POST /api/v1/performance-bonuses — Grant a bonus ────────────────────────
bonusRouter.post('/', protect, adminOnly, asyncHandler(async (req, res) => {
  const { employee, amount, month, year, note,bonusType  } = req.body;

  if (!employee || !amount || !month || !year) {
    return res.status(400).json({
      success: false,
      message: 'employee, amount, month, and year are required.',
    });
  }

  if (parseFloat(amount) <= 0) {
    return res.status(400).json({ success: false, message: 'Bonus amount must be greater than zero.' });
  }

  const bonus = await PerformanceBonus.create({
    employee,
    amount: parseFloat(amount),
    month:  parseInt(month),
    year:   parseInt(year),
    grantedBy: req.user._id,
    note: note?.trim() || '',
    isProcessed: false,
    bonusType:   bonusType || 'performance',  // ← bonusType saved

  });

  await bonus.populate('employee', 'firstName lastName employeeId department');
  await bonus.populate('grantedBy', 'firstName lastName');

  res.status(201).json({
    success: true,
    message: 'Performance bonus granted successfully. It will be included in the next payroll run.',
    data: bonus,
  });
}));

// ─── GET /api/v1/performance-bonuses — List with filters ─────────────────────
bonusRouter.get('/', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const { employeeId, month, year, isProcessed } = req.query;
  const query = {};

  if (employeeId)   query.employee    = employeeId;
  if (month)        query.month       = parseInt(month);
  if (year)         query.year        = parseInt(year);
  if (isProcessed !== undefined) query.isProcessed = isProcessed === 'true';

  const bonuses = await PerformanceBonus.find(query)
    .populate('employee',  'firstName lastName employeeId department position')
    .populate('grantedBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(500);

  res.json({ success: true, data: bonuses });
}));

// ─── DELETE /api/v1/performance-bonuses/:id — Revoke unprocessed bonus ────────
bonusRouter.delete('/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const bonus = await PerformanceBonus.findById(req.params.id);

  if (!bonus) {
    return res.status(404).json({ success: false, message: 'Bonus record not found.' });
  }

  if (bonus.isProcessed) {
    return res.status(400).json({
      success: false,
      message: 'Cannot revoke a bonus that has already been processed through payroll.',
    });
  }

  await PerformanceBonus.findByIdAndDelete(req.params.id);

  res.json({ success: true, message: 'Bonus revoked successfully.' });
}));

module.exports = bonusRouter;