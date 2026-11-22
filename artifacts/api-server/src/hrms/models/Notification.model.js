const mongoose = require('../core/mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ['leave', 'late', 'shift_swap', 'attendance', 'calendar_event', 'system'],
      default: 'system',
    },
    link: { type: String, default: '' },
    read: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Notification', notificationSchema);
