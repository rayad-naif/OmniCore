'use strict';

/**
 * rdns/scheduler.js
 * The 24/7 loop (ported from scheduler.py + ratelimit.py).
 *
 * Every few seconds, on one API instance at a time (database lease):
 *   1. DNS polling — for every enabled watchlist target and every enabled source
 *      that applies to it, if that (target, source) cursor is due, fetch the next
 *      page, merge new domains (deduplicated), and persist the cursor and pacing.
 *   2. Forms crawl — advance a few queued domains by one page each.
 *
 * Pacing state lives in the database (rdns_cursors.next_allowed_at /
 * backoff_seconds), so a restart or redeploy never re-bursts a source.
 */

const { pool } = require('../lib/db');
const logger = require('../utils/logger');
const { open } = require('../lib/secretBox');
const { SOURCES, applies } = require('./sources');
const crawler = require('./crawler');
const { ensureSchema, log, trimLogs, claimLease } = require('./schema');

const TICK_MS = Number(process.env.RDNS_TICK_SECONDS || 5) * 1000;
const CRAWL_PAGES_PER_TICK = 5;
const SOURCE_CALLS_PER_TICK = 12;

// ── Pacing (ratelimit.py) ────────────────────────────────────────────────────
const MIN_BACKOFF = 30;
const MAX_BACKOFF = 3600;
const pacing = {
  interval: (rph) => 3600 / Math.max(1, Number(rph) || 1),
  afterSuccess: (rph) => ({ delay: pacing.interval(rph), backoff: 0 }),
  afterRateLimited: (cur) => {
    const backoff = Math.min((cur || MIN_BACKOFF) * 2, MAX_BACKOFF);
    return { delay: backoff, backoff };
  },
  afterError: (cur) => {
    const backoff = Math.min((cur || 15) * 2, 900);
    return { delay: backoff, backoff };
  },
  afterExhausted: (hours) => ({
    delay: Math.max(1, Number(hours) || 24) * 3600,
    backoff: 0,
  }),
};

function sourceKey(row) {
  if (!row?.api_key_sealed) return '';
  try {
    return open(row.api_key_sealed);
  } catch {
    return '';
  }
}

/** Upserts discovered domains; returns the ones that are new for this target. */
async function mergeDomains(target, domains, label) {
  const list = [...domains];
  if (!list.length) return [];
  const { rows } = await pool.query(
    `INSERT INTO rdns_domains (target_id, domain, record_type, sources)
     SELECT $1, d, $2, ARRAY[$3]::text[] FROM unnest($4::text[]) AS d
     ON CONFLICT (target_id, domain) DO UPDATE SET
       last_seen_at = NOW(),
       sources = CASE WHEN $3 = ANY(rdns_domains.sources) THEN rdns_domains.sources
                      ELSE array_append(rdns_domains.sources, $3) END
     RETURNING domain, (xmax = 0) AS inserted`,
    [target.id, target.record_type, label, list],
  );
  const fresh = rows.filter((r) => r.inserted).map((r) => r.domain);
  if (fresh.length && target.crawl_forms) {
    await pool.query(
      `INSERT INTO rdns_crawl_jobs (domain) SELECT unnest($1::text[]) ON CONFLICT (domain) DO NOTHING`,
      [fresh],
    );
  }
  return fresh;
}

async function pollSource(target, cfg, spec) {
  await pool.query(
    `INSERT INTO rdns_cursors (target_id, source_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [target.id, cfg.key],
  );
  const { rows } = await pool.query(
    `SELECT * FROM rdns_cursors WHERE target_id = $1 AND source_key = $2 AND next_allowed_at <= NOW()`,
    [target.id, cfg.key],
  );
  const cursor = rows[0];
  if (!cursor) return false;

  let res;
  try {
    res = await spec.fn(target.value, target.record_type, {
      state: cursor.page_state,
      apiKey: sourceKey(cfg),
      extra: cfg.extra || {},
    });
  } catch (err) {
    res = { domains: new Set(), error: err.message, exhausted: true };
  }

  const save = (fields) => {
    const keys = Object.keys(fields);
    const sets = keys.map((k, i) =>
      k === 'delay'
        ? `next_allowed_at = NOW() + ($${i + 2} || ' seconds')::interval`
        : `${k} = $${i + 2}`,
    );
    return pool.query(
      `UPDATE rdns_cursors SET last_run_at = NOW(), ${sets.join(', ')} WHERE id = $1`,
      [
        cursor.id,
        ...keys.map((k) =>
          k === 'delay' ? String(Math.ceil(fields[k])) : fields[k],
        ),
      ],
    );
  };

  if (res.rateLimited) {
    const p = pacing.afterRateLimited(cursor.backoff_seconds);
    await save({
      status: 'rate_limited',
      delay: p.delay,
      backoff_seconds: p.backoff,
    });
    await log(
      'warning',
      'scheduler',
      `[${spec.label}] rate limited on '${target.value}', backing off ${p.backoff}s`,
    );
    return true;
  }
  if (res.error) {
    const p = pacing.afterError(cursor.backoff_seconds);
    await save({
      status: 'error',
      last_error: String(res.error).slice(0, 500),
      delay: p.delay,
      backoff_seconds: p.backoff,
    });
    await log(
      'warning',
      'scheduler',
      `[${spec.label}] error on '${target.value}': ${res.error}`,
    );
    return true;
  }

  const fresh = await mergeDomains(target, res.domains, spec.label);
  const found = res.domains.size;
  const common = {
    last_error: null,
    pages_fetched_total: cursor.pages_fetched_total + 1,
    records_found_total: cursor.records_found_total + found,
  };
  const done = !spec.paginated || res.exhausted || !res.nextState;
  if (done) {
    const p = pacing.afterExhausted(target.rescan_interval_hours);
    await save({
      ...common,
      status: 'exhausted',
      exhausted_at: new Date(),
      page_number: 0,
      page_state: null,
      delay: p.delay,
      backoff_seconds: 0,
    });
    if (spec.paginated) {
      await log(
        'info',
        'scheduler',
        `[${spec.label}] finished walking '${target.value}': ${common.records_found_total} records so far, ${fresh.length} new this pass. Rechecking in ${target.rescan_interval_hours}h.`,
      );
    } else if (fresh.length) {
      await log(
        'info',
        'scheduler',
        `[${spec.label}] '${target.value}': +${fresh.length} new domain(s)`,
      );
    }
  } else {
    const p = pacing.afterSuccess(cfg.requests_per_hour);
    await save({
      ...common,
      status: 'active',
      page_number: cursor.page_number + 1,
      page_state: res.nextState,
      delay: p.delay,
      backoff_seconds: 0,
    });
    if (fresh.length) {
      await log(
        'info',
        'scheduler',
        `[${spec.label}] '${target.value}' page ${cursor.page_number + 1}: +${fresh.length} new domain(s)`,
      );
    }
  }
  return true;
}

async function runDnsTick() {
  const { rows: targets } = await pool.query(
    `SELECT * FROM rdns_targets WHERE enabled = true ORDER BY id`,
  );
  if (!targets.length) return 0;
  const { rows: configs } = await pool.query(
    `SELECT * FROM rdns_sources WHERE enabled = true`,
  );
  let calls = 0;
  for (const target of targets) {
    for (const cfg of configs) {
      const spec = SOURCES[cfg.key];
      if (!spec || !applies(spec, target.record_type)) continue;
      if (spec.kind === 'paid' && !cfg.api_key_sealed) continue;
      try {
        if (await pollSource(target, cfg, spec)) calls += 1;
      } catch (err) {
        await log(
          'error',
          'scheduler',
          `unexpected error polling ${cfg.key} for '${target.value}': ${err.message}`,
        );
      }
      if (calls >= SOURCE_CALLS_PER_TICK) return calls;
    }
  }
  return calls;
}

async function crawlJob(job) {
  const update = (fields) => {
    const keys = Object.keys(fields);
    return pool.query(
      `UPDATE rdns_crawl_jobs SET last_run_at = NOW(), ${keys
        .map((k, i) =>
          k === 'delay'
            ? `next_allowed_at = NOW() + ($${i + 2} || ' seconds')::interval`
            : `${k} = $${i + 2}`,
        )
        .join(', ')} WHERE id = $1`,
      [
        job.id,
        ...keys.map((k) =>
          k === 'delay'
            ? String(fields[k])
            : ['queue', 'visited', 'robots_disallow'].includes(k)
              ? JSON.stringify(fields[k])
              : fields[k],
        ),
      ],
    );
  };

  let { queue, visited } = job;
  let disallow = job.robots_disallow || [];
  let delay = job.crawl_delay_seconds || crawler.DEFAULT_CRAWL_DELAY;
  if (!job.seeded) {
    try {
      const s = await crawler.seed(job.domain, job.max_pages);
      queue = s.queue;
      disallow = s.disallow;
      delay = s.crawlDelay;
      visited = [];
    } catch (err) {
      await update({ status: 'failed', last_error: err.message });
      await log(
        'warning',
        'crawler',
        `${job.domain}: failed to seed crawl (${err.message})`,
      );
      return;
    }
  }
  queue = Array.isArray(queue) ? [...queue] : [];
  visited = Array.isArray(visited) ? [...visited] : [];

  if (!queue.length || job.pages_crawled >= job.max_pages) {
    await update({
      status: 'done',
      seeded: true,
      queue,
      visited,
      robots_disallow: disallow,
      crawl_delay_seconds: delay,
    });
    await log(
      'info',
      'crawler',
      `${job.domain}: done — ${job.pages_crawled} pages, ${job.forms_found} forms`,
    );
    return;
  }

  const url = queue.shift();
  visited.push(url);
  let pages = job.pages_crawled;
  let forms = job.forms_found;
  let lastError = null;
  let pathname = '/';
  try {
    pathname = new URL(url).pathname || '/';
  } catch {
    /* keep '/' */
  }

  if (!crawler.isDisallowed(pathname, disallow)) {
    pages += 1;
    const res = await crawler.safeFetch(url);
    if (res.error) lastError = res.error;
    else if (res.status === 200 && res.contentType.includes('text/html')) {
      const page = crawler.parsePage(res.body, res.url);
      let added = 0;
      for (const [index, form] of page.forms.entries()) {
        const ins = await pool.query(
          `INSERT INTO rdns_forms (domain, page_url, form_index, method, action, field_names, field_count, guessed_purpose, page_title)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (domain, page_url, form_index) DO NOTHING`,
          [
            job.domain,
            url.slice(0, 1000),
            index,
            form.method,
            form.action,
            JSON.stringify(form.fields),
            form.fieldCount,
            crawler.guessPurpose(url, page.title, form.actionAttr),
            page.title,
          ],
        );
        added += ins.rowCount;
      }
      forms += added;
      if (added)
        await log(
          'info',
          'crawler',
          `${job.domain}: ${url} → ${added} form(s)`,
        );
      // Extend the queue with same-site links, bounded by max_pages.
      const known = new Set([...queue, ...visited]);
      for (const href of page.links) {
        if (queue.length + visited.length >= job.max_pages) break;
        let abs;
        try {
          abs = new URL(href, url);
        } catch {
          continue;
        }
        if (!['http:', 'https:'].includes(abs.protocol)) continue;
        if (!crawler.onDomain(abs.hostname, job.domain)) continue;
        abs.hash = '';
        const clean = abs.toString();
        if (known.has(clean)) continue;
        known.add(clean);
        queue.push(clean);
      }
    }
  }

  const finished = !queue.length || pages >= job.max_pages;
  await update({
    status: finished ? 'done' : 'crawling',
    seeded: true,
    queue,
    visited,
    robots_disallow: disallow,
    crawl_delay_seconds: delay,
    pages_crawled: pages,
    forms_found: forms,
    last_error: lastError,
    delay,
  });
  if (finished)
    await log(
      'info',
      'crawler',
      `${job.domain}: done — ${pages} pages, ${forms} forms`,
    );
}

async function runCrawlTick() {
  const { rows } = await pool.query(
    `SELECT * FROM rdns_crawl_jobs
      WHERE status IN ('queued', 'crawling') AND next_allowed_at <= NOW()
      ORDER BY next_allowed_at LIMIT $1`,
    [CRAWL_PAGES_PER_TICK],
  );
  for (const job of rows) {
    try {
      await crawlJob(job);
    } catch (err) {
      await log(
        'error',
        'crawler',
        `unexpected error crawling '${job.domain}': ${err.message}`,
      );
    }
  }
  return rows.length;
}

let timer = null;
let running = false;
let lastTrim = 0;

async function tick() {
  if (running) return;
  running = true;
  try {
    await ensureSchema();
    // One instance at a time; the lease outlives a slow tick.
    if (!(await claimLease('rdns:scheduler', 120_000))) return;
    try {
      await runDnsTick();
      await runCrawlTick();
      if (Date.now() - lastTrim > 3600_000) {
        lastTrim = Date.now();
        await trimLogs();
      }
    } finally {
      await pool
        .query(`UPDATE rdns_locks SET until = 0 WHERE key = 'rdns:scheduler'`)
        .catch(() => {});
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'rdns_tick_failed');
  } finally {
    running = false;
  }
}

function startRdnsWorker() {
  if (timer || process.env.RDNS_WORKER === 'false') return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  ensureSchema()
    .then(() => log('info', 'scheduler', 'Background worker started.'))
    .catch((err) => logger.warn({ err: err.message }, 'rdns_schema_failed'));
}

function stopRdnsWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  startRdnsWorker,
  stopRdnsWorker,
  tick,
  runDnsTick,
  runCrawlTick,
  pacing,
  mergeDomains,
};
