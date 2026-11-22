const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth.middleware');
const { asyncHandler, AppError } = require('../utils/errorUtils');
const Role = require('../models/Role.model');

router.get(
  '/',
  protect,
  asyncHandler(async (req, res) => {
    const roles = await Role.find().sort({ name: 1 });
    res.json({ success: true, data: roles });
  }),
);

router.post(
  '/',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { name, description } = req.body;
    if (!name) throw new AppError('Role name is required.', 400);
    const existing = await Role.findOne({ name: name.trim() });
    if (existing) throw new AppError('Role already exists.', 409);
    const role = await Role.create({ name: name.trim(), description });
    res.status(201).json({ success: true, data: role });
  }),
);

router.put(
  '/:id',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { name, description, isActive } = req.body;
    const role = await Role.findById(req.params.id);
    if (!role) throw new AppError('Role not found.', 404);
    if (name) role.name = name.trim();
    if (description !== undefined) role.description = description;
    if (isActive !== undefined) role.isActive = Boolean(isActive);
    await role.save();
    res.json({ success: true, data: role });
  }),
);

router.delete(
  '/:id',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const role = await Role.findByIdAndDelete(req.params.id);
    if (!role) throw new AppError('Role not found.', 404);
    res.json({ success: true, message: 'Role deleted.' });
  }),
);

module.exports = router;
