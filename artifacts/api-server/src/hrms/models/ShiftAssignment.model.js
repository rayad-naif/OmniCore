const mongoose = require('../core/mongoose');

const shiftAssignmentSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    shiftType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ShiftType',
      required: true,
    },
    recurring: { type: Boolean, default: false },
    // weekday follows JS getDay() (0 = Sunday, 6 = Saturday). Used when `recurring` is true.
    weekday: { type: Number, min: 0, max: 6 },
    startDate: {
      type: Date,
      required: function () {
        return !this.recurring;
      },
    },
    endDate: {
      type: Date,
      required: function () {
        return !this.recurring;
      },
    },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    crossDay: { type: Boolean, default: false },
    workMode: {
      type: String,
      enum: ['office', 'remote', 'hybrid'],
      default: 'office',
    },
    breakEnabled: { type: Boolean, default: true },
    breakDurationMinutes: { type: Number, default: 60 },
    notes: { type: String, trim: true },
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
  },
  {
    timestamps: true,
  },
);

shiftAssignmentSchema.index({ employee: 1, startDate: 1, endDate: 1 });
shiftAssignmentSchema.index({ employee: 1, recurring: 1, weekday: 1 });

module.exports = mongoose.model('ShiftAssignment', shiftAssignmentSchema);
