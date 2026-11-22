'use strict';

/** Small fetch wrapper for processor APIs: JSON in/out, timeout, readable errors. */

class ProviderError extends Error {
  constructor(message, status = 502, detail = null) {
    super(message);
    this.statusCode = status;
    this.detail = detail;
  }
}

async function call(
  url,
  { method = 'GET', headers = {}, json, form, body, timeoutMs = 20_000 } = {},
) {
  const h = { Accept: 'application/json', ...headers };
  let payload = body;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(json);
  } else if (form !== undefined) {
    h['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: h,
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ProviderError(
      err?.name === 'TimeoutError'
        ? 'The payment processor did not answer in time'
        : `Cannot reach the payment processor (${err.message})`,
    );
  }
  // Authorize.net prefixes its JSON with a byte-order mark.
  const rawText = await res.text();
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

/** Flattens nested objects into Stripe-style form keys: a[b][0][c]=v */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object')
          flatten(item, `${key}[${i}]`, out);
        else out[`${key}[${i}]`] = String(item);
      });
    } else if (typeof v === 'object') flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

module.exports = { call, flatten, ProviderError };
