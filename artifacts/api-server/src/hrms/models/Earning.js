const mongoose = require('../core/mongoose');

/**
 * Earning — revenue/income recorded month-wise.
 *
 * Each document represents one earning entry for a specific person.
 * The optional `commissionPercent` field lets you declare what % of the
 * total monthly revenue this person is entitled to; the actual payout
 * can be auto-calculated on read (totalMonthRevenue * commissionPercent / 100).
 */
const earningSchema = new mongoose.Schema(
  {
    // ── Month bucket ──────────────────────────────────────────────────────
    month: { type: Number, required: true, min: 1, max: 12 },
    year:  { type: Number, required: true },

    // ── Source / description ──────────────────────────────────────────────
    title:       { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    notes:       { type: String, trim: true, default: '' },

    // ── Person who earned / brought in the revenue ────────────────────────
    person: {
      name:   { type: String, required: true, trim: true },
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },

    // ── Amount ────────────────────────────────────────────────────────────
    // The total amount entered before the earnings split. Kept for audit.
    grossAmountPKR: { type: Number, default: null, min: 0 },
    // Business earned amount (30% of gross); this is included in earnings totals.
    amountPKR:      { type: Number, required: true, min: 0 },
    // Person's 70% share. It is retained as a record but excluded from earnings totals.
    personAmountPKR: { type: Number, default: null, min: 0 },
    usdRateAtEntry: { type: Number, default: null },
    amountUSD:      { type: Number, default: null },

    /**
     * Optional: if this entry represents a commission/percentage-based earning,
     * store the percentage for reporting. The amountPKR is still the actual figure.
     * When set, the frontend can show "Auto-calculated from X%".
     */
    commissionPercent: { type: Number, default: null, min: 0, max: 100 },

    /**
     * If this is auto-calculated from a base amount (e.g. 10% of a project value),
     * store the base for audit trail.
     */
    baseAmountPKR: { type: Number, default: null },

    date:      { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isActive:  { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Auto-compute USD
earningSchema.pre('save', function (next) {
  if (this.usdRateAtEntry && this.usdRateAtEntry > 0) {
    this.amountUSD = parseFloat((this.amountPKR / this.usdRateAtEntry).toFixed(2));
  }
  next();
});

earningSchema.index({ year: 1, month: 1 });
earningSchema.index({ 'person.name': 1, year: 1, month: 1 });

module.exports = mongoose.model('Earning', earningSchema);
