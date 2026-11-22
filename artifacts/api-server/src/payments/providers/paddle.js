'use strict';

/**
 * Paddle Billing (the workspace's own Paddle account), as in paddle-pay-connect:
 * paste one API key; we detect sandbox/live, create a client-side token and a
 * notification destination (webhook + signing secret) automatically. Payments
 * use a transaction with a non-catalog price for the exact amount and open
 * Paddle.js checkout on the pay page.
 *
 * Paddle requires a default payment link (Checkout → Checkout settings) and an
 * approved website domain before live checkouts open.
 */

const crypto = require('node:crypto');
const { call, ProviderError } = require('./http');

const BASE = {
  live: 'https://api.paddle.com',
  sandbox: 'https://sandbox-api.paddle.com',
};

const auth = (apiKey) => ({ Authorization: `Bearer ${apiKey}` });
const paddleError = (r, fallback) =>
  new ProviderError(
    r.data?.error?.detail || r.data?.error?.code || fallback,
    r.status === 403 || r.status === 401 ? 400 : 502,
  );

async function detectEnvironment(apiKey) {
  if (apiKey.includes('_sdbx_')) return 'sandbox';
  if (apiKey.includes('_live_')) return 'live';
  for (const env of ['live', 'sandbox']) {
    const r = await call(`${BASE[env]}/event-types`, { headers: auth(apiKey) });
    if (r.ok) return env;
  }
  throw new ProviderError(
    'Paddle rejected this API key (checked live and sandbox)',
    400,
  );
}

module.exports = {
  key: 'paddle',
  label: 'Paddle',
  kind: 'online',
  methods:
    'Cards, PayPal, Apple Pay, Google Pay and local methods, with Paddle as merchant of record',
  fields: [
    { name: 'api_key', label: 'Paddle API key', secret: true, required: true },
  ],

  async connect({ credentials, webhookUrl, workspaceName }) {
    const apiKey = String(credentials.api_key || '').trim();
    if (!apiKey) throw new ProviderError('Enter your Paddle API key', 400);
    const env = await detectEnvironment(apiKey);
    const base = BASE[env];
    const token = await call(`${base}/client-tokens`, {
      method: 'POST',
      headers: auth(apiKey),
      json: {
        name: `OmniCore checkout — ${workspaceName}`.slice(0, 150),
        description: 'Created by OmniCore payments',
      },
    });
    if (!token.ok)
      throw paddleError(token, 'Could not create a Paddle client-side token');
    const dest = await call(`${base}/notification-settings`, {
      method: 'POST',
      headers: auth(apiKey),
      json: {
        description: 'OmniCore payments',
        destination: webhookUrl,
        type: 'url',
        api_version: 1,
        include_sensitive_fields: false,
        subscribed_events: ['transaction.completed', 'transaction.paid'],
      },
    });
    if (!dest.ok)
      throw paddleError(
        dest,
        'Could not create the Paddle notification destination',
      );
    return {
      environment: env,
      credentials: {
        api_key: apiKey,
        webhook_secret: dest.data?.data?.endpoint_secret_key,
        notification_id: dest.data?.data?.id,
      },
      settings: {
        client_token: token.data?.data?.token,
        client_token_id: token.data?.data?.id,
      },
    };
  },

  async disconnect({ credentials, environment, settings }) {
    const base = BASE[environment] || BASE.live;
    if (credentials?.notification_id) {
      await call(
        `${base}/notification-settings/${credentials.notification_id}`,
        {
          method: 'DELETE',
          headers: auth(credentials.api_key),
        },
      ).catch(() => {});
    }
    if (settings?.client_token_id) {
      await call(`${base}/client-tokens/${settings.client_token_id}`, {
        method: 'PATCH',
        headers: auth(credentials.api_key),
        json: { status: 'revoked' },
      }).catch(() => {});
    }
  },

  async createCheckout({ credentials, environment, settings, attempt }) {
    const base = BASE[environment] || BASE.live;
    const r = await call(`${base}/transactions`, {
      method: 'POST',
      headers: auth(credentials.api_key),
      json: {
        collection_mode: 'automatic',
        currency_code: attempt.currency.toUpperCase(),
        custom_data: { omnicore_attempt: attempt.id },
        items: [
          {
            quantity: 1,
            price: {
              name: attempt.description.slice(0, 150),
              description: attempt.description.slice(0, 200),
              unit_price: {
                amount: String(attempt.amount),
                currency_code: attempt.currency.toUpperCase(),
              },
              product: {
                name: attempt.description.slice(0, 150),
                tax_category: 'standard',
              },
            },
          },
        ],
      },
    });
    if (!r.ok) throw paddleError(r, 'Paddle could not start the checkout');
    return {
      type: 'paddle',
      externalRef: r.data?.data?.id,
      transactionId: r.data?.data?.id,
      clientToken: settings?.client_token,
      environment,
    };
  },

  /** Paddle-Signature: ts=…;h1=… over `${ts}:${rawBody}`. */
  verifyWebhook({ rawBody, headers, credentials }) {
    const header = String(headers['paddle-signature'] || '');
    const parts = Object.fromEntries(
      header.split(';').map((p) => p.split('=')),
    );
    const ts = Number(parts.ts);
    if (!ts || !parts.h1 || !credentials?.webhook_secret) return false;
    if (Math.abs(Date.now() / 1000 - ts) > 300) return false;
    const expected = crypto
      .createHmac('sha256', credentials.webhook_secret)
      .update(`${ts}:${rawBody.toString('utf8')}`)
      .digest('hex');
    return (
      parts.h1.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(parts.h1), Buffer.from(expected))
    );
  },

  parseWebhook(event) {
    if (
      !['transaction.completed', 'transaction.paid'].includes(event?.event_type)
    )
      return null;
    const t = event.data || {};
    return {
      attemptId: t.custom_data?.omnicore_attempt,
      externalId: t.id,
      externalRef: t.id,
      amount: Number(
        t.details?.totals?.grand_total ?? t.details?.totals?.total ?? 0,
      ),
      currency: String(t.currency_code || '').toLowerCase(),
      paid: true,
      email: '',
      name: '',
    };
  },

  async handleReturn({ credentials, environment, attempt }) {
    if (!attempt.external_ref) return null;
    const base = BASE[environment] || BASE.live;
    const r = await call(`${base}/transactions/${attempt.external_ref}`, {
      headers: auth(credentials.api_key),
    });
    if (!r.ok) return null;
    const t = r.data?.data || {};
    return {
      externalId: t.id,
      amount: Number(t.details?.totals?.grand_total ?? 0),
      currency: String(t.currency_code || '').toLowerCase(),
      paid: ['completed', 'paid'].includes(t.status),
    };
  },
};
