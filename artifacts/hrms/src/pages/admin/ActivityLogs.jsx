import { useCallback, useEffect, useMemo, useState } from 'react';
import { activityLogAPI } from '@/services/api';
import {
  ClipboardList, Search, Clock, ChevronDown, CalendarDays, X,
  Youtube, Chrome, Globe, Terminal, Code, Monitor, AppWindow, Filter, RefreshCw, Hourglass,
  Facebook, Instagram, MessageCircle, Linkedin, Mail,
  MousePointerClick, Keyboard, Timer, Activity, Loader2, Eye, ZoomIn, ZoomOut, RotateCcw,
  Briefcase, Gamepad2, TrendingUp, TrendingDown, Minus, Trash2, AlertTriangle,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import ActivityDashboard from './ActivityDashboard';

const DATE_FORMAT_OPTIONS = {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
};

// Screenshot agents submit the workstation's wall-clock capture time. Keep it
// in that recorded time zone when displaying screenshots instead of applying
// the admin browser's UTC offset.
const SCREENSHOT_DATE_FORMAT_OPTIONS = {
  ...DATE_FORMAT_OPTIONS,
  timeZone: 'UTC',
};
const SCREENSHOT_TIME_FORMAT_OPTIONS = {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'UTC',
};

// System-wide screenshot storage, summed server-side from each screenshot's
// real stored byte size (not an estimate) — see getScreenshotStorageStats.
const STORAGE_CAP_BYTES = 3 * 1024 * 1024 * 1024; // 3 GB

function formatStorageSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

// Green while there's plenty of headroom, amber as it fills up, red once
// storage is nearly maxed out against the 3GB cap.
function getStorageBarStyle(percent) {
  if (percent >= 90) {
    return {
      bar: 'bg-gradient-to-r from-rose-500 to-red-600',
      text: 'text-red-600 dark:text-red-400',
      chip: 'bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400',
    };
  }
  if (percent >= 70) {
    return {
      bar: 'bg-gradient-to-r from-amber-400 to-orange-500',
      text: 'text-amber-600 dark:text-amber-400',
      chip: 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400',
    };
  }
  return {
    bar: 'bg-gradient-to-r from-emerald-400 to-teal-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    chip: 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400',
  };
}

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
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    return hours * 3600 + minutes * 60 + seconds;
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

// ─── Duration / gap helpers ───────────────────────────────────────────────────
const MAX_GAP_SECONDS = 300;

function timeToSeconds(timeStr) {
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
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

// ─── Trend Badge (used by the Selected Employee stat tiles) ──────────────────

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

// ─── Shift Filtering ─────────────────────────────────────────────────────────
//
// NOTE: The backend now pre-filters log text by shift window (see
// Activitylog.controller.js → getEmployeeLogHistory).  These helpers are kept
// here for:
//   1. Computing the "Shift: HH:MM – HH:MM" badge shown in the UI header.
//   2. A lightweight client-side safety-net for edge cases where filteredText
//      is unavailable (e.g. no shift assignments, or older server version).
//
function isTimeInShift(timeStr, startTime, endTime, crossDay) {
  if (!startTime || !endTime) return true;
  const entryMin = timeToSeconds(timeStr) / 60;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (!crossDay) return entryMin >= startMin && entryMin <= endMin;
  return entryMin >= startMin || entryMin <= endMin;
}

function getShiftForDate(dateStr, assignments) {
  const d = new Date(`${dateStr}T00:00:00`);
  const weekday = d.getDay();
  for (const asgn of assignments) {
    if (asgn.status && asgn.status !== 'active') continue;
    if (asgn.recurring) {
      if (asgn.weekday === weekday) return asgn;
    } else {
      const start = new Date(asgn.startDate);
      const end = new Date(asgn.endDate);
      const check = new Date(`${dateStr}T00:00:00`);
      if (check >= start && check <= end) return asgn;
    }
  }
  return null;
}

// ─── Main log grouper ─────────────────────────────────────────────────────────
// Parses raw log text (all three formats), groups by date.
// When `shiftAssignments` is provided AND the text was NOT already server-filtered
// (shiftPreFiltered === false), applies client-side shift filtering as a fallback.
function groupLogsByDate(rawText, shiftAssignments, shiftPreFiltered = false) {
  if (!rawText) return [];

  const buckets = {};
  const unparsedLines = [];

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
      return;
    }

    // Try to parse as a log entry (passes ctx for Format C)
    const parsed = parseLogLine(trimmed, ctx);
    if (!parsed) {
      unparsedLines.push(line);
      ctx.time = null;
      return;
    }

    if (parsed.date && parsed.date !== 'Unknown') ctx.date = parsed.date;
    ctx.time = null;

    if (!buckets[parsed.date]) buckets[parsed.date] = [];
    buckets[parsed.date].push(parsed);
  });

  const groups = Object.entries(buckets)
    .map(([date, entries]) => {
      const sorted = entries.sort((a, b) => a.time.localeCompare(b.time));
      const withDurations = computeDurations(sorted);

      // Only apply client-side shift filtering when the server did NOT pre-filter
      // (i.e. employee has no shift assignments configured → shiftPreFiltered is false)
      let filtered = withDurations;
      if (!shiftPreFiltered && shiftAssignments && shiftAssignments.length > 0) {
        const shift = getShiftForDate(date, shiftAssignments);
        if (shift) {
          filtered = withDurations.filter((entry) =>
            isTimeInShift(entry.time, shift.startTime, shift.endTime, shift.crossDay)
          );
        }
      }

      return { date, entries: filtered };
    })
    .filter((g) => g.entries.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (unparsedLines.length > 0) {
    groups.push({ date: 'Unrecognized lines', entries: unparsedLines.map((raw) => ({ raw })) });
  }

  return groups;
}

function formatDateLabel(dateStr) {
  if (dateStr === 'Unrecognized lines') return dateStr;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── Categorisation ───────────────────────────────────────────────────────────
const BROWSER_PROCESSES = { 'chrome.exe': 'Chrome', 'msedge.exe': 'Edge', 'firefox.exe': 'Firefox' };
const TERMINAL_PROCESSES = new Set(['cmd.exe', 'powershell.exe', 'pwsh.exe', 'windowsterminal.exe', 'wt.exe', 'bash.exe']);
const SYSTEM_PROCESSES = new Set(['explorer.exe', 'dwm.exe', 'svchost.exe', 'taskmgr.exe', 'winlogon.exe', 'searchhost.exe', 'textinputhost.exe', 'shellexperiencehost.exe']);
const CODE_EDITOR_PROCESSES = new Set(['code.exe', 'code - insiders.exe']);

const NATIVE_APP_PROCESSES = {
  'whatsapp.exe': { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, badge: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400' },
};

const SITE_CATEGORIES = [
  { key: 'youtube',    label: 'YouTube',     match: (t) => t.includes('youtube'),    icon: Youtube,        badge: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400' },
  { key: 'facebook',   label: 'Facebook',    match: (t) => t.includes('facebook'),   icon: Facebook,       badge: 'bg-blue-50 text-blue-700 dark:bg-blue-600/10 dark:text-blue-400' },
  { key: 'instagram',  label: 'Instagram',   match: (t) => t.includes('instagram'),  icon: Instagram,      badge: 'bg-pink-50 text-pink-600 dark:bg-pink-500/10 dark:text-pink-400' },
  { key: 'whatsapp',   label: 'WhatsApp',    match: (t) => t.includes('whatsapp'),   icon: MessageCircle,  badge: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400' },
  { key: 'twitter',    label: 'Twitter / X', match: (t) => t.includes('twitter') || t.includes(' / x'), icon: Globe, badge: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200' },
  { key: 'linkedin',   label: 'LinkedIn',    match: (t) => t.includes('linkedin'),   icon: Linkedin,       badge: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400' },
  { key: 'gmail',      label: 'Gmail',       match: (t) => t.includes('gmail') || t.includes('mail.google.com'), icon: Mail, badge: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' },
  { key: 'slack',      label: 'Slack',       match: (t) => t.includes('slack'),      icon: MessageCircle,  badge: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400' },
  { key: 'voxility',   label: 'Voxility',    match: (t) => t.includes('voxility'),   icon: Globe,          badge: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200' },
  { key: 'glitchgone', label: 'GlitchGone',  match: (t) => t.includes('glitchgone'), icon: Globe,          badge: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200' },
];

function isCRMSite(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  if (t.startsWith('http') || t.includes('app.')) return true;
  const crmKeywords = [
    'gohighlevel', 'ghl', 'hubspot', 'salesforce', 'pipedrive', 'zoho', 'freshsales',
    'keap', 'infusionsoft', 'mycrm', 'crm', 'glitchgone', 'taftsystems', 'voxility', 'slack',
    'highlevel', 'app.voxility', 'app.gohighlevel', 'voximity', 'app.slack',
    'localhost', '127.0.0.1',
    'xovera', 'digitlc', 'support@customersuccess.rocks', 'profit lifter', 'growthable', 'wix',
    'email',
  ];
  return crmKeywords.some((k) => t.includes(k.toLowerCase()));
}

// For Format C logs where process is null, infer from window title
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

// Idle time is NOT reclassified as Entertainment the instant it happens — a
// brief pause (a few seconds between keystrokes) still counts as Work. Only
// once a *continuous* idle stretch on a work app has run for
// IDLE_TO_ENTERTAINMENT_SECONDS or longer does that whole stretch flip to
// Entertainment. So a 12s idle gap before the next active entry stays Work;
// a 6-minute idle gap becomes Entertainment. Social-media entries are
// unaffected — they're Entertainment whether active or idle, same as before.
// Mirrors the identical helpers in ActivityDashboard.jsx so both screens agree.
const IDLE_TO_ENTERTAINMENT_SECONDS = 300; // 5 minutes

// Walks a chronologically-sorted list of entries and tags each one Work or
// Entertainment, resolving idle streaks by their total length rather than
// entry-by-entry. A streak only continues while entries are genuinely
// back-to-back in time on the same date — a gap (e.g. from a time-of-day
// filter, or entries from a different day) starts a fresh streak instead of
// silently merging two unrelated idle periods into one.
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

function categorizeEntry(entry) {
  const process = inferProcess(entry) || '';
  const title = (entry.windowTitle || '').toLowerCase();

  if (NATIVE_APP_PROCESSES[process]) return NATIVE_APP_PROCESSES[process];

  const isBrowser = !!BROWSER_PROCESSES[process] || title.includes('google chrome') || title.includes('firefox') || title.includes('microsoft edge');

  if (isBrowser) {
    if (isCRMSite(title)) {
      return { key: 'crm', label: 'CRM / Work', icon: ClipboardList, badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' };
    }
    const site = SITE_CATEGORIES.find((s) => s.match(title));
    if (site) return site;
    const browserLabel = BROWSER_PROCESSES[process] || 'Browser';
    return { key: process || 'browser', label: browserLabel, icon: Chrome, badge: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' };
  }

  if (TERMINAL_PROCESSES.has(process)) return { key: 'terminal', label: 'Terminal', icon: Terminal, badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' };
  if (CODE_EDITOR_PROCESSES.has(process)) return { key: 'vscode', label: 'VS Code', icon: Code, badge: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400' };
  if (SYSTEM_PROCESSES.has(process)) return { key: 'system', label: 'System', icon: Monitor, badge: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' };

  const fallbackLabel = entry.process
    ? entry.process.replace(/\.exe$/i, '')
    : (entry.windowTitle ? entry.windowTitle.split(' - ').pop()?.trim() : 'Other');
  return { key: process || 'other', label: fallbackLabel || 'Other', icon: AppWindow, badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' };
}

function groupEntriesByCategory(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    if (!entry.time) return;
    const cat = categorizeEntry(entry);
    if (!map.has(cat.key)) map.set(cat.key, { ...cat, entries: [], totalSeconds: 0 });
    const bucket = map.get(cat.key);
    bucket.entries.push(entry);
    bucket.totalSeconds += entry.durationSeconds || 0;
  });
  return Array.from(map.values()).sort((a, b) => b.totalSeconds - a.totalSeconds);
}

function groupEntriesByWindow(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    if (!entry.time) return;
    const key = `${entry.process || ''}||${entry.windowTitle}`;
    if (!map.has(key)) map.set(key, { key, windowTitle: entry.windowTitle, category: categorizeEntry(entry), totalSeconds: 0, count: 0 });
    const bucket = map.get(key);
    bucket.totalSeconds += entry.durationSeconds || 0;
    bucket.count += 1;
  });
  return Array.from(map.values()).sort((a, b) => b.totalSeconds - a.totalSeconds);
}

// ─── Chart helpers ────────────────────────────────────────────────────────────
function buildHourlyData(entries) {
  const hours = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    label: i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i - 12}p`,
    durationMin: 0,
    clicks: 0,
    keystrokes: 0,
  }));

  entries.forEach((entry) => {
    if (!entry.time) return;
    const h = parseInt(entry.time.split(':')[0], 10);
    if (h >= 0 && h < 24) {
      // Idle entries (no clicks/keystrokes/active%) don't count as active minutes,
      // even though they still have a recorded duration.
      if (isActiveEntry(entry)) hours[h].durationMin += (entry.durationSeconds ?? 0) / 60;
      hours[h].clicks += entry.clicks ?? 0;
      hours[h].keystrokes += entry.keystrokes ?? 0;
    }
  });

  const activeHours = hours.filter((h) => h.durationMin > 0 || h.clicks > 0 || h.keystrokes > 0);
  if (activeHours.length === 0) return hours.slice(8, 18);
  const minIdx = Math.max(0, activeHours[0].hour - 1);
  const maxIdx = Math.min(23, activeHours[activeHours.length - 1].hour + 1);
  return hours.slice(minIdx, maxIdx + 1);
}

// ─── Minute-level breakdown ───────────────────────────────────────────────────
// Logger entries land roughly every 30s, so once the selected window is
// narrow (e.g. a single hour) an hourly bucket collapses everything into one
// bar. This groups by minute instead and fills the gaps between the first
// and last active minute so the line reads as a continuous timeline.
function minuteLabel(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')}${period}`;
}

function buildMinuteData(entries) {
  const buckets = new Map(); // 'HH:MM' -> { durationMin, clicks, keystrokes }

  entries.forEach((entry) => {
    if (!entry.time) return;
    const key = entry.time.slice(0, 5);
    if (!buckets.has(key)) buckets.set(key, { durationMin: 0, clicks: 0, keystrokes: 0 });
    const bucket = buckets.get(key);
    // Idle entries (no clicks/keystrokes/active%) don't count as active minutes,
    // even though they still have a recorded duration.
    if (isActiveEntry(entry)) bucket.durationMin += (entry.durationSeconds ?? 0) / 60;
    bucket.clicks += entry.clicks ?? 0;
    bucket.keystrokes += entry.keystrokes ?? 0;
  });

  const keys = Array.from(buckets.keys()).sort();
  if (keys.length === 0) return [];

  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const fromMinutes = (mins) => {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const startMin = toMinutes(keys[0]);
  const endMin = toMinutes(keys[keys.length - 1]);

  const result = [];
  for (let m = startMin; m <= endMin; m++) {
    const key = fromMinutes(m);
    const bucket = buckets.get(key) || { durationMin: 0, clicks: 0, keystrokes: 0 };
    result.push({
      minuteKey: key,
      label: minuteLabel(key),
      durationMin: bucket.durationMin,
      clicks: bucket.clicks,
      keystrokes: bucket.keystrokes,
    });
  }
  return result;
}

// Decide whether a minute-by-minute or hour-by-hour breakdown is more useful:
// minute view only makes sense for a single day and a reasonably narrow span
// (otherwise the chart would need hundreds of points to stay readable).
const MINUTE_VIEW_MAX_SPAN_MINUTES = 180;

function pickChartGranularity(entries, startTime, endTime) {
  if (entries.length === 0) return 'hour';

  const distinctDates = new Set(entries.map((e) => e.date));
  if (distinctDates.size > 1) return 'hour';

  let spanMinutes;
  if (startTime && endTime) {
    const s = timeToSeconds(`${startTime}:00`);
    const e = timeToSeconds(`${endTime}:59`);
    spanMinutes = Math.abs(e - s) / 60;
  } else {
    const seconds = entries.filter((e) => e.time).map((e) => timeToSeconds(e.time));
    if (seconds.length === 0) return 'hour';
    spanMinutes = (Math.max(...seconds) - Math.min(...seconds)) / 60;
  }

  return spanMinutes <= MINUTE_VIEW_MAX_SPAN_MINUTES ? 'minute' : 'hour';
}

function HourlyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/95 px-3 py-2.5 text-xs shadow-xl backdrop-blur-sm">
      <p className="mb-1 font-semibold text-slate-200">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="font-medium text-white">
            {p.dataKey === 'durationMin' ? `${p.value.toFixed(1)}m` : p.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function InputTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/95 px-3 py-2.5 text-xs shadow-xl backdrop-blur-sm">
      <p className="mb-1 font-semibold text-slate-200">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="font-medium text-white">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, subValue, color, bgColor }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/60 dark:bg-slate-950/60 p-4 flex items-center gap-3 shadow-sm">
      <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', bgColor)}>
        <Icon className={clsx('h-5 w-5', color)} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
        <p className="text-xl font-bold text-slate-900 dark:text-white leading-tight">{value}</p>
        {subValue && <p className="text-[11px] text-slate-500">{subValue}</p>}
      </div>
    </div>
  );
}

function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/95 px-3 py-2 text-xs shadow-xl backdrop-blur-sm">
      <span className="font-medium text-white">{payload[0].name}: </span>
      <span className="text-slate-300">{formatDuration(payload[0].value)}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ActivityLogs({ embedded = false }) {
  const [records, setRecords] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [sharedRange, setSharedRange] = useState({ start: '', end: '' });
  const [logContent, setLogContent] = useState('');
  const [shiftAssignments, setShiftAssignments] = useState([]);
  // Whether the currently loaded logContent was already shift-filtered by the server.
  // When true, we skip the redundant client-side shift filter in groupLogsByDate.
  const [shiftPreFiltered, setShiftPreFiltered] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState(null);
  const [expandedDates, setExpandedDates] = useState(() => new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [activeTab, setActiveTab] = useState('work');
  const [showScreenshots, setShowScreenshots] = useState(false);
  const [screenshots, setScreenshots] = useState([]);
  const [loadingScreenshots, setLoadingScreenshots] = useState(false);
  const [screenshotsError, setScreenshotsError] = useState('');
  const [previewScreenshot, setPreviewScreenshot] = useState(null);
  const [screenshotZoom, setScreenshotZoom] = useState(1);
  const [deletingScreenshotId, setDeletingScreenshotId] = useState(null);
  const [deletingAllScreenshots, setDeletingAllScreenshots] = useState(false);
  // System-wide screenshot storage — every employee's screenshots combined,
  // not scoped to the selected employee or the date/time filter.
  const [storageStats, setStorageStats] = useState(null); // { count, totalBytes }
  const [loadingStorageStats, setLoadingStorageStats] = useState(true);
  // Selected employee's range-scoped stats (cache/rangeSummary/dayOverDay/retry),
  // reported up from the embedded ActivityDashboard for the stat tiles below.
  const [selectedStats, setSelectedStats] = useState(null);

  // The overview's range selector is the single date+time control for this page.
  useEffect(() => {
    setStartDate(sharedRange.start);
    setEndDate(sharedRange.end);
    setStartTime(sharedRange.startTime || '');
    setEndTime(sharedRange.endTime || '');
  }, [sharedRange]);

  // Fetched once on mount (system-wide, so it doesn't depend on which
  // employee is selected). Uses a real DB-side sum of each screenshot's
  // stored byte size, not an estimate.
  useEffect(() => {
    setLoadingStorageStats(true);
    activityLogAPI.getScreenshotStorageStats()
      .then(({ data }) => setStorageStats(data?.data || null))
      .catch(() => setStorageStats(null))
      .finally(() => setLoadingStorageStats(false));
  }, []);

  const storageUsage = useMemo(() => {
    const totalBytes = storageStats?.totalBytes || 0;
    const percent = Math.min(100, (totalBytes / STORAGE_CAP_BYTES) * 100);
    const dailyRateBytes = storageStats?.dailyRateBytes || 0;
    const bytesRemaining = Math.max(0, STORAGE_CAP_BYTES - totalBytes);
    // null = not enough recent activity to project a rate; 0 = already full.
    const daysRemaining = totalBytes >= STORAGE_CAP_BYTES
      ? 0
      : dailyRateBytes > 0
        ? Math.ceil(bytesRemaining / dailyRateBytes)
        : null;
    return { count: storageStats?.count || 0, totalBytes, percent, daysRemaining };
  }, [storageStats]);

  const openScreenshots = useCallback(() => {
    if (!selectedId) return;
    setShowScreenshots(true);
    setLoadingScreenshots(true);
    setScreenshotsError('');
    activityLogAPI.getScreenshots(selectedId)
      .then(({ data }) => setScreenshots(data.data || []))
      .catch((err) => {
        setScreenshots([]);
        setScreenshotsError(err?.response?.data?.message || 'Could not load screenshots.');
      })
      .finally(() => setLoadingScreenshots(false));
  }, [selectedId]);

  const deleteScreenshot = async (screenshot) => {
    if (!window.confirm('Delete this screenshot permanently? This cannot be undone. The image will also be removed from ImageKit.')) return;
    setDeletingScreenshotId(screenshot._id);
    try {
      await activityLogAPI.deleteScreenshot(screenshot._id);
      setScreenshots((current) => current.filter((item) => item._id !== screenshot._id));
      if (previewScreenshot?._id === screenshot._id) setPreviewScreenshot(null);
    } catch (error) {
      setScreenshotsError(error?.response?.data?.message || 'Could not delete screenshot.');
    } finally {
      setDeletingScreenshotId(null);
    }
  };

  const deleteAllScreenshots = async () => {
    if (!selectedId || !screenshots.length) return;
    if (!window.confirm(`Delete all ${screenshots.length} screenshots permanently? This cannot be undone. Every image will also be removed from ImageKit.`)) return;
    setDeletingAllScreenshots(true);
    try {
      await activityLogAPI.deleteAllScreenshots(selectedId);
      setScreenshots([]);
      setPreviewScreenshot(null);
    } catch (error) {
      setScreenshotsError(error?.response?.data?.message || 'Could not delete all screenshots.');
    } finally {
      setDeletingAllScreenshots(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (previewScreenshot) setPreviewScreenshot(null);
      else if (showScreenshots) setShowScreenshots(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewScreenshot, showScreenshots]);

  // Fetch all employee records once
  useEffect(() => {
    setLoadingRecords(true);
    activityLogAPI.getAll()
      .then(({ data }) => {
        const items = data.data || [];
        const map = new Map();
        items.forEach((record) => {
          const emp = record.employee || {};
          const id = emp._id || emp.id || record._id;
          if (!id) return;
          const existing = map.get(id);
          if (!existing) { map.set(id, record); return; }
          const aUpdated = existing.lastUpdated ? new Date(existing.lastUpdated) : new Date(0);
          const bUpdated = record.lastUpdated ? new Date(record.lastUpdated) : new Date(0);
          if (bUpdated > aUpdated) map.set(id, record);
        });
        const deduped = Array.from(map.values()).sort((a, b) => {
          const da = a.lastUpdated ? new Date(a.lastUpdated) : new Date(0);
          const db = b.lastUpdated ? new Date(b.lastUpdated) : new Date(0);
          return db - da;
        });
        setRecords(deduped);
        if (deduped.length > 0) {
          const firstId = deduped[0].employee?._id || deduped[0].employee?.id || deduped[0]._id;
          setSelectedId(firstId);
        }
      })
      .catch((err) => setError(err?.response?.data?.message || err.message || 'Failed to load activity logs'))
      .finally(() => setLoadingRecords(false));
  }, []);

  // Fetch shift assignments for the selected employee.
  // These are used for the "Shift: HH:MM – HH:MM" badge in the UI header.
  // The actual log filtering is now handled server-side; these assignments are
  // informational here (and a client-side fallback when server filtering is off).
  useEffect(() => {
    if (!selectedId) { setShiftAssignments([]); return; }
    fetch(`/api/v1/shift-assignments?employee=${selectedId}`, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setShiftAssignments(body.data || []))
      .catch(() => setShiftAssignments([]));
  }, [selectedId]);

  // CHANGED: fetchLogContent now prefers server-returned filteredText over a
  // raw Cloudinary fetch.  When the server has shift assignments configured for
  // this employee it returns pre-filtered text (shiftFiltered: true) — each
  // employee sharing a PC only sees log lines from their own shift window.
  const fetchLogContent = useCallback((employeeId) => {
    if (!employeeId) { setLogContent(''); setShiftPreFiltered(false); return; }
    setLoadingContent(true);
    activityLogAPI.getHistory(employeeId)
      .then(({ data }) => {
        const recs = data.data || [];
        if (recs.length === 0) {
          setLogContent('No log text available.');
          setShiftPreFiltered(false);
          return;
        }

        // Detect whether the server has already applied shift filtering.
        // (All records in the response share the same shiftFiltered flag.)
        const serverFiltered = recs.some((r) => r.shiftFiltered === true);
        setShiftPreFiltered(serverFiltered);

        return Promise.all(
          recs.map(async (r) => {
            if (r.filteredText != null) return r.filteredText;

            if (r.cloudinaryUrl && r.stationId) {
              try {
                const month = r.month;
                const { data: stationResp } = await activityLogAPI.getStationByShift(r.stationId, month);
                const byEmployee = stationResp.data?.byEmployee || {};
                const empEntry = byEmployee[employeeId];
                if (empEntry) return [...(empEntry.confirmed || []), ...(empEntry.scheduleInferred || [])].join('\n');
              } catch (e) {
                // ignore and fallback
              }
            }

            if (!r.cloudinaryUrl) return '';
            return fetch(r.cloudinaryUrl).then((res) => (res.ok ? res.text() : '')).catch(() => '');
          })
        ).then((texts) => {
          const merged = texts.filter(Boolean).join('\n');
          setLogContent(merged || 'No log text available.');
          setLastRefreshedAt(new Date());
        });
      })
      .catch(() => {
        setLogContent('No log text available.');
        setShiftPreFiltered(false);
      })
      .finally(() => setLoadingContent(false));
  }, []);

  useEffect(() => {
    setCategoryFilter('');
    fetchLogContent(selectedId);
  }, [selectedId, fetchLogContent]);

  const handleRefresh = () => { if (!loadingContent) fetchLogContent(selectedId); };

  const getEmployeeProfile = (record) => {
    const employee = record?.employee || {};
    const user = employee?.user || employee;
    const fullName = user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.name;
    const stationLabel = record?.stationLabel || record?.stationLabels?.[0] || record?.stationId || 'No station';
    return {
      avatar: user?.avatar || '',
      name: fullName || 'Unknown employee',
      employeeId: user?.employeeId || employee?.employeeId || 'No ID',
      stationLabel,
    };
  };

  const selectedRecord = useMemo(() => {
    return records.find((record) => {
      const id = record.employee?._id || record.employee?.id || record._id;
      return id === selectedId;
    });
  }, [records, selectedId]);

  const selectedProfile = selectedRecord ? getEmployeeProfile(selectedRecord) : null;

  // Group logs — multi-format parser + shift filtering.
  // shiftPreFiltered=true → server already narrowed the text; skip client filter.
  // shiftPreFiltered=false → no server shift filtering; apply client-side fallback.
  const groupedLogs = useMemo(
    () => groupLogsByDate(logContent, shiftAssignments, shiftPreFiltered),
    [logContent, shiftAssignments, shiftPreFiltered]
  );

  // This is the page-wide date/time filter. Every summary, chart and log list
  // below is derived from this collection.
  const effectiveStartDate = sharedRange.start || startDate;
  const effectiveEndDate = sharedRange.end || endDate;
  const rangeFilteredLogs = useMemo(() => {
    if (!groupedLogs || groupedLogs.length === 0) return [];
    return groupedLogs
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => {
          if (group.date === 'Unrecognized lines') return !effectiveStartDate && !effectiveEndDate;
          if (effectiveStartDate && group.date < effectiveStartDate) return false;
          if (effectiveEndDate && group.date > effectiveEndDate) return false;
          if (!entry.time || (!startTime && !endTime)) return true;

          const entrySeconds = timeToSeconds(entry.time);
          const startSeconds = startTime ? timeToSeconds(`${startTime}:00`) : null;
          const endSeconds = endTime ? timeToSeconds(`${endTime}:59`) : null;
          const crossesMidnight = startSeconds != null && endSeconds != null && startSeconds > endSeconds;
          return crossesMidnight
            ? (startSeconds == null || entrySeconds >= startSeconds) || (endSeconds == null || entrySeconds <= endSeconds)
            : (startSeconds == null || entrySeconds >= startSeconds) && (endSeconds == null || entrySeconds <= endSeconds);
        }),
      }))
      .filter((group) => group.entries.length > 0);
  }, [groupedLogs, effectiveStartDate, effectiveEndDate, startTime, endTime]);

  const selectedDayEntries = useMemo(
    () => rangeFilteredLogs.flatMap((group) => group.entries),
    [rangeFilteredLogs]
  );

  const selectedPeriodLabel = useMemo(() => {
    const dateLabel = startDate || endDate
      ? `${startDate || 'Earliest'} – ${endDate || 'Latest'}`
      : 'All recorded activity';
    return startTime || endTime ? `${dateLabel} · ${startTime || '00:00'} – ${endTime || '23:59'}` : dateLabel;
  }, [startDate, endDate, startTime, endTime]);

  const selectedDayTotals = useMemo(() => {
    return selectedDayEntries.reduce(
      (acc, entry) => {
        acc.clicks += entry.clicks ?? 0;
        acc.keystrokes += entry.keystrokes ?? 0;
        // Only count duration toward "active" time when the entry actually
        // shows input activity — idle entries (0 clicks/keystrokes/active%)
        // are excluded so leaving the PC on a screen doesn't inflate this.
        if (isActiveEntry(entry)) acc.activeSeconds += entry.durationSeconds ?? 0;
        return acc;
      },
      { clicks: 0, keystrokes: 0, activeSeconds: 0 }
    );
  }, [selectedDayEntries]);

  // Logger entries land roughly every 30s, so a narrow single-day window
  // (e.g. "last hour") switches the chart to per-minute buckets instead of
  // collapsing everything into one or two hourly bars.
  const chartGranularity = useMemo(
    () => pickChartGranularity(selectedDayEntries, startTime, endTime),
    [selectedDayEntries, startTime, endTime]
  );

  const hourlyData = useMemo(() => {
    return chartGranularity === 'minute'
      ? buildMinuteData(selectedDayEntries)
      : buildHourlyData(selectedDayEntries);
  }, [selectedDayEntries, chartGranularity]);

  const inputChartData = useMemo(
    () => hourlyData.filter((h) => h.clicks > 0 || h.keystrokes > 0),
    [hourlyData]
  );

  // "Work" only counts time on a work app/site where the employee was
  // actually active (clicks/keystrokes/active% > 0), OR idle for less than
  // the 5-minute threshold. Social-media time is always Entertainment; a
  // work app idle for 5+ minutes straight also falls into Entertainment.
  // Work + Entertainment always add up to the full shift/range duration.
  const selectedDayWorkEntertainment = useMemo(() => {
    // Classify per date-group so idle streaks never bleed across days —
    // selectedDayEntries concatenates multiple days' worth of entries.
    const byDate = new Map();
    selectedDayEntries.forEach((entry) => {
      if (!byDate.has(entry.date)) byDate.set(entry.date, []);
      byDate.get(entry.date).push(entry);
    });

    let workSeconds = 0;
    let entertainmentSeconds = 0;
    byDate.forEach((dayEntries) => {
      classifyWorkEntertainment(dayEntries).forEach(({ entry, isWork }) => {
        if (isWork) workSeconds += entry.durationSeconds ?? 0;
        else entertainmentSeconds += entry.durationSeconds ?? 0;
      });
    });

    return [
      { name: 'Work', value: workSeconds },
      { name: 'Entertainment', value: entertainmentSeconds },
    ];
  }, [selectedDayEntries]);

  // Work + Entertainment always spans the full range (every entry falls into
  // exactly one bucket), so this is the "Active Time" / pie-chart total —
  // not selectedDayTotals.activeSeconds, which only sums entries with an
  // input signal and therefore excludes idle-but-still-Work/Entertainment time.
  const selectedDayActiveSeconds = useMemo(
    () => selectedDayWorkEntertainment.reduce((sum, d) => sum + d.value, 0),
    [selectedDayWorkEntertainment]
  );

  // Same idle-streak classification drives which tab (Work / Entertainment)
  // each log line shows up under, so the log list always agrees with the
  // totals above.
  const classifiedByGroup = useMemo(() => {
    const map = new Map(); // entry -> isWork
    rangeFilteredLogs.forEach((group) => {
      classifyWorkEntertainment(group.entries).forEach(({ entry, isWork }) => map.set(entry, isWork));
    });
    return map;
  }, [rangeFilteredLogs]);

  const filteredLogs = useMemo(() => {
    return rangeFilteredLogs
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => {
          // Fall back to the raw app-based check for any entry the classifier
          // didn't see (shouldn't happen, but keeps this resilient).
          const isWork = classifiedByGroup.has(entry) ? classifiedByGroup.get(entry) : isWorkEntry(entry);
          return activeTab === 'work' ? isWork : !isWork;
        }),
      }))
      .filter((g) => g.entries.length > 0);
  }, [rangeFilteredLogs, activeTab, classifiedByGroup]);

  useEffect(() => {
    if (rangeFilteredLogs.length > 0) setExpandedDates(new Set([rangeFilteredLogs[0].date]));
    else setExpandedDates(new Set());
  }, [rangeFilteredLogs]);

  const toggleDate = (date) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  };

  const allCategories = useMemo(
    () => groupEntriesByCategory(filteredLogs.flatMap((g) => g.entries)),
    [filteredLogs]
  );

  const visibleGroups = useMemo(() => {
    let groups = filteredLogs;
    if (categoryFilter) {
      groups = groups
        .map((group) => ({
          ...group,
          entries: group.entries.filter((entry) => entry.time && categorizeEntry(entry).key === categoryFilter),
        }))
        .filter((group) => group.entries.length > 0);
    }
    return groups;
  }, [filteredLogs, categoryFilter]);

  useEffect(() => {
    setCategoryFilter('');
  }, [activeTab]);

  const activeShiftLabel = useMemo(() => {
    if (!shiftAssignments.length) return null;
    const today = new Date().toISOString().slice(0, 10);
    const shift = getShiftForDate(today, shiftAssignments);
    if (!shift) return null;
    return `Shift: ${shift.startTime} – ${shift.endTime}${shift.crossDay ? ' (+1)' : ''}`;
  }, [shiftAssignments]);

  return (
    <div className="space-y-6">
      {!embedded && <div className="glass-card p-5">
        <div className="flex-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-white">Activity Analytics</h1>
            <p className="text-sm text-slate-400 mt-2">Select an employee to view their activity log filtered to their shift hours.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/20 px-4 py-2 text-xs text-slate-300">
            <ClipboardList className="w-4 h-4 text-accent-400" />
            Current entries
          </div>
        </div>

        {/* System-wide screenshot storage — every employee combined, not scoped
            to whoever is currently selected or the date/time filter. */}
        {!loadingStorageStats && storageStats && (() => {
          const style = getStorageBarStyle(storageUsage.percent);
          return (
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-1.5 text-slate-300">
                  <Monitor className="h-3.5 w-3.5 text-slate-400" />
                  Screenshot storage · {storageUsage.count.toLocaleString()} screenshot{storageUsage.count === 1 ? '' : 's'} · {formatStorageSize(storageUsage.totalBytes)} of 3 GB used
                </span>
                <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium', style.chip)}>
                  {storageUsage.percent >= 90 && <AlertTriangle className="h-3 w-3" />}
                  {storageUsage.percent.toFixed(1)}%
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800/70">
                <div
                  className={clsx('h-full rounded-full transition-all duration-500', style.bar, storageUsage.percent >= 90 && 'animate-pulse')}
                  style={{ width: `${Math.max(storageUsage.percent, storageUsage.count > 0 ? 1.5 : 0)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                {storageUsage.daysRemaining === 0
                  ? 'Storage cap reached.'
                  : storageUsage.daysRemaining == null
                    ? 'Not enough recent activity to estimate time to full.'
                    : `At the current pace, ~${storageUsage.daysRemaining} day${storageUsage.daysRemaining === 1 ? '' : 's'} until storage is full.`}
              </p>
              {storageUsage.percent >= 90 && (
                <p className="mt-1.5 text-[11px] font-medium text-red-400">
                  Storage is almost full — delete old screenshots to free up space.
                </p>
              )}
            </div>
          );
        })()}
      </div>}

      {!embedded && (
        <ActivityDashboard
          embedded
          selectedEmployeeId={selectedId}
          onSelectEmployee={setSelectedId}
          onRangeChange={setSharedRange}
          onSelectedStatsChange={setSelectedStats}
        >
        {/* Selected employee section — rendered inside ActivityDashboard
            so it sits beside the Employee List column. */}
        <div className="glass-card p-4 border border-white/10">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Selected employee</p>
              <div className="flex items-center gap-3">
                {selectedProfile?.avatar ? (
                  <img src={selectedProfile.avatar} alt={selectedProfile.name} className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {selectedProfile?.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white truncate">
                    {selectedProfile?.name || 'No employee selected'}
                  </h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {selectedProfile?.employeeId || 'No ID'} • {selectedProfile?.stationLabel || 'No station'}
                    </p>
                    {activeShiftLabel && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/20 px-2 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-400">
                        <Activity className="w-2.5 h-2.5" />
                        {activeShiftLabel}
                      </span>
                    )}
                    {/* Show badge when logs are server-filtered by shift */}
                    {shiftPreFiltered && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-400">
                        Shift-filtered
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-100/80 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/70 dark:text-slate-300">
                <Clock className="w-4 h-4" />
                {selectedRecord?.lastUpdated
                  ? new Date(selectedRecord.lastUpdated).toLocaleString('en-US', DATE_FORMAT_OPTIONS)
                  : 'No timestamp'}
              </div>
              <div className="hidden flex items-center gap-1 rounded-full border border-slate-200/70 bg-white/80 px-2 py-1.5 dark:border-white/10 dark:bg-slate-950/80">
                <CalendarDays className="ml-1 h-3.5 w-3.5 text-slate-400" />
                <input type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} aria-label="Start date" title="From date" className="w-28 bg-transparent text-xs text-slate-700 outline-none dark:text-slate-200" />
                <span className="text-xs text-slate-400">–</span>
                <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} aria-label="End date" title="To date" className="w-28 bg-transparent text-xs text-slate-700 outline-none dark:text-slate-200" />
              </div>
              <div className="hidden flex items-center gap-1 rounded-full border border-slate-200/70 bg-white/80 px-2 py-1.5 dark:border-white/10 dark:bg-slate-950/80">
                <Clock className="ml-1 h-3.5 w-3.5 text-slate-400" />
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-label="Start time" title="From time" className="w-20 bg-transparent text-xs text-slate-700 outline-none dark:text-slate-200" />
                <span className="text-xs text-slate-400">–</span>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label="End time" title="To time" className="w-20 bg-transparent text-xs text-slate-700 outline-none dark:text-slate-200" />
              </div>
              {(startDate || endDate || startTime || endTime) && (
                <button type="button" onClick={() => { setStartDate(''); setEndDate(''); setStartTime(''); setEndTime(''); }} className="rounded-full px-2 py-1.5 text-xs text-slate-500 hover:text-slate-200">
                  Clear range
                </button>
              )}
              <button
                type="button"
                onClick={handleRefresh}
                disabled={!selectedId || loadingContent}
                title={lastRefreshedAt ? `Last refreshed ${lastRefreshedAt.toLocaleTimeString()}` : 'Refresh'}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/70 dark:border-white/10 bg-slate-100/80 dark:bg-slate-800/70 px-3 py-2 text-xs text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <RefreshCw className={clsx('w-4 h-4', loadingContent && 'animate-spin')} />
                Refresh
              </button>
              <button
                type="button"
                onClick={openScreenshots}
                disabled={!selectedId}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary-300/60 bg-primary-50 px-3 py-2 text-xs font-medium text-primary-700 transition hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-primary-400/30 dark:bg-primary-500/10 dark:text-primary-300 dark:hover:bg-primary-500/20"
              >
                <Monitor className="h-4 w-4" />
                Screenshots
              </button>
            </div>
          </div>

          {/* ── Stat cards ── */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatCard
              icon={MousePointerClick}
              label="Clicks"
              value={selectedDayTotals.clicks.toLocaleString()}
              subValue={selectedPeriodLabel}
              color="text-blue-600 dark:text-blue-400"
              bgColor="bg-blue-50 dark:bg-blue-500/10"
            />
            <StatCard
              icon={Keyboard}
              label="Keystrokes"
              value={selectedDayTotals.keystrokes.toLocaleString()}
              subValue={selectedPeriodLabel}
              color="text-violet-600 dark:text-violet-400"
              bgColor="bg-violet-50 dark:bg-violet-500/10"
            />
            <StatCard
              icon={Timer}
              label="Active Time"
              value={formatDuration(selectedDayActiveSeconds)}
              subValue={selectedPeriodLabel}
              color="text-teal-600 dark:text-teal-400"
              bgColor="bg-teal-50 dark:bg-teal-500/10"
            />
          </div>

          {/* ── Charts ── */}
          <div className="grid gap-4 lg:grid-cols-[1fr_260px] mb-4">
            {/* Hourly activity area chart */}
            <div className="rounded-2xl border border-white/10 bg-white/60 dark:bg-slate-950/60 p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  {/* <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Selected Employee</p> */}
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Active time by {chartGranularity === 'minute' ? 'minute' : 'hour'}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  {chartGranularity === 'minute' && (
                    <span className="text-[10px] rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 px-2 py-1 text-indigo-700 dark:text-indigo-400">
                      Minute view
                    </span>
                  )}
                  {(shiftPreFiltered || shiftAssignments.length > 0) && (
                    <span className="text-[10px] rounded-full bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/20 px-2 py-1 text-teal-700 dark:text-teal-400">
                      Shift-filtered
                    </span>
                  )}
                </div>
              </div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={hourlyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="areaGradientDuration" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0d9488" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#0d9488" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      interval={chartGranularity === 'minute' ? Math.max(0, Math.ceil(hourlyData.length / 10) - 1) : 0}
                    />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => `${v.toFixed(0)}m`} />
                    <Tooltip content={<HourlyTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="durationMin"
                      name="Active Time"
                      stroke="#0d9488"
                      strokeWidth={2.5}
                      fill="url(#areaGradientDuration)"
                      dot={chartGranularity === 'minute' ? { r: 2, fill: '#0d9488', strokeWidth: 0 } : false}
                      activeDot={{ r: 4, fill: '#0d9488', stroke: '#fff', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Clicks & Keystrokes per hour/minute */}
              {inputChartData.length > 0 && (
                <div className="mt-4 border-t border-slate-100 dark:border-white/5 pt-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">
                    Clicks &amp; Keystrokes per {chartGranularity === 'minute' ? 'minute' : 'hour'}
                  </p>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={inputChartData} margin={{ top: 2, right: 4, left: -20, bottom: 0 }} barGap={2}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 10, fill: '#94a3b8' }}
                          interval={chartGranularity === 'minute' ? Math.max(0, Math.ceil(inputChartData.length / 8) - 1) : 0}
                        />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <Tooltip content={<InputTooltip />} />
                        <Bar dataKey="clicks" name="Clicks" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={18} />
                        <Bar dataKey="keystrokes" name="Keystrokes" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={18} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>

            {/* Work vs Entertainment donut */}
            <div className="rounded-2xl border border-white/10 bg-white/60 dark:bg-slate-950/60 p-4 shadow-sm">
              <div className="mb-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Focus split</p>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Work vs Entertainment</h3>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <defs>
                      <linearGradient id="workGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0f766e" />
                        <stop offset="100%" stopColor="#0d9488" />
                      </linearGradient>
                      <linearGradient id="entGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1d4ed8" />
                        <stop offset="100%" stopColor="#3b82f6" />
                      </linearGradient>
                    </defs>
                    <Pie
                      data={selectedDayWorkEntertainment}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={78}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      <Cell fill="url(#workGrad)" />
                      <Cell fill="url(#entGrad)" />
                    </Pie>
                    <Tooltip content={<DonutTooltip />} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: '11px' }}
                      formatter={(value, entry) => (
                        <span style={{ color: '#94a3b8' }}>
                          {value} <strong style={{ color: '#e2e8f0' }}>{formatDuration(entry.payload.value)}</strong>
                        </span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 rounded-xl bg-slate-50 dark:bg-slate-900/40 px-3 py-2 text-center">
                <p className="text-[11px] text-slate-400">Total active</p>
                <p className="text-base font-bold text-slate-900 dark:text-white">{formatDuration(selectedDayActiveSeconds)}</p>
              </div>
            </div>
          </div>

          {/* ── Selected Employee Stats Card (moved from ActivityDashboard) ── */}
          <AnimatePresence mode="wait">
            {selectedId && (
              <motion.div
                key={selectedId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="rounded-2xl border border-white/10 bg-white/60 dark:bg-slate-950/60 p-4 shadow-sm mb-4"
              >
                <div className="mb-3">
                  {/* <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Selected Employee</p> */}
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Work &amp; activity summary</h3>
                </div>

                {selectedStats?.cache && selectedStats.hasRangeFilter && !selectedStats.rangeHasData ? (
                  <div className="rounded-2xl border border-dashed border-slate-200/70 dark:border-white/10 p-6 text-center text-slate-500 text-sm">
                    No activity logs for {selectedProfile?.name || 'this employee'} in {selectedStats.rangeLabel}.
                  </div>
                ) : selectedStats?.cache ? (
                  <motion.div
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
                        <TrendBadge change={selectedStats.dayOverDay?.workSeconds} />
                      </div>
                      <Briefcase className="w-4 h-4 text-blue-500 mx-auto mb-1" />
                      <p className="text-lg font-bold text-blue-700 dark:text-blue-300">
                        {formatDuration(selectedStats.rangeSummary.totals.workSeconds)}
                      </p>
                      <p className="text-[10px] text-blue-500/80 uppercase tracking-wide font-medium">Work</p>
                    </motion.div>
                    {/* Entertainment */}
                    <motion.div
                      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                      className="rounded-2xl bg-rose-50 dark:bg-rose-500/10 p-3 text-center relative"
                    >
                      <div className="absolute top-2 right-2">
                        <TrendBadge change={selectedStats.dayOverDay?.entertainmentSeconds} />
                      </div>
                      <Gamepad2 className="w-4 h-4 text-rose-500 mx-auto mb-1" />
                      <p className="text-lg font-bold text-rose-700 dark:text-rose-300">
                        {formatDuration(selectedStats.rangeSummary.totals.entertainmentSeconds)}
                      </p>
                      <p className="text-[10px] text-rose-500/80 uppercase tracking-wide font-medium">Entertainment</p>
                    </motion.div>

                    {/* Keystrokes */}
                    <motion.div
                      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                      className="rounded-2xl bg-cyan-50 dark:bg-cyan-500/10 p-3 text-center relative"
                    >
                      <div className="absolute top-2 right-2">
                        <TrendBadge change={selectedStats.dayOverDay?.keystrokes} />
                      </div>
                      <Keyboard className="w-4 h-4 text-cyan-500 mx-auto mb-1" />
                      <p className="text-lg font-bold text-cyan-700 dark:text-cyan-300">
                        {selectedStats.rangeSummary.totals.keystrokes.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-cyan-500/80 uppercase tracking-wide font-medium">Keystrokes</p>
                    </motion.div>
                    {/* Clicks */}
                    <motion.div
                      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                      className="rounded-2xl bg-violet-50 dark:bg-violet-500/10 p-3 text-center relative"
                    >
                      <div className="absolute top-2 right-2">
                        <TrendBadge change={selectedStats.dayOverDay?.clicks} />
                      </div>
                      <MousePointerClick className="w-4 h-4 text-violet-500 mx-auto mb-1" />
                      <p className="text-lg font-bold text-violet-700 dark:text-violet-300">
                        {selectedStats.rangeSummary.totals.clicks.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-violet-500/80 uppercase tracking-wide font-medium">Clicks</p>
                    </motion.div>
                    {/* Active duration */}
                    <motion.div
                      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                      className="rounded-2xl bg-amber-50 dark:bg-amber-500/10 p-3 text-center relative"
                    >
                      <div className="absolute top-2 right-2">
                        <TrendBadge change={selectedStats.dayOverDay?.totalSeconds} />
                      </div>
                      <Clock className="w-4 h-4 text-amber-500 mx-auto mb-1" />
                      <p className="text-lg font-bold text-amber-700 dark:text-amber-300">
                        {formatDuration(selectedStats.rangeSummary.totals.totalSeconds)}
                      </p>
                      <p className="text-[10px] text-amber-500/80 uppercase tracking-wide font-medium">Active Duration</p>
                    </motion.div>
                    {/* Total Hours */}
                    <motion.div
                      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                      className="rounded-2xl bg-teal-50 dark:bg-teal-500/10 p-3 text-center relative"
                    >
                      <div className="absolute top-2 right-2">
                        <TrendBadge change={selectedStats.dayOverDay?.totalSeconds} />
                      </div>
                      <Timer className="w-4 h-4 text-teal-500 mx-auto mb-1" />
                      <p className="text-lg font-bold text-teal-700 dark:text-teal-300">
                        {formatHoursDecimal(selectedStats.rangeSummary.totals.totalSeconds)}
                      </p>
                      <p className="text-[10px] text-teal-500/80 uppercase tracking-wide font-medium">Total Hours</p>
                    </motion.div>
                  </motion.div>
                ) : selectedStats?.cache === undefined ? (
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
                      onClick={() => selectedStats?.retry?.()}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-4 py-2 text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Retry
                    </button>
                  </div>
                )}

                {/* Work efficiency bar */}
                {selectedStats?.cache && selectedStats.rangeHasData && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1.5">
                      <span>Work efficiency</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {Math.round((selectedStats.rangeSummary.totals.workSeconds / selectedStats.rangeSummary.totals.totalSeconds) * 100)}% productive
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-700"
                        style={{ width: `${Math.round((selectedStats.rangeSummary.totals.workSeconds / selectedStats.rangeSummary.totals.totalSeconds) * 100)}%` }}
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
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Loading bar ── */}
          <div className="mb-4 h-1 rounded-full bg-slate-200/70 dark:bg-slate-800/70 overflow-hidden">
            <div className={clsx(
              'h-full rounded-full bg-primary-500 transition-all duration-500',
              loadingContent ? 'w-full animate-pulse' : 'w-0'
            )} />
          </div>

          {/* ── Tab & filters ── */}
          {groupedLogs.length > 0 && (
            <div className="mb-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="inline-flex rounded-full bg-slate-100/80 p-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('work')}
                    className={clsx(
                      'px-3 py-1 text-xs rounded-full transition',
                      activeTab === 'work' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-500'
                    )}
                  >
                    Work
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('entertainment')}
                    className={clsx(
                      'px-3 py-1 text-xs rounded-full transition',
                      activeTab === 'entertainment' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-500'
                    )}
                  >
                    Entertainment
                  </button>
                </div>
                <div className="text-xs text-slate-400">Showing {activeTab === 'work' ? 'Work' : 'Entertainment'}</div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {allCategories.length > 0 && (
                  <div className="relative flex-1 max-w-[200px]">
                    <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="w-full appearance-none rounded-full border border-slate-200/70 bg-white/80 dark:border-white/10 dark:bg-slate-950/80 dark:text-slate-200 pl-9 pr-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-400/40"
                    >
                      <option value="">All categories</option>
                      {allCategories.map((cat) => (
                        <option key={cat.key} value={cat.key}>
                          {cat.label} ({cat.entries.length})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {categoryFilter && (
                  <button
                    type="button"
                    onClick={() => setCategoryFilter('')}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200/70 dark:border-white/10 px-3 py-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Log list ── */}
          <div className="flex-1 min-h-0 rounded-3xl border border-slate-200/70 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 dark:border-white/10 dark:bg-slate-950 dark:text-slate-300">
            {loadingContent ? (
              <div className="flex h-56 items-center justify-center text-slate-500">Loading log content…</div>
            ) : !selectedRecord ? (
              <div className="flex h-56 flex-col items-center justify-center gap-2 text-slate-500">
                <p>Select an employee to view their activity log.</p>
              </div>
            ) : visibleGroups.length > 0 ? (
              <div className="space-y-3">
                {visibleGroups.map((group) => {
                  const displayEntries = group.entries.slice().reverse();
                  const isOpen = expandedDates.has(group.date);
                  const dayTotalSeconds = group.entries.reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0);
                  const topWindows = group.date === 'Unrecognized lines' ? [] : groupEntriesByWindow(group.entries).slice(0, 6);
                  return (
                    <div
                      key={group.date}
                      className="rounded-2xl border border-slate-200/70 bg-white/70 dark:border-white/10 dark:bg-slate-950/60 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleDate(group.date)}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <ChevronDown className={clsx('w-4 h-4 shrink-0 text-slate-400 transition-transform', isOpen ? 'rotate-0' : '-rotate-90')} />
                          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {formatDateLabel(group.date)}
                          </span>
                        </div>
                        <span className="text-[11px] shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-slate-500 dark:text-slate-400">
                          {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                          {group.date !== 'Unrecognized lines' && ` • ~${formatDuration(dayTotalSeconds)}`}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="border-t border-slate-200/70 dark:border-white/10">
                          {group.date === 'Unrecognized lines' ? (
                            <div className="divide-y divide-slate-100 dark:divide-white/5">
                              {displayEntries.map((entry, idx) => (
                                <div key={idx} className="px-4 py-2 text-xs text-slate-500 break-all whitespace-pre-wrap">{entry.raw}</div>
                              ))}
                            </div>
                          ) : (
                            <>
                              {topWindows.length > 0 && (
                                <div className="px-4 py-3 bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-100 dark:border-white/5">
                                  <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                    <Hourglass className="w-3 h-3" />
                                    Time on page (estimated)
                                  </div>
                                  <div className="space-y-1.5">
                                    {topWindows.map((w) => (
                                      <div key={w.key} className="flex items-center gap-2 text-xs">
                                        <span className={clsx('flex h-4 w-4 shrink-0 items-center justify-center rounded', w.category.badge)}>
                                          <w.category.icon className="w-2.5 h-2.5" />
                                        </span>
                                        <span className="min-w-0 flex-1 break-all text-slate-600 dark:text-slate-300" title={w.windowTitle}>
                                          {w.windowTitle}
                                        </span>
                                        <span className="shrink-0 text-slate-400">{w.count}×</span>
                                        <span className="shrink-0 w-16 text-right font-mono font-medium text-slate-700 dark:text-slate-200">
                                          {formatDuration(w.totalSeconds)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {groupEntriesByCategory(displayEntries).map((cat) => (
                                <div key={cat.key} className="border-b last:border-b-0 border-slate-100 dark:border-white/5">
                                  <div className="flex items-center gap-2 px-4 py-2 bg-slate-50/70 dark:bg-slate-900/40">
                                    <span className={clsx('flex h-5 w-5 items-center justify-center rounded-md', cat.badge)}>
                                      <cat.icon className="w-3 h-3" />
                                    </span>
                                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{cat.label}</span>
                                    <span className="text-[10px] rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-slate-500 dark:text-slate-400">
                                      {cat.entries.length} • ~{formatDuration(cat.totalSeconds)}
                                    </span>
                                  </div>
                                  <div className="divide-y divide-slate-100 dark:divide-white/5">
                                    {cat.entries.map((entry, idx) => {
                                      const idle = !isActiveEntry(entry);
                                      // Adjacent duplicate window/input signature while idle usually means the
                                      // same idle window was logged repeatedly (screen left open, no input).
                                      const neighbor = cat.entries[idx - 1] || cat.entries[idx + 1];
                                      const repeated = idle && neighbor
                                        && neighbor.windowTitle === entry.windowTitle
                                        && neighbor.clicks === entry.clicks
                                        && neighbor.keystrokes === entry.keystrokes;
                                      return (
                                        <div
                                          key={idx}
                                          className={clsx(
                                            'flex items-center gap-3 px-4 py-1.5 pl-9 text-xs transition-colors',
                                            idle && 'bg-amber-50/80 dark:bg-amber-500/[0.08] border-l-2 border-amber-300 dark:border-amber-500/50'
                                          )}
                                        >
                                          <span className={clsx('shrink-0 w-16 font-mono', idle ? 'text-amber-600/80 dark:text-amber-400/80' : 'text-slate-400')}>
                                            {entry.time}
                                          </span>
                                          <span className={clsx('min-w-0 flex-1 break-all', idle ? 'text-amber-900/80 dark:text-amber-200/80' : 'text-slate-600 dark:text-slate-300')} title={entry.windowTitle}>
                                            {entry.windowTitle}
                                          </span>
                                          {(entry.clicks !== undefined || entry.keystrokes !== undefined) && (
                                            <span className="shrink-0 flex items-center gap-2 text-[10px] text-slate-400">
                                              {entry.clicks !== undefined && (
                                                <span className="flex items-center gap-0.5">
                                                  <MousePointerClick className="w-2.5 h-2.5" />{entry.clicks}
                                                </span>
                                              )}
                                              {entry.keystrokes !== undefined && (
                                                <span className="flex items-center gap-0.5">
                                                  <Keyboard className="w-2.5 h-2.5" />{entry.keystrokes}
                                                </span>
                                              )}
                                              {idle && (
                                                <span
                                                  className="flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 px-1.5 py-0.5 font-medium"
                                                  title={repeated ? 'No input — same window logged repeatedly' : 'No input recorded for this entry'}
                                                >
                                                  <AlertTriangle className="w-2.5 h-2.5" />
                                                  {repeated ? 'Idle · repeated' : 'Idle'}
                                                </span>
                                              )}
                                            </span>
                                          )}
                                          <span className={clsx('shrink-0 font-mono text-[11px]', idle ? 'text-amber-600/70 dark:text-amber-400/60' : 'text-slate-400')}>
                                            {formatDuration(entry.durationSeconds ?? 0)}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-56 flex-col items-center justify-center gap-2 text-slate-500 text-sm">
                {selectedRecord && !loadingContent && groupedLogs.length === 0 ? (
                  <>
                    <p>No log entries found.</p>
                    <p className="text-xs text-slate-400">
                      {shiftAssignments.length > 0
                        ? 'No activity was recorded during this employee\'s shift window.'
                        : 'No activity logs available for this employee.'}
                    </p>
                  </>
                ) : (
                  <p>No {activeTab} entries match the current filters.</p>
                )}
              </div>
            )}
          </div>
        </div>
        </ActivityDashboard>
      )}

      <AnimatePresence>
      {showScreenshots && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Employee screenshots">
          <motion.div initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }} transition={{ type: 'spring', stiffness: 280, damping: 26 }} className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-white/10">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Screenshot preview</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{selectedProfile?.name || 'Employee'} screenshots</h3>
                <p className="mt-1 text-xs text-slate-500">Date, time, and station ID are shown with every capture.</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={deleteAllScreenshots} disabled={!screenshots.length || loadingScreenshots || deletingAllScreenshots || Boolean(deletingScreenshotId)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/35 px-3 py-2 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300" title="Permanently delete all screenshots">
                  {deletingAllScreenshots ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete all
                </button>
                <button type="button" onClick={() => { setShowScreenshots(false); setPreviewScreenshot(null); }} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white" aria-label="Close screenshot preview">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto p-5">
              {loadingScreenshots ? (
                <div className="flex h-56 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading screenshots…</div>
              ) : screenshotsError ? (
                <div className="flex h-56 items-center justify-center text-sm text-rose-600 dark:text-rose-400">{screenshotsError}</div>
              ) : screenshots.length === 0 ? (
                <div className="flex h-56 flex-col items-center justify-center gap-2 text-sm text-slate-500"><Monitor className="h-8 w-8" /> No screenshots available for this employee.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {screenshots.map((screenshot) => {
                    const capturedAt = new Date(screenshot.capturedAt);
                    return (
                      <article key={screenshot._id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-950/50">
                        {screenshot.imageUrl ? (
                          <div className="relative overflow-hidden bg-slate-200 dark:bg-slate-800">
                            <motion.img whileHover={{ scale: 1.04 }} transition={{ duration: 0.22 }} src={screenshot.imageUrl} alt={`Screenshot captured ${capturedAt.toLocaleString()}`} className="aspect-video w-full object-cover" loading="lazy" />
                            <button
                              type="button"
                              onClick={() => deleteScreenshot(screenshot)}
                              disabled={deletingAllScreenshots || Boolean(deletingScreenshotId)}
                              className="absolute right-2 top-2 z-10 rounded-lg bg-rose-600 p-2 text-white opacity-0 shadow-lg transition hover:bg-rose-500 group-hover:opacity-100 group-focus-within:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
                              aria-label="Permanently delete screenshot"
                              title="Delete permanently"
                            >
                              {deletingScreenshotId === screenshot._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                              <button type="button" onClick={() => { setPreviewScreenshot(screenshot); setScreenshotZoom(1); }} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-900 shadow-lg transition hover:scale-105">
                                <Eye className="h-4 w-4" /> Open image
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex aspect-video items-center justify-center text-xs text-slate-500">Preview URL unavailable</div>
                        )}
                        <div className="space-y-1.5 p-3 text-xs">
                          <p className="font-medium text-slate-800 dark:text-slate-100">{capturedAt.toLocaleDateString('en-US', SCREENSHOT_DATE_FORMAT_OPTIONS)}</p>
                          <p className="text-slate-500 dark:text-slate-400">Time: {capturedAt.toLocaleTimeString('en-US', SCREENSHOT_TIME_FORMAT_OPTIONS)}</p>
                          <p className="text-slate-500 dark:text-slate-400">Station ID: <span className="font-mono text-slate-700 dark:text-slate-200">{screenshot.station}</span></p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence>
        {previewScreenshot && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPreviewScreenshot(null)} className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Full-size screenshot preview">
            <motion.div initial={{ opacity: 0, scale: 0.94, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }} transition={{ type: 'spring', stiffness: 300, damping: 28 }} onClick={(event) => event.stopPropagation()} className="flex h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900 shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-white">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{new Date(previewScreenshot.capturedAt).toLocaleString('en-US', SCREENSHOT_DATE_FORMAT_OPTIONS)}</p>
                  <p className="mt-0.5 text-xs text-slate-400">Station ID: {previewScreenshot.station}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => setScreenshotZoom((zoom) => Math.max(0.5, +(zoom - 0.25).toFixed(2)))} className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></button>
                  <span className="min-w-12 text-center text-xs text-slate-300">{Math.round(screenshotZoom * 100)}%</span>
                  <button type="button" onClick={() => setScreenshotZoom((zoom) => Math.min(3, +(zoom + 0.25).toFixed(2)))} className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setScreenshotZoom(1)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Reset zoom"><RotateCcw className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setPreviewScreenshot(null)} className="ml-1 rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Close full-size preview"><X className="h-5 w-5" /></button>
                </div>
              </div>
              <div className="flex flex-1 items-center justify-center overflow-auto bg-[radial-gradient(circle_at_center,_#334155_0,_#0f172a_65%)] p-6">
                <motion.img animate={{ scale: screenshotZoom }} transition={{ type: 'spring', stiffness: 320, damping: 30 }} src={previewScreenshot.imageUrl} alt={`Full-size screenshot captured ${new Date(previewScreenshot.capturedAt).toLocaleString()}`} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}