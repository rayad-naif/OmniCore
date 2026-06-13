'use strict';

/**
 * crawler.worker.js
 * Atelier OmniCore — Section 7: Web Crawling & Vectorisation Worker
 *
 * Intended to run as a BullMQ worker process (or called directly for testing).
 *
 * Responsibilities:
 *  1. Fetch a URL (respects robots.txt via X-Robots-Tag, obeys rate limiting)
 *  2. Extract clean text from <p> tags using Cheerio
 *  3. Resolve and enqueue internal links from <a href> for breadth-first crawl
 *  4. Upsert a knowledge_article row for each crawled page
 *  5. Call ai.service.vectoriseArticle() to chunk + embed + store in pgvector
 *
 * Job payload (BullMQ):
 * {
 *   tenantId:    string,
 *   brandId:     string,
 *   url:         string,    starting URL to crawl
 *   maxDepth?:   number,    default 2
 *   maxPages?:   number,    default 50
 *   agentId?:    string,    optional: attribute articles to an agent
 * }
 *
 * Standalone usage (no BullMQ):
 *   const { crawlSite } = require('./crawler.worker');
 *   await crawlSite({ tenantId, brandId, url, maxDepth: 2, maxPages: 20 });
 */

const cheerio      = require('cheerio');
const { URL }      = require('url');
const { pool }     = require('../../server');
const aiService    = require('../services/ai.service');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DEFAULT_MAX_DEPTH  = 2;
const DEFAULT_MAX_PAGES  = 50;
const REQUEST_DELAY_MS   = 800;    // polite crawl delay between requests
const REQUEST_TIMEOUT_MS = 12_000;
const USER_AGENT         = 'AtelierOmniCoreBot/1.0 (+https://iratelier.com/bot)';

// HTML elements whose text is included verbatim (beyond <p>)
const TEXT_SELECTORS = ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote'].join(', ');

// Patterns for URLs we should never crawl
const SKIP_EXTENSIONS = /\.(pdf|zip|png|jpg|jpeg|gif|svg|mp4|mp3|css|js|xml|json|ico|woff2?)$/i;
const SKIP_PROTOCOLS  = /^(mailto:|tel:|javascript:|#)/i;

// ---------------------------------------------------------------------------
// SSRF protection — private / loopback / link-local IP ranges
// ---------------------------------------------------------------------------
const PRIVATE_HOST_RE = new RegExp(
  [
    '^localhost$',
    '^127\\.',                          // 127.0.0.0/8  loopback
    '^10\\.',                           // 10.0.0.0/8   private
    '^172\\.(1[6-9]|2[0-9]|3[01])\\.',// 172.16-31.x  private
    '^192\\.168\\.',                    // 192.168.0.0/16 private
    '^169\\.254\\.',                    // 169.254.0.0/16 link-local (AWS IMDS etc.)
    '^::1$',                            // IPv6 loopback
    '^fc00:',                           // IPv6 unique local
    '^fe80:',                           // IPv6 link-local
    '^0\\.0\\.0\\.0$',                  // unspecified
  ].join('|'),
  'i'
);

/**
 * assertPublicUrl(rawUrl)
 *
 * Throws if:
 *  - The protocol is not http: or https:
 *  - The hostname matches any private/loopback/link-local range
 *
 * @param {string} rawUrl
 * @throws {Error} with a descriptive message
 */
function assertPublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`SSRF_INVALID_URL: "${rawUrl}" is not a valid URL`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`SSRF_PROTOCOL: only http/https allowed, got "${parsed.protocol}"`);
  }

  const host = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST_RE.test(host)) {
    throw new Error(`SSRF_PRIVATE_HOST: crawling "${host}" is not permitted`);
  }
}

// ---------------------------------------------------------------------------
// HTTP fetch with timeout
// ---------------------------------------------------------------------------
async function fetchPage(url) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) throw new Error('Non-HTML content type');

    // Honour X-Robots-Tag: noindex / nofollow
    const robotsTag = (res.headers.get('x-robots-tag') || '').toLowerCase();
    const noIndex   = robotsTag.includes('noindex');
    const noFollow  = robotsTag.includes('nofollow');

    const html = await res.text();
    return { html, noIndex, noFollow };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// HTML → plain text extraction
// ---------------------------------------------------------------------------

/**
 * Extract readable text from a Cheerio-parsed document.
 * Focuses on <p> tags per spec, augmented by headings and list items.
 *
 * @param {CheerioAPI} $
 * @returns {string}
 */
function extractText($) {
  // Remove noise elements
  $('script, style, nav, footer, header, aside, form, noscript, iframe, [aria-hidden="true"]').remove();

  const parts = [];
  $(TEXT_SELECTORS).each((_i, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length > 20) parts.push(text);
  });
  return parts.join('\n\n');
}

/**
 * Extract the page title.
 */
function extractTitle($) {
  return (
    $('meta[property="og:title"]').attr('content') ||
    $('title').text() ||
    'Untitled'
  ).trim().slice(0, 255);
}

/**
 * Resolve and deduplicate internal links from the page.
 * Only follows same-origin URLs.
 *
 * @param {CheerioAPI} $ Cheerio instance
 * @param {string} baseUrl  The URL of the current page
 * @returns {string[]} Absolute same-origin URLs
 */
function extractInternalLinks($, baseUrl) {
  const base    = new URL(baseUrl);
  const links   = new Set();

  $('a[href]').each((_i, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || SKIP_PROTOCOLS.test(href) || SKIP_EXTENSIONS.test(href)) return;

    try {
      const resolved = new URL(href, baseUrl);
      // Same origin only — strip hash and query for dedup
      if (resolved.hostname === base.hostname) {
        resolved.hash   = '';
        links.add(resolved.toString());
      }
    } catch { /* ignore malformed URLs */ }
  });
  return [...links];
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Upsert a knowledge_article for a crawled page.
 * Matches on (tenant_id, brand_id, source_url stored in embeddings).
 * Returns the article id.
 */
async function upsertArticle({ tenantId, brandId, title, htmlContent, plainText, agentId = null }) {
  // We use a unique constraint on (tenant_id, brand_id, title) as a proxy.
  // A dedicated source_url column on knowledge_articles would be cleaner —
  // add one as needed without breaking this logic.
  const { rows } = await pool.query(
    `INSERT INTO knowledge_articles
       (tenant_id, brand_id, title, public_html_content, plain_text_content,
        is_public, is_vectorized, author_agent_id)
     VALUES ($1,$2,$3,$4,$5, FALSE, FALSE, $6)
     ON CONFLICT (tenant_id, brand_id, title) DO UPDATE
       SET public_html_content = EXCLUDED.public_html_content,
           plain_text_content  = EXCLUDED.plain_text_content,
           is_vectorized       = FALSE,
           updated_at          = NOW()
     RETURNING id`,
    [tenantId, brandId, title, htmlContent, plainText, agentId]
  );
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// Polite delay
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Core crawl function
// ---------------------------------------------------------------------------

/**
 * crawlSite
 *
 * BFS crawl starting at `url`. For each page:
 *  1. Fetch HTML
 *  2. Extract <p> text via Cheerio
 *  3. Upsert knowledge_article
 *  4. Vectorise with ai.service
 *  5. Enqueue discovered internal links (up to maxDepth)
 *
 * @param {{
 *   tenantId:  string,
 *   brandId:   string,
 *   url:       string,
 *   maxDepth?: number,
 *   maxPages?: number,
 *   agentId?:  string,
 *   onProgress?: (stats: object) => void
 * }} opts
 *
 * @returns {Promise<{ crawled: number, vectorised: number, errors: number }>}
 */
async function crawlSite({
  tenantId,
  brandId,
  url: startUrl,
  maxDepth  = DEFAULT_MAX_DEPTH,
  maxPages  = DEFAULT_MAX_PAGES,
  agentId   = null,
  onProgress = null,
}) {
  const visited   = new Set();
  const errors    = [];
  let   crawled   = 0;
  let   vectorised = 0;

  // SSRF guard — validate the seed URL before any network activity
  assertPublicUrl(startUrl);

  // BFS queue: { url, depth }
  const queue = [{ url: startUrl, depth: 0 }];

  while (queue.length && crawled < maxPages) {
    const { url, depth } = queue.shift();
    const normalised = url.split('?')[0].split('#')[0];

    if (visited.has(normalised)) continue;
    visited.add(normalised);

    if (SKIP_EXTENSIONS.test(normalised)) continue;

    try {
      console.log(`[crawler] fetching  depth=${depth}  url=${normalised}`);
      const { html, noIndex, noFollow } = await fetchPage(normalised);
      crawled++;

      const $     = cheerio.load(html);
      const title = extractTitle($);
      const text  = extractText($);

      if (!noIndex && text.length > 100) {
        // Upsert article and vectorise
        const articleId = await upsertArticle({
          tenantId,
          brandId,
          title,
          htmlContent: html.slice(0, 500_000),   // cap raw HTML storage
          plainText:   text,
          agentId,
        });

        await aiService.vectoriseArticle({
          articleId,
          tenantId,
          brandId,
          plainText: text,
          sourceUrl: normalised,
        });
        vectorised++;
      }

      // Enqueue child links
      if (!noFollow && depth < maxDepth) {
        const links = extractInternalLinks($, normalised);
        for (const link of links) {
          if (!visited.has(link.split('?')[0])) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }

      onProgress?.({ crawled, vectorised, errors: errors.length, currentUrl: normalised });

    } catch (err) {
      console.error(`[crawler] error  url=${normalised}  msg=${err.message}`);
      errors.push({ url: normalised, error: err.message });
    }

    if (queue.length) await sleep(REQUEST_DELAY_MS);
  }

  const stats = { crawled, vectorised, errors: errors.length, errorDetails: errors };
  console.log('[crawler] complete', stats);
  return stats;
}

// ---------------------------------------------------------------------------
// BullMQ worker registration (optional — only active when REDIS_URL is set)
// ---------------------------------------------------------------------------
let crawlQueue  = null;
let crawlWorker = null;

function registerBullWorker() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log('[crawler] REDIS_URL not set — BullMQ worker not registered');
    return;
  }

  try {
    const { Worker, Queue } = require('bullmq');
    const IORedis = require('ioredis');
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

    const QUEUE_NAME = 'omnicore:crawl';

    crawlQueue = new Queue(QUEUE_NAME, { connection });

    crawlWorker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const { tenantId, brandId, url, maxDepth, maxPages, agentId } = job.data;
        return crawlSite({
          tenantId, brandId, url,
          maxDepth: maxDepth || DEFAULT_MAX_DEPTH,
          maxPages: maxPages || DEFAULT_MAX_PAGES,
          agentId:  agentId  || null,
          onProgress: (stats) => job.updateProgress(stats),
        });
      },
      {
        connection,
        concurrency: 1,         // one crawl job at a time per worker process
        limiter:     { max: 5, duration: 10_000 },
      }
    );

    crawlWorker.on('completed', (job, result) =>
      console.log(`[crawler:worker] job=${job.id} done`, result)
    );
    crawlWorker.on('failed', (job, err) =>
      console.error(`[crawler:worker] job=${job.id} failed`, err.message)
    );

    console.log(`[crawler] BullMQ worker registered on queue "${QUEUE_NAME}"`);
  } catch (err) {
    console.error('[crawler] BullMQ setup failed — running without queue', err.message);
  }
}

/**
 * Enqueue a crawl job.
 * Falls back to running inline if the BullMQ queue is not initialised.
 *
 * @param {{ tenantId, brandId, url, maxDepth?, maxPages?, agentId? }} opts
 */
async function enqueueCrawl(opts) {
  if (crawlQueue) {
    const job = await crawlQueue.add('crawl', opts, {
      attempts:       3,
      backoff:        { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail:   50,
    });
    console.log(`[crawler] enqueued job=${job.id}  url=${opts.url}`);
    return { jobId: job.id };
  }
  // Synchronous fallback (dev / no Redis)
  console.log('[crawler] running inline (no BullMQ)');
  const stats = await crawlSite(opts);
  return { stats };
}

// Auto-register BullMQ worker when this module is loaded
registerBullWorker();

module.exports = {
  crawlSite,
  enqueueCrawl,
  extractText,
  extractInternalLinks,
  assertPublicUrl,
  chunkText: aiService.chunkText,
};
