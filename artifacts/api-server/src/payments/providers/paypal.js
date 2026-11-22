'use strict';

/**
 * PayPal (the workspace's own REST app): Orders v2. The customer approves on
 * PayPal and comes back to /api/pay/return/paypal, where the order is captured.
 * Credentials: REST app client ID + secret (developer.paypal.com → Apps).
 */

const { call, ProviderError } = require('./http');

const BASE = {
  live: 'https://api-m.paypal.com',
  sandbox: 'https://api-m.sandbox.paypal.com',
};
const { toMajorString, toMinor } = require('../money');

async function token(environment, credentials) {
  const basic = Buffer.from(
    `${credentials.client_id}:${credentials.client_secret}`,
  ).toString('base64');
  const r = await call(`${BASE[environment] || BASE.live}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
    form: { grant_type: 'client_credentials' },
  });
  if (!r.ok || !r.data?.access_token) {
    throw new ProviderError(
      r.data?.error_description || 'PayPal rejected these credentials',
      400,
    );
  }
  return r.data.access_token;
}

function captureSummary(order) {
  const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    externalId: capture?.id || order?.id,
    amountMajor: capture?.amount?.value,
    currencyRaw: capture?.amount?.currency_code,
    paid: order?.status === 'COMPLETED' && capture?.status === 'COMPLETED',
    email: order?.payer?.email_address || '',
    name: [order?.payer?.name?.given_name, order?.payer?.name?.surname]
      .filter(Boolean)
      .join(' '),
  };
}

module.exports = {
  key: 'paypal',
  label: 'PayPal',
  kind: 'online',
  methods: 'PayPal balance, Pay Later, Venmo (US) and cards through PayPal',
  fields: [
    { name: 'client_id', label: 'REST app client ID', required: true },
    {
      name: 'client_secret',
      label: 'REST app secret',
      secret: true,
      required: true,
    },
    {
      name: 'environment',
      label: 'Environment',
      options: ['live', 'sandbox'],
      required: true,
    },
  ],

  async connect({ credentials }) {
    const environment =
      credentials.environment === 'sandbox' ? 'sandbox' : 'live';
    const creds = {
      client_id: String(credentials.client_id || '').trim(),
      client_secret: String(credentials.client_secret || '').trim(),
    };
    if (!creds.client_id || !creds.client_secret)
      throw new ProviderError('Enter the client ID and secret', 400);
    await token(environment, creds);
    return { environment, credentials: creds, settings: {} };
  },

  async createCheckout({
    credentials,
    environment,
    attempt,
    urls,
    workspaceName,
  }) {
    const access = await token(environment, credentials);
    const r = await call(`${BASE[environment]}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access}`,
        'PayPal-Request-Id': attempt.id,
      },
      json: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: attempt.id,
            custom_id: attempt.id,
            description: attempt.description.slice(0, 127),
            amount: {
              currency_code: attempt.currency.toUpperCase(),
              value: toMajorString(attempt.amount, attempt.currency),
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name:
                String(workspaceName || '').slice(0, 127) || undefined,
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
              return_url: urls.return,
              cancel_url: urls.cancel,
            },
          },
        },
      },
    });
    if (!r.ok)
      throw new ProviderError(
        r.data?.details?.[0]?.description ||
          r.data?.message ||
          'PayPal could not create the order',
      );
    const link = (r.data.links || []).find(
      (l) => l.rel === 'payer-action' || l.rel === 'approve',
    );
    if (!link)
      throw new ProviderError('PayPal did not return an approval link');
    return { type: 'redirect', url: link.href, externalRef: r.data.id };
  },

  /** Captures the approved order (idempotent on PayPal's side for the same order). */
  async handleReturn({ credentials, environment, attempt }) {
    if (!attempt.external_ref) return null;
    const access = await token(environment, credentials);
    const base = BASE[environment];
    let r = await call(
      `${base}/v2/checkout/orders/${attempt.external_ref}/capture`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access}`,
          'PayPal-Request-Id': `${attempt.id}-capture`,
        },
        json: {},
      },
    );
    if (r.status === 422) {
      // Already captured: read the order instead.
      r = await call(`${base}/v2/checkout/orders/${attempt.external_ref}`, {
        headers: { Authorization: `Bearer ${access}` },
      });
    }
    if (!r.ok) return null;
    const s = captureSummary(r.data);
    const currency = String(s.currencyRaw || attempt.currency).toLowerCase();
    return {
      ...s,
      currency,
      amount: s.amountMajor ? toMinor(s.amountMajor, currency) : 0,
    };
  },
};
