'use strict';

/**
 * dbSsl.js
 * Decides the `ssl` option for node-postgres from DATABASE_URL and DATABASE_SSL.
 *
 * DATABASE_SSL
 *   (unset)     auto: no TLS for local / private-network hosts (localhost,
 *               Docker service names, Render internal hostnames, 10.x/172.16-31.x/
 *               192.168.x); verified TLS for everything else in production.
 *   disable     never use TLS
 *   no-verify   TLS without certificate verification (self-signed managed DBs)
 *   verify      TLS with full certificate verification
 *
 * A `sslmode=` parameter in DATABASE_URL is left to node-postgres.
 */

function isPrivateHost(host) {
  if (!host) return true;
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h.startsWith('127.')) return true;
  if (!h.includes('.') && !h.includes(':')) return true; // docker / render internal names
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  return Boolean(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

function sslFor(url = process.env.DATABASE_URL, env = process.env) {
  const mode = (env.DATABASE_SSL || '').toLowerCase();
  if (mode === 'disable' || mode === 'false') return false;
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  if (mode === 'verify' || mode === 'true') return { rejectUnauthorized: true };
  if (/[?&]sslmode=/.test(url || '')) return undefined;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (isPrivateHost(host)) return false;
  return env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false;
}

module.exports = { sslFor, isPrivateHost };
