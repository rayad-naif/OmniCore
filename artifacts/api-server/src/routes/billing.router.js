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

// ── Lemon Squeezy webhook (no auth — HMAC-verified inside handleWebhook) ──────
// Raw body is captured by the app.ts middleware and stored in req.rawBody.
router.post('/webhooks/lemonsqueezy',  handleWebhook);

module.exports = router;
