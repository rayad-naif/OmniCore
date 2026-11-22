'use strict';

/**
 * Methods without an automatic confirmation: bank transfer, cash on delivery
 * and Payoneer. The customer sees the workspace's instructions; choosing the
 * method creates a pending transaction that staff confirm in the dashboard or
 * through the REST API (POST /api/v1/payments/:id/confirm with a write key) —
 * e.g. a courier app confirming cash collected on delivery.
 *
 * Payoneer does not offer a public self-serve checkout API, so it works like a
 * bank transfer: share your Payoneer payment request link or receiving account.
 */

const { ProviderError } = require('./http');

function manual(key, label, methods, fields, describe) {
  return {
    key,
    label,
    kind: 'manual',
    methods,
    fields,
    async connect({ credentials }) {
      const settings = {};
      for (const f of fields)
        settings[f.name] = String(credentials[f.name] || '')
          .trim()
          .slice(0, 2000);
      if (fields.some((f) => f.required && !settings[f.name])) {
        throw new ProviderError(
          `Fill in: ${fields
            .filter((f) => f.required)
            .map((f) => f.label)
            .join(', ')}`,
          400,
        );
      }
      if (settings.payment_url && !/^https:\/\//i.test(settings.payment_url)) {
        throw new ProviderError(
          'The payment link must start with https://',
          400,
        );
      }
      return { environment: 'live', credentials: {}, settings };
    },
    async createCheckout({ settings }) {
      return { type: 'manual', ...describe(settings) };
    },
  };
}

module.exports = {
  bank_transfer: manual(
    'bank_transfer',
    'Bank transfer',
    'Local or international bank transfer, confirmed by you',
    [
      {
        name: 'instructions',
        label: 'Bank details and instructions',
        multiline: true,
        required: true,
      },
    ],
    (s) => ({
      instructions: s.instructions,
      needsReference: true,
      confirmLabel: "I've sent the transfer",
    }),
  ),
  cod: manual(
    'cod',
    'Cash on delivery',
    'Pay in cash when the order is delivered or the job is done',
    [
      {
        name: 'instructions',
        label: 'Instructions shown to the customer',
        multiline: true,
      },
    ],
    (s) => ({
      instructions:
        s.instructions || 'Pay in cash when your order is delivered.',
      needsReference: false,
      confirmLabel: 'Pay cash on delivery',
    }),
  ),
  payoneer: manual(
    'payoneer',
    'Payoneer',
    'Payoneer payment request or transfer to your Payoneer account, confirmed by you',
    [
      {
        name: 'payment_url',
        label: 'Payoneer payment request link (https://…)',
      },
      {
        name: 'instructions',
        label: 'Instructions (account email or receiving details)',
        multiline: true,
        required: true,
      },
    ],
    (s) => ({
      instructions: s.instructions,
      url: s.payment_url || null,
      needsReference: true,
      confirmLabel: "I've paid with Payoneer",
    }),
  ),
};
