'use strict';

/**
 * super-admin.controller.js
 * Strict access: only for agents whose email === process.env.SUPER_ADMIN_EMAIL
 *
 * GET    /api/super-admin/tenants                     — list all tenants
 * GET    /api/super-admin/upgrade-requests            — list pending upgrade requests
 * PATCH  /api/super-admin/tenants/:id/status          — suspend / activate
 * PATCH  /api/super-admin/tenants/:id/billing         — manually set plan / status
 * PATCH  /api/super-admin/tenants/:id/limits          — adjust max_brands_allowed + agent/feature limits
 * DELETE /api/super-admin/tenants/:id/purge           — hard cascade delete
 */

const { Router }   = require('express');
const { pool }     = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const logger       = require('../utils/logger');
const { sendPlatformSmtpTestEmail, sendAccountUpdateEmail } = require('../services/email.service');

const router = Router();
router.use(requireAuth);

// ─── Super-admin guard ────────────────────────────────────────────────────────
async function requireSuperAdmin(req, res, next) {
  try {
    const saEmail = process.env.SUPER_ADMIN_EMAIL;
    if (saEmail && req.agent.email === saEmail) return next();

    // Also check DB table for additional super admins
    const { rows } = await pool.query(
      `SELECT 1 FROM super_admin_emails WHERE email = $1 AND is_active = TRUE LIMIT 1`,
      [req.agent.email]
    );
    if (rows.length) return next();

    return res.status(403).json({ error: 'Forbidden — super admin only' });
  } catch {
    return res.status(403).json({ error: 'Forbidden — super admin only' });
  }
}

router.use(requireSuperAdmin);

// ─── Helper: notify a tenant's active admins about an account change ──────────
async function notifyTenantAdmins(tenantId, subject, heading, message) {
  try {
    const { rows } = await pool.query(
      `SELECT email, name FROM agents
       WHERE tenant_id = $1 AND role = 'admin' AND is_active = TRUE`,
      [tenantId]
    );
    await Promise.all(rows.map(a => sendAccountUpdateEmail({ to: a.email, subject, heading, message })));
  } catch (err) {
    logger.warn({ err: err.message, tenantId }, 'tenant_admin_notify_failed');
  }
}

// ─── Idempotent migrations ────────────────────────────────────────────────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS super_admin_emails (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email      TEXT NOT NULL UNIQUE,
        added_by   TEXT,
        is_active  BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS account_status       TEXT    NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS default_timezone     TEXT    NOT NULL DEFAULT 'UTC',
        ADD COLUMN IF NOT EXISTS ai_auto_reply_enabled BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS max_brands_allowed   INTEGER NOT NULL DEFAULT 3,
        ADD COLUMN IF NOT EXISTS custom_domain        TEXT,
        ADD COLUMN IF NOT EXISTS smtp_config_json     JSONB,
        ADD COLUMN IF NOT EXISTS max_agents_allowed   INTEGER NOT NULL DEFAULT 10,
        ADD COLUMN IF NOT EXISTS ai_feature_enabled   BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS smtp_feature_enabled BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS conversation_limit   INTEGER NOT NULL DEFAULT 1000,
        ADD COLUMN IF NOT EXISTS plan                 TEXT    NOT NULL DEFAULT 'free'
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        id               INT PRIMARY KEY DEFAULT 1,
        smtp_config_json JSONB NOT NULL DEFAULT '{}',
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT platform_settings_singleton CHECK (id = 1)
      )
    `);
    await pool.query(`INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
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
        t.max_brands_allowed, t.max_agents_allowed,
        t.ai_feature_enabled, t.smtp_feature_enabled,
        t.conversation_limit, t.created_at,
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

    const suspended = account_status === 'suspended';
    notifyTenantAdmins(
      req.params.id,
      `Your OmniCore account has been ${suspended ? 'suspended' : 'reactivated'}`,
      `Account ${suspended ? 'suspended' : 'reactivated'}`,
      suspended
        ? 'Your OmniCore workspace has been suspended. Please contact support if you believe this is an error.'
        : 'Good news — your OmniCore workspace has been reactivated and is available again.'
    );

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

    if (fields.includes('plan') && req.body.plan) {
      notifyTenantAdmins(
        req.params.id,
        'Your OmniCore plan has changed',
        'Plan updated',
        `Your workspace plan is now "${req.body.plan}". This change is effective immediately.`
      );
    }

    return res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── PATCH /api/super-admin/tenants/:id/limits ───────────────────────────────
router.patch('/tenants/:id/limits', async (req, res, next) => {
  try {
    const { max_brands_allowed, max_agents_allowed, ai_feature_enabled, smtp_feature_enabled, conversation_limit } = req.body || {};

    const updates = [];
    const values  = [];
    let i = 1;

    if (max_brands_allowed !== undefined) {
      const val = parseInt(max_brands_allowed, 10);
      if (isNaN(val) || val < 1 || val > 1000) return res.status(400).json({ error: 'max_brands_allowed must be 1–1000' });
      updates.push(`max_brands_allowed = $${i++}`); values.push(val);
    }
    if (max_agents_allowed !== undefined) {
      const val = parseInt(max_agents_allowed, 10);
      if (isNaN(val) || val < 1 || val > 10000) return res.status(400).json({ error: 'max_agents_allowed must be 1–10000' });
      updates.push(`max_agents_allowed = $${i++}`); values.push(val);
    }
    if (ai_feature_enabled !== undefined) {
      updates.push(`ai_feature_enabled = $${i++}`); values.push(Boolean(ai_feature_enabled));
    }
    if (smtp_feature_enabled !== undefined) {
      updates.push(`smtp_feature_enabled = $${i++}`); values.push(Boolean(smtp_feature_enabled));
    }
    if (conversation_limit !== undefined) {
      const val = parseInt(conversation_limit, 10);
      if (isNaN(val) || val < 1) return res.status(400).json({ error: 'conversation_limit must be >= 1' });
      updates.push(`conversation_limit = $${i++}`); values.push(val);
    }

    if (!updates.length) return res.status(400).json({ error: 'No valid limit fields provided' });

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE tenants SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${i}
       RETURNING id, company_name, max_brands_allowed, max_agents_allowed, ai_feature_enabled, smtp_feature_enabled, conversation_limit`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Tenant not found' });
    logger.info({ tenantId: req.params.id, by: req.agent.id }, 'tenant_limits_updated');
    return res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── GET /api/super-admin/super-admins ───────────────────────────────────────
// Lists all super admin emails (except the primary env var one).
router.get('/super-admins', async (req, res, next) => {
  try {
    const primaryEmail = process.env.SUPER_ADMIN_EMAIL;
    const { rows } = await pool.query(
      `SELECT id, email, added_by, is_active, created_at
       FROM super_admin_emails
       ORDER BY created_at DESC`
    );
    return res.json({ primary: primaryEmail || null, list: rows });
  } catch (err) { next(err); }
});

// ─── POST /api/super-admin/super-admins ──────────────────────────────────────
// Add a new super admin email.
router.post('/super-admins', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email?.trim()) return res.status(400).json({ error: 'email is required' });
    const normalized = email.trim().toLowerCase();
    const { rows } = await pool.query(
      `INSERT INTO super_admin_emails (email, added_by)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET is_active = TRUE, added_by = $2
       RETURNING id, email, added_by, is_active, created_at`,
      [normalized, req.agent.email]
    );
    logger.info({ email: normalized, by: req.agent.email }, 'super_admin_added');
    return res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ─── DELETE /api/super-admin/super-admins/:id ────────────────────────────────
// Remove a super admin (deactivate).
router.delete('/super-admins/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE super_admin_emails SET is_active = FALSE WHERE id = $1 RETURNING email`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    logger.info({ id: req.params.id, by: req.agent.email }, 'super_admin_removed');
    return res.status(204).end();
  } catch (err) { next(err); }
});

// ─── GET /api/super-admin/platform-smtp ──────────────────────────────────────
// Returns the platform SMTP config with the password masked.
router.get('/platform-smtp', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT smtp_config_json FROM platform_settings WHERE id = 1`);
    const cfg = rows[0]?.smtp_config_json || {};
    const { pass, ...safe } = cfg;
    return res.json({ ...safe, pass_set: Boolean(pass) });
  } catch (err) { next(err); }
});

// ─── PUT /api/super-admin/platform-smtp ──────────────────────────────────────
// Upsert the single-row platform SMTP config. A blank password preserves the
// stored one (so the UI never needs to re-enter it). Never returns the password.
router.put('/platform-smtp', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { rows } = await pool.query(`SELECT smtp_config_json FROM platform_settings WHERE id = 1`);
    const existing = rows[0]?.smtp_config_json || {};

    const cfg = {
      host:       String(body.host ?? existing.host ?? '').trim(),
      port:       parseInt(body.port ?? existing.port ?? 587, 10) || 587,
      secure:     body.secure !== undefined ? Boolean(body.secure) : Boolean(existing.secure),
      user:       String(body.user ?? existing.user ?? '').trim(),
      from_email: String(body.from_email ?? existing.from_email ?? '').trim(),
      enabled:    body.enabled !== undefined ? Boolean(body.enabled) : Boolean(existing.enabled),
      pass:       (body.pass && String(body.pass).trim().length) ? String(body.pass) : (existing.pass || ''),
    };

    await pool.query(
      `INSERT INTO platform_settings (id, smtp_config_json, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET smtp_config_json = $1, updated_at = NOW()`,
      [JSON.stringify(cfg)]
    );
    logger.info({ by: req.agent.email }, 'platform_smtp_updated');
    const { pass, ...safe } = cfg;
    return res.json({ ...safe, pass_set: Boolean(pass) });
  } catch (err) { next(err); }
});

// ─── POST /api/super-admin/platform-smtp/test ────────────────────────────────
router.post('/platform-smtp/test', async (req, res) => {
  try {
    const result = await sendPlatformSmtpTestEmail(req.body?.to);
    return res.json({ ok: true, to: result.to, message: `Test email sent to ${result.to}` });
  } catch (err) {
    const status = err.status || 500;
    const message = err.responseCode
      ? `SMTP error ${err.responseCode}: ${err.response}`
      : (err.code === 'EAUTH' ? 'Authentication failed — check your username and password'
        : err.code === 'ECONNREFUSED' ? 'Connection refused — check host and port'
        : err.code === 'ETIMEDOUT' ? 'Connection timed out — check host and port'
        : err.message || 'Unknown SMTP error');
    logger.warn({ err: err.message, by: req.agent.email }, 'platform_smtp_test_failed');
    return res.status(status).json({ ok: false, message });
  }
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
