'use strict';

const manual = require('./manual');

/** Every payment method a workspace can offer its customers. */
const PROVIDERS = {
  paddle: require('./paddle'),
  stripe: require('./stripe'),
  paypal: require('./paypal'),
  square: require('./square'),
  authorize_net: require('./authorizenet'),
  payoneer: manual.payoneer,
  bank_transfer: manual.bank_transfer,
  cod: manual.cod,
};

/** Public description (no secrets) for the dashboard. */
function catalog() {
  return Object.values(PROVIDERS).map((p) => ({
    key: p.key,
    label: p.label,
    kind: p.kind,
    methods: p.methods,
    fields: p.fields.map((f) => ({ ...f })),
    webhook: Boolean(p.verifyWebhook),
  }));
}

module.exports = { PROVIDERS, catalog };
