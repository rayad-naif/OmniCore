'use strict';

/** Variables the API cannot run without. */
const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];

/**
 * verifyEnv — call once at process start before any server setup.
 * Exits with code 1 if a required variable is absent. Without GEMINI_API_KEY the
 * API still starts: platform AI features are off (agencies can use their own key).
 */
function verifyEnv(env = process.env, exit = (code) => process.exit(code)) {
  const missing = REQUIRED.filter((key) => !env[key]);
  for (const key of missing) {
    console.error(`FATAL: Missing environment variable: ${key}`);
  }
  if (missing.length) return exit(1);
  if (!env.GEMINI_API_KEY) {
    console.warn(
      'GEMINI_API_KEY is not set: AI replies, the assistant and AI store content are off until it is.',
    );
  }
  return true;
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

  // Render sets RENDER_EXTERNAL_URL (https://<service>.onrender.com).
  const render = (process.env.RENDER_EXTERNAL_URL || '').trim();
  if (render) return render.replace(/\/+$/, '');

  if (req) {
    const proto = req.headers?.['x-forwarded-proto'] || req.protocol || 'https';
    const host =
      typeof req.get === 'function' ? req.get('host') : req.headers?.host;
    if (host) return `${proto}://${host}`;
  }
  return '';
}

module.exports = { verifyEnv, publicAppUrl };
