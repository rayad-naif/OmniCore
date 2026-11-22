const mongoose = require('../core/mongoose');

const salaryHoldSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // The total amount being held back from this employee's salary
    amount: { type: Number, required: true, min: 0 },

    // Date (and time) the admin placed the hold — deductions only start from
    // the payroll period that contains/ follows this date
    holdDate: { type: Date, required: true, default: Date.now },

    // Over how many months the held amount should be deducted
    durationMonths: { type: Number, required: true, min: 1 },

    // amount / durationMonths, rounded — computed once at creation so it never drifts
    monthlyDeduction: { type: Number, required: true, min: 0 },

    // Decremented every payroll run; hold auto-completes at 0
    remainingBalance: { type: Number, required: true, min: 0 },

    reason: { type: String, default: '', trim: true },

    status: {
      type: String,
      enum: ['active', 'completed', 'cancelled'],
      default: 'active',
      index: true,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: { type: Date },

    // Every time payroll/run actually deducts something against this hold
    deductionHistory: [
      {
        payrollId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payroll' },
        amountDeducted: { type: Number, required: true },
        month: { type: Number, required: true },
        year: { type: Number, required: true },
        deductedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

// Quick lookup: "does this employee have an active hold right now"
salaryHoldSchema.index({ employee: 1, status: 1 });

module.exports = mongoose.model('SalaryHold', salaryHoldSchema);
