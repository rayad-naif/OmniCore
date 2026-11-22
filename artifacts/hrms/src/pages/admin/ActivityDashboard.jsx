import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { activityLogAPI, attendanceAPI } from '@/services/api';
import {
  Users, MousePointerClick, Clock, Activity, RefreshCw,
  TrendingUp, TrendingDown, Minus, Briefcase, Gamepad2, Timer,
  Keyboard,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

// ─── Log format support ───────────────────────────────────────────────────────
// Handles three formats produced by different logger versions:
//
// Format A (old, full):
//   [2026-07-21 04:56:28] | Process: chrome.exe | Window: New Tab - Google Chrome | Duration: 204s | Keystrokes: 199 | Clicks: 4
//
// Format B (new, bracket date+time, no Process field):
//   [2026-07-21 01:41:01] | Modern - Google Chrome | Duration: 30s | Keystrokes: 0 | Clicks: 10 | Active: 14%
//   [2026-07-21 01:41:01] | Window: Modern - Google Chrome | Duration: 30s | Keystrokes: 0 | Clicks: 10 | Active: 14%
//
// Format C (multi-line — time on its own line, content on the next line):
//   01:41:01
//   Modern - Google Chrome | Duration: 30s | Keystrokes: 0 | Clicks: 10 | Active: 14%
//   30s   ← gap/idle indicator — skipped

// RE_A — old format with Process: + Window: labels
const RE_A = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]\s*\|\s*Process:\s*(.+?)\s*\|\s*(?:Window:)?\s*(.+?)(?:\s*\|\s*Duration:\s*([^|]+?))?(?:\s*\|\s*Keystrokes:\s*(\d+))?(?:\s*\|\s*Clicks:\s*(\d+))?(?:\s*\|\s*Active:\s*([\d.]+)%)?\s*$/;

// RE_B — new format: bracket date+time then content (no Process)
const RE_B = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]\s*\|(?:\s*Window:)?\s*(.+?)\s*\|\s*Duration:\s*([^|]+?)(?:\s*\|\s*Keystrokes:\s*(\d+))?(?:\s*\|\s*Clicks:\s*(\d+))?(?:\s*\|\s*Active:\s*([\d.]+)%)?\s*$/;

// RE_CONTENT — content-only line used with Format C (time comes from prior line via ctx)
//   "Modern - Google Chrome | Duration: 30s | Keystrokes: 0 | Clicks: 10 | Active: 14%"
const RE_CONTENT = /^(.+?)\s*\|\s*Duration:\s*([^|]+?)\s*\|\s*Keystrokes:\s*(\d+)\s*\|\s*Clicks:\s*(\d+)(?:\s*\|\s*Active:\s*([\d.]+)%)?\s*$/;

// Standalone time line: "01:41:01" or "1:41:31"
const RE_TIME_ONLY = /^(\d{1,2}:\d{2}:\d{2})$/;

// Standalone date line: "2026-07-21"
const RE_DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;

// Gap / idle / separator tokens — skip them (e.g. "0s", "30s", "14%")
const RE_SKIP = /^(\d+[smh](\s+\d+[smh])*|\d+(\.\d+)?%)$/;

function normalizeTime(t) {
  // Pad single-digit hour: "1:41:31" → "01:41:31"
  return t.split(':').map((p) => p.padStart(2, '0')).join(':');
}

function parseDurationString(value) {
  if (!value) return 0;
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i);
  if (match) {
    return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  }
  const digitsOnly = normalized.match(/^(\d+)$/);
  if (digitsOnly) return Number(digitsOnly[1]);
  return 0;
}

// Parse one trimmed line into a log entry.
// `ctx` carries the last-seen date/time from preceding lines (Format C support).
function parseLogLine(line, ctx) {
  const t = line.trim();

  // ── Format A ──
  let m = t.match(RE_A);
  if (m) {
    const [, date, time, process, windowTitle, durationText, keystrokes, clicks, activePercent] = m;
    return {
      date,
      time: normalizeTime(time),
      process,
      windowTitle: windowTitle.trim(),
      durationSeconds: durationText ? parseDurationString(durationText.trim()) : undefined,
      keystrokes: keystrokes != null ? Number(keystrokes) : undefined,
      clicks: clicks != null ? Number(clicks) : undefined,
      activePercent: activePercent != null ? Number(activePercent) : undefined,
      raw: line,
    };
  }

  // ── Format B ──
  m = t.match(RE_B);
  if (m) {
    const [, date, time, windowTitle, durationText, keystrokes, clicks, activePercent] = m;
    return {
      date,
      time: normalizeTime(time),
      process: null,
      windowTitle: windowTitle.trim(),
      durationSeconds: parseDurationString(durationText.trim()),
      keystrokes: keystrokes != null ? Number(keystrokes) : undefined,
      clicks: clicks != null ? Number(clicks) : undefined,
      activePercent: activePercent != null ? Number(activePercent) : undefined,
      raw: line,
    };
  }

  // ── Format C content line — only when we have a preceding time from ctx ──
  if (ctx && ctx.time) {
    m = t.match(RE_CONTENT);
    if (m) {
      const [, windowTitle, durationText, keystrokes, clicks, activePercent] = m;
      return {
        date: ctx.date || 'Unknown',
        time: ctx.time,
        process: null,
        windowTitle: windowTitle.trim(),
        durationSeconds: parseDurationString(durationText.trim()),
        keystrokes: Number(keystrokes),
        clicks: Number(clicks),
        activePercent: activePercent != null ? Number(activePercent) : undefined,
        raw: line,
      };
    }
  }

  return null;
}

const MAX_GAP_SECONDS = 300;

function timeToSeconds(timeStr) {
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function computeDurations(sortedEntries) {
  return sortedEntries.map((entry, idx) => {
    if (typeof entry.durationSeconds === 'number') return entry;
    const next = sortedEntries[idx + 1];
    let durationSeconds = 0;
    if (next) {
      const gap = timeToSeconds(next.time) - timeToSeconds(entry.time);
      durationSeconds = gap > 0 ? Math.min(gap, MAX_GAP_SECONDS) : 0;
    }
    return { ...entry, durationSeconds };
  });
}

function formatDuration(totalSeconds) {
  const secs = Math.round(totalSeconds || 0);
  if (secs < 60) return `${secs}s`;
  const totalMinutes = Math.floor(secs / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function formatHoursDecimal(totalSeconds) {
  return (totalSeconds / 3600).toFixed(1) + 'h';
}

// For Format C logs where process is null, try to infer from window title
function inferProcess(entry) {
  if (entry.process) return entry.process.toLowerCase().trim();
  const title = (entry.windowTitle || '').toLowerCase();
  if (title.includes('google chrome') || title.includes('- chrome')) return 'chrome.exe';
  if (title.includes('firefox')) return 'firefox.exe';
  if (title.includes('edge')) return 'msedge.exe';
  return null;
}

// Entertainment is deliberately limited to the social-media services below.
// Every other tracked application or website counts as work.
function isSocialMediaEntry(entry) {
  const process = inferProcess(entry) || '';
  const title = (entry.windowTitle || '').toLowerCase();

  return process === 'whatsapp.exe' || [
    'whatsapp',
    'youtube',
    'youtu.be',
    'facebook',
    'instagram',
    'twitter',
    'x.com',
    'linkedin',
  ].some((site) => title.includes(site));
}

function isWorkEntry(entry) {
  return !isSocialMediaEntry(entry);
}

// An entry only counts as "active" (and therefore productive) time if the
// logger actually recorded some input signal for it — clicks, keystrokes,
// or an Active% reading above 0. A window that just sat open untouched
// (e.g. left on a screen overnight) reports 0 clicks / 0 keystrokes /
// 0% active on every tick and must NOT be counted toward active/work time,
// even though it still has a nonzero duration.
//
// If a log line predates the logger versions that emit these fields at all
// (all three are `undefined`), we can't tell either way — fall back to
// treating it as active so older logs aren't zeroed out retroactively.
// Kept in sync with the identical helper in ActivityLogs.jsx.
function isActiveEntry(entry) {
  const hasClicks = typeof entry.clicks === 'number';
  const hasKeystrokes = typeof entry.keystrokes === 'number';
  const hasActivePercent = typeof entry.activePercent === 'number';

  if (!hasClicks && !hasKeystrokes && !hasActivePercent) return true;

  return (
    (hasClicks && entry.clicks > 0) ||
    (hasKeystrokes && entry.keystrokes > 0) ||
    (hasActivePercent && entry.activePercent > 0)
  );
}

// Parses raw log text (all three formats) into { [date]: entries[] } buckets.
function parseLogText(rawText) {
  if (!rawText) return {};

  const buckets = {};
  // Context for Format C (multi-line): track last seen standalone time/date
  const ctx = { date: null, time: null };

  rawText.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Skip gap / idle / separator tokens
    if (RE_SKIP.test(trimmed)) return;

    // Standalone date header
    const dateMatch = trimmed.match(RE_DATE_ONLY);
    if (dateMatch) {
      ctx.date = dateMatch[1];
      return;
    }

    // Standalone time line (Format C first line)
    const timeMatch = trimmed.match(RE_TIME_ONLY);
    if (timeMatch) {
      ctx.time = normalizeTime(timeMatch[1]);
      return; // wait for the content line that follows
    }

    // Try to parse as a log entry (passes ctx for Format C)
    const parsed = parseLogLine(trimmed, ctx);
    if (!parsed) {
      // Reset ctx.time so a stray content-like line doesn't accidentally
      // use a much older time from a completely different entry
      ctx.time = null;
      return;
    }

    // Update ctx from the parsed entry so subsequent lines have the right date
    if (parsed.date && parsed.date !== 'Unknown') ctx.date = parsed.date;
    ctx.time = null; // consumed — reset so we don't reuse it

    if (!buckets[parsed.date]) buckets[parsed.date] = [];
    buckets[parsed.date].push(parsed);
  });

  // Sort each date's entries and fill in gap-based durations
  Object.keys(buckets).forEach((date) => {
    buckets[date] = computeDurations(buckets[date].sort((a, b) => a.time.localeCompare(b.time)));
  });

  return buckets;
}

// A cross-day shift belongs to the date it starts. For example, activity at
// 01:00 on Aug 7 during a 21:00–05:00 shift is counted under Aug 6.
function getPreviousDateStr(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function getAssignmentForDate(dateStr, assignments) {
  const date = new Date(`${dateStr}T12:00:00`);
  const weekday = date.getDay();

  return assignments.find((assignment) => {
    if (assignment.recurring) return assignment.weekday === weekday;
    return assignment.startDate <= dateStr && assignment.endDate >= dateStr;
  }) || null;
}

function rekeyBucketsByShift(buckets, assignments) {
  if (!assignments?.length) return buckets;

  const shiftBuckets = {};
  Object.entries(buckets).forEach(([date, entries]) => {
    const previousDate = getPreviousDateStr(date);
    const previousShift = getAssignmentForDate(previousDate, assignments);

    entries.forEach((entry) => {
      const entryMinutes = timeToSeconds(entry.time) / 60;
      const previousShiftEnd = previousShift ? timeToSeconds(`${previousShift.endTime}:00`) / 60 : -1;
      const belongsToPreviousShift = previousShift?.crossDay && entryMinutes <= previousShiftEnd;
      const shiftDate = belongsToPreviousShift ? previousDate : date;

      if (!shiftBuckets[shiftDate]) shiftBuckets[shiftDate] = [];
      shiftBuckets[shiftDate].push({ ...entry, date: shiftDate });
    });
  });

  Object.keys(shiftBuckets).forEach((date) => {
    shiftBuckets[date].sort((a, b) => a.time.localeCompare(b.time));
  });

  return shiftBuckets;
}

// "Work" seconds only accrue when the entry is on a work app/site AND the
// employee was actually active there (clicks/keystrokes/active% > 0).
//
// Idle time is NOT reclassified as Entertainment the instant it happens —
// a brief pause (reading something, a few seconds between keystrokes) still
// counts as Work. Only once a *continuous* idle stretch on a work app has
// run for IDLE_TO_ENTERTAINMENT_SECONDS or longer does that whole stretch
// flip to Entertainment. So a 12s idle gap before the next active entry
// stays Work; a 6-minute idle gap becomes Entertainment.
//
// Social-media entries are unaffected by this — they're Entertainment
// whether active or idle, same as before.
//
// Mirrors the identical helpers in ActivityLogs.jsx so both screens agree.
const IDLE_TO_ENTERTAINMENT_SECONDS = 300; // 5 minutes

// Walks a chronologically-sorted list of entries and tags each one Work or
// Entertainment, resolving idle streaks by their total length rather than
// entry-by-entry. Streaks never cross a date boundary (each entry carries
// its own `date`), so this stays correct even when called with entries
// spanning multiple days.
function classifyWorkEntertainment(entries) {
  const classified = [];
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];

    if (!isWorkEntry(entry)) {
      classified.push({ entry, isWork: false });
      i += 1;
      continue;
    }
    if (isActiveEntry(entry)) {
      classified.push({ entry, isWork: true });
      i += 1;
      continue;
    }

    // Idle on a work app — look ahead to measure the full continuous streak.
    // "Continuous" means genuinely back-to-back in time, not just same date —
    // if a time-of-day filter has punched a gap out of the entries (e.g.
    // only 9–10am and 5–6pm selected), that gap must NOT be treated as one
    // long idle streak just because both halves fall on the same date.
    let streakSeconds = entry.durationSeconds ?? 0;
    let cursorEnd = timeToSeconds(entry.time) + streakSeconds;
    let j = i + 1;
    while (
      j < entries.length &&
      isWorkEntry(entries[j]) &&
      !isActiveEntry(entries[j]) &&
      entries[j].date === entry.date &&
      timeToSeconds(entries[j].time) - cursorEnd <= 5 // small tolerance for rounding
    ) {
      const dur = entries[j].durationSeconds ?? 0;
      streakSeconds += dur;
      cursorEnd = timeToSeconds(entries[j].time) + dur;
      j += 1;
    }

    const streakIsWork = streakSeconds < IDLE_TO_ENTERTAINMENT_SECONDS;
    for (let k = i; k < j; k++) classified.push({ entry: entries[k], isWork: streakIsWork });
    i = j;
  }
  return classified;
}

function computeTotals(entries) {
  const classified = classifyWorkEntertainment(entries);
  return classified.reduce(
    (acc, { entry: e, isWork }) => ({
      clicks: acc.clicks + (e.clicks ?? 0),
      keystrokes: acc.keystrokes + (e.keystrokes ?? 0),
      workSeconds: acc.workSeconds + (isWork ? (e.durationSeconds ?? 0) : 0),
      entertainmentSeconds: acc.entertainmentSeconds + (!isWork ? (e.durationSeconds ?? 0) : 0),
      totalSeconds: acc.totalSeconds + (e.durationSeconds ?? 0),
    }),
    { clicks: 0, keystrokes: 0, workSeconds: 0, entertainmentSeconds: 0, totalSeconds: 0 }
  );
}

// toISOString() converts to UTC first, which shifts the calendar date for any
// timezone ahead of UTC (e.g. Pakistan, UTC+5) during the early-morning hours —
// "today" would still read as yesterday until 5 AM local time. Use the
// browser's local date components instead so this always matches the
// employee's/admin's actual wall-clock date.
function toLocalDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(toLocalDateStr(d));
  }
  return days;
}

function formatDayLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
}

// ─── Day-over-day change (stock-ticker style trend badges) ───────────────────

function getTodayDateStr() {
  return toLocalDateStr(new Date());
}

function getYesterdayDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toLocalDateStr(d);
}

// null = no comparison possible (no data either day), Infinity-ish handled via 'isNew'
function computeChangePct(current, previous) {
  if (!previous) {
    if (!current) return { pct: null, isNew: false };
    return { pct: null, isNew: true }; // went from 0 → something: show "New" rather than a %
  }
  return { pct: ((current - previous) / previous) * 100, isNew: false };
}

// Given a { [date]: entries[] } bucket map, return today vs. yesterday totals
// for each metric so stat tiles can show an increase/decrease badge.
function computeDayOverDay(buckets) {
  const today = computeTotals(buckets?.[getTodayDateStr()] || []);
  const yesterday = computeTotals(buckets?.[getYesterdayDateStr()] || []);
  return {
    clicks: computeChangePct(today.clicks, yesterday.clicks),
    keystrokes: computeChangePct(today.keystrokes, yesterday.keystrokes),
    workSeconds: computeChangePct(today.workSeconds, yesterday.workSeconds),
    entertainmentSeconds: computeChangePct(today.entertainmentSeconds, yesterday.entertainmentSeconds),
    totalSeconds: computeChangePct(today.totalSeconds, yesterday.totalSeconds),
  };
}

// ─── Date range filtering ──────────────────────────────────────────────────
//
// `start` / `end` are 'YYYY-MM-DD' strings (or '' for open-ended). Used to
// scope the already-fetched per-employee buckets down to a chosen window
// without re-hitting the server (all history is already cached client-side
// by fetchAndBuildCache).

function isDateInRange(dateStr, start, end) {
  if (!dateStr) return false;
  if (start && dateStr < start) return false;
  if (end && dateStr > end) return false;
  return true;
}

// Checks whether a 'HH:MM:SS' entry time falls within a 'HH:MM' start/end
// time-of-day window. Supports windows that cross midnight (e.g. 22:00–06:00).
function isTimeOfDayInRange(timeStr, startTime, endTime) {
  if (!startTime && !endTime) return true;
  if (!timeStr) return true;
  const entrySeconds = timeToSeconds(timeStr);
  const startSeconds = startTime ? timeToSeconds(`${startTime}:00`) : null;
  const endSeconds = endTime ? timeToSeconds(`${endTime}:59`) : null;
  const crossesMidnight = startSeconds != null && endSeconds != null && startSeconds > endSeconds;
  if (crossesMidnight) {
    return (startSeconds == null || entrySeconds >= startSeconds) || (endSeconds == null || entrySeconds <= endSeconds);
  }
  return (startSeconds == null || entrySeconds >= startSeconds) && (endSeconds == null || entrySeconds <= endSeconds);
}

function filterBucketsByRange(buckets, start, end, startTime, endTime) {
  if (!buckets) return {};
  if (!start && !end && !startTime && !endTime) return buckets;
  const filtered = {};
  Object.keys(buckets).forEach((date) => {
    if (!isDateInRange(date, start, end)) return;
    if (!startTime && !endTime) {
      filtered[date] = buckets[date];
      return;
    }
    const timeFiltered = buckets[date].filter((entry) => isTimeOfDayInRange(entry.time, startTime, endTime));
    if (timeFiltered.length > 0) filtered[date] = timeFiltered;
  });
  return filtered;
}

// Resolve a possibly one-sided range into concrete bounds for building a
// day-by-day chart axis. Falls back to the trailing-14-days window when no
// range has been applied at all.
function resolveChartBounds(start, end) {
  if (!start && !end) return null;
  if (start && end) return { start, end };
  if (start && !end) return { start, end: getTodayDateStr() };
  const d = new Date(`${end}T00:00:00`);
  d.setDate(d.getDate() - 13);
  return { start: toLocalDateStr(d), end };
}

function enumerateDateRange(start, end) {
  const bounds = resolveChartBounds(start, end);
  if (!bounds) return getLastNDays(14);
  const days = [];
  let cur = new Date(`${bounds.start}T00:00:00`);
  const last = new Date(`${bounds.end}T00:00:00`);
  if (cur > last) return [];
  while (cur <= last) {
    days.push(toLocalDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

// Recomputes totals / lastEntry / chartData for one employee's cache, scoped
// to a [start, end] date range. Mirrors the shape built by fetchAndBuildCache
// so it can be dropped in anywhere `cache` is used for display.
function computeRangeSummary(cache, start, end, startTime, endTime) {
  if (!cache?.buckets) return cache; // pass through null/undefined as-is

  const filteredBuckets = filterBucketsByRange(cache.buckets, start, end, startTime, endTime);
  const allEntries = Object.values(filteredBuckets).flat();
  const totals = computeTotals(allEntries);

  const sortedDates = Object.keys(filteredBuckets).sort((a, b) => b.localeCompare(a));
  let lastEntry = null;
  if (sortedDates.length > 0) {
    const dayEntries = filteredBuckets[sortedDates[0]];
    lastEntry = dayEntries[dayEntries.length - 1] || null;
  }

  const days = enumerateDateRange(start, end);
  const chartData = days
    .map((date) => {
      const dayTotals = computeTotals(filteredBuckets[date] || []);
      return {
        date,
        label: formatDayLabel(date),
        Work: parseFloat((dayTotals.workSeconds / 3600).toFixed(2)),
        Entertainment: parseFloat((dayTotals.entertainmentSeconds / 3600).toFixed(2)),
      };
    })
    .filter((d) => d.Work > 0 || d.Entertainment > 0);

  return { buckets: filteredBuckets, totals, lastEntry, chartData };
}

function formatTimeLabel(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatRangeLabel(start, end, startTime, endTime) {
  const dateLabel = !start && !end
    ? 'All time'
    : start && end
    ? `${formatDayLabel(start)} – ${formatDayLabel(end)}`
    : start
    ? `Since ${formatDayLabel(start)}`
    : `Through ${formatDayLabel(end)}`;

  if (!startTime && !endTime) return dateLabel;
  const timeLabel = `${startTime ? formatTimeLabel(startTime) : '12:00 AM'} – ${endTime ? formatTimeLabel(endTime) : '11:59 PM'}`;
  return `${dateLabel} · ${timeLabel}`;
}

const DATE_FORMAT = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEmployeeProfile(record) {
  const employee = record?.employee || {};
  const user = employee?.user || employee;
  const fullName =
    user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.name || 'Unknown';
  return {
    avatar: user?.avatar || '',
    name: fullName,
    employeeId: user?.employeeId || employee?.employeeId || '—',
    department: user?.department?.name || employee?.department?.name || '',
    stationLabel: record?.stationLabel || record?.stationLabels?.[0] || record?.stationId || '—',
    initials: fullName.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase(),
  };
}

function isActiveRecently(lastUpdated, thresholdMinutes = 30) {
  if (!lastUpdated) return false;
  return Date.now() - new Date(lastUpdated).getTime() < thresholdMinutes * 60 * 1000;
}

// ─── Helper: fetch + parse one employee's logs ────────────────────────────────
//
// CHANGED: The /history endpoint now returns `filteredText` when the employee
// has shift assignments.  When `filteredText` is present we use it directly
// (no Cloudinary round-trip needed), giving each shared-PC employee only the
// log lines that fall within their own shift window.

async function fetchAndBuildCache(employeeId) {
  const { data } = await activityLogAPI.getHistory(employeeId);
  const recs = data.data || [];
  if (recs.length === 0) return null;
  const shiftAssignments = recs.find((record) => record.shiftInfo?.length)?.shiftInfo || [];
  // Detect whether the server already applied shift filtering/dating.
  // (All records in the response share the same shiftFiltered flag.)
  // Kept in sync with the identical check in ActivityLogs.jsx's fetchLogContent —
  // applying rekeyBucketsByShift on TOP OF already shift-correct server text
  // double-shifts cross-midnight entries onto the wrong calendar date, which
  // desyncs this cache's date-range totals from ActivityLogs.jsx's own totals.
  const serverFiltered = recs.some((r) => r.shiftFiltered === true);
  const texts = await Promise.all(
    recs.map(async (r) => {
      // Prefer server-filtered text when available
      if (r.filteredText != null) return r.filteredText;

      // If the server did not pre-filter and this record has a stationId,
      // attempt to fetch station-level per-employee attribution which will
      // return only this employee's lines even when the station is shared.
      if (r.cloudinaryUrl && r.stationId) {
        try {
          const month = r.month;
          const { data: stationResp } = await activityLogAPI.getStationByShift(r.stationId, month);
          const byEmployee = stationResp.data?.byEmployee || {};
          const empEntry = byEmployee[employeeId];
          if (empEntry) {
            return [...(empEntry.confirmed || []), ...(empEntry.scheduleInferred || [])].join('\n');
          }
        } catch (e) {
          // ignore and fallback to raw Cloudinary fetch
        }
      }

      // Final fallback: fetch raw text from Cloudinary
      if (r.cloudinaryUrl) {
        return fetch(r.cloudinaryUrl).then((res) => (res.ok ? res.text() : '')).catch(() => '');
      }
      return '';
    })
  );

  const merged = texts.filter(Boolean).join('\n');
  const buckets = serverFiltered
    ? parseLogText(merged)
    : rekeyBucketsByShift(parseLogText(merged), shiftAssignments);
  const allEntries = Object.values(buckets).flat();
  const totals = computeTotals(allEntries);

  const sortedDates = Object.keys(buckets).sort((a, b) => b.localeCompare(a));
  let lastEntry = null;
  if (sortedDates.length > 0) {
    const dayEntries = buckets[sortedDates[0]];
    lastEntry = dayEntries[dayEntries.length - 1] || null;
  }

  const last14 = getLastNDays(14);
  const chartData = last14
    .map((date) => {
      const dayEntries = buckets[date] || [];
      const dayTotals = computeTotals(dayEntries);
      return {
        date,
        label: formatDayLabel(date),
        Work: parseFloat((dayTotals.workSeconds / 3600).toFixed(2)),
        Entertainment: parseFloat((dayTotals.entertainmentSeconds / 3600).toFixed(2)),
      };
    })
    .filter((d) => d.Work > 0 || d.Entertainment > 0);

  return { buckets, totals, lastEntry, chartData };
}

// ─── Trend Badge (stock-ticker style ▲ / ▼ indicator) ─────────────────────────

function TrendBadge({ change, size = 'sm' }) {
  if (!change) return null;
  const { pct, isNew } = change;

  if (isNew) {
    return (
      <motion.span
        initial={{ opacity: 0, y: -2 }}
        animate={{ opacity: 1, y: 0 }}
        className={clsx(
          'inline-flex items-center gap-0.5 rounded-full bg-blue-500/10 text-blue-500 dark:text-blue-400 font-semibold',
          size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'
        )}
      >
        New
      </motion.span>
    );
  }

  if (pct === null || !Number.isFinite(pct)) return null;

  const rounded = Math.abs(pct) < 0.1 ? 0 : Math.round(pct * 10) / 10;
  const isFlat = rounded === 0;
  const isUp = rounded > 0;

  return (
    <motion.span
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        'inline-flex items-center gap-0.5 rounded-full font-semibold tabular-nums',
        size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5',
        isFlat
          ? 'bg-slate-400/10 text-slate-400'
          : isUp
          ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400'
          : 'bg-rose-500/10 text-rose-500 dark:text-rose-400'
      )}
    >
      {isFlat ? (
        <Minus className="w-2.5 h-2.5" />
      ) : isUp ? (
        <TrendingUp className="w-2.5 h-2.5" />
      ) : (
        <TrendingDown className="w-2.5 h-2.5" />
      )}
      {isFlat ? '0%' : `${isUp ? '+' : ''}${rounded}%`}
    </motion.span>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color, trend, index = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: 'easeOut' }}
      whileHover={{ y: -2 }}
      className="glass-card rounded-3xl border border-white/10 bg-white/80 dark:bg-slate-950/80 p-5 flex items-start gap-4 shadow-sm"
    >
      <div className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-400 mb-0.5">{label}</p>
          <TrendBadge change={trend} />
        </div>
        <p className="text-2xl font-bold text-slate-900 dark:text-white leading-none">{value}</p>
        {sub && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{sub}</p>}
      </div>
    </motion.div>
  );
}

// ─── Custom Chart Tooltip ─────────────────────────────────────────────────────

function CustomChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-xs shadow-xl">
      <p className="font-semibold text-white mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-slate-300">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.fill }} />
          <span>{p.name}:</span>
          <span className="font-medium text-white">{formatDuration(p.value * 3600)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ActivityDashboard({ embedded = false, selectedEmployeeId, onSelectEmployee, onRangeChange, onSelectedStatsChange, children }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [internalSelectedId, setInternalSelectedId] = useState(null);
  const selectedId = selectedEmployeeId ?? internalSelectedId;
  const selectEmployee = onSelectEmployee || setInternalSelectedId;

  // Per-employee parsed data cache: { [employeeId]: { buckets, totals, lastEntry, chartData } | null }
  const [parsedCache, setParsedCache] = useState({});
  const [loadingContent, setLoadingContent] = useState(false);
  const [workingUserIds, setWorkingUserIds] = useState(new Set());
  // true while attendance API is in flight — prevents flickering everyone to Offline prematurely
  const [attendanceLoading, setAttendanceLoading] = useState(true);

  // Tracks which employee IDs are already fetched or in-flight — prevents double-fetching
  const inFlightRef = useRef(new Set());

  // ── Date range filter ───────────────────────────────────────────────────
  // `rangeStart` / `rangeEnd` are the raw <input type="date"> values (not yet
  // applied). `appliedRange` is what's actually used to filter the already-
  // loaded logs — it only updates when the user clicks "Apply".
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [rangeStartTime, setRangeStartTime] = useState('');
  const [rangeEndTime, setRangeEndTime] = useState('');
  const [appliedRange, setAppliedRange] = useState({ start: '', end: '', startTime: '', endTime: '' });
  const hasRangeFilter = !!(appliedRange.start || appliedRange.end);
  const hasTimeFilter = !!(appliedRange.startTime || appliedRange.endTime);

  const activePreset = useMemo(() => {
    const todayStr = getTodayDateStr();
    const matchesRange = (start, end = todayStr) =>
      appliedRange.start === start && appliedRange.end === end;

    if (!hasRangeFilter) return 'all';
    if (matchesRange(todayStr)) return 'today';

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    if (matchesRange(toLocalDateStr(sevenDaysAgo))) return '7d';

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    if (matchesRange(toLocalDateStr(thirtyDaysAgo))) return '30d';

    const now = new Date();
    const monthStart = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
    if (matchesRange(monthStart)) return 'month';

    return null;
  }, [appliedRange, hasRangeFilter]);

  const handleApplyRange = () => {
    const range = { start: rangeStart, end: rangeEnd, startTime: rangeStartTime, endTime: rangeEndTime };
    setAppliedRange(range);
    onRangeChange?.(range);
  };
  const handleClearRange = () => {
    setRangeStart('');
    setRangeEnd('');
    setRangeStartTime('');
    setRangeEndTime('');
    const range = { start: '', end: '', startTime: '', endTime: '' };
    setAppliedRange(range);
    onRangeChange?.(range);
  };
  // Presets only move the date bounds — whatever time-of-day window the
  // person already dialed in (if any) is preserved across preset clicks.
  const applyRangePreset = (preset) => {
    const todayStr = getTodayDateStr();
    let start = '';
    const end = todayStr;
    if (preset === 'today') start = todayStr;
    else if (preset === '7d') {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      start = toLocalDateStr(d);
    } else if (preset === '30d') {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      start = toLocalDateStr(d);
    } else if (preset === 'month') {
      const d = new Date();
      start = toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
    } else if (preset === 'all') {
      handleClearRange();
      return;
    }
    setRangeStart(start);
    setRangeEnd(end);
    const range = { start, end, startTime: rangeStartTime, endTime: rangeEndTime };
    setAppliedRange(range);
    onRangeChange?.(range);
  };

  // ── Fetch all employee log records ─────────────────────────────────────────
  const fetchRecords = useCallback(() => {
    setLoading(true);
    activityLogAPI
      .getAll()
      .then(({ data }) => {
        const items = data.data || [];
        const map = new Map();
        items.forEach((record) => {
          const emp = record.employee || {};
          const id = emp._id || emp.id || record._id;
          if (!id) return;
          const existing = map.get(id);
          if (!existing) { map.set(id, record); return; }
          const aDate = existing.lastUpdated ? new Date(existing.lastUpdated) : new Date(0);
          const bDate = record.lastUpdated ? new Date(record.lastUpdated) : new Date(0);
          if (bDate > aDate) map.set(id, record);
        });
        const deduped = Array.from(map.values()).sort((a, b) => {
          const da = a.lastUpdated ? new Date(a.lastUpdated) : new Date(0);
          const db = b.lastUpdated ? new Date(b.lastUpdated) : new Date(0);
          return db - da;
        });
        setRecords(deduped);
        if (deduped.length > 0) {
          const firstId = deduped[0].employee?._id || deduped[0].employee?.id || deduped[0]._id;
          selectEmployee(firstId);
        }
      })
      .catch((err) => setError(err?.response?.data?.message || err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // Fetch today's admin attendance to determine who is currently working.
  useEffect(() => {
    let mounted = true;
    setAttendanceLoading(true);
    attendanceAPI.getAdminToday()
      .then(({ data }) => {
        const rows = data.data?.employees || [];
        // A person is working only while their attendance session is open.
        // Completed (checked-out) attendance must render as Offline.
        const working = new Set();
        rows.filter((r) => r.checkIn && !r.checkOut).forEach((r) => {
          if (r.userId) working.add(String(r.userId));
          if (r.user?._id) working.add(String(r.user._id));
          if (r.user) working.add(String(r.user));
          if (r._id) working.add(String(r._id));
        });
        if (mounted) setWorkingUserIds(working);
      })
      .catch(() => {})
      .finally(() => { if (mounted) setAttendanceLoading(false); });
    return () => { mounted = false; };
  }, []);

  // ── Auto-fetch ALL employees when records load ─────────────────────────────
  // Ensures Total Clicks and Work Hours in the stat cards always reflect
  // every employee, not just whichever one is currently selected.
  // Each employee's data is now automatically shift-filtered by the backend,
  // so shared-PC employees only contribute their own shift's log lines.
  useEffect(() => {
    if (records.length === 0) return;
    records.forEach((record) => {
      const emp = record.employee || {};
      const id = emp._id || emp.id || record._id;
      if (!id || inFlightRef.current.has(id)) return;
      inFlightRef.current.add(id);

      fetchAndBuildCache(id)
        .then((result) => {
          setParsedCache((prev) => ({ ...prev, [id]: result }));
        })
        .catch(() => {
          setParsedCache((prev) => ({ ...prev, [id]: null }));
        });
    });
  }, [records]);

  // ── Manual fetch for a single employee (on click if not yet loaded) ─────────
  const fetchAndParseEmployee = useCallback((employeeId) => {
    if (!employeeId || inFlightRef.current.has(employeeId)) return;
    inFlightRef.current.add(employeeId);
    setLoadingContent(true);
    fetchAndBuildCache(employeeId)
      .then((result) => setParsedCache((prev) => ({ ...prev, [employeeId]: result })))
      .catch(() => setParsedCache((prev) => ({ ...prev, [employeeId]: null })))
      .finally(() => setLoadingContent(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    if (!inFlightRef.current.has(selectedId)) {
      fetchAndParseEmployee(selectedId);
    }
  }, [selectedId, fetchAndParseEmployee]);

  // ── Derived stat card values — always across ALL employees in cache ─────────
  // Active count driven by attendance API, not time-based heuristic
  const activeCount = useMemo(
    () => workingUserIds.size,
    [workingUserIds]
  );

  // Total Clicks — aggregated across ALL employees (each employee's data is
  // already shift-filtered by the server, so shared-PC entries aren't double-counted)
  // Scoped to the applied date range when one is set.
  const totalClicks = useMemo(() => {
    return Object.values(parsedCache).reduce((sum, cache) => {
      if (!cache?.buckets) return sum;
      const filtered = filterBucketsByRange(cache.buckets, appliedRange.start, appliedRange.end, appliedRange.startTime, appliedRange.endTime);
      return sum + computeTotals(Object.values(filtered).flat()).clicks;
    }, 0);
  }, [parsedCache, appliedRange]);

  // Work Hours — aggregated across ALL employees, scoped to the applied date range.
  const totalWorkSeconds = useMemo(() => {
    return Object.values(parsedCache).reduce((sum, cache) => {
      if (!cache?.buckets) return sum;
      const filtered = filterBucketsByRange(cache.buckets, appliedRange.start, appliedRange.end, appliedRange.startTime, appliedRange.endTime);
      return sum + computeTotals(Object.values(filtered).flat()).workSeconds;
    }, 0);
  }, [parsedCache, appliedRange]);

  // Day-over-day change (today vs. yesterday) — aggregated across ALL employees,
  // used for the Total Clicks / Work Hours trend badges up top.
  const aggregateDayOverDay = useMemo(() => {
    let todayClicks = 0, yesterdayClicks = 0, todayWork = 0, yesterdayWork = 0;
    Object.values(parsedCache).forEach((cache) => {
      if (!cache?.buckets) return;
      const todayTotals = computeTotals(cache.buckets[getTodayDateStr()] || []);
      const yesterdayTotals = computeTotals(cache.buckets[getYesterdayDateStr()] || []);
      todayClicks += todayTotals.clicks;
      yesterdayClicks += yesterdayTotals.clicks;
      todayWork += todayTotals.workSeconds;
      yesterdayWork += yesterdayTotals.workSeconds;
    });
    return {
      clicks: computeChangePct(todayClicks, yesterdayClicks),
      workSeconds: computeChangePct(todayWork, yesterdayWork),
    };
  }, [parsedCache]);

  const selectedCache = selectedId ? parsedCache[selectedId] : null;

  // Selected employee's cache, recomputed for the applied date range.
  // Falls through to undefined/null so existing loading/empty-state checks
  // (`cache === undefined`, `!cache`) keep working unchanged.
  const selectedRangeSummary = useMemo(() => {
    if (!selectedCache) return selectedCache;
    return computeRangeSummary(selectedCache, appliedRange.start, appliedRange.end, appliedRange.startTime, appliedRange.endTime);
  }, [selectedCache, appliedRange]);

  // Day-over-day change for the selected employee's 5 stat tiles.
  // Always compares today vs. yesterday from the full (unfiltered) history —
  // this is a trend indicator, independent of the chosen date range.
  const selectedDayOverDay = useMemo(() => {
    if (!selectedCache?.buckets) return null;
    return computeDayOverDay(selectedCache.buckets);
  }, [selectedCache]);

  // ── Chart: selected employee (range-scoped), or aggregate across all loaded ─
  const chartData = useMemo(() => {
    if (selectedRangeSummary?.chartData) return selectedRangeSummary.chartData;
    const days = enumerateDateRange(appliedRange.start, appliedRange.end);
    const dayMap = {};
    days.forEach((date) => { dayMap[date] = { Work: 0, Entertainment: 0 }; });
    Object.values(parsedCache).forEach((cache) => {
      if (!cache?.buckets) return;
      Object.entries(cache.buckets).forEach(([date, entries]) => {
        if (!dayMap[date]) return;
        const t = computeTotals(entries);
        dayMap[date].Work += t.workSeconds / 3600;
        dayMap[date].Entertainment += t.entertainmentSeconds / 3600;
      });
    });
    return days
      .map((date) => ({
        date,
        label: formatDayLabel(date),
        Work: parseFloat((dayMap[date]?.Work || 0).toFixed(2)),
        Entertainment: parseFloat((dayMap[date]?.Entertainment || 0).toFixed(2)),
      }))
      .filter((d) => d.Work > 0 || d.Entertainment > 0);
  }, [selectedRangeSummary, parsedCache, appliedRange]);

  // ── Refresh ────────────────────────────────────────────────────────────────
  const handleRefresh = () => {
    inFlightRef.current = new Set();
    setParsedCache({});
    fetchRecords();
  };

  // ── Expose selected employee's stats to parent (e.g. ActivityLogs) ─────────
  // Lets the embedding page render the "Selected Employee Stats Card" tiles
  // itself, using the same cache/rangeSummary this component already computes.
  useEffect(() => {
    if (!onSelectedStatsChange) return;
    const rangeHasData = !!selectedRangeSummary && selectedRangeSummary.totals.totalSeconds > 0;
    onSelectedStatsChange({
      selectedId,
      cache: selectedCache,
      rangeSummary: selectedRangeSummary,
      rangeHasData,
      hasRangeFilter,
      rangeLabel: formatRangeLabel(appliedRange.start, appliedRange.end, appliedRange.startTime, appliedRange.endTime),
      dayOverDay: selectedDayOverDay,
      retry: () => {
        if (!selectedId) return;
        inFlightRef.current.delete(selectedId);
        fetchAndParseEmployee(selectedId);
      },
    });
  }, [
    onSelectedStatsChange,
    selectedId,
    selectedCache,
    selectedRangeSummary,
    hasRangeFilter,
    appliedRange,
    selectedDayOverDay,
    fetchAndParseEmployee,
  ]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <RefreshCw className="w-6 h-6 animate-spin text-primary-400" />
          <p className="text-sm">Loading work analytics…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card rounded-3xl border border-red-200/30 bg-red-50/10 p-8 text-center text-red-400">
        <p className="font-semibold">Failed to load activity data</p>
        <p className="text-sm mt-1 text-red-400/70">{error}</p>
        <button
          type="button"
          onClick={handleRefresh}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-red-500/10 px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 transition"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      {!embedded && <div className="glass-card rounded-3xl border border-white/10 p-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Activity Logs</h1>
          <p className="text-sm text-slate-400 mt-1">Monitor employee activity, productivity, and detailed work patterns in one place.</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-800/60 px-4 py-2 text-xs text-slate-300 hover:text-white hover:border-white/20 transition"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>}

      {/* Organisation summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard index={0} icon={Activity} label="Active Now" value={activeCount} sub="Currently checked in" color="bg-emerald-500/15 text-emerald-400" />
        <StatCard
          index={1}
          icon={Clock}
          label="Work Hours"
          value={totalWorkSeconds > 0 ? formatHoursDecimal(totalWorkSeconds) : '--'}
          sub={hasRangeFilter ? formatRangeLabel(appliedRange.start, appliedRange.end, appliedRange.startTime, appliedRange.endTime) : `All ${records.length} employees`}
          color="bg-violet-500/15 text-violet-400"
          trend={aggregateDayOverDay.workSeconds}
        />
        <StatCard
          index={2}
          icon={MousePointerClick}
          label="Total Clicks"
          value={totalClicks > 0 ? totalClicks.toLocaleString() : '--'}
          sub={hasRangeFilter ? formatRangeLabel(appliedRange.start, appliedRange.end, appliedRange.startTime, appliedRange.endTime) : `All ${records.length} employees`}
          color="bg-blue-500/15 text-blue-400"
          trend={aggregateDayOverDay.clicks}
        />
        <StatCard index={3} icon={Users} label="Employees" value={records.length} sub={`${activeCount} active right now`} color="bg-amber-500/15 text-amber-400" />
      </div>

      {/* Date Range Filter */}
      <div className="glass-card rounded-3xl border border-white/10 p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-slate-400">From</label>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={rangeStart}
              max={rangeEnd || getTodayDateStr()}
              onChange={(e) => setRangeStart(e.target.value)}
              className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
            <input
              type="time"
              value={rangeStartTime}
              onChange={(e) => setRangeStartTime(e.target.value)}
              aria-label="From time"
              title="From time"
              className="rounded-xl border border-white/10 bg-slate-900/60 px-2.5 py-2 text-sm text-white [color-scheme:dark]"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-slate-400">To</label>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={rangeEnd}
              min={rangeStart || undefined}
              max={getTodayDateStr()}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
            <input
              type="time"
              value={rangeEndTime}
              onChange={(e) => setRangeEndTime(e.target.value)}
              aria-label="To time"
              title="To time"
              className="rounded-xl border border-white/10 bg-slate-900/60 px-2.5 py-2 text-sm text-white [color-scheme:dark]"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleApplyRange}
          disabled={!rangeStart && !rangeEnd}
          className="inline-flex items-center gap-2 rounded-full bg-primary-500/20 border border-primary-400/30 px-4 py-2 text-xs font-medium text-primary-300 hover:bg-primary-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Apply dates
        </button>

        {hasRangeFilter && (
          <button
            type="button"
            onClick={handleClearRange}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-800/60 px-3 py-2 text-xs font-medium text-slate-300 hover:border-white/20 hover:bg-slate-700/70 hover:text-white transition"
          >
            Clear
          </button>
        )}

        {hasTimeFilter && (
          <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 border border-cyan-400/20 px-2.5 py-1 text-[10px] font-medium text-cyan-300">
            Time filtered
          </span>
        )}

        {/* Quick presets */}
        <div className="flex items-center gap-1.5 ml-1">
          {[
            ['today', 'Today'],
            ['7d', '7 Days'],
            ['30d', '30 Days'],
            ['all', 'All time'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyRangePreset(key)}
              aria-pressed={activePreset === key}
              className={clsx(
                'rounded-full border px-3 py-1.5 text-[11px] font-medium transition',
                activePreset === key
                  ? 'border-primary-400/50 bg-primary-500/25 text-primary-200 shadow-sm shadow-primary-500/20'
                  : 'border-white/10 bg-slate-800/60 text-slate-300 hover:border-white/20 hover:text-white'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto text-[11px] text-slate-500">
          Showing <span className="text-slate-300 font-medium">{formatRangeLabel(appliedRange.start, appliedRange.end, appliedRange.startTime, appliedRange.endTime)}</span>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-5 items-start">

        {/* Employee List */}
        <div className="glass-card rounded-3xl border border-white/10 bg-white/80 dark:bg-slate-950/80 p-4">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Employees</p>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Latest logs</h2>
            </div>
            <span className="text-[11px] text-slate-500 rounded-full bg-slate-100/80 dark:bg-slate-800/60 px-2.5 py-1">
              {records.length} total
            </span>
          </div>

          <div className="space-y-2.5 max-h-[940px] overflow-y-auto pr-1">
            {records.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200/70 dark:border-white/10 text-slate-500 text-sm">
                No activity logs yet.
              </div>
            ) : (
              records.map((record) => {
                const emp = record.employee || {};
                const recordId = emp._id || emp.id || record._id;
                const isSelected = recordId === selectedId;
                const profile = getEmployeeProfile(record);
                // Determine working status from attendance API only — no time-based fallback
                // which can falsely mark recently-logged-but-offline employees as Working.
                const empUserId = record.employee?.user?._id
                  || (typeof record.employee?.user === 'string' ? record.employee?.user : null);
                const active = !attendanceLoading && !!empUserId && workingUserIds.has(String(empUserId));
                const cache = parsedCache[recordId];
                const lastEntry = cache?.lastEntry;

                return (
                  <button
                    key={recordId}
                    type="button"
                    onClick={() => selectEmployee(recordId)}
                    className={clsx(
                      'w-full text-left rounded-2xl border px-4 py-3.5 transition group',
                      isSelected
                        ? 'border-primary-400/60 bg-primary-50/80 dark:border-primary-500/30 dark:bg-primary-500/10'
                        : 'border-slate-200/60 bg-white/60 dark:border-white/8 dark:bg-slate-950/60 hover:border-slate-300 dark:hover:border-white/15'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="relative shrink-0 mt-0.5">
                        {profile.avatar ? (
                          <img src={profile.avatar} alt={profile.name} className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                            {profile.initials}
                          </div>
                        )}
                        {active && (
                          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-slate-950 bg-emerald-400" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{profile.name}</p>
                          {active ? (
                            <span className="shrink-0 text-[10px] rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 px-2 py-0.5 font-medium">Working</span>
                          ) : (
                            <span className="shrink-0 text-[10px] rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800/10 dark:text-slate-300 px-2 py-0.5 font-medium">Offline</span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {profile.employeeId}{profile.department ? ` • ${profile.department}` : ''}
                        </p>

                        {lastEntry ? (
                          <div className="mt-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 px-3 py-2 text-[11px]">
                            <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                              <span className="font-mono">{lastEntry.time}</span>
                              <span>·</span>
                              <span className={clsx(
                                'rounded px-1.5 py-0.5 font-medium',
                                isWorkEntry(lastEntry) && isActiveEntry(lastEntry)
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                                  : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
                              )}>
                                {isWorkEntry(lastEntry) && isActiveEntry(lastEntry) ? 'Work' : 'Entertainment'}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-slate-700 dark:text-slate-300" title={lastEntry.windowTitle}>
                              {lastEntry.windowTitle}
                            </p>
                            <p className="text-slate-400 dark:text-slate-500 truncate">{lastEntry.process || inferProcess(lastEntry)}</p>
                          </div>
                        ) : cache === undefined ? (
                          <div className="mt-2 h-10 rounded-xl bg-slate-100/60 dark:bg-slate-800/40 animate-pulse" />
                        ) : (
                          <div className="mt-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 px-3 py-2 text-[11px] text-slate-400 italic">
                            {record.lastUpdated
                              ? new Date(record.lastUpdated).toLocaleString('en-US', DATE_FORMAT)
                              : 'No log data loaded'}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="space-y-5">

          {/* When embedded inside ActivityLogs, the caller's "Selected employee"
              section (header, stat tiles, charts, log list, screenshots button)
              renders here — right beside the Employee List column above. */}
          {embedded && children}

          {/* Removed duplicate overview chart; detailed hourly activity remains in Activity Logs. */}
{/* (duplicate overview chart removed) */}

          {/* Selected Employee Detail — only in standalone mode; when embedded,
              ActivityLogs renders these stat tiles itself (see onSelectedStatsChange). */}
          <AnimatePresence mode="wait">
            {!embedded && selectedId && (
              <motion.div
                key={selectedId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="glass-card rounded-3xl border border-white/10 bg-white/80 dark:bg-slate-950/80 p-5"
              >
              {(() => {
                const record = records.find((r) => {
                  const emp = r.employee || {};
                  return (emp._id || emp.id || r._id) === selectedId;
                });
                if (!record) return null;
                const profile = getEmployeeProfile(record);
                const cache = parsedCache[selectedId];
                // Totals/tiles below are scoped to the applied date range
                // (falls back to all-time when no range has been applied).
                const rangeSummary = cache ? computeRangeSummary(cache, appliedRange.start, appliedRange.end, appliedRange.startTime, appliedRange.endTime) : cache;
                const rangeHasData = !!rangeSummary && rangeSummary.totals.totalSeconds > 0;
                const detailEmpUserId = record.employee?.user?._id
                  || (typeof record.employee?.user === 'string' ? record.employee?.user : null);
                const active = !attendanceLoading && !!detailEmpUserId && workingUserIds.has(String(detailEmpUserId));

                return (
                  <>
                    {/* Employee header */}
                    <div className="flex items-center gap-4 mb-5">
                      <div className="relative shrink-0">
                        {profile.avatar ? (
                          <img src={profile.avatar} alt={profile.name} className="h-12 w-12 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800 text-sm font-bold text-slate-600 dark:text-slate-300">
                            {profile.initials}
                          </div>
                        )}
                        {active && (
                          <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-slate-950 bg-emerald-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 mb-1">Selected Employee</p>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">{profile.name}</h3>
                          {active && (
                            <span className="shrink-0 text-[10px] rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 px-2 py-0.5 font-medium">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {profile.employeeId}{profile.department ? ` · ${profile.department}` : ''}
                          {profile.stationLabel !== '—' ? ` · ${profile.stationLabel}` : ''}
                        </p>
                        {record.lastUpdated && (
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Last seen {new Date(record.lastUpdated).toLocaleString('en-US', DATE_FORMAT)}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* 5 Stat Tiles */}
                    {cache && hasRangeFilter && !rangeHasData ? (
                      <div className="rounded-2xl border border-dashed border-slate-200/70 dark:border-white/10 p-6 text-center text-slate-500 text-sm">
                        No activity logs for {profile.name} in {formatRangeLabel(appliedRange.start, appliedRange.end, appliedRange.startTime, appliedRange.endTime)}.
                      </div>
                    ) : cache ? (
                      <motion.div
                        key={selectedId}
                        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"
                        initial="hidden"
                        animate="show"
                        variants={{
                          hidden: {},
                          show: { transition: { staggerChildren: 0.05 } },
                        }}
                      >
                        {/* Work time */}
                        <motion.div
                          variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                          className="rounded-2xl bg-blue-50 dark:bg-blue-500/10 p-3 text-center relative"
                        >
                          <div className="absolute top-2 right-2">
                            <TrendBadge change={selectedDayOverDay?.workSeconds} />
                          </div>
                          <Briefcase className="w-4 h-4 text-blue-500 mx-auto mb-1" />
                          <p className="text-lg font-bold text-blue-700 dark:text-blue-300">
                            {formatDuration(rangeSummary.totals.workSeconds)}
                          </p>
                          <p className="text-[10px] text-blue-500/80 uppercase tracking-wide font-medium">Work</p>
                        </motion.div>
                        {/* Entertainment */}
                        <motion.div
                          variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                          className="rounded-2xl bg-rose-50 dark:bg-rose-500/10 p-3 text-center relative"
                        >
                          <div className="absolute top-2 right-2">
                            <TrendBadge change={selectedDayOverDay?.entertainmentSeconds} />
                          </div>
                          <Gamepad2 className="w-4 h-4 text-rose-500 mx-auto mb-1" />
                          <p className="text-lg font-bold text-rose-700 dark:text-rose-300">
                            {formatDuration(rangeSummary.totals.entertainmentSeconds)}
                          </p>
                          <p className="text-[10px] text-rose-500/80 uppercase tracking-wide font-medium">Entertainment</p>
                        </motion.div>
                       
                        {/* Keystrokes */}
                        <motion.div
                          variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                          className="rounded-2xl bg-cyan-50 dark:bg-cyan-500/10 p-3 text-center relative"
                        >
                          <div className="absolute top-2 right-2">
                            <TrendBadge change={selectedDayOverDay?.keystrokes} />
                          </div>
                          <Keyboard className="w-4 h-4 text-cyan-500 mx-auto mb-1" />
                          <p className="text-lg font-bold text-cyan-700 dark:text-cyan-300">
                            {rangeSummary.totals.keystrokes.toLocaleString()}
                          </p>
                          <p className="text-[10px] text-cyan-500/80 uppercase tracking-wide font-medium">Keystrokes</p>
                        </motion.div>
                        {/* Clicks */}
                        <motion.div
                          variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                          className="rounded-2xl bg-violet-50 dark:bg-violet-500/10 p-3 text-center relative"
                        >
                          <div className="absolute top-2 right-2">
                            <TrendBadge change={selectedDayOverDay?.clicks} />
                          </div>
                          <MousePointerClick className="w-4 h-4 text-violet-500 mx-auto mb-1" />
                          <p className="text-lg font-bold text-violet-700 dark:text-violet-300">
                            {rangeSummary.totals.clicks.toLocaleString()}
                          </p>
                          <p className="text-[10px] text-violet-500/80 uppercase tracking-wide font-medium">Clicks</p>
                        </motion.div>
                         {/* Active duration */}
                        <motion.div
                          variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                          className="rounded-2xl bg-amber-50 dark:bg-amber-500/10 p-3 text-center relative"
                        >
                          <div className="absolute top-2 right-2">
                            <TrendBadge change={selectedDayOverDay?.totalSeconds} />
                          </div>
                          <Clock className="w-4 h-4 text-amber-500 mx-auto mb-1" />
                          <p className="text-lg font-bold text-amber-700 dark:text-amber-300">
                            {formatDuration(rangeSummary.totals.totalSeconds)}
                          </p>
                          <p className="text-[10px] text-amber-500/80 uppercase tracking-wide font-medium">Active Duration</p>
                        </motion.div>
                        {/* Total Hours */}
                        <motion.div
                          variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                          className="rounded-2xl bg-teal-50 dark:bg-teal-500/10 p-3 text-center relative"
                        >
                          <div className="absolute top-2 right-2">
                            <TrendBadge change={selectedDayOverDay?.totalSeconds} />
                          </div>
                          <Timer className="w-4 h-4 text-teal-500 mx-auto mb-1" />
                          <p className="text-lg font-bold text-teal-700 dark:text-teal-300">
                            {formatHoursDecimal(rangeSummary.totals.totalSeconds)}
                          </p>
                          <p className="text-[10px] text-teal-500/80 uppercase tracking-wide font-medium">Total Hours</p>
                        </motion.div>
                      </motion.div>
                    ) : cache === undefined ? (
                      /* Loading skeleton — 6 placeholders */
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                          <div key={i} className="rounded-2xl bg-slate-100/60 dark:bg-slate-800/40 h-20 animate-pulse" />
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200/70 dark:border-white/10 p-6 text-center text-slate-500 text-sm">
                        <p>No log data available for this employee.</p>
                        <button
                          type="button"
                          onClick={() => {
                            inFlightRef.current.delete(selectedId);
                            fetchAndParseEmployee(selectedId);
                          }}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-4 py-2 text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Retry
                        </button>
                      </div>
                    )}

                    {/* Work efficiency bar */}
                    {cache && rangeHasData && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1.5">
                          <span>Work efficiency</span>
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            {Math.round((rangeSummary.totals.workSeconds / rangeSummary.totals.totalSeconds) * 100)}% productive
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all duration-700"
                            style={{ width: `${Math.round((rangeSummary.totals.workSeconds / rangeSummary.totals.totalSeconds) * 100)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                          <span className="flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />Work
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />Entertainment
                          </span>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}