const mongoose = require('../core/mongoose');

const workFromHomeRequestSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalDays: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    comments: { type: String, default: '' },
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  'WorkFromHomeRequest',
  workFromHomeRequestSchema,
);
