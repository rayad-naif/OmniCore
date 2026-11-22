const express = require('express');
const router = express.Router();
const { protect, managementOnly } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const Earning = require('../models/Earning');
const FinanceSetting = require('../models/FinanceSetting');

// ─── GET /earnings ────────────────────────────────────────────────────────
router.get(
  '/',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const { month, year, person } = req.query;

    const filter = { isActive: true };
    if (month) filter.month = Number(month);
    if (year) filter.year = Number(year);
    if (person) filter['person.name'] = new RegExp(person, 'i');

    const earnings = await Earning.find(filter)
      .sort({ date: -1 })
      .populate('createdBy', 'name')
      .lean();

    res.json({ success: true, data: earnings });
  }),
);

// ─── GET /earnings/summary ────────────────────────────────────────────────
// Person-wise + grand total for a month
router.get(
  '/summary',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const month = Number(req.query.month) || new Date().getMonth() + 1;
    const year = Number(req.query.year) || new Date().getFullYear();

    const byPerson = await Earning.aggregate([
      { $match: { month, year, isActive: true } },
      {
        $group: {
          _id: '$person.name',
          totalPKR: { $sum: '$amountPKR' },
          totalUSD: { $sum: '$amountUSD' },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalPKR: -1 } },
    ]);

    const grandTotal = byPerson.reduce(
      (acc, p) => {
        acc.totalPKR += p.totalPKR;
        acc.totalUSD += p.totalUSD || 0;
        return acc;
      },
      { totalPKR: 0, totalUSD: 0 },
    );

    res.json({
      success: true,
      data: { month, year, grandTotal, byPerson },
    });
  }),
);

// ─── GET /earnings/yearly ─────────────────────────────────────────────────
router.get(
  '/yearly',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();

    const monthly = await Earning.aggregate([
      { $match: { year, isActive: true } },
      {
        $group: {
          _id: '$month',
          totalPKR: { $sum: '$amountPKR' },
          totalUSD: { $sum: '$amountUSD' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const byPersonYearly = await Earning.aggregate([
      { $match: { year, isActive: true } },
      {
        $group: {
          _id: '$person.name',
          totalPKR: { $sum: '$amountPKR' },
          totalUSD: { $sum: '$amountUSD' },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalPKR: -1 } },
    ]);

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      totalPKR: 0,
      totalUSD: 0,
    }));
    monthly.forEach((m) => {
      months[m._id - 1].totalPKR = m.totalPKR;
      months[m._id - 1].totalUSD = m.totalUSD || 0;
    });

    res.json({
      success: true,
      data: { year, months, byPersonYearly },
    });
  }),
);

// ─── GET /earnings/:id ────────────────────────────────────────────────────
router.get(
  '/:id',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const earning = await Earning.findById(req.params.id).populate(
      'createdBy',
      'name',
    );
    if (!earning || !earning.isActive)
      return res
        .status(404)
        .json({ success: false, message: 'Earning not found' });
    res.json({ success: true, data: earning });
  }),
);

// ─── POST /earnings ───────────────────────────────────────────────────────
router.post(
  '/',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const {
      title,
      description,
      notes,
      person,
      amountPKR,
      grossAmountPKR,
      commissionPercent,
      baseAmountPKR,
      date,
      month,
      year,
      usdRateAtEntry,
    } = req.body;

    let rate = usdRateAtEntry;
    if (!rate) {
      const settings = await FinanceSetting.getSingleton();
      rate = settings.usdToPkrRate;
    }

    // Auto-calculate from percentage if requested
    let finalAmountPKR = Number(amountPKR);
    if (commissionPercent && baseAmountPKR && !amountPKR) {
      finalAmountPKR = parseFloat(
        ((Number(baseAmountPKR) * Number(commissionPercent)) / 100).toFixed(2),
      );
    }

    // Earnings totals include 30% of the total; the person's 70% stays record-only.
    const enteredGrossAmount =
      grossAmountPKR === undefined ? null : Number(grossAmountPKR);
    let personAmountPKR = null;
    if (enteredGrossAmount !== null && Number.isFinite(enteredGrossAmount)) {
      finalAmountPKR = parseFloat((enteredGrossAmount * 0.3).toFixed(2));
      personAmountPKR = parseFloat((enteredGrossAmount * 0.7).toFixed(2));
    }

    const entryDate = date ? new Date(date) : new Date();
    const entryMonth = month || entryDate.getMonth() + 1;
    const entryYear = year || entryDate.getFullYear();

    const earning = await Earning.create({
      month: entryMonth,
      year: entryYear,
      title,
      description,
      notes,
      person,
      amountPKR: finalAmountPKR,
      grossAmountPKR: enteredGrossAmount,
      personAmountPKR,
      usdRateAtEntry: rate,
      commissionPercent: commissionPercent || null,
      baseAmountPKR: baseAmountPKR || null,
      date: entryDate,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, data: earning });
  }),
);

// ─── PUT /earnings/:id ────────────────────────────────────────────────────
router.put(
  '/:id',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const earning = await Earning.findById(req.params.id);
    if (!earning || !earning.isActive)
      return res
        .status(404)
        .json({ success: false, message: 'Earning not found' });

    const allowed = [
      'title',
      'description',
      'notes',
      'person',
      'amountPKR',
      'grossAmountPKR',
      'personAmountPKR',
      'commissionPercent',
      'baseAmountPKR',
      'date',
      'month',
      'year',
      'usdRateAtEntry',
    ];
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) earning[k] = req.body[k];
    });

    if (req.body.grossAmountPKR !== undefined) {
      const grossAmount = Number(req.body.grossAmountPKR);
      if (Number.isFinite(grossAmount)) {
        earning.grossAmountPKR = grossAmount;
        earning.amountPKR = parseFloat((grossAmount * 0.3).toFixed(2));
        earning.personAmountPKR = parseFloat((grossAmount * 0.7).toFixed(2));
      }
    }

    // Keep month/year reporting aligned when an earning date is edited.
    if (req.body.date !== undefined) {
      const entryDate = new Date(req.body.date);
      if (req.body.month === undefined)
        earning.month = entryDate.getMonth() + 1;
      if (req.body.year === undefined) earning.year = entryDate.getFullYear();
    }

    await earning.save();
    res.json({ success: true, data: earning });
  }),
);

// ─── DELETE /earnings/:id ─────────────────────────────────────────────────
router.delete(
  '/:id',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const earning = await Earning.findById(req.params.id);
    if (!earning || !earning.isActive)
      return res
        .status(404)
        .json({ success: false, message: 'Earning not found' });

    earning.isActive = false;
    await earning.save();
    res.json({ success: true, message: 'Earning deleted' });
  }),
);

module.exports = router;
