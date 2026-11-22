const express = require('express');
const router = express.Router();
const { protect, managementOnly } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const Expense = require('../models/Expense');
const Earning = require('../models/Earning');
const FinanceSetting = require('../models/FinanceSetting');

// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/dashboard',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const month = Number(req.query.month) || new Date().getMonth() + 1;
    const year = Number(req.query.year) || new Date().getFullYear();

    const settings = await FinanceSetting.getSingleton();

    const [
      expenseAgg,
      earningAgg,
      expenseByPerson,
      earningByPerson,
      liabilitiesByPerson,
    ] = await Promise.all([
      Expense.aggregate([
        { $match: { month, year, isActive: true } },
        {
          $group: {
            _id: '$category',
            totalPKR: { $sum: '$amountPKR' },
            totalUSD: { $sum: '$amountUSD' },
          },
        },
      ]),

      Earning.aggregate([
        { $match: { month, year, isActive: true } },
        {
          $group: {
            _id: null,
            totalPKR: { $sum: '$amountPKR' },
            totalUSD: { $sum: '$amountUSD' },
          },
        },
      ]),

      Expense.aggregate([
        { $match: { month, year, isActive: true } },
        {
          $group: {
            _id: '$paidBy.name',
            totalPKR: { $sum: '$amountPKR' },
            totalUSD: { $sum: '$amountUSD' },
          },
        },
        { $sort: { totalPKR: -1 } },
      ]),

      Earning.aggregate([
        { $match: { month, year, isActive: true } },
        {
          $group: {
            _id: '$person.name',
            totalPKR: { $sum: '$amountPKR' },
            totalUSD: { $sum: '$amountUSD' },
          },
        },
        { $sort: { totalPKR: -1 } },
      ]),

      // Outstanding liabilities — NOT scoped to month/year on purpose:
      // an unreturned expense from 2 months ago is still owed today.
      Expense.aggregate([
        { $match: { isActive: true, needsReturn: true, isReturned: false } },
        {
          $group: { _id: '$paidBy.name', totalOwedPKR: { $sum: '$amountPKR' } },
        },
        { $sort: { totalOwedPKR: -1 } },
      ]),
    ]);

    const expenseBreakdown = expenseAgg.reduce(
      (acc, item) => {
        const pkr = item.totalPKR || 0;
        const usd = item.totalUSD || 0;
        if (item._id === 'fixed_expense') {
          acc.fixed.totalPKR += pkr;
          acc.fixed.totalUSD += usd;
        } else if (item._id === 'employee_salary') {
          acc.salaries.totalPKR += pkr;
          acc.salaries.totalUSD += usd;
        } else {
          acc.variable.totalPKR += pkr;
          acc.variable.totalUSD += usd;
        }
        return acc;
      },
      {
        variable: { totalPKR: 0, totalUSD: 0 },
        fixed: { totalPKR: 0, totalUSD: 0 },
        salaries: { totalPKR: 0, totalUSD: 0 },
      },
    );

    const totalExpensePKR =
      expenseBreakdown.variable.totalPKR +
      expenseBreakdown.fixed.totalPKR +
      expenseBreakdown.salaries.totalPKR;
    const totalExpenseUSD = totalExpensePKR / settings.usdToPkrRate;

    const totalEarningPKR = earningAgg[0]?.totalPKR || 0;
    const totalEarningUSD = totalEarningPKR / settings.usdToPkrRate;

    const profitPKR = totalEarningPKR - totalExpensePKR;
    const profitUSD = totalEarningUSD - totalExpenseUSD;

    const activeOwners = settings.owners.filter((o) => o.isActive);
    const ownerCount = activeOwners.length || 2;
    const perOwnerPKR = profitPKR / ownerCount;
    const perOwnerUSD = profitUSD / ownerCount;

    // ── Outstanding liabilities ──
    const totalOutstandingPKR = liabilitiesByPerson.reduce(
      (sum, p) => sum + (p.totalOwedPKR || 0),
      0,
    );
    const totalOutstandingUSD = totalOutstandingPKR / settings.usdToPkrRate;

    res.json({
      success: true,
      data: {
        month,
        year,
        usdToPkrRate: settings.usdToPkrRate,
        expenses: {
          variable: {
            _id: 'variable_expense',
            totalPKR: expenseBreakdown.variable.totalPKR,
            totalUSD: expenseBreakdown.variable.totalUSD,
            totalExpensePKR: expenseBreakdown.variable.totalPKR,
          },
          fixed: {
            _id: 'fixed_expense',
            totalPKR: expenseBreakdown.fixed.totalPKR,
            totalUSD: expenseBreakdown.fixed.totalUSD,
            totalExpensePKR: expenseBreakdown.fixed.totalPKR,
          },
          salaries: {
            _id: 'employee_salary',
            totalPKR: expenseBreakdown.salaries.totalPKR,
            totalUSD: expenseBreakdown.salaries.totalUSD,
            totalExpensePKR: expenseBreakdown.salaries.totalPKR,
          },
          totalPKR: totalExpensePKR,
          totalUSD: parseFloat(totalExpenseUSD.toFixed(2)),
        },
        earnings: {
          totalPKR: totalEarningPKR,
          totalUSD: parseFloat(totalEarningUSD.toFixed(2)),
          byPerson: earningByPerson,
        },
        profit: {
          pkr: parseFloat(profitPKR.toFixed(2)),
          usd: parseFloat(profitUSD.toFixed(2)),
          perOwnerPKR: parseFloat(perOwnerPKR.toFixed(2)),
          perOwnerUSD: parseFloat(perOwnerUSD.toFixed(2)),
          ownerCount,
          owners: activeOwners,
        },
        liabilities: {
          totalOutstandingPKR: parseFloat(totalOutstandingPKR.toFixed(2)),
          totalOutstandingUSD: parseFloat(totalOutstandingUSD.toFixed(2)),
          byPerson: liabilitiesByPerson,
        },
        expenseByPayer: expenseByPerson,
      },
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /finance/yearly-summary
// Full year breakdown for owner yearly summary view
// Query: year, startMonth, endMonth (optional range, default full year)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/yearly-summary',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const startMonth = Number(req.query.startMonth) || 1;
    const endMonth = Number(req.query.endMonth) || 12;

    const settings = await FinanceSetting.getSingleton();
    const rate = settings.usdToPkrRate;

    const monthMatch = {
      year,
      month: { $gte: startMonth, $lte: endMonth },
      isActive: true,
    };

    const [expenseMonthly, earningMonthly, earningByPerson] = await Promise.all(
      [
        // Aggregates total per category per month
        Expense.aggregate([
          { $match: monthMatch },
          {
            $group: {
              _id: { month: '$month', category: '$category' },
              totalPKR: { $sum: '$amountPKR' },
            },
          },
          { $sort: { '_id.month': 1 } },
        ]),

        Earning.aggregate([
          { $match: monthMatch },
          {
            $group: {
              _id: '$month',
              totalPKR: { $sum: '$amountPKR' },
            },
          },
          { $sort: { _id: 1 } },
        ]),

        Earning.aggregate([
          { $match: monthMatch },
          {
            $group: {
              _id: '$person.name',
              totalPKR: { $sum: '$amountPKR' },
            },
          },
          { $sort: { totalPKR: -1 } },
        ]),
      ],
    );

    // Build month-by-month P&L (safely generating all selected months sequentially)
    const months = [];
    for (let m = startMonth; m <= endMonth; m++) {
      // 1. Calculate total month expenses across ALL categories combined
      const totalMonthExpPKR = expenseMonthly
        .filter((e) => e._id.month === m)
        .reduce((sum, item) => sum + (item.totalPKR || 0), 0);

      // 2. Identify explicit structural category figures
      const fixed =
        expenseMonthly.find(
          (e) => e._id.month === m && e._id.category === 'fixed_expense',
        )?.totalPKR || 0;
      const salaries =
        expenseMonthly.find(
          (e) => e._id.month === m && e._id.category === 'employee_salary',
        )?.totalPKR || 0;

      // 3. Dynamic variable bucket calculation: Total minus (Fixed + Salaries)
      const variable = totalMonthExpPKR - (fixed + salaries);

      const totalEarn = earningMonthly.find((e) => e._id === m)?.totalPKR || 0;
      const profit = totalEarn - totalMonthExpPKR;

      months.push({
        month: m,
        variable,
        fixed,
        salaries,
        totalExpense: totalMonthExpPKR,
        totalEarning: totalEarn,
        profit,
        expenseUSD: parseFloat((totalMonthExpPKR / rate).toFixed(2)),
        earningUSD: parseFloat((totalEarn / rate).toFixed(2)),
        profitUSD: parseFloat((profit / rate).toFixed(2)),
      });
    }

    // Year totals
    const yearTotals = months.reduce(
      (acc, m) => {
        acc.totalExpense += m.totalExpense;
        acc.totalEarning += m.totalEarning;
        acc.totalProfit += m.profit;
        return acc;
      },
      { totalExpense: 0, totalEarning: 0, totalProfit: 0 },
    );

    const activeOwners = settings.owners.filter((o) => o.isActive);
    const ownerCount = activeOwners.length || 2;

    res.json({
      success: true,
      data: {
        year,
        startMonth,
        endMonth,
        usdToPkrRate: rate,
        months,
        yearTotals: {
          ...yearTotals,
          totalExpenseUSD: parseFloat(
            (yearTotals.totalExpense / rate).toFixed(2),
          ),
          totalEarningUSD: parseFloat(
            (yearTotals.totalEarning / rate).toFixed(2),
          ),
          totalProfitUSD: parseFloat(
            (yearTotals.totalProfit / rate).toFixed(2),
          ),
          perOwnerPKR: parseFloat(
            (yearTotals.totalProfit / ownerCount).toFixed(2),
          ),
          perOwnerUSD: parseFloat(
            (yearTotals.totalProfit / ownerCount / rate).toFixed(2),
          ),
          ownerCount,
          owners: activeOwners,
        },
        earningByPerson: earningByPerson.map((p) => ({
          name: p._id,
          totalPKR: p.totalPKR,
          totalUSD: parseFloat((p.totalPKR / rate).toFixed(2)),
        })),
      },
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Finance Settings CRUD
// ─────────────────────────────────────────────────────────────────────────────

// GET /finance/settings
router.get(
  '/settings',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const settings = await FinanceSetting.getSingleton();
    res.json({ success: true, data: settings });
  }),
);

// PATCH /finance/settings/rate  — update USD rate
router.patch(
  '/settings/rate',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const { usdToPkrRate } = req.body;
    if (!usdToPkrRate || usdToPkrRate < 1)
      return res.status(400).json({ success: false, message: 'Invalid rate' });

    const settings = await FinanceSetting.getSingleton();
    settings.usdToPkrRate = Number(usdToPkrRate);
    settings.rateUpdatedAt = new Date();
    settings.rateUpdatedBy = req.user._id;
    await settings.save();

    res.json({ success: true, data: settings });
  }),
);

// POST /finance/settings/persons — add a person to the roster
router.post(
  '/settings/persons',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const { name, role, userId } = req.body;
    const settings = await FinanceSetting.getSingleton();
    settings.persons.push({ name, role: role || '', userId: userId || null });
    await settings.save();
    res.status(201).json({ success: true, data: settings.persons });
  }),
);

// DELETE /finance/settings/persons/:personId
router.delete(
  '/settings/persons/:personId',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const settings = await FinanceSetting.getSingleton();
    const person = settings.persons.id(req.params.personId);
    if (!person)
      return res
        .status(404)
        .json({ success: false, message: 'Person not found' });
    person.isActive = false;
    await settings.save();
    res.json({ success: true, message: 'Person deactivated' });
  }),
);

// POST /finance/settings/owners
router.post(
  '/settings/owners',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const { name, userId } = req.body;
    const settings = await FinanceSetting.getSingleton();
    settings.owners.push({ name, userId: userId || null });
    await settings.save();
    res.status(201).json({ success: true, data: settings.owners });
  }),
);

// DELETE /finance/settings/owners/:ownerId
router.delete(
  '/settings/owners/:ownerId',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const settings = await FinanceSetting.getSingleton();
    const owner = settings.owners.id(req.params.ownerId);
    if (!owner)
      return res
        .status(404)
        .json({ success: false, message: 'Owner not found' });
    owner.isActive = false;
    await settings.save();
    res.json({ success: true, message: 'Owner removed' });
  }),
);

module.exports = router;
