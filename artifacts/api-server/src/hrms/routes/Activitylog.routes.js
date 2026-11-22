const express = require('express');
const router  = express.Router();
const multer = require('multer');
const { protect, adminOnly } = require('../middleware/auth.middleware');

const {
  ingestLogs,
  getStationCurrentLog,
  getStationShiftLogs,
  getAllCurrentLogs,
  getAllLogs,
  getPendingBackup,
  archiveLog,
  getCurrentLog,
  getCurrentLogContent,
  getEmployeeLogHistory,
  getUnattributed,
  resolveAttribution,
} = require('../controllers/Activitylog.controller');
const {
  getScreenshotContext,
  getScreenshotUploadAuth,
  confirmScreenshot,
  uploadScreenshot,
  getScreenshots,
  getScreenshotStorageStats,
  deleteScreenshot,
  deleteEmployeeScreenshots,
} = require('../controllers/ActivityScreenshot.controller');

const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1.5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    callback(null, ['image/jpeg', 'image/png'].includes(file.mimetype));
  },
});

// ─── API-key guard for logger.py requests ────────────────────────────────────
// Each workspace has its own activity-agent key (HR settings in OmniCore); the
// HR router verified it and selected the workspace before this runs.
const apiKeyAuth = (req, res, next) => {
  if (req.hrmsAuthKind !== 'activity') {
    return res.status(401).json({ success: false, message: 'Unauthorised: invalid API key' });
  }
  next();
};

// ─── PC-side route (called from logger.py — no JWT, uses API key) ─────────────
// POST /api/v1/activity-logs/ingest   Body: { stationId, logs }
router.post('/ingest', apiKeyAuth, ingestLogs);

// PC-side screenshot routes. ImageKit credentials remain on the backend.
router.get('/screenshots/context', apiKeyAuth, getScreenshotContext);
router.post('/screenshots', apiKeyAuth, screenshotUpload.single('screenshot'), uploadScreenshot);

// ─── Admin-only: station-level raw views ──────────────────────────────────────
router.get('/all-current', protect, adminOnly, getAllCurrentLogs);
router.get('/all',         protect, adminOnly, getAllLogs);
router.get('/pending-backup', protect, adminOnly, getPendingBackup);
router.get('/screenshots', protect, adminOnly, getScreenshots);
router.get('/screenshots/storage-stats', protect, adminOnly, getScreenshotStorageStats);
router.delete('/screenshots', protect, adminOnly, deleteEmployeeScreenshots);
router.delete('/screenshots/:screenshotId', protect, adminOnly, deleteScreenshot);

router.get('/station/:stationId/current',       protect, adminOnly, getStationCurrentLog);
router.get('/station/:stationId/unattributed',  protect, adminOnly, getUnattributed);
router.get('/station/:stationId/by-shift',      protect, adminOnly, getStationShiftLogs);
router.post('/station/:stationId/resolve',      protect, adminOnly, resolveAttribution);
router.post('/station/:stationId/archive',      protect, adminOnly, archiveLog);

// ─── Admin-only: employee-level attributed views ──────────────────────────────
router.get('/:employeeId/current',         protect, adminOnly, getCurrentLog);
router.get('/:employeeId/current/content', protect, adminOnly, getCurrentLogContent);
router.get('/:employeeId/history',         protect, adminOnly, getEmployeeLogHistory);
router.get('/screenshots/upload-auth', apiKeyAuth, getScreenshotUploadAuth);
router.post('/screenshots/confirm', apiKeyAuth, confirmScreenshot);

module.exports = router;