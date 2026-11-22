const mongoose = require('../core/mongoose');

const calendarEventSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  date: { type: Date, required: true },
  endDate: { type: Date, required: true },
  type: { type: String, enum: ['public_holiday', 'company_lunch', 'announcement', 'other'], default: 'other' },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

calendarEventSchema.index({ date: 1 });
module.exports = mongoose.model('CalendarEvent', calendarEventSchema);
