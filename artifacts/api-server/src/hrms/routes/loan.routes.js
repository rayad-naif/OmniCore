const express = require('express');
const loanRouter = express.Router();
const {
  protect,
  adminOnly,
  hrAndAbove,
} = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const Loan = require('../models/Loan.model');

// ─── 1. POST /api/v1/loans — Setup a New Loan ────────────────────────────────
loanRouter.post(
  '/',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const {
      employee,
      loanAmount,
      interestPercentage,
      tenureMonths,
      status,
      termsAndConditions,
    } = req.body;

    if (!employee || !loanAmount || !tenureMonths) {
      return res.status(400).json({
        success: false,
        message: 'Employee, loan amount, and tenure months are required.',
      });
    }

    const principal = parseFloat(loanAmount);
    const months = parseInt(tenureMonths);
    const rate = interestPercentage ? parseFloat(interestPercentage) : 0;

    // Calculate Interest & Repayments based on your exact schema fields
    const interestAmount = principal * (rate / 100);
    const totalRepaymentAmount = Math.round(principal + interestAmount);
    const monthlyEMI = Math.round(totalRepaymentAmount / months);

    const newLoan = new Loan({
      employee,
      loanAmount: principal,
      interestPercentage: rate,
      totalRepaymentAmount,
      tenureMonths: months,
      monthlyEMI,
      remainingBalance: totalRepaymentAmount, // Starts at the full repayment sum
      status: status || 'active',
      termsAndConditions,
    });

    await newLoan.save();

    res.status(201).json({
      success: true,
      message: 'Loan configured and saved successfully.',
      data: newLoan,
    });
  }),
);

// ─── 2. GET /api/v1/loans — Get All Loans with Filters ────────────────────────
loanRouter.get(
  '/',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const { employeeId, status } = req.query;
    const query = {};

    if (employeeId) query.employee = employeeId;
    if (status) query.status = status;

    const loans = await Loan.find(query)
      .populate('employee', 'firstName lastName employeeId department position')
      .populate('deductionHistory.payrollId', 'payPeriod')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: loans });
  }),
);

// ─── 3. PUT /api/v1/loans/:id — Update Loan Settings or Status ────────────────
loanRouter.put(
  '/:id',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const {
      loanAmount,
      interestPercentage,
      tenureMonths,
      remainingBalance,
      status,
      termsAndConditions,
    } = req.body;

    const loan = await Loan.findById(req.params.id);
    if (!loan) {
      return res
        .status(404)
        .json({ success: false, message: 'Loan record not found.' });
    }

    // Recalculate calculations if core numbers change
    if (
      loanAmount !== undefined ||
      interestPercentage !== undefined ||
      tenureMonths !== undefined
    ) {
      const finalPrincipal =
        loanAmount !== undefined ? parseFloat(loanAmount) : loan.loanAmount;
      const finalRate =
        interestPercentage !== undefined
          ? parseFloat(interestPercentage)
          : loan.interestPercentage;
      const finalMonths =
        tenureMonths !== undefined ? parseInt(tenureMonths) : loan.tenureMonths;

      const interestAmount = finalPrincipal * (finalRate / 100);

      loan.loanAmount = finalPrincipal;
      loan.interestPercentage = finalRate;
      loan.tenureMonths = finalMonths;
      loan.totalRepaymentAmount = Math.round(finalPrincipal + interestAmount);
      loan.monthlyEMI = Math.round(loan.totalRepaymentAmount / finalMonths);

      // Reset remaining balance only if it wasn't explicitly overridden in this manual request
      if (remainingBalance === undefined) {
        loan.remainingBalance = loan.totalRepaymentAmount;
      }
    }

    if (remainingBalance !== undefined)
      loan.remainingBalance = parseFloat(remainingBalance);
    if (status) loan.status = status;
    if (termsAndConditions !== undefined)
      loan.termsAndConditions = termsAndConditions;

    // Auto-close loan if balance hits zero
    if (loan.remainingBalance <= 0) {
      loan.status = 'fully_paid';
    }

    await loan.save();

    res.json({
      success: true,
      message: 'Loan metrics updated successfully.',
      data: loan,
    });
  }),
);

// ─── 4. DELETE /api/v1/loans/:id — Delete or Cancel Loan ──────────────────────
loanRouter.delete(
  '/:id',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res
        .status(404)
        .json({ success: false, message: 'Loan record not found.' });
    }

    // Business safety rule: Don't allow outright deleting if a payroll deduction has run
    if (loan.deductionHistory && loan.deductionHistory.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Cannot delete this loan setup because active payroll deductions have already happened. Change status to "paused" or "fully_paid" instead.',
      });
    }

    await Loan.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Loan configuration completely deleted.',
    });
  }),
);

module.exports = loanRouter;
