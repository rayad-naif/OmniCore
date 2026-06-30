'use strict';

/**
 * paddleClient.js
 * Thin fetch-based wrapper around the Paddle Billing REST API.
 * Uses PADDLE_API_KEY + PADDLE_ENVIRONMENT env vars — no SDK dependency.
 *
 * PADDLE_ENVIRONMENT: 'sandbox' (default) | 'production'
 * PADDLE_API_KEY: found in Paddle dashboard → Developer → Authentication
 * PADDLE_WEBHOOK_SECRET: found in Paddle dashboard → Developer → Notifications
 * PADDLE_STARTER_PRICE_ID: set after running `pnpm --filter @workspace/scripts run seed-paddle`
 * PADDLE_GROWTH_PRICE_ID:  set after running seed-paddle
 */

const crypto = require('crypto');

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

function getApiKey() {
  const key = process.env.PADDLE_API_KEY;
  if (!key) {
    const err = new Error(
      'PADDLE_API_KEY is not set. Add it as an environment secret from the Paddle dashboard → Developer → Authentication.',
    );
    err.status = 503;
    throw err;
  }
  return key;
}

/**
 * Makes an authenticated Paddle Billing API request.
 * Throws a descriptive Error on non-2xx responses.
 */
async function paddleRequest(method, path, body) {
  const base = paddleBaseUrl();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

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

/**
 * Creates a Paddle Billing transaction and returns the hosted checkout URL.
 * Trial periods must already be baked into the Price object (via seed-paddle).
 *
 * @param {object} opts
 * @param {string} opts.priceId   — Paddle Price ID (pri_xxx)
 * @param {string} opts.email     — Customer email (for prefill + custom_data)
 * @param {string} opts.plan      — Plan slug for custom_data
 * @param {string} opts.successUrl — Where Paddle redirects after checkout
 * @param {string} [opts.cancelUrl] — Not officially in Paddle tx, but stored in custom_data
 * @returns {Promise<{url: string, transactionId: string}>}
 */
async function createCheckoutTransaction({ priceId, email, plan, successUrl, cancelUrl }) {
  const resp = await paddleRequest('POST', '/transactions', {
    items: [{ price_id: priceId, quantity: 1 }],
    custom_data: { plan, email, cancel_url: cancelUrl || null },
    checkout: {
      url: successUrl,
    },
  });

  const txId = resp.data?.id;
  // Prefer the URL Paddle returns; fall back to the standard hosted-checkout pattern.
  const url =
    resp.data?.checkout?.url ||
    `${paddleCheckoutBaseUrl()}/checkout/custom/${txId}`;

  return { url, transactionId: txId };
}

/**
 * Returns the Paddle Price ID for a given plan slug.
 * Reads PADDLE_<PLAN>_PRICE_ID from env.
 */
function getPaddlePriceId(plan) {
  return process.env[`PADDLE_${plan.toUpperCase()}_PRICE_ID`] || null;
}

/**
 * Verifies an incoming Paddle webhook signature.
 * Paddle format: `Paddle-Signature: ts=<unix>;h1=<hex-sha256>`
 *
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
};
