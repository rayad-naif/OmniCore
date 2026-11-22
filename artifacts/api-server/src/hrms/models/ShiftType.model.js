const mongoose = require('../core/mongoose');

// Inside models/ShiftType.model.js
const shiftTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, trim: true },
    startTime: { type: String, required: true, default: '09:00' },
    endTime: { type: String, required: true, default: '18:00' },
    crossDay: { type: Boolean, default: false }, // ◄◄ ADD THIS FIELD
    workMode: { type: String, enum: ['office', 'remote', 'hybrid'], default: 'office' },
    breakEnabled: { type: Boolean, default: true },
    breakDurationMinutes: { type: Number, default: 60 },
    isActive: { type: Boolean, default: true },
    iconKey: {
        type: String,
        enum: ['morning', 'day', 'evening', 'night', 'cross_day'],
        default: 'day'
      },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ShiftType', shiftTypeSchema);
