'use strict';

/**
 * Stripe (the workspace's own account): Checkout Sessions + a webhook endpoint
 * created automatically on connect. Keys: secret key (sk_live_/sk_test_) or a
 * restricted key with Checkout Sessions write + Webhook Endpoints write.
 */

const crypto = require('node:crypto');
const { call, flatten, ProviderError } = require('./http');

const API = 'https://api.stripe.com/v1';

function auth(secretKey) {
  return { Authorization: `Bearer ${secretKey}` };
}

function stripeError(r, fallback) {
  return new ProviderError(
    r.data?.error?.message || fallback,
    r.status === 401 ? 400 : 502,
  );
}

module.exports = {
  key: 'stripe',
  label: 'Stripe',
  kind: 'online',
  methods:
    'Cards, Apple Pay, Google Pay, Link and local methods enabled in your Stripe account',
  fields: [
    {
      name: 'secret_key',
      label: 'Secret key (sk_live_… or sk_test_…)',
      secret: true,
      required: true,
    },
  ],

  async connect({ credentials, webhookUrl }) {
    const sk = String(credentials.secret_key || '').trim();
    if (!/^(sk|rk)_(live|test)_/.test(sk))
      throw new ProviderError(
        'Enter a Stripe secret key (sk_live_… or sk_test_…)',
        400,
      );
    const acct = await call(`${API}/account`, { headers: auth(sk) });
    if (!acct.ok) throw stripeError(acct, 'Stripe rejected this key');
    const hook = await call(`${API}/webhook_endpoints`, {
      method: 'POST',
      headers: auth(sk),
      form: flatten({
        url: webhookUrl,
        description: 'OmniCore payments',
        enabled_events: [
          'checkout.session.completed',
          'checkout.session.async_payment_succeeded',
          'charge.refunded',
        ],
      }),
    });
    if (!hook.ok)
      throw stripeError(hook, 'Could not create the Stripe webhook endpoint');
    return {
      environment: sk.includes('_test_') ? 'test' : 'live',
      credentials: {
        secret_key: sk,
        webhook_secret: hook.data.secret,
        webhook_id: hook.data.id,
      },
      settings: {
        account_name:
          acct.data?.settings?.dashboard?.display_name ||
          acct.data?.business_profile?.name ||
          acct.data?.id,
        account_id: acct.data?.id,
      },
    };
  },

  async disconnect({ credentials }) {
    if (credentials?.webhook_id && credentials?.secret_key) {
      await call(`${API}/webhook_endpoints/${credentials.webhook_id}`, {
        method: 'DELETE',
        headers: auth(credentials.secret_key),
      }).catch(() => {});
    }
  },

  async createCheckout({ credentials, attempt, urls }) {
    const r = await call(`${API}/checkout/sessions`, {
      method: 'POST',
      headers: {
        ...auth(credentials.secret_key),
        'Idempotency-Key': attempt.id,
      },
      form: flatten({
        mode: 'payment',
        success_url: urls.success,
        cancel_url: urls.cancel,
        client_reference_id: attempt.id,
        customer_email: attempt.customer_email || undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: attempt.currency,
              unit_amount: attempt.amount,
              product_data: { name: attempt.description.slice(0, 250) },
            },
          },
        ],
        metadata: { omnicore_attempt: attempt.id },
        payment_intent_data: { metadata: { omnicore_attempt: attempt.id } },
      }),
    });
    if (!r.ok) throw stripeError(r, 'Stripe could not start the checkout');
    return { type: 'redirect', url: r.data.url, externalRef: r.data.id };
  },

  /** Stripe-Signature: t=…,v1=… over `${t}.${rawBody}` (5-minute tolerance). */
  verifyWebhook({ rawBody, headers, credentials }) {
    const sig = String(headers['stripe-signature'] || '');
    const parts = Object.fromEntries(
      sig
        .split(',')
        .map((p) => p.split('=').map((x) => x.trim()))
        .filter((p) => p.length === 2),
    );
    const t = Number(parts.t);
    const v1s = sig
      .split(',')
      .filter((p) => p.trim().startsWith('v1='))
      .map((p) => p.trim().slice(3));
    if (!t || !v1s.length || !credentials?.webhook_secret) return false;
    if (Math.abs(Date.now() / 1000 - t) > 300) return false;
    const expected = crypto
      .createHmac('sha256', credentials.webhook_secret)
      .update(`${t}.${rawBody.toString('utf8')}`)
      .digest('hex');
    return v1s.some(
      (v) =>
        v.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected)),
    );
  },

  /** → { attemptId, externalId, amount, currency, paid } or null */
  parseWebhook(event) {
    if (
      ![
        'checkout.session.completed',
        'checkout.session.async_payment_succeeded',
      ].includes(event?.type)
    )
      return null;
    const s = event.data?.object || {};
    return {
      attemptId: s.client_reference_id || s.metadata?.omnicore_attempt,
      externalId: s.payment_intent || s.id,
      externalRef: s.id,
      amount: s.amount_total,
      currency: String(s.currency || '').toLowerCase(),
      paid:
        s.payment_status === 'paid' ||
        event.type === 'checkout.session.async_payment_succeeded',
      email: s.customer_details?.email || '',
      name: s.customer_details?.name || '',
    };
  },

  /** On return we confirm with Stripe directly (webhook may be slower). */
  async handleReturn({ credentials, attempt }) {
    if (!attempt.external_ref) return null;
    const r = await call(`${API}/checkout/sessions/${attempt.external_ref}`, {
      headers: auth(credentials.secret_key),
    });
    if (!r.ok) return null;
    return {
      externalId: r.data.payment_intent || r.data.id,
      amount: r.data.amount_total,
      currency: String(r.data.currency || '').toLowerCase(),
      paid: r.data.payment_status === 'paid',
      email: r.data.customer_details?.email || '',
      name: r.data.customer_details?.name || '',
    };
  },
};
