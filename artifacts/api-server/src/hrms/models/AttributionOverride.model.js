const mongoose = require('../core/mongoose');

const attributionOverrideSchema = new mongoose.Schema(
  {
    station: { type: String, required: true, index: true },
    rangeStart: { type: Date, required: true },
    rangeEnd: { type: Date, required: true },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

attributionOverrideSchema.index({ station: 1, rangeStart: 1, rangeEnd: 1 });

module.exports = mongoose.model('AttributionOverride', attributionOverrideSchema);
