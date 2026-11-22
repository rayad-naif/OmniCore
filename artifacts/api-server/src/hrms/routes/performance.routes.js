const express = require('express');
const router = express.Router();
const { protect, hrAndAbove } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const PerformanceReview = require('../models/Performance.model');

router.get('/', protect, asyncHandler(async (req, res) => {
  const query = req.user.role === 'employee' ? { employee: req.user._id } : {};
  if (req.query.employeeId) query.employee = req.query.employeeId;
  const reviews = await PerformanceReview.find(query)
    .populate('employee reviewer', 'firstName lastName')
    .sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, data: reviews });
}));

router.post('/', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const review = await PerformanceReview.create({ ...req.body, reviewer: req.user._id });
  res.status(201).json({ success: true, data: review });
}));

router.put('/:id', protect, asyncHandler(async (req, res) => {
  const review = await PerformanceReview.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json({ success: true, data: review });
}));
module.exports = router;
