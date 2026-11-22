'use strict';

/**
 * Square (the workspace's own seller account): Checkout API payment links.
 * After paying, the customer returns to /api/pay/return/square and we read the
 * order to confirm it is paid. Credentials: access token from the Square
 * Developer Dashboard (production or sandbox) and, optionally, a location ID.
 */

const { call, ProviderError } = require('./http');

const BASE = {
  live: 'https://connect.squareup.com',
  sandbox: 'https://connect.squareupsandbox.com',
};
const VERSION = '2024-10-17';

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  'Square-Version': VERSION,
});
const squareError = (r, fallback) =>
  new ProviderError(
    r.data?.errors?.[0]?.detail || fallback,
    r.status === 401 ? 400 : 502,
  );

module.exports = {
  key: 'square',
  label: 'Square',
  kind: 'online',
  methods:
    'Cards, Apple Pay, Google Pay, Cash App Pay and Afterpay where Square supports them',
  fields: [
    {
      name: 'access_token',
      label: 'Access token',
      secret: true,
      required: true,
    },
    {
      name: 'location_id',
      label: 'Location ID (optional — first active location)',
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
    const token = String(credentials.access_token || '').trim();
    if (!token) throw new ProviderError('Enter your Square access token', 400);
    const r = await call(`${BASE[environment]}/v2/locations`, {
      headers: headers(token),
    });
    if (!r.ok) throw squareError(r, 'Square rejected this access token');
    const locations = (r.data?.locations || []).filter(
      (l) => l.status === 'ACTIVE',
    );
    const wanted = String(credentials.location_id || '').trim();
    const location = wanted
      ? locations.find((l) => l.id === wanted)
      : locations[0];
    if (!location)
      throw new ProviderError(
        wanted ? 'That location ID was not found' : 'No active Square location',
        400,
      );
    return {
      environment,
      credentials: { access_token: token },
      settings: {
        location_id: location.id,
        location_name: location.name,
        currency: String(location.currency || '').toLowerCase(),
      },
    };
  },

  async createCheckout({ credentials, environment, settings, attempt, urls }) {
    const r = await call(
      `${BASE[environment]}/v2/online-checkout/payment-links`,
      {
        method: 'POST',
        headers: headers(credentials.access_token),
        json: {
          idempotency_key: attempt.id,
          quick_pay: {
            name: attempt.description.slice(0, 255),
            price_money: {
              amount: attempt.amount,
              currency: attempt.currency.toUpperCase(),
            },
            location_id: settings.location_id,
          },
          checkout_options: { redirect_url: urls.return },
          pre_populated_data: attempt.customer_email
            ? { buyer_email: attempt.customer_email }
            : undefined,
          payment_note: attempt.id,
        },
      },
    );
    if (!r.ok) throw squareError(r, 'Square could not create the checkout');
    const link = r.data?.payment_link || {};
    return { type: 'redirect', url: link.url, externalRef: link.order_id };
  },

  async handleReturn({ credentials, environment, attempt }) {
    if (!attempt.external_ref) return null;
    const r = await call(
      `${BASE[environment]}/v2/orders/${attempt.external_ref}`,
      { headers: headers(credentials.access_token) },
    );
    if (!r.ok) return null;
    const o = r.data?.order || {};
    const due = Number(
      o.net_amount_due_money?.amount ?? o.total_money?.amount ?? 0,
    );
    const paid =
      o.state === 'COMPLETED' || ((o.tenders || []).length > 0 && due === 0);
    return {
      externalId: o.tenders?.[0]?.payment_id || o.id,
      amount: Number(o.total_money?.amount || 0),
      currency: String(
        o.total_money?.currency || attempt.currency,
      ).toLowerCase(),
      paid,
    };
  },
};
