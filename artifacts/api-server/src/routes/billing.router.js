'use strict';

/**
 * billing.router.js
 * Wraps billing.controller.js handler functions into named Express routes.
 *
 * Mounted at /api in routes/index.ts so full paths are:
 *   POST   /api/checkout
 *   POST   /api/billing/portal
 *   GET    /api/billing/subscription
 *   GET    /api/billing/usage
 *   POST   /api/webhooks/lemonsqueezy   (raw body — pre-parsed by app.ts middleware)
 */

const express         = require('express');
const { Router }      = express;
const { requireAuth } = require('../middleware/auth');
const { pool }        = require('../lib/db');
const logger          = require('../utils/logger');
const {
  createCheckout,
  getPortalUrl,
  getSubscription,
  getUsage,
  handleWebhook,
} = require('../controllers/billing.controller');

const router = Router();

// ── Authenticated billing routes ──────────────────────────────────────────────
router.post('/checkout',               requireAuth, createCheckout);
router.post('/billing/portal',         requireAuth, getPortalUrl);
router.get ('/billing/subscription',   requireAuth, getSubscription);
router.get ('/billing/usage',          requireAuth, getUsage);

// ── Manual upgrade request (replaces LemonSqueezy redirect) ──────────────────
router.post('/billing/upgrade-request', requireAuth, async (req, res, next) => {
  try {
    const { requested_plan, company_size, notes } = req.body || {};
    if (!requested_plan?.trim()) {
      return res.status(400).json({ error: 'requested_plan is required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO upgrade_requests (tenant_id, agent_id, requested_plan, company_size, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, requested_plan, status, created_at`,
      [req.agent.tenantId, req.agent.id, requested_plan.trim(), company_size || null, notes || null]
    );
    logger.info({ tenantId: req.agent.tenantId, requested_plan }, 'upgrade_request_submitted');
    return res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── Lemon Squeezy webhook (no auth — HMAC-verified inside handleWebhook) ──────
// Raw body is captured by the app.ts middleware and stored in req.rawBody.
router.post('/webhooks/lemonsqueezy',  handleWebhook);

module.exports = router;
