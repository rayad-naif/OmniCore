const express = require('express');
const router = express.Router();
const { protect, managementOnly } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const Expense = require('../models/Expense');
const FinanceSetting = require('../models/FinanceSetting');

// ─── GET /expenses ─────────────────────────────────────────────────────────
// Query: month, year, category, paidBy
router.get(
  '/',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const { month, year, category, paidBy } = req.query;

    const filter = { isActive: true };
    if (month) filter.month = Number(month);
    if (year) filter.year = Number(year);
    if (category) filter.category = category;
    if (paidBy) filter['paidBy.name'] = new RegExp(paidBy, 'i');

    const expenses = await Expense.find(filter)
      .sort({ date: -1 })
      .populate('createdBy', 'name')
      .lean();

    res.json({ success: true, data: expenses });
  }),
);

// ─── GET /expenses/summary ────────────────────────────────────────────────
// Returns monthly totals broken down by category + paidBy
// Query: month, year  (required)
router.get(
  '/summary',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const month = Number(req.query.month) || new Date().getMonth() + 1;
    const year = Number(req.query.year) || new Date().getFullYear();

    const [byCategory, byPerson] = await Promise.all([
      // ── Total per category ──
      Expense.aggregate([
        { $match: { month, year, isActive: true } },
        {
          $group: {
            _id: '$category',
            totalPKR: { $sum: '$amountPKR' },
            totalUSD: { $sum: '$amountUSD' },
            count: { $sum: 1 },
          },
        },
      ]),

      // ── Total per paidBy person ──
      Expense.aggregate([
        { $match: { month, year, isActive: true } },
        {
          $group: {
            _id: '$paidBy.name',
            totalPKR: { $sum: '$amountPKR' },
            totalUSD: { $sum: '$amountUSD' },
            count: { $sum: 1 },
          },
        },
        { $sort: { totalPKR: -1 } },
      ]),
    ]);

    // ── Grand totals ──
    // ── Grand totals ──
    const grandTotal = byCategory.reduce(
      (acc, c) => {
        acc.totalPKR += c.totalPKR;
        acc.totalUSD += c.totalUSD || 0;
        return acc;
      },
      { totalPKR: 0, totalUSD: 0 },
    );

    // FIND SPECIFIC BASE CORES
    const fixedSum = byCategory.find((c) => c._id === 'fixed_expense') || {
      totalPKR: 0,
      totalUSD: 0,
      count: 0,
    };
    const salarySum = byCategory.find((c) => c._id === 'employee_salary') || {
      totalPKR: 0,
      totalUSD: 0,
      count: 0,
    };

    // DYNAMICALLY SUM ALL OTHER EXPENSES INTO VARIABLE EXPENSES
    const variableSum = byCategory.reduce(
      (acc, c) => {
        if (c._id !== 'fixed_expense' && c._id !== 'employee_salary') {
          acc.totalPKR += c.totalPKR;
          acc.totalUSD += c.totalUSD || 0;
          acc.count += c.count;
        }
        return acc;
      },
      { totalPKR: 0, totalUSD: 0, count: 0 },
    );

    const categorySummary = {
      variable_expense: variableSum,
      fixed_expense: fixedSum,
      employee_salary: salarySum,
    };

    res.json({
      success: true,
      data: {
        month,
        year,
        grandTotal,
        categorySummary,
        byPerson,
      },
    });
  }),
);

// ─── GET /expenses/yearly ─────────────────────────────────────────────────
// Returns 12 months of totals for a given year (for charts)
router.get(
  '/yearly',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();

    const result = await Expense.aggregate([
      { $match: { year, isActive: true } },
      {
        $group: {
          _id: { month: '$month', category: '$category' },
          totalPKR: { $sum: '$amountPKR' },
          totalUSD: { $sum: '$amountUSD' },
        },
      },
      { $sort: { '_id.month': 1 } },
    ]);

    // Shape into 12-month array
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      variable_expense: 0,
      fixed_expense: 0,
      employee_salary: 0,
      totalPKR: 0,
      totalUSD: 0,
    }));

    result.forEach(({ _id, totalPKR, totalUSD }) => {
      const m = months[_id.month - 1];
      m[_id.category] = totalPKR;
      m.totalPKR += totalPKR;
      m.totalUSD += totalUSD || 0;
    });

    res.json({ success: true, data: { year, months } });
  }),
);
router.get(
  '/liabilities',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const { status } = req.query; // 'pending' | 'returned' | undefined (=all)

    const filter = { isActive: true, needsReturn: true };
    if (status === 'pending') filter.isReturned = false;
    if (status === 'returned') filter.isReturned = true;

    const items = await Expense.find(filter)
      .sort({ date: -1 })
      .populate('createdBy', 'name')
      .populate('returnedBy', 'name')
      .lean();

    const byPerson = await Expense.aggregate([
      { $match: { isActive: true, needsReturn: true, isReturned: false } },
      {
        $group: {
          _id: '$paidBy.name',
          totalOwedPKR: { $sum: '$amountPKR' },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalOwedPKR: -1 } },
    ]);

    const totalOutstandingPKR = byPerson.reduce(
      (sum, p) => sum + p.totalOwedPKR,
      0,
    );

    res.json({
      success: true,
      data: { items, byPerson, totalOutstandingPKR },
    });
  }),
);
// ─── GET /expenses/:id ────────────────────────────────────────────────────
router.get(
  '/:id',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const expense = await Expense.findById(req.params.id).populate(
      'createdBy',
      'name',
    );
    if (!expense || !expense.isActive)
      return res
        .status(404)
        .json({ success: false, message: 'Expense not found' });
    res.json({ success: true, data: expense });
  }),
);

// ─── POST /expenses ───────────────────────────────────────────────────────
// ─── POST /expenses ───────────────────────────────────────────────────────
router.post(
  '/',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const {
      title,
      description,
      notes,
      category,
      amountPKR,
      paidBy,
      linkedEmployee,
      date,
      month,
      year,
      usdRateAtEntry, // caller can pass; if omitted we pull from settings
      needsReturn, // flag: this payment must be paid back to the payer later
    } = req.body;

    // Fetch rate from settings if not provided
    let rate = usdRateAtEntry;
    if (!rate) {
      const settings = await FinanceSetting.getSingleton();
      rate = settings.usdToPkrRate;
    }

    const entryDate = date ? new Date(date) : new Date();
    const entryMonth = month || entryDate.getMonth() + 1;
    const entryYear = year || entryDate.getFullYear();

    // REQUIREMENT: Automatically select the logged-in user for fixed expenses
    let finalPaidBy = paidBy;
    if (category === 'fixed_expense') {
      // Safely combine firstName and lastName, fallback to handling missing fields cleanly
      const fullName =
        `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() ||
        'Admin';

      finalPaidBy = {
        name: fullName, // Combines first name and last name
        userId: req.user._id, // Stores their user reference ID
      };

      console.log(
        `Fixed expense detected. Overriding paidBy to logged-in user: ${fullName} (${req.user._id})`,
      );
    }

    const expense = await Expense.create({
      month: entryMonth,
      year: entryYear,
      title,
      description,
      notes,
      category,
      amountPKR: Number(amountPKR),
      usdRateAtEntry: rate,
      paidBy: finalPaidBy, // Uses the overridden paidBy block for fixed expenses
      linkedEmployee: linkedEmployee || null,
      date: entryDate,
      createdBy: req.user._id,
      needsReturn: !!needsReturn,
      isReturned: false,
      returnedAt: null,
    });

    res.status(201).json({ success: true, data: expense });
  }),
);

// ─── PUT /expenses/:id ────────────────────────────────────────────────────
router.put(
  '/:id',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const expense = await Expense.findById(req.params.id);
    if (!expense || !expense.isActive)
      return res
        .status(404)
        .json({ success: false, message: 'Expense not found' });

    const allowed = [
      'title',
      'description',
      'notes',
      'category',
      'amountPKR',
      'paidBy',
      'linkedEmployee',
      'date',
      'month',
      'year',
      'usdRateAtEntry',
      'needsReturn',
      'isReturned',
      'returnedAt',
    ];
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) expense[k] = req.body[k];
    });

    // Keep monthly reporting aligned when an expense date is changed from the UI.
    if (req.body.date !== undefined) {
      const entryDate = new Date(req.body.date);
      if (req.body.month === undefined)
        expense.month = entryDate.getMonth() + 1;
      if (req.body.year === undefined) expense.year = entryDate.getFullYear();
    }

    await expense.save();
    res.json({ success: true, data: expense });
  }),
);

// ─── PATCH /expenses/:id/return-status ────────────────────────────────────
// Dedicated one-click toggle for the "Needs Return" button in the table.
// Body: { isReturned: boolean }
router.patch(
  '/:id/return-status',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const expense = await Expense.findById(req.params.id);
    if (!expense || !expense.isActive)
      return res
        .status(404)
        .json({ success: false, message: 'Expense not found' });

    if (!expense.needsReturn) {
      return res.status(400).json({
        success: false,
        message: 'This expense is not flagged as needing a return',
      });
    }

    const isReturned = !!req.body.isReturned;
    expense.isReturned = isReturned;
    expense.returnedAt = isReturned ? new Date() : null;
    expense.returnedBy = isReturned ? req.user._id : null;
    expense.returnMethod = isReturned ? req.body.returnMethod || null : null;
    expense.returnNote = isReturned ? req.body.returnNote || null : null;

    await expense.save();
    res.json({ success: true, data: expense });
  }),
);
// ─── DELETE /expenses/:id (soft) ──────────────────────────────────────────
router.delete(
  '/:id',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const expense = await Expense.findById(req.params.id);
    if (!expense || !expense.isActive)
      return res
        .status(404)
        .json({ success: false, message: 'Expense not found' });

    expense.isActive = false;
    await expense.save();
    res.json({ success: true, message: 'Expense deleted' });
  }),
);

module.exports = router;
