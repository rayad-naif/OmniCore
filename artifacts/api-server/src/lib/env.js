'use strict';

/**
 * verifyEnv — call once at process start before any server setup.
 * Exits with code 1 if any required variable is absent.
 */
function verifyEnv() {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'GEMINI_API_KEY'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`FATAL: Missing environment variable: ${key}`);
      process.exit(1);
    }
  }
}

/**
 * publicAppUrl — the canonical public origin for every user-facing link
 * (checkout success/cancel redirects, password-reset + agent-invite emails,
 * managed webhook URLs).
 *
 * Order of precedence:
 *   1. PUBLIC_APP_URL — explicit override (the custom domain, e.g.
 *      https://omnicore.irofficial.com). This must match the domain approved
 *      in the payment provider dashboard (Paddle rejects unapproved domains).
 *   2. REPLIT_DOMAINS — the first Replit-managed domain.
 *   3. request host   — only when a `req` object is available.
 *
 * Returns an origin with no trailing slash, or '' when nothing is resolvable.
 */
function publicAppUrl(req) {
  const override = (process.env.PUBLIC_APP_URL || '').trim();
  if (override) return override.replace(/\/+$/, '');

  const domain = (process.env.REPLIT_DOMAINS || '').split(',')[0]?.trim();
  if (domain) return `https://${domain}`;

  if (req) {
    const proto = req.headers?.['x-forwarded-proto'] || req.protocol || 'https';
    const host = typeof req.get === 'function' ? req.get('host') : req.headers?.host;
    if (host) return `${proto}://${host}`;
  }
  return '';
}

module.exports = { verifyEnv, publicAppUrl };
