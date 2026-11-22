'use strict';

/**
 * payments/routes.js — /api/payments (signed-in workspace members)
 * Plan-gated by tenants.payments_feature_enabled ("Invoicing & payments").
 * Admins manage settings and processors; everyone can invoice and record payments.
 *
 *   GET  /status · /stats · /settings · PATCH /settings (admin)
 *   GET  /providers · POST /providers/:key {credentials} · DELETE /providers/:key   (admin)
 *   GET  /invoices?kind=invoice|estimate&status&q · POST /invoices · GET|PATCH /invoices/:id
 *   POST /invoices/:id/send|mark-sent|void|convert · POST /invoices/:id/payments (record offline payment)
 *   CRUD /products · /links · /coupons · /gift-cards (+ /lookup, /redeem, /:id/void)
 *   GET  /transactions · POST /transactions/:id/confirm|reject|refund
 *   GET  /customers
 */

const express = require('express');
const { requireAuth, applyWorkspaceOverride } = require('../middleware/auth');
const { pool } = require('../lib/db');
const svc = require('./service');
const money = require('./money');
const { catalog, PROVIDERS } = require('./providers');
const { ensureSchema } = require('./schema');

const router = express.Router();
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const T = (req) => req.agent.tenantId;
const by = (req) => req.agent.email;

router.use(requireAuth, applyWorkspaceOverride);

router.get(
  '/status',
  wrap(async (req, res) => {
    const ws = await svc.workspace(T(req));
    res.json({ enabled: Boolean(ws?.enabled) });
  }),
);

router.use(
  wrap(async (req, res, next) => {
    const ws = await svc.workspace(T(req));
    if (!ws?.enabled) {
      return res
        .status(403)
        .json({
          error:
            "Invoicing & payments is not included in this workspace's plan.",
          code: 'payments_disabled',
        });
    }
    return next();
  }),
);

const adminOnly = (req, res, next) =>
  req.agent.role === 'admin' || req.agent.workspaceOverride
    ? next()
    : res
        .status(403)
        .json({ error: 'Only workspace admins can change payment settings.' });

router.get(
  '/stats',
  wrap(async (req, res) => res.json(await svc.stats(T(req)))),
);
router.get(
  '/settings',
  wrap(async (req, res) => res.json(await svc.getSettings(T(req)))),
);
router.patch(
  '/settings',
  adminOnly,
  wrap(async (req, res) =>
    res.json(await svc.updateSettings(T(req), req.body)),
  ),
);

// ── Processors ───────────────────────────────────────────────────────────────
router.get(
  '/providers',
  wrap(async (req, res) => {
    const connected = await svc.listConnections(T(req));
    res.json({
      catalog: catalog(),
      connected,
      webhook_urls: Object.fromEntries(
        Object.keys(PROVIDERS).map((k) => [k, svc.webhookUrl(T(req), k)]),
      ),
    });
  }),
);
router.post(
  '/providers/:key',
  adminOnly,
  wrap(async (req, res) =>
    res.json(
      await svc.connectProvider(
        T(req),
        req.params.key,
        req.body?.credentials || {},
        by(req),
      ),
    ),
  ),
);
router.delete(
  '/providers/:key',
  adminOnly,
  wrap(async (req, res) => {
    await svc.disconnectProvider(T(req), req.params.key);
    res.json({ ok: true });
  }),
);

// ── Invoices & estimates ─────────────────────────────────────────────────────
router.get(
  '/invoices',
  wrap(async (req, res) => {
    const kind = req.query.kind === 'estimate' ? 'estimate' : 'invoice';
    res.json(
      await svc.listDocuments(T(req), {
        kind,
        status: req.query.status,
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset,
      }),
    );
  }),
);
router.post(
  '/invoices',
  wrap(async (req, res) => {
    const kind = req.body?.kind === 'estimate' ? 'estimate' : 'invoice';
    res
      .status(201)
      .json(
        await svc.createDocument(T(req), req.body || {}, { kind, by: by(req) }),
      );
  }),
);
router.get(
  '/invoices/:id',
  wrap(async (req, res) => {
    const doc = await svc.getDocument(T(req), req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(
      `SELECT * FROM pay_transactions WHERE tenant_id = $1 AND invoice_id = $2 ORDER BY created_at DESC`,
      [T(req), req.params.id],
    );
    res.json({
      ...doc,
      transactions: rows.map((r) => ({ ...r, amount: Number(r.amount) })),
    });
  }),
);
router.patch(
  '/invoices/:id',
  wrap(async (req, res) =>
    res.json(await svc.updateDocument(T(req), req.params.id, req.body || {})),
  ),
);
router.post(
  '/invoices/:id/send',
  wrap(async (req, res) =>
    res.json(await svc.sendDocument(T(req), req.params.id, req.body || {})),
  ),
);
router.post(
  '/invoices/:id/mark-sent',
  wrap(async (req, res) => res.json(await svc.markSent(T(req), req.params.id))),
);
router.post(
  '/invoices/:id/void',
  wrap(async (req, res) =>
    res.json(await svc.voidDocument(T(req), req.params.id)),
  ),
);
router.post(
  '/invoices/:id/convert',
  wrap(async (req, res) =>
    res.json(await svc.convertEstimate(T(req), req.params.id, by(req))),
  ),
);
router.post(
  '/invoices/:id/payments',
  wrap(async (req, res) => {
    const doc = await svc.getDocument(T(req), req.params.id);
    if (!doc || doc.kind !== 'invoice')
      return res.status(404).json({ error: 'Invoice not found' });
    if (doc.status === 'void')
      return res.status(400).json({ error: 'The invoice is void' });
    const amount = Math.round(Number(req.body?.amount) || doc.balance);
    if (amount <= 0)
      return res.status(400).json({ error: 'Amount must be positive' });
    const method = [
      'cash',
      'check',
      'bank_transfer',
      'card_terminal',
      'other',
    ].includes(req.body?.method)
      ? req.body.method
      : 'other';
    const tx = await svc.recordPayment(T(req), {
      invoice_id: doc.id,
      provider: 'manual',
      amount,
      currency: doc.currency,
      method,
      reference: req.body?.reference,
      note: req.body?.note,
      customer_name: doc.customer_name,
      customer_email:
        req.body?.send_receipt === false ? '' : doc.customer_email,
      confirmed_by: by(req),
    });
    res.status(201).json(tx);
  }),
);

// ── Products ─────────────────────────────────────────────────────────────────
function productFields(body, currency) {
  return {
    name: String(body.name || '')
      .trim()
      .slice(0, 200),
    description: String(body.description || '').slice(0, 1000),
    unit_price: Math.max(0, Math.round(Number(body.unit_price) || 0)),
    currency: money.normCurrency(body.currency || currency),
    taxable: Boolean(body.taxable),
    tax_rate: Math.min(100, Math.max(0, Number(body.tax_rate) || 0)),
    sku: String(body.sku || '').slice(0, 80),
    active: body.active !== false,
  };
}
router.get(
  '/products',
  wrap(async (req, res) => {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT * FROM pay_products WHERE tenant_id = $1 ORDER BY active DESC, name`,
      [T(req)],
    );
    res.json(rows.map((r) => ({ ...r, unit_price: Number(r.unit_price) })));
  }),
);
router.post(
  '/products',
  wrap(async (req, res) => {
    const s = await svc.getSettings(T(req));
    const f = productFields(req.body || {}, s.default_currency);
    if (!f.name) return res.status(400).json({ error: 'Name is required' });
    const { rows } = await pool.query(
      `INSERT INTO pay_products (tenant_id, name, description, unit_price, currency, taxable, tax_rate, sku, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        T(req),
        f.name,
        f.description,
        f.unit_price,
        f.currency,
        f.taxable,
        f.tax_rate,
        f.sku,
        f.active,
      ],
    );
    res.status(201).json(rows[0]);
  }),
);
router.patch(
  '/products/:id',
  wrap(async (req, res) => {
    const { rows: cur } = await pool.query(
      `SELECT * FROM pay_products WHERE tenant_id = $1 AND id = $2`,
      [T(req), req.params.id],
    );
    if (!cur[0]) return res.status(404).json({ error: 'Not found' });
    const f = productFields(
      { ...cur[0], unit_price: Number(cur[0].unit_price), ...req.body },
      cur[0].currency,
    );
    const { rows } = await pool.query(
      `UPDATE pay_products SET name=$3, description=$4, unit_price=$5, currency=$6, taxable=$7, tax_rate=$8, sku=$9, active=$10, updated_at=NOW()
        WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [
        T(req),
        req.params.id,
        f.name,
        f.description,
        f.unit_price,
        f.currency,
        f.taxable,
        f.tax_rate,
        f.sku,
        f.active,
      ],
    );
    res.json(rows[0]);
  }),
);
router.delete(
  '/products/:id',
  wrap(async (req, res) => {
    await pool.query(
      `DELETE FROM pay_products WHERE tenant_id = $1 AND id = $2`,
      [T(req), req.params.id],
    );
    res.json({ ok: true });
  }),
);

// ── Payment links ────────────────────────────────────────────────────────────
router.get(
  '/links',
  wrap(async (req, res) => {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT * FROM pay_links WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [T(req)],
    );
    res.json(
      rows.map((r) => ({
        ...r,
        amount: r.amount == null ? null : Number(r.amount),
        collected: Number(r.collected),
        public_url: svc.linkUrl(r),
      })),
    );
  }),
);
router.post(
  '/links',
  wrap(async (req, res) => {
    const s = await svc.getSettings(T(req));
    const title = String(req.body?.title || '')
      .trim()
      .slice(0, 200);
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const amount =
      req.body?.amount == null || req.body.amount === ''
        ? null
        : Math.max(1, Math.round(Number(req.body.amount)));
    const allowed = Array.isArray(req.body?.allowed_methods)
      ? req.body.allowed_methods.filter((m) => PROVIDERS[m])
      : null;
    const { rows } = await pool.query(
      `INSERT INTO pay_links (tenant_id, title, description, amount, currency, min_amount, public_token, allowed_methods)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        T(req),
        title,
        String(req.body?.description || '').slice(0, 2000),
        amount,
        money.normCurrency(req.body?.currency || s.default_currency),
        req.body?.min_amount
          ? Math.max(1, Math.round(Number(req.body.min_amount)))
          : null,
        svc.newToken(),
        allowed && allowed.length ? allowed : null,
      ],
    );
    res.status(201).json({ ...rows[0], public_url: svc.linkUrl(rows[0]) });
  }),
);
router.patch(
  '/links/:id',
  wrap(async (req, res) => {
    const sets = [];
    const vals = [T(req), req.params.id];
    const add = (col, v) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (req.body?.active !== undefined) add('active', Boolean(req.body.active));
    if (req.body?.title !== undefined)
      add('title', String(req.body.title).slice(0, 200));
    if (req.body?.description !== undefined)
      add('description', String(req.body.description).slice(0, 2000));
    if (!sets.length)
      return res.status(400).json({ error: 'Nothing to update' });
    const { rows } = await pool.query(
      `UPDATE pay_links SET ${sets.join(', ')}, updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      vals,
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ...rows[0], public_url: svc.linkUrl(rows[0]) });
  }),
);

// ── Coupons ──────────────────────────────────────────────────────────────────
router.get(
  '/coupons',
  wrap(async (req, res) => {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT * FROM pay_coupons WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [T(req)],
    );
    res.json(rows.map((r) => ({ ...r, value: Number(r.value) })));
  }),
);
router.post(
  '/coupons',
  wrap(async (req, res) => {
    const code = String(req.body?.code || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 40);
    const kind = req.body?.kind === 'fixed' ? 'fixed' : 'percent';
    const value = Number(req.body?.value);
    if (!code)
      return res
        .status(400)
        .json({ error: 'Code is required (letters, numbers, - and _)' });
    if (!(value > 0) || (kind === 'percent' && value > 100))
      return res.status(400).json({ error: 'Enter a valid discount value' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO pay_coupons (tenant_id, code, kind, value, currency, max_redemptions, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          T(req),
          code,
          kind,
          value,
          kind === 'fixed' ? money.normCurrency(req.body?.currency) : null,
          req.body?.max_redemptions
            ? Math.max(1, Number(req.body.max_redemptions))
            : null,
          req.body?.expires_at || null,
        ],
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505')
        return res.status(409).json({ error: 'That code already exists' });
      throw err;
    }
  }),
);
router.patch(
  '/coupons/:id',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `UPDATE pay_coupons SET active = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [T(req), req.params.id, Boolean(req.body?.active)],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  }),
);
router.delete(
  '/coupons/:id',
  wrap(async (req, res) => {
    await pool.query(
      `DELETE FROM pay_coupons WHERE tenant_id = $1 AND id = $2`,
      [T(req), req.params.id],
    );
    res.json({ ok: true });
  }),
);

// ── Gift cards ───────────────────────────────────────────────────────────────
const shapeCard = (g) => ({
  ...g,
  initial_balance: Number(g.initial_balance),
  balance: Number(g.balance),
});
router.get(
  '/gift-cards',
  wrap(async (req, res) => {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT * FROM pay_gift_cards WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [T(req)],
    );
    res.json(rows.map(shapeCard));
  }),
);
router.post(
  '/gift-cards',
  wrap(async (req, res) =>
    res
      .status(201)
      .json(
        shapeCard(await svc.issueGiftCard(T(req), req.body || {}, by(req))),
      ),
  ),
);
router.get(
  '/gift-cards/lookup',
  wrap(async (req, res) =>
    res.json(shapeCard(await svc.findGiftCard(T(req), req.query.code))),
  ),
);
router.post(
  '/gift-cards/redeem',
  wrap(async (req, res) => {
    const r = await svc.redeemGiftCard(T(req), { ...req.body, by: by(req) });
    res.json({ card: shapeCard(r.card), transaction: r.transaction });
  }),
);
router.post(
  '/gift-cards/:id/void',
  wrap(async (req, res) =>
    res.json(shapeCard(await svc.voidGiftCard(T(req), req.params.id, by(req)))),
  ),
);

// ── Transactions & customers ─────────────────────────────────────────────────
router.get(
  '/transactions',
  wrap(async (req, res) =>
    res.json(
      await svc.listTransactions(T(req), {
        status: req.query.status,
        provider: req.query.provider,
        limit: req.query.limit,
        offset: req.query.offset,
      }),
    ),
  ),
);
router.post(
  '/transactions/:id/confirm',
  wrap(async (req, res) =>
    res.json(await svc.confirmPending(T(req), req.params.id, by(req))),
  ),
);
router.post(
  '/transactions/:id/reject',
  wrap(async (req, res) =>
    res.json(await svc.rejectPending(T(req), req.params.id, by(req))),
  ),
);
router.post(
  '/transactions/:id/refund',
  adminOnly,
  wrap(async (req, res) =>
    res.json(await svc.markRefunded(T(req), req.params.id, by(req))),
  ),
);
router.get(
  '/customers',
  wrap(async (req, res) => res.json(await svc.customers(T(req), req.query.q))),
);

// Errors from the service/processors → JSON with their status.
router.use((err, _req, res, next) => {
  if (
    err instanceof svc.PayError ||
    err?.name === 'ProviderError' ||
    err?.statusCode
  ) {
    return res
      .status(err.status || err.statusCode || 400)
      .json({ error: err.message });
  }
  return next(err);
});

module.exports = router;
