/**
 * billing.controller.js
 * Atelier OmniCore — Stripe self-serve billing controller
 *
 * Routes (registered in billing.router.js):
 *   GET  /api/billing/plans                 — self-serve plans (Starter, Pro) from synced Stripe data
 *   POST /api/checkout                      — create a Stripe Checkout session for a plan
 *   POST /api/billing/portal               — Stripe billing portal URL
 *   GET  /api/billing/subscription         — current tenant subscription
 *   GET  /api/billing/usage                — current period usage meters
 *
 * Stripe webhooks are handled directly in app.ts (raw body, before express.json()).
 * Stripe product/price/subscription data is synced into the `stripe` Postgres
 * schema by stripe-replit-sync — read paths query those tables, write paths use
 * the Stripe API via getUncachableStripeClient().
 *
 * Tenant columns consumed (tenants table):
 *   stripe_customer_id      TEXT
 *   stripe_subscription_id  TEXT
 *   plan                    TEXT   ('free'|'starter'|'pro'|'enterprise')
 *   subscription_status     TEXT   ('trialing'|'active'|'past_due'|'cancelled'|'paused')
 *   grace_period_ends_at    TIMESTAMPTZ
 */

'use strict';

const { pool } = require('../lib/db');
const logger   = require('../utils/logger');   // pino singleton
// stripeClient.ts is bundled by esbuild (CJS↔ESM interop via the build banner).
const { getUncachableStripeClient } = require('../lib/stripeClient');

// Self-serve plans are driven by Stripe product metadata: any active product
// whose metadata.self_serve === 'true' is purchasable via checkout.
// Legacy plan slugs (without the flag) remain self-serve too.
const LEGACY_SELF_SERVE_PLANS = ['starter', 'pro', 'growth'];

// ─── Idempotent migration: ensure Stripe linkage columns exist ───────────────
(async () => {
  try {
    await pool.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
        ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT
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
  const domain = (process.env.REPLIT_DOMAINS || '').split(',')[0]?.trim();
  if (domain) return `https://${domain}`;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${proto}://${req.get('host')}`;
}

/**
 * Reads the active self-serve plans from the synced `stripe` schema.
 * Returns one entry per plan with its cheapest active monthly price.
 */
async function loadPlansFromSchema() {
  const { rows } = await pool.query(
    `SELECT
       p.id                       AS product_id,
       p.name                     AS name,
       p.description              AS description,
       p.metadata                 AS metadata,
       p.metadata ->> 'plan'      AS plan,
       pr.id                      AS price_id,
       pr.unit_amount             AS unit_amount,
       pr.currency                AS currency,
       pr.recurring ->> 'interval' AS interval
     FROM stripe.products p
     JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
     WHERE p.active = true
       AND p.metadata ->> 'plan' IS NOT NULL
       AND (p.metadata ->> 'self_serve' = 'true' OR p.metadata ->> 'plan' = ANY($1))
       AND pr.recurring ->> 'interval' = 'month'
     ORDER BY pr.unit_amount ASC`,
    [LEGACY_SELF_SERVE_PLANS]
  );

  // Keep the first (cheapest) active monthly price per plan, with its features.
  const byPlan = new Map();
  for (const r of rows) {
    if (!byPlan.has(r.plan)) {
      const m = r.metadata || {};
      byPlan.set(r.plan, {
        plan:        r.plan,
        name:        r.name,
        description: r.description,
        priceId:     r.price_id,
        amount:      r.unit_amount,
        currency:    r.currency,
        interval:    r.interval,
        features: {
          ai_feature_enabled:   m.ai_feature_enabled   === 'true',
          smtp_feature_enabled: m.smtp_feature_enabled === 'true',
        },
        limits: {
          max_brands_allowed: m.max_brands_allowed ? parseInt(m.max_brands_allowed, 10) : null,
          max_agents_allowed: m.max_agents_allowed ? parseInt(m.max_agents_allowed, 10) : null,
          conversation_limit: m.conversation_limit ? parseInt(m.conversation_limit, 10) : null,
        },
      });
    }
  }
  // Cheapest first.
  return [...byPlan.values()].sort((a, b) => (a.amount || 0) - (b.amount || 0));
}

// ─── GET /api/billing/plans ──────────────────────────────────────────────────
async function getPlans(req, res) {
  const plans = await loadPlansFromSchema();
  return res.json({ plans });
}

// ─── POST /api/checkout ──────────────────────────────────────────────────────
/**
 * Creates a Stripe Checkout session for the authenticated agent's tenant.
 * Body: { plan: 'starter' | 'pro' }
 * Returns: { url }
 */
async function createCheckout(req, res) {
  const tenantId = req.agent?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

  const plan = String(req.body?.plan || '').trim().toLowerCase();
  if (!plan) {
    return res.status(400).json({ error: 'plan is required' });
  }

  const plans  = await loadPlansFromSchema();
  const target = plans.find((p) => p.plan === plan);
  if (!target?.priceId) {
    return res.status(400).json({ error: 'This plan is not available for self-serve checkout.' });
  }

  const { rows } = await pool.query(
    'SELECT id, company_name, stripe_customer_id FROM tenants WHERE id = $1',
    [tenantId]
  );
  const tenant = rows[0];
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const stripe = await getUncachableStripeClient();

  // Reuse the tenant's Stripe customer, or create one keyed to the tenant.
  let customerId = tenant.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: req.agent?.email || undefined,
      name:  tenant.company_name || undefined,
      metadata: { tenant_id: String(tenantId) },
    });
    customerId = customer.id;
    await pool.query(
      'UPDATE tenants SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2',
      [customerId, tenantId]
    );
  }

  const base = appBaseUrl(req);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: String(tenantId),
    line_items: [{ price: target.priceId, quantity: 1 }],
    subscription_data: {
      metadata: { tenant_id: String(tenantId), plan },
    },
    success_url: `${base}/dashboard/?checkout=success`,
    cancel_url:  `${base}/dashboard/?checkout=cancelled`,
  });

  req.log.info({ tenantId, plan, priceId: target.priceId }, 'stripe_checkout_created');
  return res.json({ url: session.url });
}

// ─── POST /api/billing/portal ────────────────────────────────────────────────
/**
 * Generates a Stripe billing portal URL for the tenant's customer.
 * Returns: { url }
 */
async function getPortalUrl(req, res) {
  const tenantId = req.agent?.tenantId;
  const { rows } = await pool.query(
    'SELECT stripe_customer_id FROM tenants WHERE id = $1',
    [tenantId]
  );
  const customerId = rows[0]?.stripe_customer_id;
  if (!customerId) return res.status(404).json({ error: 'No billing customer found for this tenant' });

  const stripe = await getUncachableStripeClient();
  const base   = appBaseUrl(req);
  const session = await stripe.billingPortal.sessions.create({
    customer:   customerId,
    return_url: `${base}/dashboard/`,
  });
  return res.json({ url: session.url });
}

// ─── GET /api/billing/subscription ───────────────────────────────────────────
async function getSubscription(req, res) {
  const tenantId = req.agent?.tenantId;
  const { rows } = await pool.query(
    `SELECT
       stripe_customer_id     AS "customerId",
       stripe_subscription_id AS "subscriptionId",
       plan,
       subscription_status    AS status,
       grace_period_ends_at   AS "gracePeriodEndsAt"
     FROM tenants WHERE id = $1`,
    [tenantId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Tenant not found' });

  const out = rows[0];

  // Enrich with the current period end from the synced subscription, if any.
  if (out.subscriptionId) {
    try {
      const sub = await pool.query(
        `SELECT current_period_end FROM stripe.subscriptions WHERE id = $1`,
        [out.subscriptionId]
      );
      const cpe = sub.rows[0]?.current_period_end;
      out.currentPeriodEnd = cpe ? new Date(Number(cpe) * 1000).toISOString() : null;
    } catch {
      out.currentPeriodEnd = null;
    }
  } else {
    out.currentPeriodEnd = null;
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
 * Public (no auth) checkout for marketing site visitors.
 * Creates a Stripe Checkout session with a 14-day trial for new customers.
 * Body: { email, plan: 'starter' | 'growth' }
 * Returns: { url }
 */
async function createPublicCheckout(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const plan  = String(req.body?.plan  || '').trim().toLowerCase();

  if (!email) return res.status(400).json({ error: 'email is required' });
  if (!plan)  return res.status(400).json({ error: 'plan is required' });

  const plans  = await loadPlansFromSchema();
  const target = plans.find((p) => p.plan === plan);
  if (!target?.priceId) {
    return res.status(400).json({
      error: 'This plan is not available for self-serve checkout. Please contact sales.',
    });
  }

  const stripe = await getUncachableStripeClient();

  // Reuse existing Stripe customer for this email, or create a new one.
  const existing = await stripe.customers.list({ email, limit: 1 });
  let customer;
  if (existing.data.length > 0) {
    customer = existing.data[0];
  } else {
    customer = await stripe.customers.create({ email });
  }

  const base = appBaseUrl(req);
  const session = await stripe.checkout.sessions.create({
    mode:                'subscription',
    customer:            customer.id,
    line_items:          [{ price: target.priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 14,
      metadata:          { plan },
    },
    // Allow promotion codes so discount codes work at checkout.
    allow_promotion_codes: true,
    success_url: `${base}/checkout/success?plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${base}/pricing`,
  });

  logger.info({ plan, priceId: target.priceId }, 'public_checkout_created');
  return res.json({ url: session.url });
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
