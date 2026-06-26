'use strict';

/**
 * tenant.controller.js
 * CRUD for Tenants and Brands.
 * All queries use parameterised values — no string interpolation.
 *
 * Auth guards:
 *  - All /api/tenants routes require a valid JWT (requireAuth).
 *  - Tenant CRUD (list-all, delete) requires role 'superadmin'.
 *  - Brand sub-routes under /:tenantId require only 'admin'.
 *  - PATCH /api/tenants/settings is admin-only, updates caller's own tenant.
 *
 * Brand creation enforces max_brands_allowed (Tier 2 limit).
 */

const { Router }   = require('express');
const {
  S3Client,
  PutObjectCommand,
}                  = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { requireAuth, requireRole } = require('../middleware/auth');
const { pool }     = require('../lib/db');
const logger       = require('../utils/logger');
const { sendSmtpTestEmail } = require('../services/email.service');

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Self-healing column migrations
// ---------------------------------------------------------------------------
const TENANT_MIGRATIONS = [
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_timezone TEXT NOT NULL DEFAULT 'UTC'`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_auto_reply_enabled BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_feature_enabled BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS smtp_feature_enabled BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS smtp_config_json JSONB NOT NULL DEFAULT '{}'`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS imap_config_json JSONB NOT NULL DEFAULT '{}'`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webhook_config_json JSONB NOT NULL DEFAULT '{}'`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_brands_allowed INT NOT NULL DEFAULT 5`,
  `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS timezone TEXT`,
];
TENANT_MIGRATIONS.forEach(sql =>
  pool.query(sql).catch(err => logger.warn({ err: err.message }, 'tenant_migration_warning'))
);

// ---------------------------------------------------------------------------
// Super-admin guard: email matches SUPER_ADMIN_EMAIL env var OR
// the agent's ID is in the super_admin_emails table (managed by super-admin routes).
// ---------------------------------------------------------------------------
async function requireSuperAdmin(req, res, next) {
  try {
    const primaryEmail = process.env.SUPER_ADMIN_EMAIL;
    if (primaryEmail && req.agent.email === primaryEmail) return next();

    // Also check DB table for additional super admins
    const { rows } = await pool.query(
      `SELECT 1 FROM super_admin_emails WHERE email = $1 AND is_active = TRUE LIMIT 1`,
      [req.agent.email]
    );
    if (rows.length) return next();

    // Bootstrap: if no super admin is configured, allow tenant admins
    const { rows: anyAdmin } = await pool.query(
      `SELECT 1 FROM super_admin_emails WHERE is_active = TRUE LIMIT 1`
    );
    if (!process.env.SUPER_ADMIN_EMAIL && !anyAdmin.length && req.agent.role === 'admin') return next();

    return res.status(403).json({ error: 'Forbidden — super admin only' });
  } catch {
    return res.status(403).json({ error: 'Forbidden — super admin only' });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function notFound(res, entity = 'Resource') {
  return res.status(404).json({ error: `${entity} not found` });
}

function created(res, data) {
  return res.status(201).json(data);
}

// ---------------------------------------------------------------------------
// TENANTS
// ---------------------------------------------------------------------------

/** GET /api/tenants — superadmin only */
router.get('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, company_name, subscription_status,
              lemon_squeezy_customer_id, grace_period_ends_at,
              created_at, updated_at
       FROM tenants
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/** GET /api/tenants/:tenantId */
router.get('/:tenantId', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, company_name, subscription_status,
              lemon_squeezy_customer_id, lemon_squeezy_subscription_id,
              grace_period_ends_at, created_at, updated_at
       FROM tenants WHERE id = $1`,
      [req.params.tenantId]
    );
    if (!rows.length) return notFound(res, 'Tenant');
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/** POST /api/tenants — superadmin only */
router.post('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const { company_name, lemon_squeezy_customer_id = null } = req.body;
    if (!company_name?.trim()) {
      return res.status(400).json({ error: 'company_name is required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO tenants (company_name, lemon_squeezy_customer_id)
       VALUES ($1, $2)
       RETURNING id, company_name, subscription_status, created_at`,
      [company_name.trim(), lemon_squeezy_customer_id]
    );
    created(res, rows[0]);
  } catch (err) { next(err); }
});

/**
 * POST /api/tenants/provision — superadmin only
 * Creates a new tenant AND its first admin agent atomically.
 * Body: { company_name, admin_name, admin_email, admin_password }
 */
router.post('/provision', requireSuperAdmin, async (req, res, next) => {
  const bcrypt = require('bcryptjs');
  const { company_name, admin_name, admin_email, admin_password = 'Welcome1!' } = req.body || {};

  if (!company_name?.trim()) return res.status(400).json({ error: 'company_name is required' });
  if (!admin_name?.trim())   return res.status(400).json({ error: 'admin_name is required' });
  if (!admin_email?.trim())  return res.status(400).json({ error: 'admin_email is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: tenantRows } = await client.query(
      `INSERT INTO tenants (company_name)
       VALUES ($1)
       RETURNING id, company_name, subscription_status, created_at`,
      [company_name.trim()]
    );
    const tenant = tenantRows[0];

    const hash = await bcrypt.hash(admin_password, 10);
    const { rows: agentRows } = await client.query(
      `INSERT INTO agents (tenant_id, name, email, role, password_hash, is_active)
       VALUES ($1, $2, $3, 'admin', $4, true)
       RETURNING id, name, email, role, is_active, created_at`,
      [tenant.id, admin_name.trim(), admin_email.trim().toLowerCase(), hash]
    );
    const agent = agentRows[0];

    // Seed a default brand so the tenant is immediately usable
    await client.query(
      `INSERT INTO brands (tenant_id, brand_name) VALUES ($1, $2)`,
      [tenant.id, company_name.trim()]
    );

    await client.query('COMMIT');
    logger.info({ tenantId: tenant.id, agentId: agent.id }, 'tenant_provisioned');
    return res.status(201).json({ tenant, agent, temp_password: admin_password });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// WORKSPACE SETTINGS  (must be before /:tenantId)
// ---------------------------------------------------------------------------

const JSON_FIELDS = new Set(['smtp_config_json', 'imap_config_json', 'webhook_config_json']);

/**
 * GET /api/tenants/settings/current
 * Admin only — returns the caller's own tenant settings.
 */
router.get('/settings/current', requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, company_name, default_timezone, ai_auto_reply_enabled,
              ai_feature_enabled, smtp_feature_enabled, custom_domain,
              smtp_config_json, imap_config_json, webhook_config_json, updated_at
       FROM tenants WHERE id = $1`,
      [req.agent.tenantId]
    );
    if (!rows.length) return notFound(res, 'Tenant');
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/**
 * PATCH /api/tenants/settings
 * Admin only — updates the caller's own tenant.
 * Allowed fields: company_name, default_timezone, ai_auto_reply_enabled,
 *                 custom_domain, smtp_config_json, imap_config_json,
 *                 webhook_config_json, ai_feature_enabled, smtp_feature_enabled
 */
router.patch('/settings', requireRole('admin'), async (req, res, next) => {
  try {
    const allowed = [
      'company_name', 'default_timezone', 'ai_auto_reply_enabled',
      'custom_domain', 'smtp_config_json', 'imap_config_json', 'webhook_config_json',
      'ai_feature_enabled', 'smtp_feature_enabled',
    ];
    const fields  = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!fields.length) {
      return res.status(400).json({ error: 'No valid fields provided' });
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values     = fields.map(f =>
      JSON_FIELDS.has(f) ? JSON.stringify(req.body[f]) : req.body[f]
    );
    values.push(req.agent.tenantId);

    const { rows } = await pool.query(
      `UPDATE tenants SET ${setClauses}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id, company_name, default_timezone, ai_auto_reply_enabled,
                 ai_feature_enabled, smtp_feature_enabled, custom_domain,
                 smtp_config_json, imap_config_json, webhook_config_json, updated_at`,
      values
    );
    if (!rows.length) return notFound(res, 'Tenant');
    logger.info({ tenantId: req.agent.tenantId, fields }, 'workspace_settings_updated');
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/**
 * POST /api/tenants/smtp/test
 * Admin only — verifies SMTP credentials and sends a real test email.
 */
router.post('/smtp/test', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await sendSmtpTestEmail(req.agent.tenantId);
    res.json({ ok: true, to: result.to, message: `Test email sent to ${result.to}` });
  } catch (err) {
    const status = err.status || 500;
    const message = err.responseCode
      ? `SMTP error ${err.responseCode}: ${err.response}`
      : (err.code === 'EAUTH' ? 'Authentication failed — check your username and password'
        : err.code === 'ECONNREFUSED' ? 'Connection refused — check host and port'
        : err.code === 'ETIMEDOUT' ? 'Connection timed out — check host and port'
        : err.message || 'Unknown SMTP error');
    logger.warn({ err: err.message, tenantId: req.agent.tenantId }, 'smtp_test_failed');
    res.status(status).json({ ok: false, message });
  }
});

/** PATCH /api/tenants/:tenantId — superadmin only */
router.patch('/:tenantId', requireRole('superadmin'), async (req, res, next) => {
  try {
    const allowed = [
      'company_name', 'subscription_status',
      'lemon_squeezy_customer_id', 'lemon_squeezy_subscription_id',
      'grace_period_ends_at',
    ];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!fields.length) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }
    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values     = fields.map(f => req.body[f]);
    values.push(req.params.tenantId);
    const { rows } = await pool.query(
      `UPDATE tenants SET ${setClauses}
       WHERE id = $${values.length}
       RETURNING id, company_name, subscription_status, updated_at`,
      values
    );
    if (!rows.length) return notFound(res, 'Tenant');
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/** DELETE /api/tenants/:tenantId — superadmin only */
router.delete('/:tenantId', requireRole('superadmin'), async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM tenants WHERE id = $1',
      [req.params.tenantId]
    );
    if (!rowCount) return notFound(res, 'Tenant');
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// BRANDS  (nested under /api/tenants/:tenantId/brands)
// ---------------------------------------------------------------------------

/** GET /api/tenants/:tenantId/brands */
router.get('/:tenantId/brands', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, brand_name, widget_config_json, allowed_domains_array,
              inbound_email_prefix, ai_confidence_threshold,
              help_center_cname, created_at, updated_at
       FROM brands
       WHERE tenant_id = $1
       ORDER BY created_at ASC`,
      [req.params.tenantId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/** GET /api/tenants/:tenantId/brands/:brandId */
router.get('/:tenantId/brands/:brandId', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, brand_name, widget_config_json, allowed_domains_array,
              inbound_email_prefix, ai_system_prompt, ai_confidence_threshold,
              help_center_cname, created_at, updated_at
       FROM brands
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.brandId, req.params.tenantId]
    );
    if (!rows.length) return notFound(res, 'Brand');
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/**
 * POST /api/tenants/:tenantId/brands
 * Enforces max_brands_allowed for the tenant (Tier 2 limit).
 */
router.post('/:tenantId/brands', async (req, res, next) => {
  try {
    // ── Enforce brand limit ─────────────────────────────────────────────────
    const { rows: limitRows } = await pool.query(
      `SELECT max_brands_allowed,
              (SELECT COUNT(*) FROM brands WHERE tenant_id = $1)::int AS brand_count
       FROM tenants WHERE id = $1`,
      [req.params.tenantId]
    );
    if (limitRows.length) {
      const { max_brands_allowed, brand_count } = limitRows[0];
      if (brand_count >= max_brands_allowed) {
        return res.status(403).json({
          error: `Brand limit reached (${brand_count}/${max_brands_allowed}). Contact your admin to increase the limit.`,
        });
      }
    }

    const {
      brand_name,
      widget_config_json      = {},
      allowed_domains_array   = [],
      inbound_email_prefix    = null,
      ai_system_prompt        = null,
      ai_confidence_threshold = 0.70,
      help_center_cname       = null,
    } = req.body;

    if (!brand_name?.trim()) {
      return res.status(400).json({ error: 'brand_name is required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO brands
         (tenant_id, brand_name, widget_config_json, allowed_domains_array,
          inbound_email_prefix, ai_system_prompt, ai_confidence_threshold, help_center_cname)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, brand_name, allowed_domains_array, inbound_email_prefix, created_at`,
      [
        req.params.tenantId,
        brand_name.trim(),
        JSON.stringify(widget_config_json),
        allowed_domains_array,
        inbound_email_prefix,
        ai_system_prompt,
        ai_confidence_threshold,
        help_center_cname,
      ]
    );
    created(res, rows[0]);
  } catch (err) { next(err); }
});

/** PATCH /api/tenants/:tenantId/brands/:brandId */
router.patch('/:tenantId/brands/:brandId', async (req, res, next) => {
  try {
    const allowed = [
      'brand_name', 'widget_config_json', 'allowed_domains_array',
      'inbound_email_prefix', 'ai_system_prompt',
      'ai_confidence_threshold', 'help_center_cname',
    ];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!fields.length) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values     = fields.map(f =>
      f === 'widget_config_json' ? JSON.stringify(req.body[f]) : req.body[f]
    );
    values.push(req.params.brandId, req.params.tenantId);

    const { rows } = await pool.query(
      `UPDATE brands SET ${setClauses}
       WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
       RETURNING id, brand_name, updated_at`,
      values
    );
    if (!rows.length) return notFound(res, 'Brand');
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/** DELETE /api/tenants/:tenantId/brands/:brandId */
router.delete('/:tenantId/brands/:brandId', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM brands WHERE id = $1 AND tenant_id = $2',
      [req.params.brandId, req.params.tenantId]
    );
    if (!rowCount) return notFound(res, 'Brand');
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// LOGO UPLOAD  — presigned R2 PUT URL
// ---------------------------------------------------------------------------
const ALLOWED_LOGO_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_LOGO_EXT  = /\.(png|jpg|jpeg|webp)$/i;
const MAX_LOGO_BYTES    = 5 * 1024 * 1024;

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) throw Object.assign(new Error('R2_ACCOUNT_ID not set'), { status: 503 });
  return new S3Client({
    region:   'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID     || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
  });
}

router.post(
  '/:tenantId/brands/:brandId/logo-upload-url',
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const { tenantId, brandId } = req.params;
      const { contentType, filename, size } = req.body || {};

      const { rows } = await pool.query(
        'SELECT id FROM brands WHERE id = $1 AND tenant_id = $2',
        [brandId, tenantId]
      );
      if (!rows.length) return notFound(res, 'Brand');

      if (!contentType || !ALLOWED_LOGO_MIME.has(contentType)) {
        return res.status(400).json({
          error: `contentType must be one of: ${[...ALLOWED_LOGO_MIME].join(', ')}`,
        });
      }
      if (filename && !ALLOWED_LOGO_EXT.test(filename)) {
        return res.status(400).json({ error: 'Filename must be .png, .jpg, .jpeg, or .webp' });
      }
      if (size !== undefined && (typeof size !== 'number' || size > MAX_LOGO_BYTES)) {
        return res.status(400).json({ error: `File must not exceed ${MAX_LOGO_BYTES / 1024 / 1024} MB` });
      }

      const ext       = contentType.split('/')[1];
      const objectKey = `logos/tenant-${tenantId}/brand-${brandId}/logo-${Date.now()}.${ext}`;
      const bucket    = process.env.R2_BUCKET_NAME;
      if (!bucket) return res.status(503).json({ error: 'R2_BUCKET_NAME not set' });

      const TTL_SECONDS = 300;
      const r2          = getR2Client();
      const uploadUrl = await getSignedUrl(
        r2,
        new PutObjectCommand({
          Bucket: bucket, Key: objectKey, ContentType: contentType,
          ContentLength: size || undefined, ContentDisposition: 'inline',
          Metadata: {
            'omnicore-tenant': String(tenantId),
            'omnicore-brand':  String(brandId),
            'omnicore-type':   'logo',
          },
        }),
        { expiresIn: TTL_SECONDS }
      );

      logger.info({ tenantId, brandId, objectKey }, 'logo_upload_url_issued');
      return res.json({ uploadUrl, objectKey, expiresIn: TTL_SECONDS });
    } catch (err) { next(err); }
  }
);

module.exports = router;
