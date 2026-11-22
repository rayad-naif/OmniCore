const mongoose = require('../core/mongoose');

// ─── FixedExpense ──────────────────────────────────────────────────────────
// Recurring fixed-expense templates (rent, internet, subscriptions, etc).
// These are NOT the same as Expense records — they are reusable templates
// that the user toggles on/off and "posts" into a real Expense for a given
// month/year via POST /expenses with category=fixed_expense.
const fixedExpenseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    amountPKR: {
      type: Number,
      required: true,
      min: 0,
    },
    paidBy: {
      type: String,
      default: '',
      trim: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

fixedExpenseSchema.index({ isActive: 1 });

module.exports = mongoose.model('FixedExpense', fixedExpenseSchema);