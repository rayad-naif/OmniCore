'use strict';

/**
 * Authorize.net (the workspace's own gateway account): Accept Hosted payment
 * form. The pay page posts a one-time token to Authorize.net's hosted form;
 * the payment is confirmed by the webhook (registered automatically when the
 * Signature Key is provided) or, on return, by looking the transaction up.
 * Credentials: API Login ID, Transaction Key, optional Signature Key.
 */

const crypto = require('node:crypto');
const { call, ProviderError } = require('./http');
const { toMajorString, toMinor } = require('../money');

const API = {
  live: 'https://api.authorize.net/xml/v1/request.api',
  sandbox: 'https://apitest.authorize.net/xml/v1/request.api',
};
const HOSTED = {
  live: 'https://accept.authorize.net/payment/payment',
  sandbox: 'https://test.authorize.net/payment/payment',
};
const REST = {
  live: 'https://api.authorize.net/rest/v1/webhooks',
  sandbox: 'https://apitest.authorize.net/rest/v1/webhooks',
};

const merchant = (c) => ({
  name: c.api_login_id,
  transactionKey: c.transaction_key,
});
const ok = (r) => r.ok && r.data?.messages?.resultCode === 'Ok';
const anetError = (r, fallback) =>
  new ProviderError(r.data?.messages?.message?.[0]?.text || fallback, 400);

/** Authorize.net invoice numbers are limited to 20 characters. */
const refFor = (attemptId) => String(attemptId).replace(/-/g, '').slice(0, 20);

module.exports = {
  key: 'authorize_net',
  label: 'Authorize.net',
  kind: 'online',
  methods: 'Credit and debit cards through your Authorize.net gateway',
  fields: [
    { name: 'api_login_id', label: 'API Login ID', required: true },
    {
      name: 'transaction_key',
      label: 'Transaction Key',
      secret: true,
      required: true,
    },
    {
      name: 'signature_key',
      label: 'Signature Key (for instant confirmation)',
      secret: true,
    },
    {
      name: 'environment',
      label: 'Environment',
      options: ['live', 'sandbox'],
      required: true,
    },
  ],
  refFor,

  async connect({ credentials, webhookUrl }) {
    const environment =
      credentials.environment === 'sandbox' ? 'sandbox' : 'live';
    const creds = {
      api_login_id: String(credentials.api_login_id || '').trim(),
      transaction_key: String(credentials.transaction_key || '').trim(),
      signature_key: String(credentials.signature_key || '').trim(),
    };
    if (!creds.api_login_id || !creds.transaction_key)
      throw new ProviderError(
        'Enter the API Login ID and Transaction Key',
        400,
      );
    const r = await call(API[environment], {
      method: 'POST',
      json: {
        authenticateTestRequest: { merchantAuthentication: merchant(creds) },
      },
    });
    if (!ok(r)) throw anetError(r, 'Authorize.net rejected these credentials');
    const settings = { webhook: false };
    if (creds.signature_key) {
      const basic = Buffer.from(
        `${creds.api_login_id}:${creds.transaction_key}`,
      ).toString('base64');
      const hook = await call(REST[environment], {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}` },
        json: {
          name: 'OmniCore payments',
          url: webhookUrl,
          eventTypes: ['net.authorize.payment.authcapture.created'],
          status: 'active',
        },
      }).catch(() => null);
      settings.webhook = Boolean(hook?.ok);
      settings.webhook_id = hook?.data?.webhookId || null;
    }
    return { environment, credentials: creds, settings };
  },

  async createCheckout({ credentials, environment, attempt, urls }) {
    const ref = refFor(attempt.id);
    const r = await call(API[environment], {
      method: 'POST',
      json: {
        getHostedPaymentPageRequest: {
          merchantAuthentication: merchant(credentials),
          transactionRequest: {
            transactionType: 'authCaptureTransaction',
            amount: toMajorString(attempt.amount, attempt.currency),
            order: {
              invoiceNumber: ref,
              description: attempt.description.slice(0, 255),
            },
            ...(attempt.customer_email
              ? { customer: { email: attempt.customer_email } }
              : {}),
          },
          hostedPaymentSettings: {
            setting: [
              {
                settingName: 'hostedPaymentReturnOptions',
                settingValue: JSON.stringify({
                  showReceipt: false,
                  url: urls.return,
                  urlText: 'Continue',
                  cancelUrl: urls.cancel,
                  cancelUrlText: 'Cancel',
                }),
              },
              {
                settingName: 'hostedPaymentButtonOptions',
                settingValue: JSON.stringify({ text: 'Pay' }),
              },
              {
                settingName: 'hostedPaymentOrderOptions',
                settingValue: JSON.stringify({ show: true }),
              },
            ],
          },
        },
      },
    });
    if (!ok(r) || !r.data?.token)
      throw anetError(r, 'Authorize.net could not start the payment form');
    return {
      type: 'form',
      action: HOSTED[environment],
      fields: { token: r.data.token },
      externalRef: ref,
    };
  },

  /** Finds our transaction among recent unsettled ones by invoice number. */
  async handleReturn({ credentials, environment, attempt }) {
    const r = await call(API[environment], {
      method: 'POST',
      json: {
        getUnsettledTransactionListRequest: {
          merchantAuthentication: merchant(credentials),
          sorting: { orderBy: 'submitTimeUTC', orderDescending: true },
          paging: { limit: 100, offset: 1 },
        },
      },
    });
    if (!ok(r)) return null;
    const tx = (r.data?.transactions || []).find(
      (t) => t.invoiceNumber === attempt.external_ref,
    );
    if (!tx) return null;
    const paid = ['capturedPendingSettlement', 'settledSuccessfully'].includes(
      tx.transactionStatus,
    );
    return {
      externalId: String(tx.transId),
      amount: toMinor(tx.settleAmount, attempt.currency),
      currency: attempt.currency,
      paid,
    };
  },

  /** X-ANET-Signature: sha512=<HMAC-SHA512(body, signature key)> */
  verifyWebhook({ rawBody, headers, credentials }) {
    const header = String(headers['x-anet-signature'] || '')
      .replace(/^sha512=/i, '')
      .toLowerCase();
    if (!header || !credentials?.signature_key) return false;
    const key = credentials.signature_key;
    const candidates = [Buffer.from(key, 'utf8')];
    if (/^[0-9a-f]+$/i.test(key) && key.length % 2 === 0)
      candidates.push(Buffer.from(key, 'hex'));
    return candidates.some((k) => {
      const expected = crypto
        .createHmac('sha512', k)
        .update(rawBody)
        .digest('hex');
      return (
        expected.length === header.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header))
      );
    });
  },

  parseWebhook(event) {
    if (event?.eventType !== 'net.authorize.payment.authcapture.created')
      return null;
    const p = event.payload || {};
    return {
      externalRef: p.invoiceNumber,
      externalId: String(p.id || ''),
      amountMajor: p.authAmount,
      paid: Number(p.responseCode) === 1,
    };
  },
};
