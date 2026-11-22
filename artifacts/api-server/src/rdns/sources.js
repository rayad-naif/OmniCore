'use strict';

/**
 * rdns/sources.js
 * Passive-DNS source adapters (ported from sources.py). Every source has the
 * same shape: fetchPage(value, recordType, { state, apiKey, extra }) →
 *   { domains: Set, nextState, exhausted, rateLimited, error }
 * so the scheduler treats them identically. Paginated sources walk their full
 * result set one page per scheduler turn, paced by ratelimit.js.
 *
 * Polite client by design: a fixed, honest User-Agent, no proxy rotation or
 * header spoofing, and an immediate back-off when a source says 429.
 */

const USER_AGENT = 'Mozilla/5.0 (compatible; OmniCoreReverseDNS/2.0)';
const DOMAIN_RE =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

function isValidDomain(candidate) {
  const c = String(candidate || '')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase();
  return Boolean(c) && c.length <= 253 && DOMAIN_RE.test(c);
}

function clean(candidate) {
  return String(candidate || '')
    .trim()
    .replace(/^\*\./, '')
    .replace(/\.+$/, '')
    .toLowerCase();
}

function walkJsonForDomains(obj, out, depth = 0) {
  if (depth > 6 || obj == null) return;
  if (Array.isArray(obj)) {
    for (const item of obj) walkJsonForDomains(item, out, depth + 1);
  } else if (typeof obj === 'object') {
    for (const v of Object.values(obj)) walkJsonForDomains(v, out, depth + 1);
  } else if (typeof obj === 'string') {
    const c = clean(obj);
    if (isValidDomain(c)) out.add(c);
  }
}

const result = (over = {}) => ({
  domains: new Set(),
  nextState: null,
  exhausted: true,
  rateLimited: false,
  error: null,
  ...over,
});

async function request(
  url,
  { method = 'GET', headers = {}, body, timeoutMs = 20_000 } = {},
) {
  return fetch(url, {
    method,
    headers: { 'User-Agent': USER_AGENT, ...headers },
    body,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
}

/** Runs a fetch and converts transport/HTTP failures into a result object. */
async function guarded(state, fn, { paginated = false } = {}) {
  try {
    return await fn();
  } catch (err) {
    return result({
      nextState: paginated ? state : null,
      exhausted: !paginated,
      error:
        err?.name === 'TimeoutError' ? 'timed out' : err.message || String(err),
    });
  }
}

function httpError(res) {
  return new Error(`HTTP ${res.status}`);
}

// ── Single-shot sources ──────────────────────────────────────────────────────

async function rapiddns(value, recordType) {
  return guarded(null, async () => {
    const res = await request(
      `https://rapiddns.io/s/${encodeURIComponent(value)}?type=${encodeURIComponent(String(recordType).toUpperCase())}&full=1`,
    );
    if (res.status === 429) return result({ rateLimited: true });
    if (!res.ok) throw httpError(res);
    const html = await res.text();
    const out = new Set();
    for (const row of html.match(/<tr>([\s\S]*?)<\/tr>/g) || []) {
      for (const cell of row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []) {
        const text = cell.replace(/<[^>]*>/g, '').trim();
        if (isValidDomain(text)) out.add(clean(text));
      }
    }
    return result({ domains: out });
  });
}

async function crtsh(value) {
  return guarded(null, async () => {
    const res = await request(
      `https://crt.sh/?q=${encodeURIComponent(`%${value}%`)}&output=json`,
      { timeoutMs: 30_000 },
    );
    if (res.status === 429) return result({ rateLimited: true });
    if (!res.ok) throw httpError(res);
    const data = await res.json();
    const out = new Set();
    for (const entry of Array.isArray(data) ? data : []) {
      for (const line of String(entry.name_value || '').split('\n')) {
        const c = clean(line);
        if (isValidDomain(c)) out.add(c);
      }
    }
    return result({ domains: out });
  });
}

async function certspotter(value, _type, { apiKey } = {}) {
  return guarded(null, async () => {
    const qs = new URLSearchParams({
      domain: value,
      include_subdomains: 'true',
      expand: 'dns_names',
    });
    const res = await request(
      `https://api.certspotter.com/v1/issuances?${qs}`,
      {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        timeoutMs: 25_000,
      },
    );
    if (res.status === 429) return result({ rateLimited: true });
    if (!res.ok) throw httpError(res);
    const data = await res.json();
    const out = new Set();
    for (const entry of Array.isArray(data) ? data : []) {
      for (const name of entry.dns_names || []) {
        const c = clean(name);
        if (isValidDomain(c)) out.add(c);
      }
    }
    return result({ domains: out });
  });
}

async function shodanInternetdb(value) {
  return guarded(null, async () => {
    const res = await request(
      `https://internetdb.shodan.io/${encodeURIComponent(value)}`,
      {
        timeoutMs: 15_000,
      },
    );
    if (res.status === 404) return result();
    if (res.status === 429) return result({ rateLimited: true });
    if (!res.ok) throw httpError(res);
    const data = await res.json();
    const out = new Set();
    for (const h of [...(data.hostnames || []), ...(data.domains || [])]) {
      if (isValidDomain(h)) out.add(clean(h));
    }
    return result({ domains: out });
  });
}

async function otx(value) {
  return guarded(null, async () => {
    const res = await request(
      `https://otx.alienvault.com/api/v1/indicators/IPv4/${encodeURIComponent(value)}/passive_dns`,
    );
    if (res.status === 429) return result({ rateLimited: true });
    if (!res.ok) throw httpError(res);
    const data = await res.json();
    const out = new Set();
    for (const entry of data.passive_dns || []) {
      if (isValidDomain(entry.hostname)) out.add(clean(entry.hostname));
    }
    return result({ domains: out });
  });
}

async function dnsdb(value, recordType, { apiKey, extra = {} } = {}) {
  if (!apiKey) return result();
  return guarded(null, async () => {
    const server = String(extra.server || 'https://api.dnsdb.info').replace(
      /\/+$/,
      '',
    );
    const limit = Number(extra.max_results) || 1000;
    const isCname = String(recordType || 'CNAME').toUpperCase() === 'CNAME';
    const url = isCname
      ? `${server}/dnsdb/v2/lookup/rdata/name/${encodeURIComponent(value)}?rrtype=CNAME&limit=${limit}`
      : `${server}/dnsdb/v2/lookup/rdata/ip/${encodeURIComponent(value)}?rrtype=A&limit=${limit}`;
    const res = await request(url, {
      headers: { 'X-API-Key': apiKey, Accept: 'application/x-ndjson' },
      timeoutMs: 25_000,
    });
    if (res.status === 403)
      return result({ error: '403 - check API key/entitlement' });
    if (res.status === 429) return result({ rateLimited: true });
    if (!res.ok) throw httpError(res);
    const out = new Set();
    for (const line of (await res.text()).split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const rrname = clean((obj.obj || obj).rrname);
        if (isValidDomain(rrname)) out.add(rrname);
      } catch {
        /* skip malformed lines */
      }
    }
    return result({ domains: out });
  });
}

// ── Paginated sources (state = the source's own cursor) ─────────────────────

async function ipthc(value, _type, { state } = {}) {
  return guarded(
    state,
    async () => {
      const body = { target_domain: value, limit: 100 };
      if (state) body.page_state = state;
      const res = await request('https://ip.thc.org/api/v1/lookup/cnames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: 25_000,
      });
      if (res.status === 429)
        return result({
          nextState: state,
          exhausted: false,
          rateLimited: true,
        });
      if (!res.ok) throw httpError(res);
      const data = await res.json();
      const out = new Set();
      walkJsonForDomains(data, out);
      let nextState = null;
      if (data && typeof data === 'object') {
        for (const k of ['next_page_state', 'page_state', 'pageState']) {
          if (data[k]) {
            nextState = String(data[k]);
            break;
          }
        }
      }
      return result({
        domains: out,
        nextState,
        exhausted: !nextState || out.size === 0,
      });
    },
    { paginated: true },
  );
}

async function robtex(value, _type, { state } = {}) {
  return guarded(
    state,
    async () => {
      const limit = 100;
      const offset = state ? Number(state) || 0 : 0;
      const qs = new URLSearchParams({
        target: value,
        limit: String(limit),
        offset: String(offset),
      });
      const res = await request(
        `https://freeapi.robtex.com/reverse_lookup_cname?${qs}`,
      );
      if (res.status === 429)
        return result({
          nextState: state,
          exhausted: false,
          rateLimited: true,
        });
      if (!res.ok) throw httpError(res);
      const data = await res.json();
      if (data && data.status === 'ratelimited') {
        return result({
          nextState: state,
          exhausted: false,
          rateLimited: true,
        });
      }
      const out = new Set();
      walkJsonForDomains(data, out);
      const full = out.size >= limit;
      return result({
        domains: out,
        nextState: full ? String(offset + limit) : null,
        exhausted: !full,
      });
    },
    { paginated: true },
  );
}

async function securitytrails(value, recordType, { state, apiKey } = {}) {
  if (!apiKey) return result();
  return guarded(
    state,
    async () => {
      const field =
        String(recordType || 'CNAME').toUpperCase() === 'CNAME'
          ? 'cname'
          : 'ipv4';
      const page = state ? Number(state) || 1 : 1;
      const res = await request(
        `https://api.securitytrails.com/v1/domains/list?page=${page}`,
        {
          method: 'POST',
          headers: { APIKEY: apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ filter: { [field]: value } }),
          timeoutMs: 25_000,
        },
      );
      if (res.status === 401)
        return result({
          nextState: state,
          exhausted: true,
          error: '401 - check API key',
        });
      if (res.status === 429)
        return result({
          nextState: state,
          exhausted: false,
          rateLimited: true,
        });
      if (!res.ok) throw httpError(res);
      const data = await res.json();
      const records = data.records || [];
      const out = new Set();
      for (const r of records)
        if (isValidDomain(r.hostname)) out.add(clean(r.hostname));
      const full = records.length >= 100;
      return result({
        domains: out,
        nextState: full ? String(page + 1) : null,
        exhausted: !full,
      });
    },
    { paginated: true },
  );
}

/** Registry: label, adapter, free/paid, which record type, pagination, default pace. */
const SOURCES = {
  rapiddns: {
    label: 'RapidDNS',
    fn: rapiddns,
    kind: 'free',
    appliesTo: 'both',
    paginated: false,
    defaultRph: 60,
  },
  crtsh: {
    label: 'crt.sh',
    fn: crtsh,
    kind: 'free',
    appliesTo: 'CNAME',
    paginated: false,
    defaultRph: 30,
  },
  certspotter: {
    label: 'Certspotter',
    fn: certspotter,
    kind: 'free',
    appliesTo: 'CNAME',
    paginated: false,
    defaultRph: 90,
  },
  ipthc: {
    label: 'IP.THC',
    fn: ipthc,
    kind: 'free',
    appliesTo: 'CNAME',
    paginated: true,
    defaultRph: 120,
  },
  robtex: {
    label: 'Robtex',
    fn: robtex,
    kind: 'free',
    appliesTo: 'CNAME',
    paginated: true,
    defaultRph: 10,
  },
  shodan_internetdb: {
    label: 'Shodan InternetDB',
    fn: shodanInternetdb,
    kind: 'free',
    appliesTo: 'A',
    paginated: false,
    defaultRph: 120,
  },
  otx: {
    label: 'AlienVault OTX',
    fn: otx,
    kind: 'free',
    appliesTo: 'A',
    paginated: false,
    defaultRph: 120,
  },
  securitytrails: {
    label: 'SecurityTrails',
    fn: securitytrails,
    kind: 'paid',
    appliesTo: 'both',
    paginated: true,
    defaultRph: 100,
  },
  dnsdb: {
    label: 'DNSDB (Farsight)',
    fn: dnsdb,
    kind: 'paid',
    appliesTo: 'both',
    paginated: false,
    defaultRph: 100,
  },
};

const applies = (spec, recordType) =>
  spec.appliesTo === 'both' || spec.appliesTo === recordType;

module.exports = {
  SOURCES,
  applies,
  isValidDomain,
  walkJsonForDomains,
  USER_AGENT,
};
