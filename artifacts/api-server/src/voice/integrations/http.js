'use strict';
/* Shared JSON-over-HTTP helper for every provider client. Errors carry the
   provider name, status and a short, secret-free message for the UI. */
class ApiError extends Error {
  constructor(provider, message, status, body) {
    super(provider + ': ' + message);
    this.name = 'ApiError';
    this.provider = provider;
    this.status = status;
    this.body = body;
  }
}

function describe(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 300);
  const m =
    body.message ||
    body.error_description ||
    (body.error && (body.error.message || body.error)) ||
    body.detail ||
    body.msg;
  if (Array.isArray(m)) return m.join('; ').slice(0, 300);
  return (typeof m === 'string' ? m : JSON.stringify(body)).slice(0, 300);
}

function createHttp(provider, fetchImpl, opts) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const timeoutMs = (opts && opts.timeoutMs) || 20000;
  return async function request(url, init) {
    init = Object.assign({}, init);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs || timeoutMs);
    init.signal = ctrl.signal;
    let res;
    try {
      res = await doFetch(url, init);
    } catch (e) {
      throw new ApiError(
        provider,
        e.name === 'AbortError'
          ? 'request timed out'
          : 'network error (' + e.message + ')',
        0,
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!res.ok)
      throw new ApiError(
        provider,
        describe(json || text) || 'HTTP ' + res.status,
        res.status,
        json || text,
      );
    return json === null ? text || null : json;
  };
}

module.exports = { createHttp, ApiError };
