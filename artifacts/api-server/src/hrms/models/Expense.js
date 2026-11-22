const mongoose = require('../core/mongoose');

const expenseSchema = new mongoose.Schema(
  {
    // ── Month bucket ──────────────────────────────────────────────────────
    month: { type: Number, required: true, min: 1, max: 12 }, // 1-12
    year: { type: Number, required: true },

    // ── What it is ────────────────────────────────────────────────────────
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },

    category: {
      type: String,
      required: true,
      trim: true,
    },

    // ── Amount ────────────────────────────────────────────────────────────
    amountPKR: { type: Number, required: true, min: 0 },
    // Stored at time of entry so historical records stay accurate
    usdRateAtEntry: { type: Number, default: null }, // PKR per 1 USD
    amountUSD: { type: Number, default: null }, // amountPKR / rate

    // ── Who paid ──────────────────────────────────────────────────────────
    paidBy: {
      name: { type: String, required: true, trim: true },
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
    },

    // ── Optional linkage for employee_salary category ─────────────────────
    linkedEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    date: { type: Date, default: Date.now },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isActive: { type: Boolean, default: true },
    needsReturn: { type: Boolean, default: false },
    isReturned: { type: Boolean, default: false },
    returnedAt: { type: Date, default: null },
    returnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    returnMethod: { type: String, default: null }, // 'cash' | 'bank_transfer' | etc. (optional)
    returnNote: { type: String, default: null }, // optional note
  },
  { timestamps: true },
);

// Auto-compute amountUSD before save
expenseSchema.pre('save', function (next) {
  if (this.usdRateAtEntry && this.usdRateAtEntry > 0) {
    this.amountUSD = parseFloat(
      (this.amountPKR / this.usdRateAtEntry).toFixed(2),
    );
  }
  next();
});

// Indexes for fast monthly aggregations
expenseSchema.index({ year: 1, month: 1 });
expenseSchema.index({ year: 1, month: 1, category: 1 });
expenseSchema.index({ 'paidBy.name': 1, year: 1, month: 1 });

module.exports = mongoose.model('Expense', expenseSchema);
