const mongoose = require('../core/mongoose');

// ─── ExpenseCategory ───────────────────────────────────────────────────────
// Stores ONLY custom (user-created) categories. The three built-in
// categories (variable_expense, fixed_expense, employee_salary) remain
// hard-coded on the frontend and are never written here.
const expenseCategorySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    color: {
      type: String,
      default: '#ec4899',
    },
    icon: {
      type: String,
      default: 'Tag',
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

expenseCategorySchema.index({ isActive: 1 });

module.exports = mongoose.model('ExpenseCategory', expenseCategorySchema);