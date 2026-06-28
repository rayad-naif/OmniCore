const { Router }     = require('express');
const { pool }        = require('../lib/db');
const { requireAuth, requirePermissionByMethod } = require('../middleware/auth');
const logger          = require('../utils/logger');

const router = Router();
router.use(requireAuth);
router.use(requirePermissionByMethod('inbox'));

// Self-healing migration
pool.query(`
  CREATE TABLE IF NOT EXISTS canned_responses (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    body       TEXT        NOT NULL,
    shortcut   TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).then(() => logger.info('canned_responses_migration_ok'))
  .catch(e => logger.error(e, 'canned_responses_migration_failed'));

function tid(req) { return req.agent.tenantId; }

// ── GET /api/canned-responses ────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, body, shortcut, created_at
       FROM canned_responses
       WHERE tenant_id = $1
       ORDER BY name ASC`,
      [tid(req)]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/canned-responses ───────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { name, body, shortcut } = req.body || {};
    if (!name?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'name and body are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO canned_responses (tenant_id, name, body, shortcut)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, body, shortcut, created_at`,
      [tid(req), name.trim(), body.trim(), shortcut?.trim() || null]
    );
    logger.info({ tenantId: tid(req), id: rows[0].id }, 'canned_response_created');
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── PATCH /api/canned-responses/:id ─────────────────────────────────────────
router.patch('/:id', async (req, res, next) => {
  try {
    const { name, body, shortcut } = req.body || {};
    if (!name?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'name and body are required' });
    }
    const { rows } = await pool.query(
      `UPDATE canned_responses SET name = $1, body = $2, shortcut = $3
       WHERE id = $4 AND tenant_id = $5
       RETURNING id, name, body, shortcut, created_at`,
      [name.trim(), body.trim(), shortcut?.trim() || null, req.params.id, tid(req)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── DELETE /api/canned-responses/:id ────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM canned_responses WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tid(req)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
