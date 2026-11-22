const mongoose = require('../core/mongoose');

const advanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, 'Advance amount must be greater than 0'],
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'deducted', 'cancelled'],
      default: 'pending',
      index: true,
    },
    // Which payroll period this was deducted in
    deductedIn: {
      month: { type: Number },
      year:  { type: Number },
    },
    payrollId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payroll',
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: { type: Date, default: null },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    rejectedAt:  { type: Date, default: null },
    rejectionNote: { type: String, default: '' },
    requestedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

// Compound index — useful for "all pending advances for employee X"
advanceSchema.index({ employee: 1, status: 1 });
advanceSchema.index({ 'deductedIn.month': 1, 'deductedIn.year': 1 });

module.exports = mongoose.model('Advance', advanceSchema);