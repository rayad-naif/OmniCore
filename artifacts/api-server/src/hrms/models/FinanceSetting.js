const mongoose = require('../core/mongoose');

/**
 * FinanceSetting — singleton document (one per app) that stores:
 *  - current USD ↔ PKR conversion rate
 *  - owner list (for profit-split calculation)
 *  - any other global finance config
 *
 * Use FinanceSetting.getSingleton() to always get/create the one document.
 */
const financeSettingSchema = new mongoose.Schema(
  {
    // ── Currency ──────────────────────────────────────────────────────────
    usdToPkrRate: { type: Number, default: 278, min: 1 },  // PKR per 1 USD
    rateUpdatedAt: { type: Date, default: Date.now },
    rateUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // ── Owners list ───────────────────────────────────────────────────────
    // Profit is split equally among all active owners (Total Profit / owners.length)
    owners: [
      {
        name:   { type: String, required: true, trim: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        isActive: { type: Boolean, default: true },
      },
    ],

    // ── Named persons who can be selected as paidBy / earner ─────────────
    // Keeps a global roster so dropdowns stay consistent
    persons: [
      {
        name:   { type: String, required: true, trim: true },
        role:   { type: String, default: '' },   // e.g. "Owner", "Manager"
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        isActive: { type: Boolean, default: true },
      },
    ],
  },
  { timestamps: true }
);

// Ensure only one document exists
financeSettingSchema.statics.getSingleton = async function () {
  let doc = await this.findOne();
  if (!doc) doc = await this.create({});
  return doc;
};

module.exports = mongoose.model('FinanceSetting', financeSettingSchema);