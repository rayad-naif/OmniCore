const mongoose = require('../core/mongoose');

const loanSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    loanAmount: { type: Number, required: true },
    interestPercentage: { type: Number, default: 0 }, // Admin defined percentage
    totalRepaymentAmount: { type: Number, required: true }, // Principal + calculated interest
    tenureMonths: { type: Number, required: true }, // "In how many months the loan will deduct"
    monthlyEMI: { type: Number, required: true }, // Auto-calculated baseline (totalRepaymentAmount / tenureMonths)
    remainingBalance: { type: Number, required: true }, // Decrements each month
    status: {
      type: String,
      enum: ['pending', 'active', 'paused', 'fully_paid'],
      default: 'active',
    },
    termsAndConditions: { type: String, trim: true },
    deductionHistory: [
      {
        payrollId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payroll' },
        amountDeducted: Number,
        deductedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

// Compound index for performance
loanSchema.index({ employee: 1, status: 1 });

module.exports = mongoose.model('Loan', loanSchema);
