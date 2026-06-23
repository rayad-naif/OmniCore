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
const { requireAuth } = require('../middleware/auth');
const { rephraseText } = require('../services/ai.service');
const logger          = require('../utils/logger');
const { pool }        = require('../lib/db');

const router = Router();
router.use(requireAuth);

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
// Returns AI settings per brand for the current tenant
router.get('/settings', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, brand_name, ai_system_prompt
       FROM brands
       WHERE tenant_id = $1
       ORDER BY brand_name`,
      [req.agent.tenantId]
    );
    return res.json(rows);
  } catch (err) { next(err); }
});

// ─── PATCH /api/ai/settings/:brandId ─────────────────────────────────────────
router.patch('/settings/:brandId', async (req, res, next) => {
  try {
    const { ai_system_prompt } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE brands SET ai_system_prompt = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING id, brand_name, ai_system_prompt`,
      [ai_system_prompt ?? null, req.params.brandId, req.agent.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Brand not found' });
    return res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
