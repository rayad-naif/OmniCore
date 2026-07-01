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
const { sendAccountUpdateEmail } = require('../services/email.service');

// ─── Idempotent migration: ensure billing linkage columns exist ──────────────
(async () => {
  try {
    await pool.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
        ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
        ADD COLUMN IF NOT EXISTS paddle_customer_id     TEXT,
        ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT,
        ADD COLUMN IF NOT EXISTS trial_ends_at          TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS lock_notified_at       TIMESTAMPTZ
    `);
  } catch (err) {
    logger.error({ err: err.message }, 'billing_migration_failed');
  }
})();

// ─── Lock notification helper ─────────────────────────────────────────────────
/**
 * Fires a one-time email when a tenant's grace period expires and they are
 * hard-locked. Sends to all tenant admins + PLATFORM_ADMIN_EMAIL if set.
 */
async function notifyLockEmails(tenantId, plan) {
  try {
    const { rows } = await pool.query(
      `SELECT a.email, t.company_name
         FROM agents a
         JOIN tenants t ON t.id = a.tenant_id
        WHERE a.tenant_id = $1 AND a.role = 'admin' AND a.is_active = TRUE
        LIMIT 5`,
      [tenantId],
    );
    const companyName = rows[0]?.company_name || 'your workspace';
    const subject  = 'Action required — OmniCore access locked';
    const heading  = 'Workspace access locked';
    const message  = `The free trial for ${companyName} has ended and the 7-day grace period has expired. `
                   + `All agents in this workspace are now prevented from accessing the dashboard until a paid subscription is activated. `
                   + `Please log in to the Billing section and add a payment method to restore access immediately.`;

    const sends = rows.map(r => sendAccountUpdateEmail({ to: r.email, subject, heading, message }));

    const platformEmail = process.env.PLATFORM_ADMIN_EMAIL;
    if (platformEmail) {
      sends.push(sendAccountUpdateEmail({
        to:      platformEmail,
        subject: `[Platform] Workspace locked — ${companyName}`,
        heading: 'Workspace hard-locked',
        message: `Tenant ID: ${tenantId}\nPlan: ${plan || 'unknown'}\nCompany: ${companyName}\n\nTheir trial + grace period have expired. No active paid subscription found.`,
      }));
    }

    await Promise.allSettled(sends);
    logger.info({ tenantId }, 'lock_notification_sent');
  } catch (err) {
    logger.warn({ err: err.message, tenantId }, 'lock_notification_failed');
  }
}

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
       grace_period_ends_at    AS "gracePeriodEndsAt",
       trial_ends_at           AS "trialEndsAt",
       lock_notified_at        AS "lockNotifiedAt"
     FROM tenants WHERE id = $1`,
    [tenantId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Tenant not found' });

  const t = rows[0];

  // ── Compute lock / grace state ────────────────────────────────────────────
  // Rules:
  //   active               → no lock (paid)
  //   trialing, within trial dates → no lock
  //   trialing, trial ended, within 7-day grace → lockState: 'grace'
  //   trialing, trial ended, grace expired       → lockState: 'locked'
  //   past_due, within grace_period_ends_at      → lockState: 'grace'
  //   past_due, past grace_period_ends_at        → lockState: 'locked'
  //   cancelled / paused                         → lockState: 'locked'
  const now = new Date();
  let lockState = null;
  let graceDaysLeft = 0;

  const status = t.status;
  if (status === 'active') {
    lockState = null;
  } else if (status === 'trialing') {
    if (t.trialEndsAt && new Date(t.trialEndsAt) <= now) {
      const graceEnd = new Date(new Date(t.trialEndsAt).getTime() + 7 * 24 * 60 * 60 * 1000);
      if (now >= graceEnd) {
        lockState = 'locked';
      } else {
        lockState = 'grace';
        graceDaysLeft = Math.ceil((graceEnd - now) / (24 * 60 * 60 * 1000));
      }
    }
    // else still within trial period — no lock
  } else if (status === 'past_due') {
    const graceEnd = t.gracePeriodEndsAt
      ? new Date(t.gracePeriodEndsAt)
      : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (now >= graceEnd) {
      lockState = 'locked';
    } else {
      lockState = 'grace';
      graceDaysLeft = Math.ceil((graceEnd - now) / (24 * 60 * 60 * 1000));
    }
  } else if (status === 'cancelled' || status === 'paused') {
    lockState = 'locked';
  }

  // Fire one-time lock notification email (fire-and-forget, never blocks response)
  if (lockState === 'locked' && !t.lockNotifiedAt) {
    pool.query('UPDATE tenants SET lock_notified_at = NOW() WHERE id = $1', [tenantId]).catch(() => {});
    notifyLockEmails(tenantId, t.plan).catch(() => {});
  }

  // Determine which provider owns the active subscription.
  const isPaddle = !!t.paddleSubscriptionId;
  const out = {
    customerId:        isPaddle ? t.paddleCustomerId  : t.stripeCustomerId,
    subscriptionId:    isPaddle ? t.paddleSubscriptionId : t.stripeSubscriptionId,
    plan:              t.plan,
    status:            t.status,
    gracePeriodEndsAt: t.gracePeriodEndsAt,
    trialEndsAt:       t.trialEndsAt,
    lockState,
    graceDaysLeft,
    provider:          isPaddle ? 'paddle' : 'stripe',
    currentPeriodEnd:  null,
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
  const email        = String(req.body?.email        || '').trim().toLowerCase();
  const plan         = String(req.body?.plan         || '').trim().toLowerCase();
  const businessName = String(req.body?.businessName || '').trim();
  const userName     = String(req.body?.userName     || '').trim();

  if (!businessName) return res.status(400).json({ error: 'businessName is required' });
  if (!userName)     return res.status(400).json({ error: 'userName is required' });
  if (!email)        return res.status(400).json({ error: 'email is required' });
  if (!plan)         return res.status(400).json({ error: 'plan is required' });

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
    businessName,
    userName,
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
