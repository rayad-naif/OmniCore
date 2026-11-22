// Request signing between OmniCore and the store agent.
// Header: x-omnicore-agent-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${METHOD}.${path}.${body}`)>
import crypto from 'node:crypto';

export const MAX_SKEW_SECONDS = 300;

export function signRequest(secret, method, path, body, now = Date.now()) {
  const t = Math.floor(now / 1000);
  const v1 = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${method.toUpperCase()}.${path}.${body || ''}`)
    .digest('hex');
  return `t=${t},v1=${v1}`;
}

/** Returns null when valid, otherwise a short reason. `seen` blocks replays inside the window. */
export function verifyRequest({
  secret,
  header,
  method,
  path,
  body,
  seen,
  now = Date.now(),
}) {
  if (!secret) return 'agent secret not configured';
  const parts = Object.fromEntries(
    String(header || '')
      .split(',')
      .map((p) => p.trim().split('='))
      .filter((kv) => kv.length === 2),
  );
  const t = Number(parts.t);
  if (!t || !/^[a-f0-9]{64}$/.test(parts.v1 || '')) return 'missing signature';
  if (Math.abs(now / 1000 - t) > MAX_SKEW_SECONDS) return 'stale signature';
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${method.toUpperCase()}.${path}.${body || ''}`)
    .digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1)))
    return 'bad signature';
  if (seen) {
    if (seen.has(parts.v1)) return 'replayed request';
    seen.set(parts.v1, now);
    for (const [k, at] of seen)
      if (now - at > MAX_SKEW_SECONDS * 2000) seen.delete(k);
  }
  return null;
}
