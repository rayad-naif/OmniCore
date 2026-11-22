const mongoose = require('../core/mongoose');

/**
 * UsdRate – stores the USD→PKR rate for a given month/year.
 * Used as a default when adding expenses/earnings for that month.
 * Users can always override per record.
 */
const usdRateSchema = new mongoose.Schema(
  {
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    rate: { type: Number, required: true, min: 0 }, // 1 USD = rate PKR
    notes: { type: String, default: '' },
    setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

usdRateSchema.index({ year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('UsdRate', usdRateSchema);
