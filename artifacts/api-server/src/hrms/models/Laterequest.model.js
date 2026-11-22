const mongoose = require('../core/mongoose');

// ─── LateRequest ────────────────────────────────────────────────────────────
// An employee's advance request to be marked late for a specific day, with
// the expected arrival window and a reason. Admin/HR reviews it separately
// from the attendance record itself — the attendance route layer reads the
// approved/pending/rejected status of the request that matches an
// employee+date to decide whether a 'late' day should render as
// "Approved" or "Unapproved".

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/; // "HH:MM", 24h, local (PKT) wall time

const lateRequestSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Business date this request applies to — stored as a UTC midnight
    // bucket, same convention as Attendance.date so the two can be joined
    // directly on `date`.
    date: {
      type: Date,
      required: true,
      index: true,
    },

    // Expected window of lateness on that date, e.g. "09:00" → "09:45".
    // Kept as plain "HH:MM" strings (same convention as
    // ShiftAssignment.startTime) rather than Date objects, so there's no
    // ambiguity about timezone offsets — they're always read as local time.
    lateFrom: {
      type: String,
      required: true,
      match: timeRegex,
    },
    lateTo: {
      type: String,
      required: true,
      match: timeRegex,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    // Optional note from the reviewer — most useful on rejection.
    reviewNote: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true }
);

// One late request per employee per day. The route layer upserts into this
// (overwriting a pending/rejected doc rather than erroring) so an employee
// can revise their request before it's reviewed, or resubmit after a
// rejection, without piling up duplicate rows for the same day.
lateRequestSchema.index({ employee: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('LateRequest', lateRequestSchema);