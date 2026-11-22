'use strict';

/**
 * hrms/core/time.js
 * Workspace time zone helpers. The original HRMS hard-coded Pakistan time
 * (UTC+5); here every workspace uses its own time zone (Workspace settings →
 * Default time zone in OmniCore).
 */

const { currentContext } = require('./context');

function currentTimezone() {
  return currentContext()?.timezone || 'UTC';
}

/** Milliseconds to add to a UTC instant to get the workspace wall-clock time. */
function tzOffsetMs(at = new Date(), timeZone = currentTimezone()) {
  const date = at instanceof Date ? at : new Date(at);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(
    dtf.formatToParts(date).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function tzOffsetMinutes(at, timeZone) {
  return Math.round(tzOffsetMs(at, timeZone) / 60_000);
}

module.exports = { currentTimezone, tzOffsetMs, tzOffsetMinutes };
