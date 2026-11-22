const mongoose = require('../core/mongoose');

/**
 * A physical PC/workstation that one or more employees share across shifts.
 * `assignedEmployees` is a small allow-list — used to disambiguate attribution
 * when two employees happen to be checked in at the same moment company-wide
 * but only one of them ever actually sits at this particular machine.
 *
 * Example: stationId "PC-CS-04" → assignedEmployees: [Rayadh, Awais]
 * (Awais mornings, Rayadh evenings — the actual split is inferred at read
 * time from Attendance, not stored here.)
 */
const stationSchema = new mongoose.Schema(
  {
    stationId: {
      // Must exactly match RESOLVED_STATION_ID sent by logger.py
      // (hostname by default, or whatever STATION_ID is hardcoded to).
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    label: {
      // Human-friendly name for the admin dashboard, e.g. "Front Desk PC".
      type: String,
      trim: true,
    },
    assignedEmployees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Station', stationSchema);
