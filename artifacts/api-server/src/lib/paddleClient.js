'use strict';

/**
 * paddleClient.js
 * Thin wrapper around the Paddle Billing REST API.
 *
 * Auth priority:
 *   1. Replit Connectors SDK  — when running inside Replit (no env var needed;
 *      the integration handles key injection automatically).
 *   2. PADDLE_API_KEY env var — fallback for self-hosted / CI environments.
 *
 * Other env vars still required:
 *   PADDLE_ENVIRONMENT      : 'sandbox' (default) | 'production'
 *   PADDLE_WEBHOOK_SECRET   : Paddle dashboard → Developer → Notifications
 *   PADDLE_STARTER_PRICE_ID : set after running seed-paddle
 *   PADDLE_GROWTH_PRICE_ID  : set after running seed-paddle
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Replit Connectors — lazy-load the ESM module into CJS context.
// A new ReplitConnectors() is created per request (tokens expire).
// ---------------------------------------------------------------------------
let _ReplitConnectorsClass = null;

async function getConnectorClient() {
  // Only use Replit Connectors when running inside a Repl (REPL_ID is set by
  // the Replit runtime). On self-hosted deployments fall back to PADDLE_API_KEY.
  if (!process.env.REPL_ID) return null;

  if (!_ReplitConnectorsClass) {
    try {
      const mod = await import('@replit/connectors-sdk');
      _ReplitConnectorsClass = mod.ReplitConnectors;
    } catch {
      // SDK not available — will fall back to direct API key
      _ReplitConnectorsClass = null;
    }
  }
  return _ReplitConnectorsClass ? new _ReplitConnectorsClass() : null;
}

// ---------------------------------------------------------------------------
// Base URLs
// ---------------------------------------------------------------------------
function paddleBaseUrl() {
  return process.env.PADDLE_ENVIRONMENT === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com';
}

function paddleCheckoutBaseUrl() {
  return process.env.PADDLE_ENVIRONMENT === 'production'
    ? 'https://checkout.paddle.com'
    : 'https://sandbox-checkout.paddle.com';
}

// ---------------------------------------------------------------------------
// Core request — tries connector first, falls back to direct fetch with API key
// ---------------------------------------------------------------------------
async function paddleRequest(method, path, body) {
  const connectors = await getConnectorClient();

  let res;

  if (connectors) {
    // ── Replit Connectors path (API key injected automatically) ──────────
    res = await connectors.proxy('paddle', path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } else {
    // ── Direct fetch fallback (requires PADDLE_API_KEY env var) ──────────
    const key = process.env.PADDLE_API_KEY;
    if (!key) {
      const err = new Error(
        'Paddle is not configured. Either connect the Paddle integration in Replit, ' +
        'or set the PADDLE_API_KEY environment secret.',
      );
      err.status = 503;
      throw err;
    }

    res = await fetch(`${paddleBaseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const detail =
      json?.error?.detail ||
      json?.error?.type ||
      `Paddle API error ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    err.paddleError = json?.error;
    throw err;
  }

  return json;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Creates a Paddle Billing transaction and returns the hosted checkout URL.
 * Trial periods must be baked into the Price object (via seed-paddle).
 */
async function createCheckoutTransaction({ priceId, email, plan, businessName, userName, tenantId }) {
  // NOTE: We do NOT pass checkout.url here. With Paddle.js overlay checkout,
  // the success/cancel URLs are specified client-side via Paddle.Checkout.open()
  // settings. Passing a server-side checkout.url requires that domain to be
  // pre-approved in the Paddle dashboard — omitting it avoids that constraint.
  const resp = await paddleRequest('POST', '/transactions', {
    items: [{ price_id: priceId, quantity: 1 }],
    custom_data: {
      plan,
      email,
      business_name: businessName || null,
      user_name:     userName || null,
      tenant_id:     tenantId || null,
    },
  });

  const txId = resp.data?.id;
  // Build a fallback redirect URL (used if JS overlay isn't available)
  const base = paddleCheckoutBaseUrl();
  const url = resp.data?.checkout?.url || `${base}/checkout/custom-checkout?_ptxn=${txId}`;

  return { url, transactionId: txId };
}

/**
 * Returns the Paddle Price ID for a given plan slug from env vars.
 */
function getPaddlePriceId(plan) {
  return process.env[`PADDLE_${plan.toUpperCase()}_PRICE_ID`] || null;
}

// ---------------------------------------------------------------------------
// Catalog write helpers — used by the plan manager to keep Paddle in sync with
// the `billing_plans` table (source of truth).
// ---------------------------------------------------------------------------

/** Reports Paddle connection state by pinging the catalog. */
async function getPaddleConnectionStatus() {
  const environment =
    process.env.PADDLE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  try {
    await paddleRequest('GET', '/products?per_page=1');
    return { connected: true, environment };
  } catch (err) {
    return { connected: false, environment, error: err.message };
  }
}

/** Creates a Paddle product. Returns the created product object. */
async function createPaddleProduct({ name, description, customData }) {
  const resp = await paddleRequest('POST', '/products', {
    name,
    description: description || undefined,
    tax_category: 'saas',
    custom_data: customData || undefined,
  });
  return resp.data;
}

/** Updates a Paddle product's name/description/custom_data (best-effort fields). */
async function updatePaddleProduct(productId, { name, description, customData }) {
  const body = {};
  if (name !== undefined) body.name = name;
  if (description !== undefined) body.description = description || null;
  if (customData !== undefined) body.custom_data = customData;
  const resp = await paddleRequest('PATCH', `/products/${productId}`, body);
  return resp.data;
}

/** Archives a Paddle product so it is no longer purchasable. */
async function archivePaddleProduct(productId) {
  const resp = await paddleRequest('PATCH', `/products/${productId}`, {
    status: 'archived',
  });
  return resp.data;
}

/**
 * Creates a recurring monthly Paddle price with an optional baked-in trial.
 * Paddle prices are immutable — change price by creating a new one + archiving
 * the old. Returns the created price object.
 */
async function createPaddlePrice({ productId, amountCents, currency, trialDays, plan }) {
  const body = {
    product_id: productId,
    description: `${plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Plan'} — Monthly`,
    unit_price: {
      amount: String(amountCents),
      currency_code: String(currency || 'usd').toUpperCase(),
    },
    billing_cycle: { interval: 'month', frequency: 1 },
    tax_mode: 'account_setting',
    custom_data: plan ? { plan } : undefined,
  };
  if (trialDays && trialDays > 0) {
    body.trial_period = { interval: 'day', frequency: trialDays };
  }
  const resp = await paddleRequest('POST', '/prices', body);
  return resp.data;
}

/** Archives a Paddle price. */
async function archivePaddlePrice(priceId) {
  const resp = await paddleRequest('PATCH', `/prices/${priceId}`, {
    status: 'archived',
  });
  return resp.data;
}

/**
 * Verifies an incoming Paddle webhook signature.
 * Header format: `Paddle-Signature: ts=<unix>;h1=<hex-sha256>`
 * Returns the parsed event object on success, or null on failure.
 */
function verifyPaddleWebhook(rawBody, secret, signatureHeader) {
  if (!secret || !signatureHeader) return null;

  const parts = {};
  for (const segment of signatureHeader.split(';')) {
    const idx = segment.indexOf('=');
    if (idx < 0) continue;
    parts[segment.slice(0, idx)] = segment.slice(idx + 1);
  }
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) return null;

  const signedPayload = `${ts}:${rawBody.toString('utf8')}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(h1))) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  paddleRequest,
  createCheckoutTransaction,
  getPaddlePriceId,
  verifyPaddleWebhook,
  getPaddleConnectionStatus,
  createPaddleProduct,
  updatePaddleProduct,
  archivePaddleProduct,
  createPaddlePrice,
  archivePaddlePrice,
};
