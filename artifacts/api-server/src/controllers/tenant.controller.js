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
const logger       = require('../utils/logger');

const router = Router();
router.use(requireAuth);

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
router.get('/', requireRole('superadmin'), async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
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
    const { rows } = await req.db.query(
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
router.post('/', requireRole('superadmin'), async (req, res, next) => {
  try {
    const { company_name, lemon_squeezy_customer_id = null } = req.body;
    if (!company_name?.trim()) {
      return res.status(400).json({ error: 'company_name is required' });
    }
    const { rows } = await req.db.query(
      `INSERT INTO tenants (company_name, lemon_squeezy_customer_id)
       VALUES ($1, $2)
       RETURNING id, company_name, subscription_status, created_at`,
      [company_name.trim(), lemon_squeezy_customer_id]
    );
    created(res, rows[0]);
  } catch (err) { next(err); }
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
    const { rows } = await req.db.query(
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
    const { rowCount } = await req.db.query(
      'DELETE FROM tenants WHERE id = $1',
      [req.params.tenantId]
    );
    if (!rowCount) return notFound(res, 'Tenant');
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// WORKSPACE SETTINGS  PATCH /api/tenants/settings
// ---------------------------------------------------------------------------

/**
 * PATCH /api/tenants/settings
 * Admin only — updates the caller's own tenant.
 * Allowed fields: company_name, default_timezone, ai_auto_reply_enabled,
 *                 custom_domain, smtp_config_json
 */
router.patch('/settings', requireRole('admin'), async (req, res, next) => {
  try {
    const allowed = [
      'company_name', 'default_timezone', 'ai_auto_reply_enabled',
      'custom_domain', 'smtp_config_json',
    ];
    const fields  = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!fields.length) {
      return res.status(400).json({ error: 'No valid fields provided' });
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values     = fields.map(f =>
      f === 'smtp_config_json' ? JSON.stringify(req.body[f]) : req.body[f]
    );
    values.push(req.agent.tenantId);

    const { rows } = await req.db.query(
      `UPDATE tenants SET ${setClauses}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id, company_name, default_timezone, ai_auto_reply_enabled,
                 custom_domain, updated_at`,
      values
    );
    if (!rows.length) return notFound(res, 'Tenant');
    logger.info({ tenantId: req.agent.tenantId, fields }, 'workspace_settings_updated');
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// BRANDS  (nested under /api/tenants/:tenantId/brands)
// ---------------------------------------------------------------------------

/** GET /api/tenants/:tenantId/brands */
router.get('/:tenantId/brands', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
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
    const { rows } = await req.db.query(
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
    const { rows: limitRows } = await req.db.query(
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

    const { rows } = await req.db.query(
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

    const { rows } = await req.db.query(
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
    const { rowCount } = await req.db.query(
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

      const { rows } = await req.db.query(
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
