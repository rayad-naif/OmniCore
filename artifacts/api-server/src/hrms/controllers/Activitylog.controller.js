const cloudinary = require('../core/cloudinaryShim').v2;
const ActivityLog = require('../models/Activitylog.model');
const Station = require('../models/Station.model');
const Employee = require('../models/Employee.model');
const AttributionOverride = require('../models/AttributionOverride.model');
const { attributeStationMonth } = require('../services/Attribution.service');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const storage = require('../core/storage');

const fetchCloudinaryText = async (url) => {
  try {
    // Files stored by OmniCore (R2 / local disk) are read directly.
    const key = storage.keyFromUrl(url);
    if (key) {
      const buf = await storage.read(key);
      return buf ? buf.toString('utf8') : '';
    }
    // Older records may still point at Cloudinary.
    if (!/^https:\/\//.test(String(url))) return '';
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
};

const _employeeUserPopulate = {
  path: 'employee',
  select: 'user',
  populate: {
    path: 'user',
    select: 'firstName lastName avatar employeeId department',
    populate: { path: 'department', select: 'name' },
  },
};

const uploadTextToCloudinary = (content, publicId) =>
  new Promise((resolve, reject) => {
    const buffer = Buffer.from(content, 'utf-8');
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: 'raw', content_type: 'text/plain; charset=utf-8', overwrite: true, invalidate: true },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });

const findStationsForEmployeeReference = async (employeeId) => {
  const refsToTry = [employeeId];

  const employee = await Employee.findById(employeeId).lean();
  if (employee?.user) {
    refsToTry.push(employee.user.toString());
  }

  const userEmployee = await Employee.findOne({ user: employeeId }).lean();
  if (userEmployee) {
    refsToTry.push(userEmployee._id.toString());
  }

  const uniqueRefs = [...new Set(refsToTry.filter(Boolean))];
  return await Station.find({ assignedEmployees: { $in: uniqueRefs } });
};

// ─── Shift-based log filtering (mirrors front-end logic) ─────────────────────
//
// When multiple employees share one PC (station), logs must be filtered to
// only include lines that fall within each employee's assigned shift window.
// This runs on the server so both ActivityLogs and ActivityDashboard get
// correctly partitioned data without any client-side per-employee fetching.

// Matches Format A: [2026-07-21 04:56:28] | Process: ...
// and   Format B: [2026-07-21 01:41:01] | Window: ...
const RE_TIMESTAMPED_LINE = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]/;

// Format C: time on its own line, e.g. "01:41:01" or "1:41:31"
const RE_TIME_ONLY_LINE = /^(\d{1,2}:\d{2}:\d{2})$/;

// Standalone date header, e.g. "2026-07-21"
const RE_DATE_ONLY_LINE = /^(\d{4}-\d{2}-\d{2})$/;

// Gap / idle tokens — "0s", "30s", "14%" — skip them
const RE_SKIP_LINE = /^(\d+[smh](\s+\d+[smh])*|\d+(\.\d+)?%)$/;

/** Pad single-digit hour so "1:41:31" → "01:41:31" */
function normalizeTime(t) {
  return t.split(':').map((p) => p.padStart(2, '0')).join(':');
}

/** Convert "HH:MM" or "HH:MM:SS" to total minutes */
function timeStrToMinutes(t) {
  const parts = t.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

/**
 * Check whether a log entry at `timeStr` (HH:MM:SS) falls inside the shift.
 * `crossDay` is true when the shift spans midnight (e.g. 18:00 → 02:00).
 */
function isTimeInShift(timeStr, startTime, endTime, crossDay) {
  if (!startTime || !endTime) return true; // no shift constraint → include all
  const entryMin = timeStrToMinutes(timeStr);
  const startMin = timeStrToMinutes(startTime);
  const endMin   = timeStrToMinutes(endTime);
  if (!crossDay) {
    return entryMin >= startMin && entryMin <= endMin;
  }
  // Cross-midnight: e.g. 18:00 → 02:00
  // A line at 20:00 (≥18:00) OR at 01:30 (≤02:00) both belong to this shift.
  return entryMin >= startMin || entryMin <= endMin;
}

/**
 * Find the shift assignment that applies to a given calendar date.
 * Recurring assignments match by weekday; date-range assignments check the interval.
 * Returns null when no assignment covers this date.
 */
function getShiftForDate(dateStr, assignments) {
  const d = new Date(`${dateStr}T00:00:00`);
  const weekday = d.getDay();
  for (const asgn of assignments) {
    if (asgn.status && asgn.status !== 'active') continue;
    if (asgn.recurring) {
      if (asgn.weekday === weekday) return asgn;
    } else {
      const start = new Date(asgn.startDate);
      const end   = new Date(asgn.endDate);
      const check = new Date(`${dateStr}T00:00:00`);
      if (check >= start && check <= end) return asgn;
    }
  }

  // Cross-day carry: if no shift matches this date, check whether yesterday's
  // shift is a cross-day shift that extends into today's early hours.
  const prevDate = new Date(d);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = prevDate.toISOString().slice(0, 10);
  const prevWeekday = prevDate.getDay();
  for (const asgn of assignments) {
    if (asgn.status && asgn.status !== 'active') continue;
    if (!asgn.crossDay) continue; // only cross-day assignments carry over
    if (asgn.recurring) {
      if (asgn.weekday === prevWeekday) return { ...asgn, _carriedFromPrev: true };
    } else {
      const start = new Date(asgn.startDate);
      const end   = new Date(asgn.endDate);
      const check = new Date(`${prevDateStr}T00:00:00`);
      if (check >= start && check <= end) return { ...asgn, _carriedFromPrev: true };
    }
  }

  return null;
}

/**
 * Filter a raw multi-format log text string so that only lines whose timestamp
 * falls within the employee's assigned shift window are kept.
 *
 * Handles all three log formats:
 *   Format A  [2026-07-21 04:56:28] | Process: chrome.exe | Window: ...
 *   Format B  [2026-07-21 01:41:01] | Window: ... | Duration: ...
 *   Format C  01:41:01              (time-only line)
 *             Modern - Google Chrome | Duration: 30s | ...  (content line)
 *
 * Returns the filtered text with the same newline structure (non-matching
 * entries are simply omitted rather than replaced with blanks).
 *
 * @param {string}   rawText     - Full raw log text from Cloudinary
 * @param {object[]} assignments - Active ShiftAssignment documents for this employee
 * @returns {string}
 */
function filterLogTextByShift(rawText, assignments) {
  if (!rawText || !assignments || assignments.length === 0) return rawText;

  const lines   = rawText.split('\n');
  const output  = [];

  let ctxDate         = null; // last-seen date (for Format C multi-line)
  let ctxTime         = null; // last-seen time (for Format C multi-line)
  let pendingTimeLine = null; // hold Format-C time-only line until we see its content

  for (const line of lines) {
    const trimmed = line.trim();

    // Preserve blank lines as structural separators
    if (!trimmed) {
      // If we had a pending Format-C time line and hit a blank, discard it
      pendingTimeLine = null;
      ctxTime         = null;
      output.push(line);
      continue;
    }

    // Skip gap/idle tokens — keep them so the downstream parser stays in sync
    if (RE_SKIP_LINE.test(trimmed)) {
      output.push(line);
      continue;
    }

    // ── Standalone date header (always keep — it anchors subsequent lines) ──
    const dateMatch = trimmed.match(RE_DATE_ONLY_LINE);
    if (dateMatch) {
      ctxDate         = dateMatch[1];
      pendingTimeLine = null;
      ctxTime         = null;
      output.push(line);
      continue;
    }

    // ── Format A / B — self-contained timestamped lines ──────────────────────
    const tsMatch = trimmed.match(RE_TIMESTAMPED_LINE);
    if (tsMatch) {
      const [, date, time] = tsMatch;
      ctxDate         = date;
      ctxTime         = normalizeTime(time);
      pendingTimeLine = null;

      const shift = getShiftForDate(date, assignments);
      // When a cross-day shift carries from the previous day, the "end" side
      // applies to the current date's early-morning lines (entryMin <= endMin).
      if (!shift || isTimeInShift(ctxTime, shift.startTime, shift.endTime, shift.crossDay)) {
        output.push(line);
      }
      continue;
    }

    // ── Format C — standalone time line ──────────────────────────────────────
    const timeMatch = trimmed.match(RE_TIME_ONLY_LINE);
    if (timeMatch) {
      // Flush any unmatched pending time line first (no content followed it)
      pendingTimeLine = null;
      ctxTime         = normalizeTime(timeMatch[1]);
      pendingTimeLine = line; // hold until we see the content line
      continue;
    }

    // ── Format C content line ─────────────────────────────────────────────────
    // Reached when the previous line was a standalone time
    if (pendingTimeLine !== null && ctxTime) {
      const date  = ctxDate || new Date().toISOString().slice(0, 10);
      const shift = getShiftForDate(date, assignments);
      if (!shift || isTimeInShift(ctxTime, shift.startTime, shift.endTime, shift.crossDay)) {
        output.push(pendingTimeLine); // emit the held time line
        output.push(line);            // emit the content line
      }
      pendingTimeLine = null;
      ctxTime         = null;
      continue;
    }

    // ── Anything else (unrecognised / header text) — pass through ────────────
    output.push(line);
  }

  return output.join('\n');
}

// ─── Ingestion (called by logger.py — station-tagged, no employee) ───────────

/**
 * POST /activity-logs/ingest
 * Body: { stationId: "PC-CS-04", logs: ["line1", "line2", ...] }
 * Auth: x-api-key header (see route middleware)
 */
const ingestLogs = async (req, res) => {
  try {
    const { stationId, logs } = req.body;

    if (!stationId || !Array.isArray(logs) || logs.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'stationId (string) and logs (non-empty array) are required',
      });
    }

    // Runtime logs identify a tracker that is still using an old upload
    // interval. Do not log activity contents or credentials.
    console.log(`[ActivityLog] ingest station=${stationId} entries=${logs.length}`);
   
    await Station.findOneAndUpdate(
      { stationId },
      { $setOnInsert: { stationId, label: stationId } },
      { upsert: true }
    );

    const currentMonth = getCurrentMonth();
    const publicId      = `activity-logs/station/${stationId}/${currentMonth}`;

    await ActivityLog.updateMany(
      { station: stationId, status: 'active', month: { $ne: currentMonth } }, 
      { $set: { status: 'needs-backup' } }
    );

    let logRecord = await ActivityLog.findOne({ station: stationId, month: currentMonth });

    let existingContent = '';
    if (logRecord?.cloudinaryUrl) {
      existingContent = await fetchCloudinaryText(logRecord.cloudinaryUrl);
    }

    const newBlock      = logs.join('\n');
    const mergedContent = existingContent
      ? `${existingContent.trimEnd()}\n${newBlock}`
      : newBlock;
    const uploadResult = await uploadTextToCloudinary(mergedContent, publicId);
    const lineCount     = mergedContent.split('\n').filter(Boolean).length;

    logRecord = await ActivityLog.findOneAndUpdate(
      { station: stationId, month: currentMonth },
      {
        $set: {
          cloudinaryPublicId: uploadResult.public_id,
          cloudinaryUrl:      uploadResult.secure_url,
          lineCount,
          lastUpdated:        new Date(),
          status:             'active',
        },
      },
      { upsert: true, new: true }
    );
    return res.status(200).json({
      success: true,
      message: `Log entries saved In File`,
      station: stationId,
      month: currentMonth,
      lineCount,
    });
  } catch (err) {
    console.error('[ActivityLog] ingestLogs error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save activity log' });
  }
};

// ─── Station-level raw views (admin) ──────────────────────────────────────────

const getStationCurrentLog = async (req, res) => {
  try {
    const { stationId } = req.params;
    const currentMonth  = getCurrentMonth();

    const record = await ActivityLog.findOne({ station: stationId, month: currentMonth });
    if (!record) {
      return res.status(404).json({ success: false, message: 'No log found for this station this month' });
    }
    return res.status(200).json({ success: true, data: record });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

  /**
   * GET /activity-logs/station/:stationId/by-shift?month=YYYY-MM
   * Returns attributed lines grouped by assigned employee (includes confirmed
   * and scheduleInferred lines) for the given station/month. Useful for
   * showing logs split by shifts when a PC is shared.
   */
  const getStationShiftLogs = async (req, res) => {
    try {
      const { stationId } = req.params;
      const month = req.query.month || getCurrentMonth();

      const record = await ActivityLog.findOne({ station: stationId, month });
      if (!record?.cloudinaryUrl) {
        return res.status(200).json({ success: true, data: { byEmployee: {}, unattributed: [] } });
      }

      const rawText = await fetchCloudinaryText(record.cloudinaryUrl);
      const result = await attributeStationMonth(stationId, month, rawText);

      return res.status(200).json({ success: true, month, data: result });
    } catch (err) {
      console.error('[ActivityLog] getStationShiftLogs error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  };

const getAllCurrentLogs = async (req, res) => {
  try {
    const currentMonth = getCurrentMonth();
    const records = await ActivityLog.find({ month: currentMonth }).sort({ lastUpdated: -1 });
    return res.status(200).json({ success: true, count: records.length, data: records });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getAllLogs = async (req, res) => {
  try {
    const logs = await ActivityLog.find({ cloudinaryUrl: { $exists: true, $ne: '' } });
    const stationIds = [...new Set(logs.map((record) => record.station))];

    const stations = await Station.find({ stationId: { $in: stationIds } });
    const assignedIds = [...new Set(stations.flatMap((station) => (station.assignedEmployees || []).map((id) => id.toString())))];

    const employees = await Employee.find({
      $or: [
        { _id: { $in: assignedIds } },
        { user: { $in: assignedIds } },
      ],
    }).populate({
      path: 'user',
      select: 'firstName lastName avatar employeeId department',
    });

    const employeeById = new Map(employees.map((employee) => [employee._id.toString(), employee]));
    const employeeByUserId = new Map(
      employees
        .filter((employee) => employee.user)
        .map((employee) => [employee.user.toString(), employee])
    );

    const stationLogMap = new Map(logs.map((record) => [record.station, record]));
    const employeeMap = new Map();

    stations.forEach((station) => {
      const logRecord = stationLogMap.get(station.stationId);
      if (!logRecord) return;

      const lineCount = logRecord.lineCount || 0;
      const lastUpdated = logRecord.lastUpdated || logRecord.updatedAt || logRecord.createdAt;

      (station.assignedEmployees || []).forEach((employeeRef) => {
        const employeeId = employeeRef.toString();
        const employee = employeeById.get(employeeId) || employeeByUserId.get(employeeId);
        if (!employee) return;

        const existing = employeeMap.get(employeeId);
        const stationLabel = station.label || station.stationId;
        if (!existing) {
          employeeMap.set(employeeId, {
            employee,
            lastUpdated,
            lineCount,
            stationIds: [station.stationId],
            stationLabels: [stationLabel],
          });
          return;
        }

        existing.lineCount += lineCount;
        if (lastUpdated && new Date(lastUpdated) > new Date(existing.lastUpdated)) {
          existing.lastUpdated = lastUpdated;
        }
        if (!existing.stationIds.includes(station.stationId)) {
          existing.stationIds.push(station.stationId);
        }
        if (!existing.stationLabels.includes(stationLabel)) {
          existing.stationLabels.push(stationLabel);
        }
      });
    });

    const records = Array.from(employeeMap.values())
      .map((record) => ({
        ...record,
        stationId: record.stationIds?.[0] || null,
        stationLabel: record.stationLabels?.[0] || record.stationIds?.[0] || null,
      }))
      .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

    return res.status(200).json({ success: true, count: records.length, data: records });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getPendingBackup = async (req, res) => {
  try {
    const records = await ActivityLog.find({ status: 'needs-backup' }).sort({ month: -1 });
    return res.status(200).json({ success: true, count: records.length, data: records });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const archiveLog = async (req, res) => {
  try {
    const { stationId } = req.params;
    const { month } = req.body;

    if (!month) {
      return res.status(400).json({ success: false, message: 'month (YYYY-MM) is required in body' });
    }

    const record = await ActivityLog.findOne({ station: stationId, month });
    if (!record) {
      return res.status(404).json({ success: false, message: 'Log record not found' });
    }

    if (record.cloudinaryPublicId) {
      await cloudinary.uploader.destroy(record.cloudinaryPublicId, { resource_type: 'raw' });
    }

    record.status = 'archived';
    record.cloudinaryUrl = '';
    record.cloudinaryPublicId = '';
    await record.save();

    return res.status(200).json({
      success: true,
      message: `Log for station ${stationId}, ${month} archived and removed from Cloudinary`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Employee-level views (computed on read via attribution) ─────────────────

/**
 * GET /activity-logs/:employeeId/current
 * Finds every station this employee is assigned to, pulls that station's raw
 * log for the current month, attributes each line via Attendance overlap,
 * and returns only the lines that belong to this employee.
 */
const getCurrentLogContent = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const currentMonth = getCurrentMonth();

    const stations = await findStationsForEmployeeReference(employeeId);
    if (stations.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'This employee is not assigned to any station. Assign them in the Station admin screen.',
      });
    }

    let confirmedLines = [];
    let scheduleInferredLines = [];
    let unattributedCount = 0;

    for (const station of stations) {
      const record = await ActivityLog.findOne({ station: station.stationId, month: currentMonth });
      if (!record?.cloudinaryUrl) continue;

      const rawText = await fetchCloudinaryText(record.cloudinaryUrl);
      const { byEmployee, unattributed } = await attributeStationMonth(
        station.stationId,
        currentMonth,
        rawText
      );

      const entry = byEmployee[employeeId];
      if (entry) {
        confirmedLines = confirmedLines.concat(entry.confirmed);
        scheduleInferredLines = scheduleInferredLines.concat(entry.scheduleInferred);
      }
      unattributedCount += unattributed.length;
    }

    // Lines carry their own timestamp prefix, so a simple string sort works.
    confirmedLines.sort();
    scheduleInferredLines.sort();

    return res.status(200).json({
      success: true,
      data: {
        employeeId,
        month: currentMonth,
        stations: stations.map((s) => s.stationId),
        confirmedLineCount: confirmedLines.length,
        scheduleInferredLineCount: scheduleInferredLines.length,
        unattributedElsewhere: unattributedCount,
        rawText: confirmedLines.join('\n'),
        scheduleInferredText: scheduleInferredLines.join('\n'),
      },
    });
  } catch (err) {
    console.error('[ActivityLog] getCurrentLogContent error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /activity-logs/:employeeId/current — lighter metadata-only version */
const getCurrentLog = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const stations = await findStationsForEmployeeReference(employeeId);
    return res.status(200).json({
      success: true,
      data: { employeeId, stations: stations.map((s) => ({ stationId: s.stationId, label: s.label })) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /activity-logs/:employeeId/history
 *
 * Returns the log history for an employee across all their assigned stations.
 *
 * KEY CHANGE: When the employee has active ShiftAssignment records, the raw
 * log text from each station is fetched server-side and filtered to only the
 * lines that fall within that employee's shift window.  This is what makes
 * shared-station setups work correctly: two employees on the same PC each
 * receive only the entries produced during their own shift, even when the
 * logs are stored in a single file.
 *
 * Each item in the returned `data` array includes:
 *   - cloudinaryUrl  — original URL (still included for backward-compat / admin use)
 *   - filteredText   — pre-filtered log text string; use this instead of fetching cloudinaryUrl
 *   - shiftFiltered  — boolean: true when filteredText was narrowed by a shift window
 *   - shiftInfo      — array of { startTime, endTime, crossDay } used for filtering (informational)
 */
const getEmployeeLogHistory = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const stations = await findStationsForEmployeeReference(employeeId);
    const stationIds = stations.map((s) => s.stationId);

    if (stationIds.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    // ── Fetch this employee's active shift assignments ─────────────────────────
    const ShiftAssignment = require('../models/ShiftAssignment.model');
    // Activity endpoints receive an Employee document ID because stations
    // reference Employee. ShiftAssignment, however, references User. Resolve
    // both forms so the employee's actual assignments are always found.
    const employeeProfile = await Employee.findById(employeeId).select('user').lean();
    const shiftEmployeeRefs = [employeeId];
    if (employeeProfile?.user) shiftEmployeeRefs.push(employeeProfile.user.toString());

    const shiftAssignments = await ShiftAssignment.find({
      employee: { $in: [...new Set(shiftEmployeeRefs)] },
      status: 'active',
    }).lean();

    const hasShifts = shiftAssignments.length > 0;

    // Build a human-readable summary of shift windows (returned for UI display)
    const shiftInfo = shiftAssignments.map((a) => ({
      startTime: a.startTime,
      endTime:   a.endTime,
      crossDay:  a.crossDay,
      recurring: a.recurring,
      weekday:   a.recurring ? a.weekday : null,
      // The dashboard uses the same assignment data to group overnight work
      // under the date the shift started, rather than splitting it at midnight.
      startDate: a.startDate ? a.startDate.toISOString().slice(0, 10) : null,
      endDate:   a.endDate ? a.endDate.toISOString().slice(0, 10) : null,
    }));

    // ── Fetch log records for all assigned stations ────────────────────────────
    const records = await ActivityLog.find({
      station:      { $in: stationIds },
      cloudinaryUrl: { $exists: true, $ne: '' },
    }).sort({ month: -1, station: 1 });

    // ── Build response — filter text by shift when assignments exist ───────────
    const history = [];

    for (const record of records) {
      if (!hasShifts) {
        // No shift assignments: return the raw Cloudinary URL as before.
        // The frontend can fetch it directly (backward-compatible behaviour).
        history.push({
          stationId:     record.station,
          month:         record.month,
          cloudinaryUrl: record.cloudinaryUrl,
          lineCount:     record.lineCount || 0,
          filteredText:  null,
          shiftFiltered: false,
          shiftInfo:     [],
        });
        continue;
      }

      // Fetch raw text and apply shift-window filter
      const rawText = await fetchCloudinaryText(record.cloudinaryUrl);
      const filteredText = filterLogTextByShift(rawText, shiftAssignments);
      const filteredLineCount = filteredText
        ? filteredText.split('\n').filter((l) => l.trim()).length
        : 0;

      history.push({
        stationId:     record.station,
        month:         record.month,
        cloudinaryUrl: record.cloudinaryUrl, // kept for admin/audit use
        lineCount:     record.lineCount || 0,
        filteredText,                         // use this on the client
        filteredLineCount,
        shiftFiltered: true,
        shiftInfo,
      });
    }

    return res.status(200).json({ success: true, data: history });
  } catch (err) {
    console.error('[ActivityLog] getEmployeeLogHistory error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Attribution review (admin resolves ambiguous windows) ───────────────────

/**
 * GET /activity-logs/station/:stationId/unattributed?month=YYYY-MM&includeIdle=false
 */
const getUnattributed = async (req, res) => {
  try {
    const { stationId } = req.params;
    const month = req.query.month || getCurrentMonth();
    const includeIdle = req.query.includeIdle === 'true';

    const record = await ActivityLog.findOne({ station: stationId, month });
    if (!record?.cloudinaryUrl) {
      return res.status(200).json({ success: true, data: [] });
    }

    const rawText = await fetchCloudinaryText(record.cloudinaryUrl);
    const { unattributed } = await attributeStationMonth(stationId, month, rawText);

    const filtered = includeIdle
      ? unattributed
      : unattributed.filter((u) => u.reason === 'ambiguous');

    return res.status(200).json({
      success: true,
      count: filtered.length,
      idleCount: unattributed.filter((u) => u.reason === 'idle').length,
      data: filtered,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /activity-logs/station/:stationId/resolve
 * Body: { rangeStart, rangeEnd, employeeId }
 */
const resolveAttribution = async (req, res) => {
  try {
    const { stationId } = req.params;
    const { rangeStart, rangeEnd, employeeId } = req.body;

    if (!rangeStart || !rangeEnd || !employeeId) {
      return res.status(400).json({
        success: false,
        message: 'rangeStart, rangeEnd, and employeeId are required',
      });
    }

    const override = await AttributionOverride.create({
      station:    stationId,
      rangeStart: new Date(rangeStart),
      rangeEnd:   new Date(rangeEnd),
      employee:   employeeId,
      resolvedBy: req.user._id,
    });

    return res.status(201).json({ success: true, data: override });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  ingestLogs,
  getStationCurrentLog,
  getAllCurrentLogs,
  getAllLogs,
  getPendingBackup,
  archiveLog,
  getCurrentLog,
  getCurrentLogContent,
  getEmployeeLogHistory,
  getUnattributed,
  getStationShiftLogs,
  resolveAttribution,
};
