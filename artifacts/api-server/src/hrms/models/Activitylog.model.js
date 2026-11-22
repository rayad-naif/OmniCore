const mongoose = require('../core/mongoose');

/**
 * Raw activity log storage, now keyed by STATION + month, not employee.
 * The Cloudinary file for a record contains every timestamped line logger.py
 * sent from that physical PC that month, regardless of who was sitting there.
 * Attribution to a specific employee happens at READ time (see controller),
 * by cross-referencing Attendance — it is never baked into this record,
 * so correcting a late check-in/checkout retroactively fixes attribution too.
 */
const activityLogSchema = new mongoose.Schema(
  {
    station: {
      type: String, // matches Station.stationId
      required: true,
      index: true,
    },
    month: {
      type: String, // "YYYY-MM"
      required: true,
      index: true,
    },
    cloudinaryPublicId: String,
    cloudinaryUrl: String,
    lineCount: {
      type: Number,
      default: 0,
    },
    lastUpdated: Date,
    status: {
      type: String,
      enum: ['active', 'needs-backup', 'archived'],
      default: 'active',
    },
  },
  { timestamps: true },
);

activityLogSchema.index({ station: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
