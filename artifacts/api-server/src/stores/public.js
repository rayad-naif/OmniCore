'use strict';

/**
 * stores/public.js — endpoints called by WooCommerce stores (no user session).
 *
 *   POST /api/stores/webhooks/:storeId     WooCommerce webhooks (X-WC-Webhook-Signature)
 *   POST /api/stores/plugin/hello          OmniCore Commerce plugin: connection check
 *   POST /api/stores/plugin/checkout       plugin: create the OmniCore invoice for an order
 *   GET  /api/stores/plugin.zip            plugin download for connected stores
 *
 * Mounted in app.ts before express.json(): signatures are computed over the raw body.
 */

const express = require('express');
const svc = require('./service');
const { zipDirectory, pluginDir } = require('./zip');

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const raw = express.raw({ type: '*/*', limit: '2mb' });

const router = express.Router();

router.post(
  '/webhooks/:storeId',
  raw,
  wrap(async (req, res) => {
    const out = await svc.handleWebhook(
      req.params.storeId,
      Buffer.isBuffer(req.body) ? req.body : Buffer.from(''),
      req.headers,
    );
    res.status(out.status).json(out.body || { ok: out.status < 400 });
  }),
);

const plugin = (fn) =>
  wrap(async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    try {
      const store = await svc.verifyPlugin(req.headers, body);
      let json = {};
      try {
        json = body.length ? JSON.parse(body.toString('utf8')) : {};
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
      return res.json(await fn(store, json));
    } catch (err) {
      return res
        .status(err.status || 500)
        .json({ error: err.status ? err.message : 'Something went wrong' });
    }
  });

router.post(
  '/plugin/hello',
  raw,
  plugin((s, body) => svc.pluginHello(s, body)),
);
router.post(
  '/plugin/checkout',
  raw,
  plugin((s, body) => svc.pluginCheckout(s, body)),
);

let cachedZip = null;
router.get('/plugin.zip', (req, res) => {
  const dir = pluginDir();
  if (!dir)
    return res
      .status(404)
      .json({ error: 'Plugin files are not available on this server.' });
  if (!cachedZip || process.env.NODE_ENV !== 'production')
    cachedZip = zipDirectory(dir, 'omnicore-commerce');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="omnicore-commerce.zip"',
  );
  res.setHeader('Cache-Control', 'no-store');
  return res.end(cachedZip);
});

module.exports = { router };
