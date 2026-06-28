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
const bcrypt       = require('bcryptjs');
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

// ─── GET /api/super-admin/users ──────────────────────────────────────────────
// Lists every account across all tenants so a super admin can manage passwords.
// Flags super admins (the env primary + any active super_admin_emails entry).
router.get('/users', async (req, res, next) => {
  try {
    const primaryEmail = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
    const { rows } = await pool.query(`
      SELECT
        a.id, a.name, a.email, a.role, a.is_active, a.created_at,
        a.tenant_id, t.company_name,
        (
          lower(a.email) = $1
          OR EXISTS (SELECT 1 FROM super_admin_emails s WHERE s.email = lower(a.email) AND s.is_active = TRUE)
        ) AS is_super_admin
      FROM agents a
      LEFT JOIN tenants t ON t.id = a.tenant_id
      ORDER BY t.company_name ASC NULLS FIRST, a.created_at ASC
    `, [primaryEmail]);
    return res.json(rows);
  } catch (err) { next(err); }
});

// ─── PATCH /api/super-admin/users/:id/password ───────────────────────────────
// Super admin sets a password for any account (agent, admin, or super admin).
// Used when the platform email service can't deliver invite / reset links.
router.patch('/users/:id/password', async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const hash = await bcrypt.hash(String(password), 10);
    const { rows } = await pool.query(
      `UPDATE agents SET password_hash = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, email, role`,
      [hash, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    logger.info({ targetId: req.params.id, by: req.agent.email }, 'user_password_set_by_super_admin');
    return res.json({ ...rows[0], password_set: true });
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

// ─── GET /api/super-admin/stripe-status ──────────────────────────────────────
// Reports Stripe connection state + the synced self-serve plans (plan→price).
router.get('/stripe-status', async (req, res, next) => {
  try {
    let connected = false;
    let account = null;
    try {
      // eslint-disable-next-line global-require
      const { getUncachableStripeClient } = require('../lib/stripeClient');
      const stripe = await getUncachableStripeClient();
      const acct = await stripe.accounts.retrieve();
      connected = true;
      account = { id: acct.id, email: acct.email || null, country: acct.country || null };
    } catch (err) {
      logger.warn({ err: err.message }, 'stripe_status_not_connected');
    }

    // Synced plan→price mapping from the `stripe` schema (if it exists yet).
    let plans = [];
    let subscriptions = 0;
    try {
      const { rows } = await pool.query(
        `SELECT
           p.name                      AS name,
           p.metadata ->> 'plan'       AS plan,
           pr.id                       AS price_id,
           pr.unit_amount              AS amount,
           pr.currency                 AS currency,
           pr.recurring ->> 'interval' AS interval
         FROM stripe.products p
         JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
         WHERE p.active = true
           AND p.metadata ->> 'plan' IN ('starter','pro')
           AND pr.recurring ->> 'interval' = 'month'
         ORDER BY pr.unit_amount ASC`
      );
      const seen = new Set();
      for (const r of rows) {
        if (seen.has(r.plan)) continue;
        seen.add(r.plan);
        plans.push({ plan: r.plan, name: r.name, priceId: r.price_id, amount: r.amount, currency: r.currency, interval: r.interval });
      }
      const subCount = await pool.query('SELECT COUNT(*)::int AS n FROM stripe.subscriptions');
      subscriptions = subCount.rows[0]?.n || 0;
    } catch {
      // stripe schema not migrated yet — leave defaults.
    }

    return res.json({ connected, account, schemaReady: plans.length > 0 || subscriptions > 0, plans, subscriptions });
  } catch (err) { next(err); }
});

// ─── STRIPE PLAN BUILDER ─────────────────────────────────────────────────────
// Manage subscription plans (products + monthly prices) directly from the
// dashboard. Feature flags & limits are stored on the Stripe product metadata
// and applied to a tenant when the matching plan's subscription becomes active.

// Canonical capability flags/limits configurable per plan.
const PLAN_FEATURE_KEYS = ['ai_feature_enabled', 'smtp_feature_enabled'];
const PLAN_LIMIT_KEYS   = ['max_brands_allowed', 'max_agents_allowed', 'conversation_limit'];

function buildPlanMetadata(body) {
  const meta = {};
  const plan = String(body.plan || '').trim().toLowerCase();
  if (plan) meta.plan = plan;
  meta.self_serve = body.self_serve ? 'true' : 'false';
  for (const k of PLAN_FEATURE_KEYS) {
    if (body[k] !== undefined) meta[k] = body[k] ? 'true' : 'false';
  }
  for (const k of PLAN_LIMIT_KEYS) {
    if (body[k] !== undefined) {
      const n = parseInt(body[k], 10);
      if (!Number.isNaN(n) && n > 0) meta[k] = String(n);
    }
  }
  return meta;
}

function shapePlan(product, price) {
  const m = product.metadata || {};
  return {
    productId:   product.id,
    name:        product.name,
    description: product.description || '',
    plan:        m.plan || null,
    self_serve:  m.self_serve === 'true',
    active:      product.active,
    priceId:     price ? price.id : null,
    amount:      price ? price.unit_amount : null,
    currency:    price ? price.currency : 'usd',
    interval:    price && price.recurring ? price.recurring.interval : 'month',
    features: {
      ai_feature_enabled:   m.ai_feature_enabled   === 'true',
      smtp_feature_enabled: m.smtp_feature_enabled === 'true',
    },
    limits: {
      max_brands_allowed: m.max_brands_allowed ? parseInt(m.max_brands_allowed, 10) : null,
      max_agents_allowed: m.max_agents_allowed ? parseInt(m.max_agents_allowed, 10) : null,
      conversation_limit: m.conversation_limit ? parseInt(m.conversation_limit, 10) : null,
    },
  };
}

/** GET /api/super-admin/stripe/plans — live list from Stripe (products + default price). */
router.get('/stripe/plans', async (req, res, next) => {
  try {
    // eslint-disable-next-line global-require
    const { getUncachableStripeClient } = require('../lib/stripeClient');
    const stripe = await getUncachableStripeClient();
    const products = await stripe.products.list({ active: true, limit: 100, expand: ['data.default_price'] });
    const plans = products.data.map((p) => {
      const price = p.default_price && typeof p.default_price === 'object' ? p.default_price : null;
      return shapePlan(p, price);
    });
    return res.json({ plans });
  } catch (err) {
    logger.warn({ err: err.message }, 'stripe_plans_list_failed');
    return res.status(503).json({ error: 'Stripe is not connected or unavailable' });
  }
});

/**
 * POST /api/super-admin/stripe/plans
 * Body: { name, description?, plan, self_serve?, amount (cents), currency?,
 *         ai_feature_enabled?, smtp_feature_enabled?,
 *         max_brands_allowed?, max_agents_allowed?, conversation_limit? }
 * Creates a product + recurring monthly price, sets it as the default price.
 */
router.post('/stripe/plans', async (req, res, next) => {
  try {
    const { name, description, amount, currency = 'usd' } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const cents = parseInt(amount, 10);
    if (Number.isNaN(cents) || cents < 0) return res.status(400).json({ error: 'amount (in cents) is required' });

    // eslint-disable-next-line global-require
    const { getUncachableStripeClient } = require('../lib/stripeClient');
    const stripe = await getUncachableStripeClient();

    const metadata = buildPlanMetadata(req.body);
    const product = await stripe.products.create({
      name: name.trim(),
      description: description?.trim() || undefined,
      metadata,
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: cents,
      currency: String(currency).toLowerCase(),
      recurring: { interval: 'month' },
    });
    await stripe.products.update(product.id, { default_price: price.id });

    logger.info({ productId: product.id, priceId: price.id, plan: metadata.plan }, 'stripe_plan_created');
    return res.status(201).json(shapePlan({ ...product, metadata }, price));
  } catch (err) {
    logger.error({ err: err.message }, 'stripe_plan_create_failed');
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create plan' });
  }
});

/**
 * PATCH /api/super-admin/stripe/plans/:productId
 * Updates name/description/metadata. If `amount` is supplied and differs, a new
 * price is created (Stripe prices are immutable), set as default, and the old
 * one archived. Set `active:false` to archive the plan.
 */
router.patch('/stripe/plans/:productId', async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { name, description, amount, currency, active } = req.body || {};

    // eslint-disable-next-line global-require
    const { getUncachableStripeClient } = require('../lib/stripeClient');
    const stripe = await getUncachableStripeClient();

    const existing = await stripe.products.retrieve(productId, { expand: ['default_price'] });
    const mergedMeta = { ...(existing.metadata || {}), ...buildPlanMetadata(req.body) };

    const productUpdate = { metadata: mergedMeta };
    if (name?.trim()) productUpdate.name = name.trim();
    if (description !== undefined) productUpdate.description = description?.trim() || null;
    if (active !== undefined) productUpdate.active = !!active;

    let price = existing.default_price && typeof existing.default_price === 'object' ? existing.default_price : null;

    if (amount !== undefined) {
      const cents = parseInt(amount, 10);
      if (Number.isNaN(cents) || cents < 0) return res.status(400).json({ error: 'amount must be a non-negative integer (cents)' });
      const changed = !price || price.unit_amount !== cents;
      if (changed) {
        const newPrice = await stripe.prices.create({
          product: productId,
          unit_amount: cents,
          currency: String(currency || price?.currency || 'usd').toLowerCase(),
          recurring: { interval: 'month' },
        });
        productUpdate.default_price = newPrice.id;
        // Archive the previous price so it no longer shows as purchasable.
        if (price?.id) {
          try { await stripe.prices.update(price.id, { active: false }); } catch { /* non-fatal */ }
        }
        price = newPrice;
      }
    }

    const updated = await stripe.products.update(productId, productUpdate);
    logger.info({ productId, plan: mergedMeta.plan }, 'stripe_plan_updated');
    return res.json(shapePlan(updated, price));
  } catch (err) {
    logger.error({ err: err.message }, 'stripe_plan_update_failed');
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update plan' });
  }
});

module.exports = router;
