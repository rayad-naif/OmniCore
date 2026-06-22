'use strict';

/**
 * super-admin.controller.js
 * Strict access: only for agents whose email === process.env.SUPER_ADMIN_EMAIL
 *
 * GET    /api/super-admin/tenants                     — list all tenants
 * GET    /api/super-admin/upgrade-requests            — list pending upgrade requests
 * PATCH  /api/super-admin/tenants/:id/status          — suspend / activate
 * PATCH  /api/super-admin/tenants/:id/billing         — manually set plan / status
 * PATCH  /api/super-admin/tenants/:id/limits          — adjust max_brands_allowed
 * DELETE /api/super-admin/tenants/:id/purge           — hard cascade delete
 */

const { Router }   = require('express');
const { pool }     = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const logger       = require('../utils/logger');

const router = Router();
router.use(requireAuth);

// ─── Super-admin guard ────────────────────────────────────────────────────────
function requireSuperAdmin(req, res, next) {
  const saEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!saEmail) {
    return res.status(503).json({ error: 'SUPER_ADMIN_EMAIL not configured' });
  }
  if (req.agent.email !== saEmail) {
    return res.status(403).json({ error: 'Forbidden — super admin only' });
  }
  next();
}

router.use(requireSuperAdmin);

// ─── Idempotent migrations ────────────────────────────────────────────────────
(async () => {
  try {
    await pool.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS account_status       TEXT    NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS default_timezone     TEXT    NOT NULL DEFAULT 'UTC',
        ADD COLUMN IF NOT EXISTS ai_auto_reply_enabled BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS max_brands_allowed   INTEGER NOT NULL DEFAULT 3,
        ADD COLUMN IF NOT EXISTS custom_domain        TEXT,
        ADD COLUMN IF NOT EXISTS smtp_config_json     JSONB
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS upgrade_requests (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        agent_id      UUID,
        requested_plan TEXT NOT NULL,
        company_size  TEXT,
        notes         TEXT,
        status        TEXT NOT NULL DEFAULT 'pending',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    logger.info('super_admin_migrations_ok');
  } catch (err) {
    logger.warn({ err }, 'super_admin_migration_warning');
  }
})();

// ─── GET /api/super-admin/tenants ────────────────────────────────────────────
router.get('/tenants', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        t.id, t.company_name, t.account_status,
        t.subscription_status, t.plan,
        t.max_brands_allowed,
        t.created_at,
        COUNT(DISTINCT a.id)::int AS agent_count
      FROM tenants t
      LEFT JOIN agents a ON a.tenant_id = t.id
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `);
    return res.json(rows);
  } catch (err) { next(err); }
});

// ─── GET /api/super-admin/upgrade-requests ────────────────────────────────────
router.get('/upgrade-requests', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT ur.*, t.company_name, a.name AS agent_name, a.email AS agent_email
      FROM upgrade_requests ur
      JOIN tenants t ON t.id = ur.tenant_id
      LEFT JOIN agents a ON a.id = ur.agent_id
      ORDER BY ur.created_at DESC
    `);
    return res.json(rows);
  } catch (err) { next(err); }
});

// ─── PATCH /api/super-admin/tenants/:id/status ───────────────────────────────
router.patch('/tenants/:id/status', async (req, res, next) => {
  try {
    const { account_status } = req.body || {};
    if (!['active', 'suspended'].includes(account_status)) {
      return res.status(400).json({ error: 'account_status must be active or suspended' });
    }
    const { rows } = await pool.query(
      `UPDATE tenants SET account_status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, company_name, account_status`,
      [account_status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Tenant not found' });
    logger.info({ tenantId: req.params.id, account_status, by: req.agent.id }, 'tenant_status_changed');
    return res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── PATCH /api/super-admin/tenants/:id/billing ──────────────────────────────
router.patch('/tenants/:id/billing', async (req, res, next) => {
  try {
    const allowed = ['plan', 'subscription_status'];
    const fields  = Object.keys(req.body || {}).filter(k => allowed.includes(k));
    if (!fields.length) return res.status(400).json({ error: 'Provide plan and/or subscription_status' });

    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values     = fields.map(f => req.body[f]);
    values.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE tenants SET ${setClauses}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id, company_name, plan, subscription_status`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Tenant not found' });
    logger.info({ tenantId: req.params.id, fields, by: req.agent.id }, 'tenant_billing_updated');
    return res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── PATCH /api/super-admin/tenants/:id/limits ───────────────────────────────
router.patch('/tenants/:id/limits', async (req, res, next) => {
  try {
    const { max_brands_allowed } = req.body || {};
    const val = parseInt(max_brands_allowed, 10);
    if (isNaN(val) || val < 1 || val > 1000) {
      return res.status(400).json({ error: 'max_brands_allowed must be an integer between 1 and 1000' });
    }
    const { rows } = await pool.query(
      `UPDATE tenants SET max_brands_allowed = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, company_name, max_brands_allowed`,
      [val, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Tenant not found' });
    logger.info({ tenantId: req.params.id, max_brands_allowed: val, by: req.agent.id }, 'tenant_limits_updated');
    return res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── DELETE /api/super-admin/tenants/:id/purge ───────────────────────────────
router.delete('/tenants/:id/purge', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT id, company_name FROM tenants WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const { confirm_name } = req.body || {};
    if (confirm_name !== rows[0].company_name) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Confirmation name does not match tenant company_name' });
    }

    await client.query('DELETE FROM tenants WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    logger.warn({ tenantId: req.params.id, by: req.agent.id }, 'tenant_purged');
    return res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
