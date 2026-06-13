'use strict';

/**
 * tenant.controller.js
 * CRUD for Tenants and Brands.
 * All queries use parameterised values — no string interpolation.
 * req.db is the pg.Pool injected by server.js middleware.
 */

const { Router } = require('express');
const router = Router();

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

/**
 * GET /api/tenants
 * List all tenants (admin use; add auth middleware in production).
 */
router.get('/', async (req, res, next) => {
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

/**
 * GET /api/tenants/:tenantId
 */
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

/**
 * POST /api/tenants
 * Body: { company_name, lemon_squeezy_customer_id? }
 */
router.post('/', async (req, res, next) => {
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

/**
 * PATCH /api/tenants/:tenantId
 * Partial update — only provided fields are changed.
 * Allowed: company_name, subscription_status, lemon_squeezy_customer_id,
 *          lemon_squeezy_subscription_id, grace_period_ends_at
 */
router.patch('/:tenantId', async (req, res, next) => {
  try {
    const allowed = [
      'company_name',
      'subscription_status',
      'lemon_squeezy_customer_id',
      'lemon_squeezy_subscription_id',
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

/**
 * DELETE /api/tenants/:tenantId
 * Cascades to brands, agents, visitors, conversations, messages (FK ON DELETE CASCADE).
 */
router.delete('/:tenantId', async (req, res, next) => {
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
// BRANDS  (nested under /api/tenants/:tenantId/brands)
// ---------------------------------------------------------------------------

/**
 * GET /api/tenants/:tenantId/brands
 */
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

/**
 * GET /api/tenants/:tenantId/brands/:brandId
 */
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
 * Body: {
 *   brand_name,
 *   widget_config_json?,
 *   allowed_domains_array?,
 *   inbound_email_prefix?,
 *   ai_system_prompt?,
 *   ai_confidence_threshold?,
 *   help_center_cname?
 * }
 */
router.post('/:tenantId/brands', async (req, res, next) => {
  try {
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

/**
 * PATCH /api/tenants/:tenantId/brands/:brandId
 */
router.patch('/:tenantId/brands/:brandId', async (req, res, next) => {
  try {
    const allowed = [
      'brand_name',
      'widget_config_json',
      'allowed_domains_array',
      'inbound_email_prefix',
      'ai_system_prompt',
      'ai_confidence_threshold',
      'help_center_cname',
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

/**
 * DELETE /api/tenants/:tenantId/brands/:brandId
 */
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

module.exports = router;
