const mongoose = require('../core/mongoose');

// models/Shiftswaprequest.model.js
const shiftSwapRequestSchema = new mongoose.Schema(
  {
    // Employee who is initiating the swap request
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // The requester's own shift assignment they want to give away
    requesterAssignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ShiftAssignment',
      required: true,
    },

    // The actual target employee (from the same department dropdown selection)
    targetEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Kept for display convenience / backward compat; auto-populated from targetEmployee on save
    targetEmployeeName: { type: String, trim: true },

    // The specific date on which the one-time swap should occur (not every week)
    requestedDate: { type: Date, required: true },

    reason: { type: String, trim: true },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
    },

    // Admin who resolved (approved/rejected) the request
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: { type: Date, default: null },
    adminNotes: { type: String, trim: true },
  },
  {
    timestamps: true,
  },
);

shiftSwapRequestSchema.index({ requester: 1, status: 1 });
shiftSwapRequestSchema.index({ targetEmployee: 1, status: 1 });
shiftSwapRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ShiftSwapRequest', shiftSwapRequestSchema);
