const storage = require('../core/storage');
const { tzOffsetMinutes } = require('../core/time');
const Attendance = require('../models/Attendance.model');
const Employee = require('../models/Employee.model');
const Station = require('../models/Station.model');
const ActivityScreenshot = require('../models/ActivityScreenshot.model');
const ShiftAssignment = require('../models/ShiftAssignment.model');

const SHIFT_LENGTH_HOURS = Math.min(
  Math.max(Number(process.env.SCREENSHOT_SHIFT_LENGTH_HOURS) || 8, 1),
  16,
);
// Set only for a short controlled test, then remove it. A value of 60 spreads
// the ten captures across one minute instead of the normal shift duration.
const SCREENSHOT_TEST_WINDOW_SECONDS = Math.min(
  Math.max(Number(process.env.SCREENSHOT_TEST_WINDOW_SECONDS) || 0, 0),
  3600,
);

// Applies an "HH:mm" string onto the given date, in the server's local timezone.
const applyTimeToDate = (baseDate, timeStr) => {
  const [hours, minutes] = String(timeStr).split(':').map(Number);

  // Find baseDate's calendar date as seen in Karachi (matters near midnight
  // UTC, where the Karachi date can differ from the UTC date).
  // (Originally fixed to Karachi time; now the workspace's time zone.)
  const KARACHI_OFFSET_MINUTES = tzOffsetMinutes(baseDate);
  const karachiMs = baseDate.getTime() + KARACHI_OFFSET_MINUTES * 60000;
  const k = new Date(karachiMs);
  const year = k.getUTCFullYear();
  const month = k.getUTCMonth();
  const day = k.getUTCDate();

  // Build the intended Karachi wall-clock instant, then convert to the
  // correct UTC instant by subtracting the offset.
  const localAsUtcMs = Date.UTC(
    year,
    month,
    day,
    hours || 0,
    minutes || 0,
    0,
    0,
  );
  return new Date(localAsUtcMs - KARACHI_OFFSET_MINUTES * 60000);
};

// Finds the ShiftAssignment that applies to an employee on the given date and
// returns computed shiftStart/shiftEnd Date objects, or null if none is assigned.
// If a recurring (weekly) assignment and a non-recurring (date-range) assignment
// both match, the non-recurring one wins, since it represents a specific override.
const resolveShiftTiming = async (employeeId, referenceDate) => {
  const weekday = referenceDate.getDay();
  const assignment = await ShiftAssignment.findOne({
    employee: employeeId,
    status: 'active',
    $or: [
      {
        recurring: false,
        startDate: { $lte: referenceDate },
        endDate: { $gte: referenceDate },
      },
      { recurring: true, weekday },
    ],
  })
    .sort({ recurring: 1 }) // false (0) sorts before true (1) -> non-recurring preferred
    .lean();

  if (!assignment) return null;

  const shiftStart = applyTimeToDate(referenceDate, assignment.startTime);
  let shiftEnd = applyTimeToDate(referenceDate, assignment.endTime);
  if (assignment.crossDay || shiftEnd <= shiftStart) {
    shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60 * 1000);
  }
  return { shiftStart, shiftEnd, shiftAssignmentId: assignment._id };
};

const resolveActiveAttendance = async (stationId, at) => {
  const station = await Station.findOne({ stationId, isActive: true }).lean();
  if (!station)
    return {
      error: 'This workstation is not registered or is inactive.',
      status: 404,
    };

  const stationRefs = (station.assignedEmployees || []).map(String);
  if (!stationRefs.length)
    return {
      error: 'No employees are assigned to this workstation.',
      status: 409,
    };

  const employees = await Employee.find({ _id: { $in: stationRefs } })
    .select('user')
    .lean();
  const candidateUserIds = [
    ...new Set([
      ...stationRefs,
      ...employees.map((employee) => String(employee.user)).filter(Boolean),
    ]),
  ];

  const active = await Attendance.find({
    employee: { $in: candidateUserIds },
    'checkIn.time': { $lte: at },
    $or: [
      { 'checkOut.time': { $exists: false } },
      { 'checkOut.time': null },
      { 'checkOut.time': { $gte: at } },
    ],
  })
    .select('employee checkIn.time')
    .lean();

  if (active.length !== 1) {
    return {
      error: active.length
        ? 'More than one assigned employee is active at this workstation.'
        : 'No assigned employee has an active attendance record.',
      status: 409,
    };
  }

  return { attendance: active[0] };
};

const getScreenshotContext = async (req, res) => {
  const stationId = String(req.query.stationId || '').trim();
  if (!stationId)
    return res
      .status(400)
      .json({ success: false, message: 'stationId is required' });

  const result = await resolveActiveAttendance(stationId, new Date());
  if (!result.attendance)
    return res.json({ success: true, active: false, reason: result.error });

  let shiftStart;
  let shiftEnd;

  if (SCREENSHOT_TEST_WINDOW_SECONDS) {
    // A test window starts when the tracker requests its context, so testing
    // works even if the employee checked in earlier in the day.
    shiftStart = new Date();
    shiftEnd = new Date(
      shiftStart.getTime() + SCREENSHOT_TEST_WINDOW_SECONDS * 1000,
    );
  } else {
    const checkInDate = new Date(result.attendance.checkIn.time);
    const assignedShift = await resolveShiftTiming(
      result.attendance.employee,
      checkInDate,
    );
    if (assignedShift) {
      ({ shiftStart, shiftEnd } = assignedShift);
    } else {
      // No ShiftAssignment found for this employee/day; fall back to the
      // legacy fixed-length window anchored on their actual check-in time.
      shiftStart = checkInDate;
      shiftEnd = new Date(
        shiftStart.getTime() + SHIFT_LENGTH_HOURS * 60 * 60 * 1000,
      );
    }
  }

  return res.json({
    success: true,
    active: true,
    data: {
      attendanceId: result.attendance._id,
      employeeId: result.attendance.employee,
      shiftStart: shiftStart.toISOString(),
      shiftEnd: shiftEnd.toISOString(),
    },
  });
};

// Screenshots are stored in OmniCore's file storage (R2 or local disk) instead
// of ImageKit. The imagekitFileId / imagekitFilePath fields hold the storage key.
const uploadToImageKit = async (
  file,
  { stationId, employeeId, capturedAt },
) => {
  const safeStation = stationId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const ext = file.mimetype === 'image/png' ? 'png' : 'jpg';
  const filename = `capture-${capturedAt.toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const key = storage.keyFor(
    `activity-screenshots/${employeeId}/${safeStation}`,
    filename,
  );
  await storage.put(key, file.buffer, file.mimetype);
  return { fileId: key, filePath: key };
};

const uploadScreenshot = async (req, res) => {
  try {
    const stationId = String(req.body.stationId || '').trim();
    const capturedAt = new Date(req.body.capturedAt || Date.now());
    if (!stationId || Number.isNaN(capturedAt.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'stationId and a valid capturedAt are required',
      });
    }
    if (!req.file)
      return res.status(400).json({
        success: false,
        message: 'A JPEG or PNG screenshot file is required',
      });

    const resolved = await resolveActiveAttendance(stationId, capturedAt);
    if (!resolved.attendance)
      return res
        .status(resolved.status)
        .json({ success: false, message: resolved.error });

    const uploaded = await uploadToImageKit(req.file, {
      stationId,
      employeeId: String(resolved.attendance.employee),
      capturedAt,
    });
    const screenshot = await ActivityScreenshot.create({
      station: stationId,
      employee: resolved.attendance.employee,
      attendance: resolved.attendance._id,
      capturedAt,
      imagekitFileId: uploaded.fileId,
      imagekitFilePath: uploaded.filePath,
      mimeType: req.file.mimetype,
      bytes: req.file.size,
    });
    return res.status(201).json({
      success: true,
      data: { id: screenshot._id, capturedAt: screenshot.capturedAt },
    });
  } catch (error) {
    console.error(
      '[ActivityScreenshot] upload failed:',
      error.response?.data || error.message,
    );
    return res
      .status(500)
      .json({ success: false, message: 'Unable to store screenshot' });
  }
};

const getScreenshots = async (req, res) => {
  const query = {};
  if (req.query.employeeId) {
    // Activity Logs selects an Employee document, while Attendance (and thus
    // screenshots) is normally linked to the Employee's User document. Query
    // both IDs so the admin view also supports legacy attendance records that
    // stored the Employee ID directly.
    const requestedEmployeeId = String(req.query.employeeId);
    const employee = await Employee.findOne({
      $or: [{ _id: requestedEmployeeId }, { user: requestedEmployeeId }],
    })
      .select('user')
      .lean();
    const employeeIds = [requestedEmployeeId];
    if (employee?.user) employeeIds.push(String(employee.user));
    query.employee = { $in: [...new Set(employeeIds)] };
  }
  if (req.query.stationId) query.station = req.query.stationId;
  const screenshots = await ActivityScreenshot.find(query)
    .populate('employee', 'firstName lastName employeeId')
    .sort({ capturedAt: -1 })
    .limit(Math.min(Math.max(Number(req.query.limit) || 50, 1), 100))
    .lean();

  const data = screenshots.map((screenshot) => {
    const key = screenshot.imagekitFilePath || screenshot.imagekitFileId;
    const imageUrl =
      key && String(key).startsWith('hrms/')
        ? storage.urlFor(key, { expiresInSeconds: 10 * 60 })
        : null;
    return { ...screenshot, imageUrl };
  });

  return res.json({ success: true, data });
};

// System-wide storage totals across ALL employees' screenshots. `getScreenshots`
// above caps at 100 rows per request, so it can't be used to sum the full
// collection — this runs a DB-side aggregation instead, which stays cheap
// even as the collection grows since Mongo does the summing, not Node.
// Days-remaining estimate is based on bytes captured in this trailing window,
// not the lifetime average — a fresh rollout with months of light usage
// followed by a recent surge (e.g. more stations/employees added) should
// reflect the current pace, not get diluted by old history.
const STORAGE_RATE_WINDOW_DAYS = 7;

const getScreenshotStorageStats = async (req, res) => {
  const windowStart = new Date(
    Date.now() - STORAGE_RATE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const [stats] = await ActivityScreenshot.aggregate([
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalBytes: { $sum: { $ifNull: ['$bytes', 0] } },
      },
    },
  ]);

  const [recent] = await ActivityScreenshot.aggregate([
    { $match: { capturedAt: { $gte: windowStart } } },
    {
      $group: { _id: null, recentBytes: { $sum: { $ifNull: ['$bytes', 0] } } },
    },
  ]);

  const recentBytes = recent?.recentBytes || 0;
  const dailyRateBytes = recentBytes / STORAGE_RATE_WINDOW_DAYS;

  return res.json({
    success: true,
    data: {
      count: stats?.count || 0,
      totalBytes: stats?.totalBytes || 0,
      dailyRateBytes,
      windowDays: STORAGE_RATE_WINDOW_DAYS,
    },
  });
};

const deleteFromImageKit = async (fileId) => {
  await storage.remove(fileId);
};

const deleteScreenshot = async (req, res) => {
  try {
    const screenshot = await ActivityScreenshot.findById(
      req.params.screenshotId,
    );
    if (!screenshot)
      return res
        .status(404)
        .json({ success: false, message: 'Screenshot not found.' });

    await deleteFromImageKit(screenshot.imagekitFileId);
    await screenshot.deleteOne();
    return res.json({
      success: true,
      message: 'Screenshot permanently deleted.',
    });
  } catch (error) {
    console.error(
      '[ActivityScreenshot] delete failed:',
      error.response?.data || error.message,
    );
    return res
      .status(500)
      .json({ success: false, message: 'Unable to delete the screenshot.' });
  }
};

const deleteEmployeeScreenshots = async (req, res) => {
  try {
    const requestedEmployeeId = String(req.query.employeeId || '').trim();
    if (!requestedEmployeeId)
      return res
        .status(400)
        .json({ success: false, message: 'employeeId is required.' });

    const employee = await Employee.findOne({
      $or: [{ _id: requestedEmployeeId }, { user: requestedEmployeeId }],
    })
      .select('user')
      .lean();
    const employeeIds = [requestedEmployeeId];
    if (employee?.user) employeeIds.push(String(employee.user));
    const screenshots = await ActivityScreenshot.find({
      employee: { $in: [...new Set(employeeIds)] },
    });

    for (const screenshot of screenshots) {
      await deleteFromImageKit(screenshot.imagekitFileId);
    }
    await ActivityScreenshot.deleteMany({
      _id: { $in: screenshots.map((screenshot) => screenshot._id) },
    });
    return res.json({
      success: true,
      deletedCount: screenshots.length,
      message: 'All screenshots permanently deleted.',
    });
  } catch (error) {
    console.error(
      '[ActivityScreenshot] bulk delete failed:',
      error.response?.data || error.message,
    );
    return res
      .status(500)
      .json({ success: false, message: 'Unable to delete all screenshots.' });
  }
};
// Direct-to-ImageKit uploads are not used with OmniCore storage: the desktop
// agent uploads through POST /activity-logs/screenshots instead.
const getScreenshotUploadAuth = async (_req, res) =>
  res.status(410).json({
    success: false,
    message:
      'Direct uploads are not available. Upload with POST /api/hrms/v1/activity-logs/screenshots.',
  });

const confirmScreenshot = async (_req, res) =>
  res.status(410).json({
    success: false,
    message:
      'Direct uploads are not available. Upload with POST /api/hrms/v1/activity-logs/screenshots.',
  });

module.exports = {
  getScreenshotContext,
  getScreenshotUploadAuth,
  confirmScreenshot,
  uploadScreenshot,
  getScreenshots,
  getScreenshotStorageStats,
  deleteScreenshot,
  deleteEmployeeScreenshots,
};
