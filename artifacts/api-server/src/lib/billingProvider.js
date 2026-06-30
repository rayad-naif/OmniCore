'use strict';

/**
 * billingProvider.js
 * Provider abstraction over Stripe and Paddle Billing.
 *
 * Environment:
 *   BILLING_PROVIDER = 'stripe' (default) | 'paddle'
 *     Controls which provider handles NEW public checkouts.
 *     Existing Stripe subscribers are never affected — their renewal/portal
 *     still routes through Stripe regardless of this flag.
 *
 * Public API:
 *   getActiveProvider()  → 'stripe' | 'paddle'
 *   createPublicCheckoutUrl({ email, plan, stripepriceId, baseUrl })
 *     → { url, provider }
 *   createTenantCheckoutUrl({ tenant, agentEmail, plan, stripepriceId, baseUrl })
 *     → { url, provider }
 *   getPortalUrl({ tenant, baseUrl })
 *     → { url }
 */

const logger = require('../utils/logger');

// ─── Provider routing ─────────────────────────────────────────────────────────

/**
 * Returns the active billing provider slug.
 * 'stripe' unless BILLING_PROVIDER=paddle is set.
 */
function getActiveProvider() {
  const p = (process.env.BILLING_PROVIDER || 'stripe').toLowerCase();
  return p === 'paddle' ? 'paddle' : 'stripe';
}

// ─── Stripe helpers ───────────────────────────────────────────────────────────

async function _stripePublicCheckout({ email, plan, stripepriceId, baseUrl }) {
  const { getUncachableStripeClient } = require('./stripeClient');
  const stripe = await getUncachableStripeClient();

  const existing = await stripe.customers.list({ email, limit: 1 });
  const customer =
    existing.data.length > 0
      ? existing.data[0]
      : await stripe.customers.create({ email });

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    line_items: [{ price: stripepriceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 14,
      metadata: { plan },
    },
    allow_promotion_codes: true,
    success_url: `${baseUrl}/checkout/success?plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/pricing`,
  });

  logger.info({ plan, provider: 'stripe' }, 'public_checkout_created');
  return { url: session.url, provider: 'stripe' };
}

async function _stripeTenantCheckout({ tenant, agentEmail, plan, stripepriceId, baseUrl }) {
  const { pool } = require('./db');
  const { getUncachableStripeClient } = require('./stripeClient');
  const stripe = await getUncachableStripeClient();

  let customerId = tenant.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: agentEmail || undefined,
      name: tenant.company_name || undefined,
      metadata: { tenant_id: String(tenant.id) },
    });
    customerId = customer.id;
    await pool.query(
      'UPDATE tenants SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2',
      [customerId, tenant.id],
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: String(tenant.id),
    line_items: [{ price: stripepriceId, quantity: 1 }],
    subscription_data: {
      metadata: { tenant_id: String(tenant.id), plan },
    },
    success_url: `${baseUrl}/dashboard/?checkout=success`,
    cancel_url: `${baseUrl}/dashboard/?checkout=cancelled`,
  });

  return { url: session.url, provider: 'stripe' };
}

async function _stripePortal({ tenant, baseUrl }) {
  const { getUncachableStripeClient } = require('./stripeClient');
  const customerId = tenant.stripe_customer_id;
  if (!customerId) {
    const err = new Error('No Stripe billing record found for this workspace');
    err.status = 404;
    throw err;
  }
  const stripe = await getUncachableStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/dashboard/`,
  });
  return { url: session.url };
}

// ─── Paddle helpers ───────────────────────────────────────────────────────────

async function _paddlePublicCheckout({ email, plan, paddlePriceId, baseUrl }) {
  const { createCheckoutTransaction, getPaddlePriceId } = require('./paddleClient');

  const priceId = paddlePriceId || getPaddlePriceId(plan);
  if (!priceId) {
    const err = new Error(
      `No Paddle price is available for the "${plan}" plan. ` +
        `Open Super Admin → Billing and sync the plan to Paddle.`,
    );
    err.status = 503;
    throw err;
  }

  const { url } = await createCheckoutTransaction({
    priceId,
    email,
    plan,
    successUrl: `${baseUrl}/checkout/success?plan=${plan}`,
    cancelUrl: `${baseUrl}/pricing`,
  });

  logger.info({ plan, provider: 'paddle' }, 'public_checkout_created');
  return { url, provider: 'paddle' };
}

async function _paddleTenantCheckout({ tenant, agentEmail, plan, paddlePriceId, baseUrl }) {
  const { createCheckoutTransaction, getPaddlePriceId, paddleRequest } = require('./paddleClient');
  const { pool } = require('./db');

  const priceId = paddlePriceId || getPaddlePriceId(plan);
  if (!priceId) {
    const err = new Error(
      `No Paddle price is available for the "${plan}" plan. ` +
        `Open Super Admin → Billing and sync the plan to Paddle.`,
    );
    err.status = 503;
    throw err;
  }

  // Reuse existing Paddle customer or create a new one.
  let paddleCustomerId = tenant.paddle_customer_id;
  if (!paddleCustomerId) {
    const resp = await paddleRequest('POST', '/customers', {
      email: agentEmail || undefined,
      name: tenant.company_name || undefined,
      custom_data: { tenant_id: String(tenant.id) },
    });
    paddleCustomerId = resp.data?.id;
    if (paddleCustomerId) {
      await pool.query(
        'UPDATE tenants SET paddle_customer_id = $1, updated_at = NOW() WHERE id = $2',
        [paddleCustomerId, tenant.id],
      );
    }
  }

  const { url } = await createCheckoutTransaction({
    priceId,
    email: agentEmail,
    plan,
    successUrl: `${baseUrl}/dashboard/?checkout=success`,
    cancelUrl: `${baseUrl}/dashboard/?checkout=cancelled`,
  });

  return { url, provider: 'paddle' };
}

async function _paddlePortal({ tenant }) {
  // Paddle uses a customer portal URL pattern.
  const paddleCustomerId = tenant.paddle_customer_id;
  if (!paddleCustomerId) {
    const err = new Error('No Paddle billing record found for this workspace');
    err.status = 404;
    throw err;
  }
  const base =
    process.env.PADDLE_ENVIRONMENT === 'production'
      ? 'https://customer.paddle.com'
      : 'https://sandbox-customer.paddle.com';
  return { url: `${base}/portal/${paddleCustomerId}` };
}

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Creates a public (pre-signup) checkout URL.
 * @param {object} opts
 * @param {string} opts.email
 * @param {string} opts.plan
 * @param {string} opts.stripepriceId — Stripe price ID (only used when provider=stripe)
 * @param {string} opts.baseUrl
 * @returns {Promise<{url: string, provider: string}>}
 */
async function createPublicCheckoutUrl({ email, plan, stripepriceId, paddlePriceId, baseUrl }) {
  const provider = getActiveProvider();
  if (provider === 'paddle') {
    return _paddlePublicCheckout({ email, plan, paddlePriceId, baseUrl });
  }
  return _stripePublicCheckout({ email, plan, stripepriceId, baseUrl });
}

/**
 * Creates a checkout URL for a logged-in tenant (dashboard → upgrade flow).
 * Routes to the provider that already has a customer record for this tenant,
 * falling back to the active provider.
 */
async function createTenantCheckoutUrl({ tenant, agentEmail, plan, stripepriceId, paddlePriceId, baseUrl }) {
  // Prefer the provider that already has a record for this tenant.
  if (tenant.paddle_customer_id || getActiveProvider() === 'paddle') {
    return _paddleTenantCheckout({ tenant, agentEmail, plan, paddlePriceId, baseUrl });
  }
  return _stripeTenantCheckout({ tenant, agentEmail, plan, stripepriceId, baseUrl });
}

/**
 * Returns a billing portal / self-serve management URL for the tenant.
 * Routes to the provider that owns the tenant's active subscription.
 */
async function getPortalUrl({ tenant, baseUrl }) {
  // Prefer the provider that has a customer record.
  if (tenant.paddle_customer_id && !tenant.stripe_customer_id) {
    return _paddlePortal({ tenant });
  }
  return _stripePortal({ tenant, baseUrl });
}

module.exports = {
  getActiveProvider,
  createPublicCheckoutUrl,
  createTenantCheckoutUrl,
  getPortalUrl,
};
