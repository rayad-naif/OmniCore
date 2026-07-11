'use strict';

/**
 * ai.router.js
 * POST /api/ai/rephrase                          — agent copilot text rephrase
 * GET  /api/ai/knowledge-base                    — list knowledge articles
 * POST /api/ai/knowledge-base                    — create knowledge article
 * PATCH /api/ai/knowledge-base/:id               — update article
 * DELETE /api/ai/knowledge-base/:id              — delete article
 * POST /api/ai/knowledge-base/crawl              — start full-site BFS crawl job
 * GET  /api/ai/knowledge-base/crawl/status/:id   — poll crawl job status
 * GET  /api/ai/settings                          — get brand AI settings
 * PATCH /api/ai/settings/:brandId                — update brand AI system prompt
 */

const { Router }      = require('express');
const { requireAuth, requirePermissionByMethod, requirePermission } = require('../middleware/auth');
const { rephraseText } = require('../services/ai.service');
const logger          = require('../utils/logger');
const { pool }        = require('../lib/db');
const crypto          = require('node:crypto');
const cheerio         = require('cheerio');

// ─── In-memory crawl job store ────────────────────────────────────────────────
// Jobs expire after 30 minutes of age. Restarting the server clears all jobs.
const crawlJobs = new Map(); // jobId → CrawlJob

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of crawlJobs) {
    if (job.startedAt < cutoff) crawlJobs.delete(id);
  }
}, 5 * 60 * 1000).unref();

// ─── BFS site crawler ─────────────────────────────────────────────────────────
const CRAWL_DELAY_MS  = 600;
const CRAWL_TIMEOUT   = 12_000;
const CRAWL_USER_AGENT = 'AtelierOmniCoreBot/1.0 (+https://iratelier.com/bot)';
const SKIP_EXT  = /\.(pdf|zip|png|jpg|jpeg|gif|svg|mp4|mp3|css|js|xml|json|ico|woff2?)$/i;
const SKIP_PROTO = /^(mailto:|tel:|javascript:|#)/i;
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|::1$|fc00:|fe80:|0\.0\.0\.0$)/i;

async function runSiteCrawl({ jobId, tenantId, agentId, brandId, startUrl, maxPages, maxDepth }) {
  const job = crawlJobs.get(jobId);
  const visited = new Set();
  const queue   = [{ url: startUrl, depth: 0 }];

  while (queue.length && job.crawled < maxPages) {
    const { url, depth } = queue.shift();
    const norm = url.split('?')[0].split('#')[0];
    if (visited.has(norm) || SKIP_EXT.test(norm)) continue;
    visited.add(norm);

    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CRAWL_TIMEOUT);
      const res   = await fetch(norm, {
        signal:  ctrl.signal,
        headers: { 'User-Agent': CRAWL_USER_AGENT, Accept: 'text/html' },
        redirect: 'follow',
      });
      clearTimeout(timer);

      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('text/html')) continue;

      const robotsTag = (res.headers.get('x-robots-tag') || '').toLowerCase();
      const noIndex   = robotsTag.includes('noindex');
      const noFollow  = robotsTag.includes('nofollow');

      const html = await res.text();
      const $    = cheerio.load(html);
      $('script,style,nav,footer,header,aside,form,noscript,iframe,[aria-hidden="true"]').remove();

      const title = (
        $('meta[property="og:title"]').attr('content') ||
        $('title').text() ||
        norm
      ).trim().slice(0, 255) || 'Crawled Page';

      const parts = [];
      $('p,li,h1,h2,h3,h4,blockquote').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim();
        if (t.length > 20) parts.push(t);
      });
      const text = parts.join('\n\n').slice(0, 15_000);

      if (!noIndex && text.length > 100) {
        await pool.query(
          `INSERT INTO knowledge_articles
             (tenant_id, brand_id, title, content, plain_text_content, tags, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, brandId || null, title, text, text, ['web-crawl'], agentId]
        );
        job.saved++;
      }

      job.crawled++;
      job.currentUrl = norm;

      // Enqueue child links (same origin only)
      if (!noFollow && depth < maxDepth) {
        const base = new URL(norm);
        $('a[href]').each((_, el) => {
          const href = ($(el).attr('href') || '').trim();
          if (!href || SKIP_PROTO.test(href) || SKIP_EXT.test(href)) return;
          try {
            const resolved = new URL(href, norm);
            resolved.hash  = '';
            const rn = resolved.toString().split('?')[0];
            if (resolved.hostname === base.hostname && !visited.has(rn)) {
              queue.push({ url: resolved.toString(), depth: depth + 1 });
            }
          } catch { /* malformed href */ }
        });
      }

    } catch (err) {
      job.errors++;
      logger.warn({ url: norm, err: err.message }, 'crawl_page_error');
    }

    if (queue.length) await new Promise(r => setTimeout(r, CRAWL_DELAY_MS));
  }

  job.status = 'done';
  logger.info({ jobId, tenantId, crawled: job.crawled, saved: job.saved, errors: job.errors }, 'crawl_site_complete');
}

const router = Router();
router.use(requireAuth);
// Knowledge-base management is gated by the 'knowledge_base' feature permission.
// (rephrase / AI settings remain available to any authenticated agent.)
router.use('/knowledge-base', requirePermissionByMethod('knowledge_base'));

// ─── Idempotent migrations ────────────────────────────────────────────────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS knowledge_articles (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   UUID NOT NULL,
        brand_id    UUID,
        title       TEXT NOT NULL,
        content     TEXT NOT NULL,
        tags        TEXT[] DEFAULT '{}',
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_by  UUID,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE brands
        ADD COLUMN IF NOT EXISTS ai_system_prompt TEXT
    `);
    logger.info('ai_router_migrations_ok');
  } catch (err) {
    logger.warn({ err }, 'ai_router_migration_warning');
  }
})();

// ─── POST /api/ai/rephrase ────────────────────────────────────────────────────
router.post('/rephrase', async (req, res, next) => {
  try {
    const { draft, tone } = req.body || {};
    if (!draft?.trim()) {
      return res.status(400).json({ error: 'draft is required' });
    }

    const rephrased = await rephraseText({ draft: draft.trim(), tone });
    logger.info({ agentId: req.agent?.id }, 'ai_rephrase');
    return res.json({ rephrased });
  } catch (err) {
    logger.error({ err }, 'ai_rephrase_error');
    next(err);
  }
});

// ─── GET /api/ai/knowledge-base ──────────────────────────────────────────────
router.get('/knowledge-base', async (req, res, next) => {
  try {
    const { brand_id } = req.query;
    const params = [req.agent.tenantId];
    let where = 'tenant_id = $1';
    if (brand_id) { where += ` AND (brand_id = $${params.length + 1} OR brand_id IS NULL)`; params.push(brand_id); }
    const { rows } = await pool.query(
      `SELECT id, title, content, tags, brand_id, is_active, created_at, updated_at
       FROM knowledge_articles
       WHERE ${where}
       ORDER BY created_at DESC`,
      params
    );
    return res.json(rows);
  } catch (err) { next(err); }
});

// ─── POST /api/ai/knowledge-base ─────────────────────────────────────────────
router.post('/knowledge-base', async (req, res, next) => {
  try {
    const { title, content, tags = [], brand_id = null } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    if (!content?.trim()) return res.status(400).json({ error: 'content is required' });

    const { rows } = await pool.query(
      `INSERT INTO knowledge_articles (tenant_id, brand_id, title, content, tags, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, content, tags, brand_id, is_active, created_at, updated_at`,
      [req.agent.tenantId, brand_id || null, title.trim(), content.trim(), tags, req.agent.id]
    );
    logger.info({ id: rows[0].id, agentId: req.agent.id }, 'knowledge_article_created');
    return res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ─── PATCH /api/ai/knowledge-base/:id ────────────────────────────────────────
router.patch('/knowledge-base/:id', async (req, res, next) => {
  try {
    const { title, content, tags, is_active } = req.body || {};
    const updates = [];
    const values = [];
    let i = 1;

    if (title !== undefined) { updates.push(`title = $${i++}`); values.push(title.trim()); }
    if (content !== undefined) { updates.push(`content = $${i++}`); values.push(content.trim()); }
    if (tags !== undefined) { updates.push(`tags = $${i++}`); values.push(tags); }
    if (is_active !== undefined) { updates.push(`is_active = $${i++}`); values.push(Boolean(is_active)); }

    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

    updates.push(`updated_at = NOW()`);
    values.push(req.params.id, req.agent.tenantId);

    const { rows } = await pool.query(
      `UPDATE knowledge_articles
       SET ${updates.join(', ')}
       WHERE id = $${i} AND tenant_id = $${i + 1}
       RETURNING id, title, content, tags, brand_id, is_active, created_at, updated_at`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Article not found' });
    return res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── DELETE /api/ai/knowledge-base/:id ───────────────────────────────────────
router.delete('/knowledge-base/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM knowledge_articles WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.agent.tenantId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Article not found' });
    return res.status(204).end();
  } catch (err) { next(err); }
});

// ─── GET /api/ai/settings ─────────────────────────────────────────────────────
// Returns AI + bot settings per brand for the current tenant
router.get('/settings', requirePermission('knowledge_base', 'read'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, brand_name, ai_system_prompt,
              COALESCE(widget_config_json->>'bot_max_messages', '10')      AS bot_max_messages,
              COALESCE(widget_config_json->>'auto_assign_strategy', 'round_robin') AS auto_assign_strategy,
              COALESCE((widget_config_json->>'auto_close_enabled')::boolean, false) AS auto_close_enabled,
              COALESCE(widget_config_json->>'auto_close_idle_minutes', '60') AS auto_close_idle_minutes
       FROM brands
       WHERE tenant_id = $1
       ORDER BY brand_name`,
      [req.agent.tenantId]
    );
    return res.json(rows);
  } catch (err) { next(err); }
});

// ─── PATCH /api/ai/settings/:brandId ─────────────────────────────────────────
// Updates AI system prompt AND bot configuration for a brand.
// Bot settings are stored in widget_config_json (JSONB merge).
router.patch('/settings/:brandId', requirePermission('knowledge_base', 'edit'), async (req, res, next) => {
  try {
    const {
      ai_system_prompt,
      bot_max_messages,
      auto_assign_strategy,
      auto_close_enabled,
      auto_close_idle_minutes,
    } = req.body || {};

    // Build widget_config_json patch (only include provided fields)
    const botPatch = {};
    if (bot_max_messages      !== undefined) botPatch.bot_max_messages      = parseInt(String(bot_max_messages), 10) || 10;
    if (auto_assign_strategy  !== undefined) botPatch.auto_assign_strategy  = auto_assign_strategy;
    if (auto_close_enabled    !== undefined) botPatch.auto_close_enabled    = Boolean(auto_close_enabled);
    if (auto_close_idle_minutes !== undefined) botPatch.auto_close_idle_minutes = parseInt(String(auto_close_idle_minutes), 10) || 60;

    const hasBotPatch = Object.keys(botPatch).length > 0;

    const { rows } = await pool.query(
      `UPDATE brands
       SET ai_system_prompt   = COALESCE($1, ai_system_prompt),
           widget_config_json = CASE WHEN $3 THEN
             COALESCE(widget_config_json, '{}'::jsonb) || $2::jsonb
           ELSE widget_config_json END,
           updated_at         = NOW()
       WHERE id = $4 AND tenant_id = $5
       RETURNING id, brand_name, ai_system_prompt,
                 COALESCE(widget_config_json->>'bot_max_messages', '10')      AS bot_max_messages,
                 COALESCE(widget_config_json->>'auto_assign_strategy', 'round_robin') AS auto_assign_strategy,
                 COALESCE((widget_config_json->>'auto_close_enabled')::boolean, false) AS auto_close_enabled,
                 COALESCE(widget_config_json->>'auto_close_idle_minutes', '60') AS auto_close_idle_minutes`,
      [
        ai_system_prompt ?? null,
        JSON.stringify(botPatch),
        hasBotPatch,
        req.params.brandId,
        req.agent.tenantId,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Brand not found' });
    return res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── POST /api/ai/knowledge-base/crawl ───────────────────────────────────────
// Starts a background BFS site crawl. Returns { jobId } immediately.
// Poll GET /api/ai/knowledge-base/crawl/status/:jobId for progress.
router.post('/knowledge-base/crawl', async (req, res, next) => {
  try {
    const { url, brand_id, max_pages, max_depth } = req.body || {};
    if (!url?.trim()) return res.status(400).json({ error: 'url is required' });

    let startUrl;
    try {
      const parsed = new URL(url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol))
        return res.status(400).json({ error: 'Only http/https URLs allowed' });
      if (PRIVATE_HOST_RE.test(parsed.hostname))
        return res.status(400).json({ error: 'Private/local URLs are not permitted' });
      startUrl = parsed.toString();
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    const maxPages = Math.min(Math.max(parseInt(String(max_pages)) || 100, 1), 500);
    const maxDepth = Math.min(Math.max(parseInt(String(max_depth))  || 5,   1), 20);

    const jobId = crypto.randomUUID();
    crawlJobs.set(jobId, {
      status:     'running',
      crawled:    0,
      saved:      0,
      errors:     0,
      maxPages,
      maxDepth,
      startUrl,
      currentUrl: startUrl,
      startedAt:  Date.now(),
    });

    // Fire-and-forget — response is returned before crawl completes
    runSiteCrawl({
      jobId,
      tenantId: req.agent.tenantId,
      agentId:  req.agent.id,
      brandId:  brand_id || null,
      startUrl,
      maxPages,
      maxDepth,
    }).catch(err => {
      const j = crawlJobs.get(jobId);
      if (j) { j.status = 'error'; j.errorMessage = err.message; }
      logger.error({ jobId, err: err.message }, 'crawl_site_failed');
    });

    logger.info({ jobId, startUrl, maxPages, maxDepth }, 'crawl_site_started');
    return res.json({ jobId, maxPages, maxDepth, startUrl });
  } catch (err) { next(err); }
});

// ─── GET /api/ai/knowledge-base/crawl/status/:jobId ──────────────────────────
router.get('/knowledge-base/crawl/status/:jobId', (req, res) => {
  const job = crawlJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });
  return res.json(job);
});

// ─── POST /api/ai/knowledge-base/upload-pdf ──────────────────────────────────
router.post('/knowledge-base/upload-pdf', async (req, res, next) => {
  try {
    const { data, filename, brand_id } = req.body || {};
    if (!data) return res.status(400).json({ error: 'data (base64 PDF) is required' });

    const pdfParse = require('pdf-parse');
    const buffer = Buffer.from(data, 'base64');
    const parsed = await pdfParse(buffer);
    const text = (parsed.text || '').trim().slice(0, 20000);

    if (!text || text.length < 10) return res.status(422).json({ error: 'Could not extract text from PDF' });

    const title = (filename || 'Uploaded PDF').replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') || 'PDF Document';

    const { rows } = await pool.query(
      `INSERT INTO knowledge_articles (tenant_id, brand_id, title, content, tags, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, content, tags, brand_id, is_active, created_at, updated_at`,
      [req.agent.tenantId, brand_id || null, title, text, ['pdf'], req.agent.id]
    );
    logger.info({ id: rows[0].id, filename }, 'knowledge_pdf_uploaded');
    return res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
