const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const mongoose = require('../core/mongoose');

// ── Schema ────────────────────────────────────────────────────────────────────
const deptSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, trim: true, default: '' },
    location: { type: String, trim: true, default: '' },
    head: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const Department =
  mongoose.models.Department || mongoose.model('Department', deptSchema);

// ── GET /departments  (all active, with employeeCount) ───────────────────────
router.get(
  '/',
  protect,
  asyncHandler(async (req, res) => {
    const depts = await Department.find({ isActive: true })
      .populate('head', 'firstName lastName')
      .sort({ name: 1 })
      .lean();

    // Count active users (employees) per department.
    // Department is stored on the User model as user.department (ObjectId).
    // `isActive` only reflects whether the account has been soft-deleted
    // (it stays true for resigned/terminated/on_leave/probation employees
    // whose accounts were never deleted) — so the actual employment status
    // must be checked via `status: 'active'`, not just isActive/deletedAt.
    const User = mongoose.model('User');
    const deptIds = depts.map((d) => d._id);

    const counts = await User.aggregate([
      {
        $match: {
          department: { $in: deptIds },
          isActive: true,
          deletedAt: null,
          status: 'active',
        },
      },
      {
        $group: { _id: '$department', count: { $sum: 1 } },
      },
    ]);

    const countMap = Object.fromEntries(
      counts.map((c) => [String(c._id), c.count]),
    );
    depts.forEach((d) => {
      d.employeeCount = countMap[String(d._id)] || 0;
    });

    res.json({ success: true, data: depts });
  }),
);

// ── GET /departments/:id ──────────────────────────────────────────────────────
router.get(
  '/:id',
  protect,
  asyncHandler(async (req, res) => {
    const dept = await Department.findById(req.params.id)
      .populate('head', 'firstName lastName')
      .lean();
    if (!dept || !dept.isActive) {
      return res
        .status(404)
        .json({ success: false, message: 'Department not found' });
    }
    res.json({ success: true, data: dept });
  }),
);

// ── POST /departments  (admin only) ──────────────────────────────────────────
router.post(
  '/',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { name, code, description, location, head } = req.body;

    if (!name || !code) {
      return res
        .status(400)
        .json({ success: false, message: 'Name and Code are required.' });
    }

    const existing = await Department.findOne({
      code: code.toUpperCase(),
      isActive: true,
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Code "${code.toUpperCase()}" already exists.`,
      });
    }

    const dept = await Department.create({
      name,
      code,
      description,
      location,
      head: head || null,
    });
    res.status(201).json({ success: true, data: dept });
  }),
);

// ── PUT /departments/:id  (admin only) ───────────────────────────────────────
router.put(
  '/:id',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { name, code, description, location, head } = req.body;

    const dept = await Department.findById(req.params.id);
    if (!dept || !dept.isActive) {
      return res
        .status(404)
        .json({ success: false, message: 'Department not found' });
    }

    if (code && code.toUpperCase() !== dept.code) {
      const collision = await Department.findOne({
        code: code.toUpperCase(),
        isActive: true,
        _id: { $ne: dept._id },
      });
      if (collision) {
        return res.status(409).json({
          success: false,
          message: `Code "${code.toUpperCase()}" already exists.`,
        });
      }
    }

    if (name) dept.name = name;
    if (code) dept.code = code.toUpperCase();
    if (description !== undefined) dept.description = description;
    if (location !== undefined) dept.location = location;
    if (head !== undefined) dept.head = head || null;

    await dept.save();
    await dept.populate('head', 'firstName lastName');

    res.json({ success: true, data: dept });
  }),
);

// ── DELETE /departments/:id  (soft-delete, admin only) ───────────────────────
router.delete(
  '/:id',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const dept = await Department.findById(req.params.id);
    if (!dept || !dept.isActive) {
      return res
        .status(404)
        .json({ success: false, message: 'Department not found' });
    }
    dept.isActive = false;
    await dept.save();
    res.json({ success: true, message: 'Department deleted successfully.' });
  }),
);

module.exports = router;
