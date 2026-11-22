'use strict';

/**
 * rdns/routes.js — /api/super-admin/rdns (platform super admins only)
 *
 *   GET    /stats
 *   GET    /targets                    watchlist with per-source progress
 *   POST   /targets                    { record_type: 'A'|'CNAME', value, notes?, rescan_interval_hours?, crawl_forms? }
 *   PATCH  /targets/:id                { enabled?, notes?, rescan_interval_hours?, crawl_forms? }
 *   POST   /targets/:id/rescan         walk every source again from page 1 now
 *   DELETE /targets/:id
 *   GET    /sources                    source settings (API keys masked)
 *   PATCH  /sources/:key               { enabled?, requests_per_hour?, api_key? ('' clears), extra? }
 *   GET    /domains[?target_id&q&page&page_size]      · GET /domains/export.csv
 *   GET    /forms[?domain&purpose&q&page&page_size]   · GET /forms/export.csv
 *   GET    /crawl-jobs[?status]
 *   GET    /logs[?level&component&limit]
 *   POST   /lookup                     { type, value } one-off search (not saved; 3 pages max)
 */

const express = require('express');
const { requireAuth, isSuperAdminAgent } = require('../middleware/auth');
const { pool } = require('../lib/db');
const { seal, mask, open } = require('../lib/secretBox');
const { SOURCES, applies } = require('./sources');
const { ensureSchema, log } = require('./schema');

const router = express.Router();
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.use(
  requireAuth,
  wrap(async (req, res, next) => {
    if (!(await isSuperAdminAgent(req.agent))) {
      return res.status(403).json({ error: 'Forbidden — super admin only' });
    }
    await ensureSchema();
    return next();
  }),
);

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOST =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function validTarget(type, value) {
  if (type === 'A') return IPV4.test(value);
  if (type === 'CNAME') return HOST.test(value);
  return false;
}

function page(req) {
  const p = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(500, Math.max(1, Number(req.query.page_size) || 100));
  return { p, size, offset: (p - 1) * size };
}

function csvCell(v) {
  const s = Array.isArray(v) ? v.join(';') : v == null ? '' : String(v);
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function sendCsv(res, filename, header, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write(`${header.map(csvCell).join(',')}\n`);
  for (const r of rows) res.write(`${r.map(csvCell).join(',')}\n`);
  res.end();
}

function shapeSource(row) {
  const spec = SOURCES[row.key];
  let key = '';
  try {
    key = row.api_key_sealed ? open(row.api_key_sealed) : '';
  } catch {
    key = '';
  }
  return {
    key: row.key,
    label: spec?.label || row.key,
    kind: spec?.kind || 'free',
    applies_to: spec?.appliesTo || 'both',
    paginated: Boolean(spec?.paginated),
    enabled: row.enabled,
    requests_per_hour: row.requests_per_hour,
    has_key: Boolean(row.api_key_sealed),
    api_key: key ? mask(key, 4) : '',
    extra: row.extra || {},
  };
}

// ── Stats ────────────────────────────────────────────────────────────────────
router.get(
  '/stats',
  wrap(async (_req, res) => {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM rdns_targets) AS targets_total,
        (SELECT COUNT(*)::int FROM rdns_targets WHERE enabled) AS targets_enabled,
        (SELECT COUNT(*)::int FROM rdns_domains) AS domains_total,
        (SELECT COUNT(*)::int FROM rdns_domains WHERE first_seen_at > NOW() - INTERVAL '24 hours') AS domains_24h,
        (SELECT COUNT(*)::int FROM rdns_forms) AS forms_total,
        (SELECT COUNT(*)::int FROM rdns_crawl_jobs WHERE status IN ('queued','crawling')) AS crawl_jobs_pending,
        (SELECT COUNT(*)::int FROM rdns_sources WHERE enabled) AS sources_active,
        (SELECT COUNT(*)::int FROM rdns_logs WHERE level = 'error' AND ts > NOW() - INTERVAL '24 hours') AS errors_24h`);
    res.json({ ...rows[0], worker: process.env.RDNS_WORKER !== 'false' });
  }),
);

// ── Watchlist ────────────────────────────────────────────────────────────────
router.get(
  '/targets',
  wrap(async (_req, res) => {
    const { rows } = await pool.query(`
      SELECT t.*,
             (SELECT COUNT(*)::int FROM rdns_domains d WHERE d.target_id = t.id) AS domain_count,
             COALESCE((SELECT json_agg(json_build_object(
                 'source_key', c.source_key, 'status', c.status, 'page_number', c.page_number,
                 'pages_fetched_total', c.pages_fetched_total, 'records_found_total', c.records_found_total,
                 'next_allowed_at', c.next_allowed_at, 'last_run_at', c.last_run_at, 'last_error', c.last_error)
                 ORDER BY c.source_key)
               FROM rdns_cursors c WHERE c.target_id = t.id), '[]') AS cursors
        FROM rdns_targets t ORDER BY t.created_at DESC`);
    res.json(rows);
  }),
);

router.post(
  '/targets',
  wrap(async (req, res) => {
    const type = String(req.body?.record_type || '')
      .toUpperCase()
      .trim();
    const value = String(req.body?.value || '')
      .trim()
      .toLowerCase()
      .replace(/\.$/, '');
    if (!['A', 'CNAME'].includes(type))
      return res
        .status(400)
        .json({ error: "record_type must be 'A' or 'CNAME'" });
    if (!validTarget(type, value)) {
      return res.status(400).json({
        error:
          type === 'A'
            ? 'value must be an IPv4 address'
            : 'value must be a host name',
      });
    }
    const hours = Math.min(
      24 * 30,
      Math.max(1, Number(req.body?.rescan_interval_hours) || 24),
    );
    const { rows } = await pool.query(
      `INSERT INTO rdns_targets (record_type, value, notes, rescan_interval_hours, crawl_forms, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (record_type, value) DO NOTHING RETURNING *`,
      [
        type,
        value,
        String(req.body?.notes || '').slice(0, 500),
        hours,
        req.body?.crawl_forms !== false,
        req.agent.email,
      ],
    );
    if (!rows.length)
      return res
        .status(409)
        .json({ error: 'This target is already on the watchlist' });
    await log(
      'info',
      'api',
      `target added to watchlist: ${type} ${value} (by ${req.agent.email})`,
    );
    res.status(201).json(rows[0]);
  }),
);

router.patch(
  '/targets/:id',
  wrap(async (req, res) => {
    const sets = [];
    const vals = [Number(req.params.id)];
    const add = (col, v) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (req.body?.enabled !== undefined)
      add('enabled', Boolean(req.body.enabled));
    if (req.body?.notes !== undefined)
      add('notes', String(req.body.notes || '').slice(0, 500));
    if (req.body?.rescan_interval_hours !== undefined) {
      add(
        'rescan_interval_hours',
        Math.min(
          24 * 30,
          Math.max(1, Number(req.body.rescan_interval_hours) || 24),
        ),
      );
    }
    if (req.body?.crawl_forms !== undefined)
      add('crawl_forms', Boolean(req.body.crawl_forms));
    if (!sets.length)
      return res.status(400).json({ error: 'Nothing to update' });
    const { rows } = await pool.query(
      `UPDATE rdns_targets SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      vals,
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  }),
);

router.post(
  '/targets/:id/rescan',
  wrap(async (req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE rdns_cursors SET status = 'pending', page_state = NULL, page_number = 0,
              next_allowed_at = NOW(), backoff_seconds = 0
        WHERE target_id = $1 AND status <> 'rate_limited'`,
      [Number(req.params.id)],
    );
    res.json({ ok: true, cursors: rowCount });
  }),
);

router.delete(
  '/targets/:id',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `DELETE FROM rdns_targets WHERE id = $1 RETURNING value`,
      [Number(req.params.id)],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await log(
      'info',
      'api',
      `target removed from watchlist: ${rows[0].value} (by ${req.agent.email})`,
    );
    res.json({ ok: true });
  }),
);

// ── Sources ──────────────────────────────────────────────────────────────────
router.get(
  '/sources',
  wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM rdns_sources ORDER BY key`,
    );
    res.json(rows.filter((r) => SOURCES[r.key]).map(shapeSource));
  }),
);

router.patch(
  '/sources/:key',
  wrap(async (req, res) => {
    const key = req.params.key;
    if (!SOURCES[key]) return res.status(404).json({ error: 'Unknown source' });
    const sets = [];
    const vals = [key];
    const add = (col, v) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (req.body?.enabled !== undefined)
      add('enabled', Boolean(req.body.enabled));
    if (req.body?.requests_per_hour !== undefined) {
      add(
        'requests_per_hour',
        Math.min(36_000, Math.max(1, Number(req.body.requests_per_hour) || 1)),
      );
    }
    if (req.body?.api_key !== undefined) {
      const k = String(req.body.api_key || '').trim();
      add('api_key_sealed', k ? seal(k) : null);
    }
    if (
      req.body?.extra !== undefined &&
      req.body.extra &&
      typeof req.body.extra === 'object'
    ) {
      const extra = {};
      if (req.body.extra.server)
        extra.server = String(req.body.extra.server).slice(0, 200);
      if (req.body.extra.max_results)
        extra.max_results = Math.min(
          100_000,
          Number(req.body.extra.max_results) || 1000,
        );
      add('extra', extra);
    }
    if (!sets.length)
      return res.status(400).json({ error: 'Nothing to update' });
    const { rows } = await pool.query(
      `UPDATE rdns_sources SET ${sets.join(', ')}, updated_at = NOW() WHERE key = $1 RETURNING *`,
      vals,
    );
    await log(
      'info',
      'api',
      `source settings changed: ${key} (by ${req.agent.email})`,
    );
    res.json(shapeSource(rows[0]));
  }),
);

// ── Results ──────────────────────────────────────────────────────────────────
function domainFilter(req) {
  const where = [];
  const vals = [];
  if (req.query.target_id) {
    vals.push(Number(req.query.target_id));
    where.push(`d.target_id = $${vals.length}`);
  }
  if (req.query.q) {
    vals.push(`%${String(req.query.q).toLowerCase()}%`);
    where.push(`d.domain LIKE $${vals.length}`);
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', vals };
}

router.get(
  '/domains',
  wrap(async (req, res) => {
    const { where, vals } = domainFilter(req);
    const { p, size, offset } = page(req);
    const [{ rows }, { rows: count }] = await Promise.all([
      pool.query(
        `SELECT d.id, d.domain, d.record_type, d.sources, d.first_seen_at, d.last_seen_at, t.value AS target_value
           FROM rdns_domains d JOIN rdns_targets t ON t.id = d.target_id ${where}
          ORDER BY d.first_seen_at DESC, d.id DESC LIMIT ${size} OFFSET ${offset}`,
        vals,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM rdns_domains d ${where}`,
        vals,
      ),
    ]);
    res.json({ items: rows, total: count[0].n, page: p, page_size: size });
  }),
);

router.get(
  '/domains/export.csv',
  wrap(async (req, res) => {
    const { where, vals } = domainFilter(req);
    const { rows } = await pool.query(
      `SELECT d.first_seen_at, d.last_seen_at, d.record_type, t.value AS target, d.domain, d.sources
         FROM rdns_domains d JOIN rdns_targets t ON t.id = d.target_id ${where}
        ORDER BY d.first_seen_at DESC LIMIT 200000`,
      vals,
    );
    sendCsv(
      res,
      'discovered_domains.csv',
      ['first_seen', 'last_seen', 'record_type', 'target', 'domain', 'sources'],
      rows.map((r) => [
        r.first_seen_at.toISOString(),
        r.last_seen_at.toISOString(),
        r.record_type,
        r.target,
        r.domain,
        r.sources,
      ]),
    );
  }),
);

function formFilter(req) {
  const where = [];
  const vals = [];
  if (req.query.domain) {
    vals.push(String(req.query.domain).toLowerCase());
    where.push(`domain = $${vals.length}`);
  }
  if (req.query.purpose) {
    vals.push(String(req.query.purpose));
    where.push(`guessed_purpose = $${vals.length}`);
  }
  if (req.query.q) {
    vals.push(`%${String(req.query.q).toLowerCase()}%`);
    where.push(
      `(domain LIKE $${vals.length} OR page_url ILIKE $${vals.length})`,
    );
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', vals };
}

router.get(
  '/forms',
  wrap(async (req, res) => {
    const { where, vals } = formFilter(req);
    const { p, size, offset } = page(req);
    const [{ rows }, { rows: count }] = await Promise.all([
      pool.query(
        `SELECT * FROM rdns_forms ${where} ORDER BY discovered_at DESC, id DESC LIMIT ${size} OFFSET ${offset}`,
        vals,
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM rdns_forms ${where}`, vals),
    ]);
    res.json({ items: rows, total: count[0].n, page: p, page_size: size });
  }),
);

router.get(
  '/forms/export.csv',
  wrap(async (req, res) => {
    const { where, vals } = formFilter(req);
    const { rows } = await pool.query(
      `SELECT * FROM rdns_forms ${where} ORDER BY discovered_at DESC LIMIT 200000`,
      vals,
    );
    sendCsv(
      res,
      'form_findings.csv',
      [
        'discovered',
        'domain',
        'page_url',
        'page_title',
        'method',
        'action',
        'purpose',
        'field_count',
        'field_names',
      ],
      rows.map((r) => [
        r.discovered_at.toISOString(),
        r.domain,
        r.page_url,
        r.page_title,
        r.method,
        r.action,
        r.guessed_purpose,
        r.field_count,
        r.field_names,
      ]),
    );
  }),
);

router.get(
  '/crawl-jobs',
  wrap(async (req, res) => {
    const vals = [];
    let where = '';
    if (req.query.status) {
      vals.push(String(req.query.status));
      where = `WHERE status = $1`;
    }
    const { rows } = await pool.query(
      `SELECT id, domain, status, pages_crawled, forms_found, max_pages, last_run_at, last_error, created_at
         FROM rdns_crawl_jobs ${where} ORDER BY COALESCE(last_run_at, created_at) DESC LIMIT 500`,
      vals,
    );
    res.json(rows);
  }),
);

router.get(
  '/logs',
  wrap(async (req, res) => {
    const where = [];
    const vals = [];
    if (req.query.level) {
      vals.push(String(req.query.level));
      where.push(`level = $${vals.length}`);
    }
    if (req.query.component) {
      vals.push(String(req.query.component));
      where.push(`component = $${vals.length}`);
    }
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
    const { rows } = await pool.query(
      `SELECT * FROM rdns_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${limit}`,
      vals,
    );
    res.json(rows);
  }),
);

// ── One-off lookup (not saved) ───────────────────────────────────────────────
router.post(
  '/lookup',
  wrap(async (req, res) => {
    const type = String(req.body?.type || '')
      .toUpperCase()
      .trim();
    const value = String(req.body?.value || '')
      .trim()
      .toLowerCase();
    if (!['A', 'CNAME'].includes(type))
      return res.status(400).json({ error: "type must be 'A' or 'CNAME'" });
    if (!validTarget(type, value))
      return res
        .status(400)
        .json({ error: 'Invalid value for this record type' });
    const { rows: configs } = await pool.query(
      `SELECT * FROM rdns_sources WHERE enabled = true`,
    );
    const found = new Map();
    const report = [];
    await Promise.all(
      configs.map(async (cfg) => {
        const spec = SOURCES[cfg.key];
        if (!spec || !applies(spec, type)) return;
        let apiKey = '';
        try {
          apiKey = cfg.api_key_sealed ? open(cfg.api_key_sealed) : '';
        } catch {
          apiKey = '';
        }
        if (spec.kind === 'paid' && !apiKey) return;
        let state = null;
        let count = 0;
        let status = 'ok';
        for (let pageNo = 0; pageNo < 3; pageNo += 1) {
          const r = await spec.fn(value, type, {
            state,
            apiKey,
            extra: cfg.extra || {},
          });
          for (const d of r.domains) {
            if (!found.has(d)) found.set(d, new Set());
            found.get(d).add(spec.label);
            count += 1;
          }
          if (r.rateLimited) status = 'rate limited';
          if (r.error) status = r.error;
          if (
            !spec.paginated ||
            r.exhausted ||
            !r.nextState ||
            r.rateLimited ||
            r.error
          )
            break;
          state = r.nextState;
        }
        report.push({ source: spec.label, results: count, status });
      }),
    );
    const results = [...found.entries()]
      .map(([domain, sources]) => ({ domain, sources: [...sources].sort() }))
      .sort((a, b) => a.domain.localeCompare(b.domain));
    res.json({ type, value, count: results.length, results, sources: report });
  }),
);

module.exports = router;
