const mongoose = require('../core/mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true },
    checkIn: {
      time: Date,
      location: {
        lat: Number,
        lng: Number,
        address: String,
      },
      method: { type: String, enum: ['manual', 'biometric', 'qr', 'gps', 'face_id'], default: 'manual' },
    },
    checkOut: {
      time: Date,
      location: {
        lat: Number,
        lng: Number,
        address: String,
      },
      method: { type: String, enum: ['manual', 'biometric', 'qr', 'gps', 'face_id'], default: 'manual' },
    },
    totalHours: { type: Number, default: 0 },
    overtimeHours: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['present', 'absent', 'late', 'half_day', 'on_leave', 'holiday', 'weekend', 'work_from_home'],
      default: 'present',
    },
    breaks: [
      {
        start: Date,
        end: Date,
        duration: Number, // minutes
      },
    ],
    notes: { type: String, trim: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isRegularized: { type: Boolean, default: false },
    regularizationReason: String,
    regularizationApprovedAt: Date,
    workMode: { type: String, enum: ['office', 'remote', 'hybrid', 'off','manual'], default: 'office' },
    lateMinutes: { type: Number, default: 0 },
    earlyMinutes: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

// Compound index to prevent duplicate records
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1, status: 1 });

// Auto-calculate totalHours
attendanceSchema.pre('save', function (next) {
  if (this.checkIn?.time && this.checkOut?.time) {
    const diff = (this.checkOut.time - this.checkIn.time) / (1000 * 60 * 60);
    const breakMins = this.breaks?.reduce((sum, b) => sum + (b.duration || 0), 0) || 0;
    this.totalHours = Math.max(0, diff - breakMins / 60);
    const standardHours = 8;
    this.overtimeHours = Math.max(0, this.totalHours - standardHours);
  }
  next();
});

module.exports = mongoose.model('Attendance', attendanceSchema);
