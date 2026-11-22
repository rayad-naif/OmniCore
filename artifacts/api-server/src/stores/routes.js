'use strict';

/**
 * stores/routes.js — /api/stores (signed-in workspace members).
 * Plan-gated by tenants.stores_feature_enabled ("Online stores"). Admins create,
 * connect, redesign, pause and delete stores; everyone can see stores and orders.
 *
 *   GET  /status                         plan switch, limits, hosting availability
 *   GET  /                               stores + limits + templates
 *   GET  /templates · GET /slug?slug=    template catalog, web-address availability
 *   POST /hosted                         {name, slug, template, description, brand_color, currency, country, city, email, phone, use_ai}
 *   POST /connect                        {name, site_url, consumer_key, consumer_secret}
 *   GET  /orders                         orders of every store
 *   GET  /:id · PATCH /:id {name, checkout_enabled} · DELETE /:id
 *   POST /:id/retry · /:id/redesign · /:id/suspend · /:id/resume · /:id/sync · /:id/sso
 *   POST /:id/domain {domain} · POST /:id/domain/check · DELETE /:id/domain
 *   GET  /:id/orders · /:id/connection-key · /:id/admin-password
 */

const express = require('express');
const { requireAuth, applyWorkspaceOverride } = require('../middleware/auth');
const { pool } = require('../lib/db');
const svc = require('./service');
const design = require('./design');
const { ensureSchema } = require('./schema');

const router = express.Router();
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const T = (req) => req.agent.tenantId;

router.use(requireAuth, applyWorkspaceOverride);

router.get(
  '/status',
  wrap(async (req, res) => {
    const ws = await svc.workspace(T(req));
    res.json({
      enabled: Boolean(ws?.enabled),
      max_stores: ws?.max_stores ?? 0,
    });
  }),
);

router.use(
  wrap(async (req, res, next) => {
    await ensureSchema();
    const ws = await svc.workspace(T(req));
    if (!ws?.enabled)
      return res.status(403).json({
        error: "Online stores are not included in this workspace's plan.",
        code: 'stores_disabled',
      });
    req.storesWs = ws;
    return next();
  }),
);

const adminOnly = (req, res, next) =>
  req.agent.role === 'admin' || req.agent.workspaceOverride
    ? next()
    : res
        .status(403)
        .json({ error: 'Only workspace admins can manage stores.' });

router.get(
  '/',
  wrap(async (req, res) => {
    const stores = await svc.listStores(T(req));
    res.json({
      stores,
      limits: { max_stores: req.storesWs.max_stores, used: stores.length },
      templates: design.catalogTemplates(),
      platform: await svc.platformInfo(),
      payments_enabled: req.storesWs.payments,
      ai_enabled: req.storesWs.ai,
    });
  }),
);

router.get('/templates', (_req, res) =>
  res.json({ templates: design.catalogTemplates() }),
);

router.get(
  '/slug',
  wrap(async (req, res) =>
    res.json(await svc.slugAvailable(String(req.query.slug || ''))),
  ),
);

router.get(
  '/orders',
  wrap(async (req, res) =>
    res.json({ orders: await svc.listOrders(T(req), null, req.query) }),
  ),
);

router.post(
  '/hosted',
  adminOnly,
  wrap(async (req, res) =>
    res
      .status(201)
      .json(await svc.createHosted(T(req), req.agent, req.body || {})),
  ),
);

router.post(
  '/connect',
  adminOnly,
  wrap(async (req, res) =>
    res
      .status(201)
      .json(await svc.connectStore(T(req), req.agent, req.body || {})),
  ),
);

router.get(
  '/:id',
  wrap(async (req, res) => res.json(await svc.getStore(T(req), req.params.id))),
);

router.patch(
  '/:id',
  adminOnly,
  wrap(async (req, res) =>
    res.json(await svc.updateStore(T(req), req.params.id, req.body || {})),
  ),
);

router.delete(
  '/:id',
  adminOnly,
  wrap(async (req, res) => {
    if ((req.body?.confirm || req.query.confirm) !== 'DELETE')
      return res.status(400).json({ error: 'Type DELETE to confirm.' });
    return res.json(await svc.deleteStore(T(req), req.params.id));
  }),
);

router.post(
  '/:id/retry',
  adminOnly,
  wrap(async (req, res) =>
    res.json(await svc.retryProvision(T(req), req.params.id)),
  ),
);
router.post(
  '/:id/redesign',
  adminOnly,
  wrap(async (req, res) =>
    res.json(await svc.redesign(T(req), req.params.id, req.body || {})),
  ),
);
router.post(
  '/:id/suspend',
  adminOnly,
  wrap(async (req, res) =>
    res.json(await svc.suspendStore(T(req), req.params.id)),
  ),
);
router.post(
  '/:id/resume',
  adminOnly,
  wrap(async (req, res) =>
    res.json(await svc.suspendStore(T(req), req.params.id, { resume: true })),
  ),
);
router.post(
  '/:id/sync',
  wrap(async (req, res) =>
    res.json(await svc.requestSync(T(req), req.params.id)),
  ),
);

router.post(
  '/:id/sso',
  adminOnly,
  wrap(async (req, res) =>
    res.json(
      await svc.ssoUrl(
        T(req),
        req.params.id,
        req.agent.email,
        req.body?.redirect,
      ),
    ),
  ),
);

router.post(
  '/:id/domain',
  adminOnly,
  wrap(async (req, res) =>
    res.json(
      await svc.setCustomDomain(T(req), req.params.id, req.body?.domain),
    ),
  ),
);
router.post(
  '/:id/domain/check',
  adminOnly,
  wrap(async (req, res) => {
    const s = await svc.rawStore(T(req), req.params.id);
    if (s.custom_domain && s.domain_status !== 'active') {
      await pool.query(
        `UPDATE store_jobs SET run_after = NOW() WHERE store_id = $1 AND kind = 'domain_check' AND status = 'queued'`,
        [s.id],
      );
      const { rowCount } = await pool.query(
        `SELECT 1 FROM store_jobs WHERE store_id = $1 AND kind = 'domain_check' AND status IN ('queued','running')`,
        [s.id],
      );
      if (!rowCount)
        await svc.enqueue(s, 'domain_check', { started: Date.now() });
    }
    res.json(await svc.getStore(T(req), req.params.id));
  }),
);
router.delete(
  '/:id/domain',
  adminOnly,
  wrap(async (req, res) =>
    res.json(await svc.removeCustomDomain(T(req), req.params.id)),
  ),
);

router.get(
  '/:id/orders',
  wrap(async (req, res) => {
    await svc.rawStore(T(req), req.params.id);
    res.json({
      orders: await svc.listOrders(T(req), req.params.id, req.query),
    });
  }),
);
router.get(
  '/:id/connection-key',
  adminOnly,
  wrap(async (req, res) =>
    res.json(await svc.connectionKey(T(req), req.params.id)),
  ),
);
router.get(
  '/:id/admin-password',
  adminOnly,
  wrap(async (req, res) =>
    res.json(await svc.adminPassword(T(req), req.params.id)),
  ),
);

router.use((err, _req, res, next) => {
  if (err instanceof svc.StoreError || err?.status) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  return next(err);
});

module.exports = router;
