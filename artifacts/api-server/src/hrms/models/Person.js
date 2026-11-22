const mongoose = require('../core/mongoose');

/**
 * Person – a named individual who can:
 *   • pay expenses  (shows up in "Paid By" dropdowns)
 *   • earn revenue  (shows up in "Earned By" dropdowns)
 *   • be an owner   (gets 50 % profit split on FinanceDashboard)
 */
const personSchema = new mongoose.Schema(
  {
    name:      { type: String, required: true, trim: true },
    type:      { type: String, enum: ['owner', 'employee', 'contractor', 'other'], default: 'other' },
    isOwner:   { type: Boolean, default: false },      // qualifies for profit split
    isPayer:   { type: Boolean, default: true  },      // can appear in "Paid By"
    isEarner:  { type: Boolean, default: true  },      // can appear in "Earned By"

    // optional: link to an existing HRMS employee record
    employeeRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },

    // default earning share % (can be overridden per earning record)
    defaultSharePct: { type: Number, min: 0, max: 100, default: 0 },

    active:    { type: Boolean, default: true },
    notes:     { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Person', personSchema);