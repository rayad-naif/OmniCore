const express = require('express');
const router = express.Router();
const { protect, managementOnly } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const ExpenseCategory = require('../models/Expensecategory');

// ─── GET /expense-categories ───────────────────────────────────────────────
// Returns all active custom categories (built-ins are hard-coded on the frontend)
router.get(
  '/',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const categories = await ExpenseCategory.find({ isActive: true }).sort({
      createdAt: 1,
    });
    res.json({ success: true, data: categories });
  }),
);

// ─── POST /expense-categories ──────────────────────────────────────────────
// Body: { key, label, color, icon }
router.post(
  '/',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const { key, label, color, icon } = req.body;
    if (!key || !label) {
      return res
        .status(400)
        .json({ success: false, message: 'key and label are required' });
    }

    const exists = await ExpenseCategory.findOne({ key });
    if (exists) {
      return res.status(409).json({
        success: false,
        message: 'A category with this key already exists',
      });
    }

    const category = await ExpenseCategory.create({
      key,
      label,
      color: color || '#ec4899',
      icon: icon || 'Tag',
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, data: category });
  }),
);

// ─── PUT /expense-categories/:id ───────────────────────────────────────────
// Body: { label, color, icon }
router.put(
  '/:id',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const category = await ExpenseCategory.findById(req.params.id);
    if (!category || !category.isActive) {
      return res
        .status(404)
        .json({ success: false, message: 'Category not found' });
    }

    const allowed = ['label', 'color', 'icon'];
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) category[k] = req.body[k];
    });

    await category.save();
    res.json({ success: true, data: category });
  }),
);

// ─── DELETE /expense-categories/:id (soft) ─────────────────────────────────
router.delete(
  '/:id',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const category = await ExpenseCategory.findById(req.params.id);
    if (!category || !category.isActive) {
      return res
        .status(404)
        .json({ success: false, message: 'Category not found' });
    }

    category.isActive = false;
    await category.save();
    res.json({ success: true, message: 'Category deleted' });
  }),
);

module.exports = router;
