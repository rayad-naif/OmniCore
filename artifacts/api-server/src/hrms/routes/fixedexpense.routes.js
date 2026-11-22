const express = require('express');
const router = express.Router();
const { protect, managementOnly } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const FixedExpense = require('../models/Fixedexpense');

// ─── GET /fixed-expenses ────────────────────────────────────────────────────
router.get(
  '/',
  protect, managementOnly,
  asyncHandler(async (req, res) => {
    const items = await FixedExpense.find({ isActive: true }).sort({ createdAt: 1 });
    res.json({ success: true, data: items });
  })
);

// ─── POST /fixed-expenses ───────────────────────────────────────────────────
// Body: { title, description, amountPKR, paidBy, enabled }
router.post(
  '/',
  protect, managementOnly,
  asyncHandler(async (req, res) => {
    const { title, description, amountPKR, paidBy, enabled } = req.body;
    if (!title || amountPKR === undefined || amountPKR === null || amountPKR === '') {
      return res.status(400).json({ success: false, message: 'title and amountPKR are required' });
    }

    const item = await FixedExpense.create({
      title,
      description: description || '',
      amountPKR: Number(amountPKR),
      paidBy: paidBy || '',
      enabled: enabled ?? true,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, data: item });
  })
);

// ─── PUT /fixed-expenses/:id ────────────────────────────────────────────────
// Body: any of { title, description, amountPKR, paidBy, enabled }
router.put(
  '/:id',
  protect, managementOnly,
  asyncHandler(async (req, res) => {
    const item = await FixedExpense.findById(req.params.id);
    if (!item || !item.isActive) {
      return res.status(404).json({ success: false, message: 'Fixed expense not found' });
    }

    const allowed = ['title', 'description', 'amountPKR', 'paidBy', 'enabled'];
    allowed.forEach(k => { if (req.body[k] !== undefined) item[k] = req.body[k]; });

    await item.save();
    res.json({ success: true, data: item });
  })
);

// ─── PATCH /fixed-expenses/:id/toggle ───────────────────────────────────────
// Body: { enabled }
router.patch(
  '/:id/toggle',
  protect, managementOnly,
  asyncHandler(async (req, res) => {
    const item = await FixedExpense.findById(req.params.id);
    if (!item || !item.isActive) {
      return res.status(404).json({ success: false, message: 'Fixed expense not found' });
    }

    item.enabled = !!req.body.enabled;
    await item.save();
    res.json({ success: true, data: item });
  })
);

// ─── DELETE /fixed-expenses/:id (soft) ──────────────────────────────────────
router.delete(
  '/:id',
  protect, managementOnly,
  asyncHandler(async (req, res) => {
    const item = await FixedExpense.findById(req.params.id);
    if (!item || !item.isActive) {
      return res.status(404).json({ success: false, message: 'Fixed expense not found' });
    }

    item.isActive = false;
    await item.save();
    res.json({ success: true, message: 'Fixed expense deleted' });
  })
);

module.exports = router;