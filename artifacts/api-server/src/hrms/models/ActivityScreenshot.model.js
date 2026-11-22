const mongoose = require('../core/mongoose');

const activityScreenshotSchema = new mongoose.Schema(
  {
    station: { type: String, required: true, index: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    attendance: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance', required: true, index: true },
    capturedAt: { type: Date, required: true, index: true },
    imagekitFileId: { type: String, required: true, unique: true },
    imagekitFilePath: { type: String, required: true },
    mimeType: { type: String, required: true },
    bytes: { type: Number, required: true },
  },
  { timestamps: true }
);

activityScreenshotSchema.index({ employee: 1, capturedAt: -1 });
activityScreenshotSchema.index({ station: 1, capturedAt: -1 });

module.exports = mongoose.model('ActivityScreenshot', activityScreenshotSchema);
