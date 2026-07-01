/**
 * billing.controller.js
 * Atelier OmniCore — multi-provider billing controller (Stripe + Paddle)
 *
 * Routes (registered in billing.router.js):
 *   GET  /api/billing/plans                 — self-serve plans from synced Stripe data
 *   POST /api/billing/checkout/public       — public (pre-signup) checkout — no auth
 *   POST /api/checkout                      — tenant checkout (logged-in agents)
 *   POST /api/billing/portal               — billing management portal URL
 *   GET  /api/billing/subscription         — current tenant subscription
 *   GET  /api/billing/usage                — current period usage meters
 *
 * Provider routing:
 *   BILLING_PROVIDER=stripe (default) | paddle
 *   Webhook handlers live in app.ts (Stripe) and the Paddle webhook route.
 *
 * Tenant columns consumed (tenants table):
 *   stripe_customer_id      TEXT
 *   stripe_subscription_id  TEXT
 *   paddle_customer_id      TEXT   (added by migration below)
 *   paddle_subscription_id  TEXT   (added by migration below)
 *   plan                    TEXT   ('free'|'starter'|'growth'|'enterprise')
 *   subscription_status     TEXT   ('trialing'|'active'|'past_due'|'cancelled'|'paused')
 *   grace_period_ends_at    TIMESTAMPTZ
 */

'use strict';

const { pool }            = require('../lib/db');
const logger              = require('../utils/logger');
const billingProvider     = require('../lib/billingProvider');
const plansRepo           = require('../lib/plansRepo');
const { publicAppUrl }    = require('../lib/env');

// ─── Idempotent migration: ensure billing linkage columns exist ──────────────
(async () => {
  try {
    await pool.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
        ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
        ADD COLUMN IF NOT EXISTS paddle_customer_id     TEXT,
        ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT
    `);
  } catch (err) {
    logger.error({ err: err.message }, 'billing_migration_failed');
  }
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Public base URL for building checkout success/cancel redirects.
 * Prefers the published Replit domain, falls back to the request host.
 */
function appBaseUrl(req) {
  return publicAppUrl(req);
}

// ─── GET /api/billing/plans ──────────────────────────────────────────────────
// Self-serve, purchasable plans (excludes the Free plan), read from the
// `billing_plans` source-of-truth table. Shapes each with a `priceId` so the
// tenant billing grid and checkout can reuse the same payload.
async function getPlans(req, res) {
  const plans = (await plansRepo.listSelfServePlans()).map((p) => ({
    plan:        p.slug,
    name:        p.name,
    description: p.description,
    priceId:     p.paddle_price_id || p.slug,
    amount:      p.amount,
    currency:    p.currency,
    interval:    p.interval,
    features:    p.features,
    limits:      p.limits,
  }));
  return res.json({ plans });
}

// ─── POST /api/checkout ──────────────────────────────────────────────────────
/**
 * Creates a checkout session for the authenticated agent's tenant.
 * Routes to Stripe or Paddle depending on BILLING_PROVIDER and whether
 * the tenant already has a provider record.
 * Body: { plan: 'starter' | 'growth' }
 * Returns: { url, provider }
 */
async function createCheckout(req, res) {
  const tenantId = req.agent?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

  const plan = String(req.body?.plan || '').trim().toLowerCase();
  if (!plan) return res.status(400).json({ error: 'plan is required' });

  const target = await plansRepo.getPlanBySlug(plan);
  if (!target || !target.active || !target.self_serve || target.is_free) {
    return res.status(400).json({ error: 'This plan is not available for self-serve checkout.' });
  }

  // Ensure the plan is mirrored in Paddle (lazily syncs if needed).
  const paddlePriceId = await plansRepo.ensurePaddlePriceId(plan);

  const { rows } = await pool.query(
    'SELECT id, company_name, stripe_customer_id, paddle_customer_id FROM tenants WHERE id = $1',
    [tenantId]
  );
  const tenant = rows[0];
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const base   = appBaseUrl(req);
  const result = await billingProvider.createTenantCheckoutUrl({
    tenant,
    agentEmail:    req.agent?.email,
    plan,
    stripepriceId: target.paddle_price_id || null,
    paddlePriceId,
    baseUrl:       base,
  });

  req.log.info({ tenantId, plan, provider: result.provider }, 'tenant_checkout_created');
  return res.json(result);
}

// ─── POST /api/billing/portal ────────────────────────────────────────────────
/**
 * Generates a billing portal / self-serve management URL for the tenant.
 * Routes to Stripe or Paddle depending on which provider owns the subscription.
 * Returns: { url }
 */
async function getPortalUrl(req, res) {
  const tenantId = req.agent?.tenantId;
  const { rows } = await pool.query(
    'SELECT stripe_customer_id, paddle_customer_id FROM tenants WHERE id = $1',
    [tenantId]
  );
  const tenant = rows[0];
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const base = appBaseUrl(req);
  const result = await billingProvider.getPortalUrl({ tenant, baseUrl: base });
  return res.json(result);
}

// ─── GET /api/billing/subscription ───────────────────────────────────────────
async function getSubscription(req, res) {
  const tenantId = req.agent?.tenantId;
  const { rows } = await pool.query(
    `SELECT
       stripe_customer_id      AS "stripeCustomerId",
       stripe_subscription_id  AS "stripeSubscriptionId",
       paddle_customer_id      AS "paddleCustomerId",
       paddle_subscription_id  AS "paddleSubscriptionId",
       plan,
       subscription_status     AS status,
       grace_period_ends_at    AS "gracePeriodEndsAt"
     FROM tenants WHERE id = $1`,
    [tenantId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Tenant not found' });

  const t = rows[0];

  // Determine which provider owns the active subscription.
  const isPaddle = !!t.paddleSubscriptionId;
  const out = {
    customerId:      isPaddle ? t.paddleCustomerId  : t.stripeCustomerId,
    subscriptionId:  isPaddle ? t.paddleSubscriptionId : t.stripeSubscriptionId,
    plan:            t.plan,
    status:          t.status,
    gracePeriodEndsAt: t.gracePeriodEndsAt,
    provider:        isPaddle ? 'paddle' : 'stripe',
    currentPeriodEnd: null,
  };

  if (!isPaddle && t.stripeSubscriptionId) {
    // Enrich with current period end from the synced Stripe schema.
    try {
      const sub = await pool.query(
        `SELECT current_period_end FROM stripe.subscriptions WHERE id = $1`,
        [t.stripeSubscriptionId]
      );
      const cpe = sub.rows[0]?.current_period_end;
      out.currentPeriodEnd = cpe ? new Date(Number(cpe) * 1000).toISOString() : null;
    } catch {
      out.currentPeriodEnd = null;
    }
  } else if (isPaddle && t.paddleSubscriptionId) {
    // For Paddle, fetch current period end from the Paddle API.
    try {
      const { paddleRequest } = require('../lib/paddleClient');
      const resp = await paddleRequest('GET', `/subscriptions/${t.paddleSubscriptionId}`);
      const nextBilledAt = resp?.data?.next_billed_at;
      out.currentPeriodEnd = nextBilledAt || null;
    } catch {
      out.currentPeriodEnd = null;
    }
  }

  return res.json(out);
}

// ─── GET /api/billing/usage ───────────────────────────────────────────────────
async function getUsage(req, res) {
  const tenantId = req.agent?.tenantId;

  const [seats, convos, articles] = await Promise.all([
    pool.query(
      'SELECT COUNT(*) FROM agents WHERE tenant_id=$1 AND is_active=true',
      [tenantId]
    ),
    pool.query(
      "SELECT COUNT(*) FROM conversations WHERE tenant_id=$1 AND created_at >= date_trunc('month', NOW())",
      [tenantId]
    ),
    pool.query(
      'SELECT COUNT(*) FROM knowledge_articles WHERE tenant_id=$1',
      [tenantId]
    ),
  ]);

  return res.json({
    seats:         parseInt(seats.rows[0].count,    10),
    conversations: parseInt(convos.rows[0].count,   10),
    articles:      parseInt(articles.rows[0].count, 10),
  });
}

// ─── POST /api/billing/checkout/public ───────────────────────────────────────
/**
 * Public (pre-signup) checkout for marketing site visitors.
 * Routes to Stripe (14-day trial baked into session) or Paddle (trial baked
 * into the Price object via seed-paddle) based on BILLING_PROVIDER.
 * Body: { email, plan: 'starter' | 'growth' }
 * Returns: { url, provider }
 */
async function createPublicCheckout(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const plan  = String(req.body?.plan  || '').trim().toLowerCase();

  if (!email) return res.status(400).json({ error: 'email is required' });
  if (!plan)  return res.status(400).json({ error: 'plan is required' });

  const target = await plansRepo.getPlanBySlug(plan);
  if (!target || !target.active || !target.self_serve || target.is_free) {
    return res.status(400).json({
      error: 'This plan is not available for checkout. Please contact sales.',
    });
  }

  // Ensure the plan is mirrored in Paddle (lazily syncs if needed).
  const paddlePriceId = await plansRepo.ensurePaddlePriceId(plan);

  const base   = appBaseUrl(req);
  const result = await billingProvider.createPublicCheckoutUrl({
    email,
    plan,
    stripepriceId: target.paddle_price_id || null,
    paddlePriceId,
    baseUrl:       base,
  });

  return res.json(result);
}

// ─── Express error wrapper ────────────────────────────────────────────────────
function wrap(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      logger.error({ err, path: req.path }, 'billing_controller_error');
      if (!res.headersSent) {
        res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
      }
    }
  };
}

module.exports = {
  getPlans:             wrap(getPlans),
  createCheckout:       wrap(createCheckout),
  createPublicCheckout: wrap(createPublicCheckout),
  getPortalUrl:         wrap(getPortalUrl),
  getSubscription:      wrap(getSubscription),
  getUsage:             wrap(getUsage),
};
