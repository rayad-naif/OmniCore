'use strict';

/**
 * ai.router.js
 * POST /api/ai/rephrase          — agent copilot text rephrase
 * GET  /api/ai/knowledge-base    — list knowledge articles
 * POST /api/ai/knowledge-base    — create knowledge article
 * PATCH /api/ai/knowledge-base/:id — update article
 * DELETE /api/ai/knowledge-base/:id — delete article
 * GET  /api/ai/settings          — get brand AI settings
 * PATCH /api/ai/settings/:brandId — update brand AI system prompt
 */

const { Router }      = require('express');
const { requireAuth, requirePermissionByMethod, requirePermission } = require('../middleware/auth');
const { rephraseText } = require('../services/ai.service');
const logger          = require('../utils/logger');
const { pool }        = require('../lib/db');

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
router.post('/knowledge-base/crawl', async (req, res, next) => {
  try {
    const { url, brand_id } = req.body || {};
    if (!url?.trim()) return res.status(400).json({ error: 'url is required' });

    let targetUrl;
    try { targetUrl = new URL(url.trim()); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
    if (!['http:', 'https:'].includes(targetUrl.protocol)) return res.status(400).json({ error: 'Only http/https URLs allowed' });

    const mod = targetUrl.protocol === 'https:' ? require('node:https') : require('node:http');

    const html = await new Promise((resolve, reject) => {
      const request = mod.get(url.trim(), { timeout: 12000, headers: { 'User-Agent': 'OmniCore-Crawler/1.0' } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return resolve(`<meta-redirect>${response.headers.location}</meta-redirect>`);
        }
        if (response.statusCode !== 200) { reject(new Error(`HTTP ${response.statusCode}`)); return; }
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { data += chunk; if (data.length > 500000) response.destroy(); });
        response.on('end', () => resolve(data));
      });
      request.on('error', reject);
      request.on('timeout', () => { request.destroy(); reject(new Error('Request timed out')); });
    });

    const text = String(html)
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, '\n\n$2\n')
      .replace(/<(p|li|td|th|div|section|article)[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 15000);

    if (!text || text.length < 50) return res.status(422).json({ error: 'Could not extract meaningful text from page' });

    const pathParts = targetUrl.pathname.split('/').filter(Boolean);
    const rawTitle = pathParts.pop() || targetUrl.hostname;
    const title = rawTitle.replace(/[-_]/g, ' ').replace(/\.[^.]+$/, '').replace(/\b\w/g, c => c.toUpperCase()) || 'Crawled Page';

    const { rows } = await pool.query(
      `INSERT INTO knowledge_articles (tenant_id, brand_id, title, content, tags, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, content, tags, brand_id, is_active, created_at, updated_at`,
      [req.agent.tenantId, brand_id || null, title, text, ['web-crawl'], req.agent.id]
    );
    logger.info({ id: rows[0].id, url }, 'knowledge_crawled');
    return res.status(201).json(rows[0]);
  } catch (err) { next(err); }
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
