'use strict';

/**
 * Small in-memory limiter for the HR login endpoints (per IP + email).
 * Failed attempts only; a successful login does not count.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 20;
const hits = new Map();

function key(req) {
  const email = String(req.body?.email || '').toLowerCase();
  return `${req.ip}|${email}`;
}

function loginLimiter(req, res, next) {
  const k = key(req);
  const now = Date.now();
  const entry = hits.get(k);
  if (entry && entry.reset > now && entry.count >= MAX_FAILURES) {
    res.setHeader('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
    return res.status(429).json({
      success: false,
      message: 'Too many failed attempts. Please try again in 15 minutes.',
    });
  }
  res.on('finish', () => {
    if (res.statusCode < 400) return;
    const cur = hits.get(k);
    if (!cur || cur.reset <= Date.now()) {
      hits.set(k, { count: 1, reset: Date.now() + WINDOW_MS });
    } else {
      cur.count += 1;
    }
    if (hits.size > 10_000) {
      for (const [hk, v] of hits) if (v.reset <= Date.now()) hits.delete(hk);
    }
  });
  return next();
}

module.exports = { loginLimiter };
