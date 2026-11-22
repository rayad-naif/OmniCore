const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth.middleware');
const { asyncHandler, AppError } = require('../utils/errorUtils');
const ShiftType = require('../models/ShiftType.model');

router.get('/', protect, asyncHandler(async (req, res) => {
  const shiftTypes = await ShiftType.find().sort({ name: 1 });
  res.json({ success: true, data: shiftTypes });
}));

router.post('/', protect, adminOnly, asyncHandler(async (req, res) => {
  // 1. Destructure iconKey and crossDay alongside your existing properties
  const { 
    name, 
    description, 
    startTime, 
    endTime, 
    workMode, 
    breakEnabled, 
    breakDurationMinutes,
    crossDay,
    iconKey 
  } = req.body;

  if (!name || !startTime || !endTime) {
    throw new AppError('Name, start time, and end time are required.', 400);
  }

  // 2. Supply them directly to the database layer instantiation
  const shiftType = await ShiftType.create({
    name,
    description,
    startTime,
    endTime,
    workMode: workMode || 'office',
    breakEnabled: typeof breakEnabled === 'boolean' ? breakEnabled : true,
    breakDurationMinutes: Number(breakDurationMinutes || 60),
    crossDay: typeof crossDay === 'boolean' ? crossDay : false,
    iconKey: iconKey || 'day' // Explicit fallback safely applied here
  });

  res.status(201).json({ success: true, data: shiftType });
}));

router.put('/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const shiftType = await ShiftType.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!shiftType) throw new AppError('Shift type not found.', 404);
  res.json({ success: true, data: shiftType });
}));

router.delete('/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const shiftType = await ShiftType.findByIdAndDelete(req.params.id);
  if (!shiftType) throw new AppError('Shift type not found.', 404);
  res.json({ success: true, message: 'Shift type deleted.' });
}));

module.exports = router;
