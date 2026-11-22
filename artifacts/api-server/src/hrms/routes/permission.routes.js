const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth.middleware');
const { asyncHandler, AppError } = require('../utils/errorUtils');
const Permission = require('../models/Permission.model');

router.get('/', protect, asyncHandler(async (req, res) => {
  const permissions = await Permission.find().sort({ name: 1 });
  res.json({ success: true, data: permissions });
}));

router.post('/', protect, adminOnly, asyncHandler(async (req, res) => {
  const { name, description, group } = req.body;
  if (!name) throw new AppError('Permission name is required.', 400);
  const existing = await Permission.findOne({ name: name.trim() });
  if (existing) throw new AppError('Permission already exists.', 409);
  const permission = await Permission.create({ name: name.trim(), description, group });
  res.status(201).json({ success: true, data: permission });
}));

router.put('/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const { name, description, group, isActive } = req.body;
  const permission = await Permission.findById(req.params.id);
  if (!permission) throw new AppError('Permission not found.', 404);
  if (name) permission.name = name.trim();
  if (description !== undefined) permission.description = description;
  if (group !== undefined) permission.group = group;
  if (isActive !== undefined) permission.isActive = Boolean(isActive);
  await permission.save();
  res.json({ success: true, data: permission });
}));

router.delete('/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const permission = await Permission.findByIdAndDelete(req.params.id);
  if (!permission) throw new AppError('Permission not found.', 404);
  res.json({ success: true, message: 'Permission deleted.' });
}));

module.exports = router;
