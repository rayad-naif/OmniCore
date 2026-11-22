const express = require('express');
const router = express.Router();
const { protect, managementOnly } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const WorkFromHomeRequest = require('../models/WorkFromHomeRequest.model');

const calculateDays = (start, end) => Math.max(1, Math.round((end - start) / 86400000) + 1);

const populateRequest = (query) => query
  .populate({
    path: 'employee',
    select: 'firstName lastName email department position avatar',
    populate: { path: 'department', select: 'name code' },
  })
  .populate('approvedBy', 'firstName lastName');

router.get('/', protect, asyncHandler(async (req, res) => {
  const query = req.user.role === 'employee' ? { employee: req.user._id } : {};
  const requests = await populateRequest(WorkFromHomeRequest.find(query).sort({ createdAt: -1 }));
  res.json({ success: true, data: requests });
}));

router.post('/', protect, asyncHandler(async (req, res) => {
  const { reason, startDate, endDate } = req.body;
  if (!reason?.trim() || !startDate || !endDate) {
    return res.status(400).json({ success: false, message: 'Please provide a reason and valid date range.' });
  }

  const rawStart = new Date(startDate);
  const rawEnd = new Date(endDate);
  if (Number.isNaN(rawStart.getTime()) || Number.isNaN(rawEnd.getTime()) || rawEnd < rawStart) {
    return res.status(400).json({ success: false, message: 'Invalid date range.' });
  }

  const start = new Date(Date.UTC(rawStart.getUTCFullYear(), rawStart.getUTCMonth(), rawStart.getUTCDate()));
  const end = new Date(Date.UTC(rawEnd.getUTCFullYear(), rawEnd.getUTCMonth(), rawEnd.getUTCDate()));
  const request = await WorkFromHomeRequest.create({
    employee: req.user._id,
    reason: reason.trim(),
    startDate: start,
    endDate: end,
    totalDays: calculateDays(start, end),
  });

  res.status(201).json({ success: true, data: request, message: 'Work from home request submitted successfully.' });
}));

router.patch('/:id/approve', protect, managementOnly, asyncHandler(async (req, res) => {
  const request = await WorkFromHomeRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ success: false, message: 'Work from home request not found.' });
  if (request.status !== 'pending') return res.status(400).json({ success: false, message: 'Only pending requests can be approved.' });

  request.status = 'approved';
  request.approvedBy = req.user._id;
  request.approvedAt = new Date();
  request.comments = req.body.comments || 'Approved.';
  await request.save();
  res.json({ success: true, data: request, message: 'Work from home request approved.' });
}));

router.patch('/:id/reject', protect, managementOnly, asyncHandler(async (req, res) => {
  const request = await WorkFromHomeRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ success: false, message: 'Work from home request not found.' });
  if (request.status !== 'pending') return res.status(400).json({ success: false, message: 'Only pending requests can be rejected.' });

  request.status = 'rejected';
  request.approvedBy = req.user._id;
  request.approvedAt = new Date();
  request.comments = req.body.comments || 'Rejected.';
  await request.save();
  res.json({ success: true, data: request, message: 'Work from home request rejected.' });
}));

module.exports = router;
