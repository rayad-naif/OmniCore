'use strict';

/**
 * rdns/crawler.js
 * Forms-only crawler (ported from crawler.py). For each discovered domain it
 * walks a bounded set of that domain's own pages (sitemap.xml, else links from
 * the home page) and records which pages contain an HTML <form>: method,
 * action, field NAMES and a guessed purpose. It never stores page text, field
 * values, emails, names or any other personal data.
 *
 * Politeness: robots.txt Disallow and Crawl-delay are honoured, one page per
 * domain per scheduler turn, at most `max_pages` pages per domain, 3 MB per
 * page, and hosts resolving to private/loopback/link-local addresses are
 * refused (checked again on every redirect).
 */

const dns = require('node:dns/promises');
const net = require('node:net');
const cheerio = require('cheerio');
const { isPrivateIp } = require('../lib/integrations/dispatcher');
const { USER_AGENT } = require('./sources');

const DEFAULT_CRAWL_DELAY = 2;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const PURPOSE_KEYWORDS = [
  [
    'careers',
    [
      'career',
      'jobs',
      'job-',
      '/job/',
      'apply',
      'hiring',
      'recruit',
      'join-us',
      'join_us',
      'vacanc',
    ],
  ],
  [
    'contact',
    ['contact', 'support', 'enquiry', 'inquiry', 'get-in-touch', 'help'],
  ],
  ['newsletter', ['newsletter', 'subscribe', 'signup-email', 'mailing-list']],
  ['login', ['login', 'signin', 'sign-in', 'log-in', 'account', 'portal']],
  ['search', ['search', 'find']],
];

function guessPurpose(pageUrl, title, action) {
  const hay = `${pageUrl} ${title} ${action}`.toLowerCase();
  for (const [purpose, words] of PURPOSE_KEYWORDS) {
    if (words.some((w) => hay.includes(w))) return purpose;
  }
  return 'unknown';
}

async function isSafeHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '');
  if (!host) return false;
  const addrs = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true }).catch(() => []);
  return addrs.length > 0 && !addrs.some((a) => isPrivateIp(a.address));
}

async function readCapped(res, maxBytes) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * GET with an SSRF check on every hop. Returns
 * { status, contentType, body, url } or { error }.
 * Bodies are read only for HTML (or `anyText` responses such as robots.txt).
 */
async function safeFetch(url, { anyText = false, timeoutMs = 15_000 } = {}) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let u;
    try {
      u = new URL(current);
    } catch {
      return { error: 'invalid URL' };
    }
    if (!['http:', 'https:'].includes(u.protocol))
      return { error: 'unsupported scheme' };
    if (!(await isSafeHost(u.hostname)))
      return { error: 'refused (private/unsafe host)' };
    let res;
    try {
      res = await fetch(u, {
        redirect: 'manual',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xml;q=0.9,*/*;q=0.5',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return {
        error: err?.name === 'TimeoutError' ? 'timed out' : err.message,
      };
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, u).toString();
      continue;
    }
    const contentType = res.headers.get('content-type') || '';
    const wanted =
      res.status === 200 && (anyText || contentType.includes('text/html'));
    const body = wanted ? await readCapped(res, MAX_RESPONSE_BYTES) : '';
    if (!wanted) await res.body?.cancel().catch(() => {});
    return { status: res.status, contentType, body, url: u.toString() };
  }
  return { error: 'too many redirects' };
}

/** robots.txt → { disallow: [prefix], crawlDelay, sitemaps: [url] } */
function parseRobots(text) {
  const disallow = [];
  const sitemaps = [];
  let crawlDelay = DEFAULT_CRAWL_DELAY;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'disallow' && value) disallow.push(value);
    else if (key === 'crawl-delay') {
      const n = Math.ceil(Number(value));
      if (Number.isFinite(n))
        crawlDelay = Math.min(Math.max(crawlDelay, n), 300);
    } else if (key === 'sitemap' && value) sitemaps.push(value);
  }
  return { disallow, crawlDelay, sitemaps };
}

const isDisallowed = (pathname, disallow) =>
  (disallow || []).some((prefix) => pathname.startsWith(prefix));

const onDomain = (hostname, domain) =>
  hostname === domain || hostname.endsWith(`.${domain}`);

/** Initial queue from robots.txt sitemaps / sitemap.xml, else the home page. */
async function seed(domain, maxPages) {
  const robots = await safeFetch(`https://${domain}/robots.txt`, {
    anyText: true,
  });
  const parsed =
    robots.status === 200 ? parseRobots(robots.body) : parseRobots('');
  const candidates = parsed.sitemaps.length
    ? parsed.sitemaps
    : [`https://${domain}/sitemap.xml`];
  let urls = [];
  for (const sm of candidates.slice(0, 5)) {
    const res = await safeFetch(sm, { anyText: true });
    if (res.status !== 200) continue;
    const locs = [...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(
      (m) => m[1],
    );
    urls = locs.filter((u) => {
      try {
        return onDomain(new URL(u).hostname, domain);
      } catch {
        return false;
      }
    });
    if (urls.length) break;
  }
  if (!urls.length) urls = [`https://${domain}/`];
  return {
    queue: [...new Set(urls)].slice(0, maxPages),
    disallow: parsed.disallow,
    crawlDelay: parsed.crawlDelay,
  };
}

/** Extracts forms (field names only), same-site links and the title. */
function parsePage(html, pageUrl) {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim().slice(0, 500);
  const forms = [];
  $('form').each((_i, el) => {
    const form = $(el);
    const fields = [];
    form.find('input, select, textarea').each((_j, f) => {
      const name = $(f).attr('name') || $(f).attr('id');
      if (name) fields.push(String(name).slice(0, 100));
    });
    const actionAttr = form.attr('action') || '';
    let action = pageUrl;
    try {
      if (actionAttr) action = new URL(actionAttr, pageUrl).toString();
    } catch {
      action = actionAttr;
    }
    forms.push({
      method: String(form.attr('method') || 'GET')
        .toUpperCase()
        .slice(0, 10),
      action: action.slice(0, 1000),
      actionAttr,
      fields: fields.slice(0, 50),
      fieldCount: fields.length,
    });
  });
  const links = [];
  $('a[href]').each((_i, a) => links.push($(a).attr('href')));
  return { title, forms, links };
}

module.exports = {
  safeFetch,
  parseRobots,
  isDisallowed,
  onDomain,
  seed,
  parsePage,
  guessPurpose,
  isSafeHost,
  DEFAULT_CRAWL_DELAY,
};
