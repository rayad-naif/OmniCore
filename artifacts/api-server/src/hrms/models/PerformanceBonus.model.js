const mongoose = require('../core/mongoose');

const PerformanceBonusSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: { type: Number, required: true },
    month: { type: Number, required: true }, // 1-12
    year: { type: Number, required: true },
    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, trim: true, default: '' }, // Admin reason / note
    isProcessed: { type: Boolean, default: false },
    bonusType: {
      type: String,
      enum: ['performance', 'released_hold'],
      default: 'performance',
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('PerformanceBonus', PerformanceBonusSchema);
