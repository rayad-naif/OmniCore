const mongoose = require('../core/mongoose');

const payrollSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    payPeriod: {
      month: { type: Number, required: true, min: 1, max: 12 },
      year: { type: Number, required: true },
      startDate: Date,
      endDate: Date,
    },
    earnings: {
      basicSalary: { type: Number, required: true, default: 0 },
      houseRentAllowance: { type: Number, default: 0 },
      conveyanceAllowance: { type: Number, default: 0 },
      medicalAllowance: { type: Number, default: 0 },
      performanceBonus: { type: Number, default: 0 },
      overtimePay: { type: Number, default: 0 },
      specialAllowance: { type: Number, default: 0 },
      otherEarnings: { type: Number, default: 0 },
      // Amount credited back when a previously held salary is released from
      // Employee Management → Hold Salary. Kept separate from performanceBonus
      // so the payslip clearly shows why this credit appeared.
      releasedHoldAmount: { type: Number, default: 0 },
    },
    deductions: {
      providentFund: { type: Number, default: 0 },
      employeeStateInsurance: { type: Number, default: 0 },
      professionalTax: { type: Number, default: 0 },
      incomeTax: { type: Number, default: 0 },
      loanDeductions: { type: Number, default: 0 },
      advanceDeductions: { type: Number, default: 0 },
      salaryHoldDeduction: { type: Number, default: 0 },
      absentDeductions: { type: Number, default: 0 },
      otherDeductions: { type: Number, default: 0 },
    },
    grossEarnings: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    netSalary: { type: Number, default: 0 },
    // Snapshot of the active loan at the time of this run — written by
    // payroll.routes.js /run. (Was previously being silently dropped because
    // this field wasn't declared here.)
    loanSnapshot: {
      loanAmount: { type: Number },
      interestPercentage: { type: Number },
      remainingBalance: { type: Number },
      tenureMonths: { type: Number },
    },
    // Snapshot of which salary hold(s) contributed to this month's deduction —
    // written by payroll.routes.js /run alongside loanSnapshot
    salaryHoldSnapshot: [
      {
        holdId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalaryHold' },
        amountDeducted: { type: Number },
        totalHoldAmount: { type: Number },
        remainingAfter: { type: Number },
        reason: { type: String },
      },
    ],
    attendanceSummary: {
      totalWorkingDays: { type: Number, default: 0 },
      presentDays: { type: Number, default: 0 },
      absentDays: { type: Number, default: 0 },
      leaveDays: { type: Number, default: 0 },
      holidays: { type: Number, default: 0 },
      overtimeHours: { type: Number, default: 0 },
      lateMarkings: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: [
        'draft',
        'pending_approval',
        'approved',
        'processed',
        'paid',
        'cancelled',
      ],
      default: 'draft',
    },
    paymentDetails: {
      method: {
        type: String,
        enum: ['bank_transfer', 'cheque', 'cash', 'upi'],
        default: 'bank_transfer',
      },
      transactionId: String,
      paidAt: Date,
      payslipUrl: String,
    },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    remarks: String,
    taxDetails: {
      taxableIncome: { type: Number, default: 0 },
      taxSlab: String,
      tds: { type: Number, default: 0 },
    },
    aiOptimizationApplied: { type: Boolean, default: false },
    aiSuggestions: [String],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  },
);

// Auto-calculate totals before save
payrollSchema.pre('save', function (next) {
  const e = this.earnings;
  this.grossEarnings =
    (e.basicSalary || 0) +
    (e.houseRentAllowance || 0) +
    (e.conveyanceAllowance || 0) +
    (e.medicalAllowance || 0) +
    (e.performanceBonus || 0) +
    (e.overtimePay || 0) +
    (e.specialAllowance || 0) +
    (e.otherEarnings || 0) +
    (e.releasedHoldAmount || 0);

  const d = this.deductions;
  this.totalDeductions =
    (d.providentFund || 0) +
    (d.employeeStateInsurance || 0) +
    (d.professionalTax || 0) +
    (d.incomeTax || 0) +
    (d.loanDeductions || 0) +
    (d.advanceDeductions || 0) +
    (d.salaryHoldDeduction || 0) +
    (d.absentDeductions || 0) +
    (d.otherDeductions || 0);

  this.netSalary = this.grossEarnings - this.totalDeductions;
  next();
});

payrollSchema.index(
  { employee: 1, 'payPeriod.month': 1, 'payPeriod.year': 1 },
  { unique: true },
);
payrollSchema.index({ status: 1 });

module.exports = mongoose.model('Payroll', payrollSchema);
