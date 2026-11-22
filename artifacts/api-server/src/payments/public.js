'use strict';

/**
 * payments/public.js — what customers use (no OmniCore sign-in).
 *
 *   GET  /pay/:token, /pay/l/:token           pay page (HTML; script /pay/assets/pay.js)
 *   GET  /api/pay/doc/:token                  invoice/estimate for the pay page
 *   GET  /api/pay/link/:token                 payment link for the pay page
 *   POST /api/pay/doc/:token/checkout         { provider, customer_email?, reference? }
 *   POST /api/pay/link/:token/checkout        { provider, amount?, customer_name, customer_email, reference?, coupon? }
 *   POST /api/pay/doc/:token/gift-card        { code } — pay (part of) an invoice with a gift card
 *   POST /api/pay/doc/:token/accept           { name } — accept an estimate
 *   GET  /api/pay/return/:provider            back from the processor (?attempt=…&result=success|cancel)
 *   POST /api/pay/webhooks/:provider/:tenant  signed processor webhooks (raw body; mounted before express.json)
 */

const express = require('express');
const { pool } = require('../lib/db');
const logger = require('../utils/logger');
const svc = require('./service');
const money = require('./money');
const { PROVIDERS } = require('./providers');
const { ensureSchema } = require('./schema');

const router = express.Router();
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const base = () => String(process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '');

// Small per-IP limiter for public writes (checkout starts, gift-card guesses).
const hits = new Map();
function limited(req, max = 30) {
  const key = `${req.ip}|${req.path.split('/').slice(0, 3).join('/')}`;
  const now = Date.now();
  const e = hits.get(key);
  if (!e || e.reset < now) {
    hits.set(key, { n: 1, reset: now + 10 * 60_000 });
    if (hits.size > 20_000)
      for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return false;
  }
  e.n += 1;
  return e.n > max;
}

async function docByToken(token) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT * FROM pay_invoices WHERE public_token = $1`,
    [String(token)],
  );
  return svc.shapeInvoice(rows[0]);
}

async function linkByToken(token) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT * FROM pay_links WHERE public_token = $1`,
    [String(token)],
  );
  return rows[0] || null;
}

async function business(tenantId) {
  const s = await svc.getSettings(tenantId);
  return {
    name: s.business_name,
    email: s.business_email,
    phone: s.business_phone,
    address: s.business_address,
    logo_url: s.logo_url,
    footer_note: s.footer_note,
  };
}

function publicDoc(d) {
  return {
    kind: d.kind,
    number: d.number,
    status: d.status,
    title: d.title,
    customer_name: d.customer_name,
    customer_email: d.customer_email,
    currency: d.currency,
    line_items: d.line_items,
    subtotal: d.subtotal,
    tax_total: d.tax_total,
    discount_total: d.discount_total,
    total: d.total,
    amount_paid: d.amount_paid,
    balance: d.balance,
    issue_date: d.issue_date,
    due_date: d.due_date,
    payment_terms: d.payment_terms,
    notes: d.notes,
    accepted_at: d.accepted_at,
  };
}

// ── Read ─────────────────────────────────────────────────────────────────────
router.get(
  '/doc/:token',
  wrap(async (req, res) => {
    const d = await docByToken(req.params.token);
    if (!d || d.status === 'draft')
      return res.status(404).json({ error: 'This document is not available.' });
    const ws = await svc.workspace(d.tenant_id);
    if (!ws?.enabled)
      return res.status(404).json({ error: 'This document is not available.' });
    if (!d.viewed_at) {
      await pool.query(
        `UPDATE pay_invoices SET viewed_at = NOW(), status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END WHERE id = $1`,
        [d.id],
      );
    }
    const methods =
      d.kind === 'invoice' && d.status !== 'void'
        ? await svc.availableMethods(d.tenant_id, d.allowed_methods)
        : [];
    res.json({
      business: await business(d.tenant_id),
      document: publicDoc(d),
      methods,
    });
  }),
);

router.get(
  '/link/:token',
  wrap(async (req, res) => {
    const l = await linkByToken(req.params.token);
    if (!l || !l.active)
      return res
        .status(404)
        .json({ error: 'This payment link is not active.' });
    const ws = await svc.workspace(l.tenant_id);
    if (!ws?.enabled)
      return res
        .status(404)
        .json({ error: 'This payment link is not active.' });
    res.json({
      business: await business(l.tenant_id),
      link: {
        title: l.title,
        description: l.description,
        amount: l.amount == null ? null : Number(l.amount),
        min_amount: l.min_amount == null ? null : Number(l.min_amount),
        currency: l.currency,
      },
      methods: await svc.availableMethods(l.tenant_id, l.allowed_methods),
    });
  }),
);

// ── Checkout ─────────────────────────────────────────────────────────────────
async function startCheckout(
  req,
  { tenantId, invoice, link, amount, currency, description, customer },
) {
  const provider = String(req.body?.provider || '');
  const p = PROVIDERS[provider];
  if (!p) throw new svc.PayError('Choose a payment method');
  const allowed = invoice ? invoice.allowed_methods : link.allowed_methods;
  if (allowed && allowed.length && !allowed.includes(provider))
    throw new svc.PayError('That payment method is not offered here');
  const conn = await svc.getConnection(tenantId, provider);
  if (!conn) throw new svc.PayError('That payment method is not available');
  if (amount <= 0) throw new svc.PayError('Nothing to pay');

  if (p.kind === 'manual') {
    const instructions = await p.createCheckout({ settings: conn.settings });
    const tx = await svc.recordPayment(tenantId, {
      invoice_id: invoice?.id,
      link_id: link?.id,
      provider,
      amount,
      currency,
      status: 'pending',
      method: provider,
      reference: String(req.body?.reference || '').slice(0, 200),
      customer_name: customer.name,
      customer_email: customer.email,
      note: 'Awaiting confirmation',
    });
    return {
      type: 'manual',
      status: 'pending',
      ...instructions,
      transaction_id: tx?.id,
    };
  }

  const { rows } = await pool.query(
    `INSERT INTO pay_attempts (tenant_id, invoice_id, link_id, provider, amount, currency, customer_name, customer_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      tenantId,
      invoice?.id || null,
      link?.id || null,
      provider,
      amount,
      currency,
      customer.name,
      customer.email,
    ],
  );
  const attempt = { ...rows[0], amount: Number(rows[0].amount), description };
  const back = `${base()}/api/pay/return/${provider}?attempt=${attempt.id}`;
  const ws = await svc.workspace(tenantId);
  const result = await p.createCheckout({
    ...conn,
    attempt,
    workspaceName:
      (await svc.getSettings(tenantId)).business_name || ws?.company_name,
    urls: {
      success: `${back}&result=success`,
      return: `${back}&result=success`,
      cancel: `${back}&result=cancel`,
    },
  });
  if (result.externalRef) {
    await pool.query(
      `UPDATE pay_attempts SET external_ref = $2 WHERE id = $1`,
      [attempt.id, result.externalRef],
    );
  }
  const { externalRef: _ref, ...client } = result;
  return { ...client, attempt_id: attempt.id };
}

router.post(
  '/doc/:token/checkout',
  wrap(async (req, res) => {
    if (limited(req))
      return res
        .status(429)
        .json({ error: 'Too many attempts, try again in a few minutes.' });
    const d = await docByToken(req.params.token);
    if (
      !d ||
      d.kind !== 'invoice' ||
      ['draft', 'void', 'paid'].includes(d.status)
    ) {
      return res
        .status(400)
        .json({ error: 'This invoice cannot be paid online.' });
    }
    const ws = await svc.workspace(d.tenant_id);
    if (!ws?.enabled) return res.status(404).json({ error: 'Not available' });
    res.json(
      await startCheckout(req, {
        tenantId: d.tenant_id,
        invoice: d,
        amount: d.balance,
        currency: d.currency,
        description: `${(await svc.getSettings(d.tenant_id)).business_name} — invoice ${d.number}`,
        customer: {
          name: d.customer_name,
          email: String(
            req.body?.customer_email || d.customer_email || '',
          ).slice(0, 200),
        },
      }),
    );
  }),
);

router.post(
  '/link/:token/checkout',
  wrap(async (req, res) => {
    if (limited(req))
      return res
        .status(429)
        .json({ error: 'Too many attempts, try again in a few minutes.' });
    const l = await linkByToken(req.params.token);
    if (!l || !l.active)
      return res
        .status(404)
        .json({ error: 'This payment link is not active.' });
    const ws = await svc.workspace(l.tenant_id);
    if (!ws?.enabled) return res.status(404).json({ error: 'Not available' });
    let amount =
      l.amount == null
        ? Math.round(Number(req.body?.amount) || 0)
        : Number(l.amount);
    if (l.amount == null && l.min_amount && amount < Number(l.min_amount)) {
      return res
        .status(400)
        .json({
          error: `The minimum is ${money.format(l.min_amount, l.currency)}`,
        });
    }
    if (req.body?.coupon) {
      const c = await svc.findCoupon(l.tenant_id, req.body.coupon, l.currency);
      const off =
        c.kind === 'percent'
          ? Math.round((amount * Number(c.value)) / 100)
          : money.toMinor(c.value, l.currency);
      amount = Math.max(0, amount - off);
      await pool.query(
        `UPDATE pay_coupons SET redemptions = redemptions + 1 WHERE id = $1`,
        [c.id],
      );
    }
    const name = String(req.body?.customer_name || '')
      .trim()
      .slice(0, 200);
    const email = String(req.body?.customer_email || '')
      .trim()
      .slice(0, 200);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Enter your name and email' });
    res.json(
      await startCheckout(req, {
        tenantId: l.tenant_id,
        link: l,
        amount,
        currency: l.currency,
        description: l.title,
        customer: { name, email },
      }),
    );
  }),
);

router.post(
  '/doc/:token/gift-card',
  wrap(async (req, res) => {
    if (limited(req, 10))
      return res
        .status(429)
        .json({ error: 'Too many attempts, try again later.' });
    const d = await docByToken(req.params.token);
    if (
      !d ||
      d.kind !== 'invoice' ||
      ['draft', 'void', 'paid'].includes(d.status)
    ) {
      return res.status(400).json({ error: 'This invoice cannot be paid.' });
    }
    const r = await svc.redeemGiftCard(d.tenant_id, {
      code: req.body?.code,
      invoice_id: d.id,
      by: 'customer',
      customer_name: d.customer_name,
      customer_email: d.customer_email,
    });
    res.json({
      applied: Number(r.transaction?.amount || 0),
      card_balance: Number(r.card.balance),
    });
  }),
);

router.post(
  '/doc/:token/accept',
  wrap(async (req, res) => {
    const d = await docByToken(req.params.token);
    if (!d || d.kind !== 'estimate' || ['draft', 'void'].includes(d.status)) {
      return res
        .status(400)
        .json({ error: 'This estimate cannot be accepted.' });
    }
    await pool.query(
      `UPDATE pay_invoices SET status = 'accepted', accepted_at = COALESCE(accepted_at, NOW()),
              notes = CASE WHEN $2 <> '' THEN notes || E'\\nAccepted by ' || $2 ELSE notes END, updated_at = NOW()
        WHERE id = $1`,
      [d.id, String(req.body?.name || '').slice(0, 200)],
    );
    try {
      require('../services/socket.service').broadcastToTenant(
        d.tenant_id,
        'estimate:accepted',
        { id: d.id, number: d.number },
      );
    } catch {
      /* best effort */
    }
    res.json({ ok: true });
  }),
);

// ── Back from the processor ─────────────────────────────────────────────────
async function finalize(attempt, outcome) {
  if (!outcome?.paid) return false;
  await svc.recordPayment(attempt.tenant_id, {
    invoice_id: attempt.invoice_id,
    link_id: attempt.link_id,
    attempt_id: attempt.id,
    provider: attempt.provider,
    external_id: outcome.externalId || attempt.external_ref,
    amount: Number(outcome.amount) || Number(attempt.amount),
    currency: outcome.currency || attempt.currency,
    method: attempt.provider,
    customer_name: outcome.name || attempt.customer_name,
    customer_email: outcome.email || attempt.customer_email,
  });
  return true;
}

async function pageFor(attempt) {
  if (attempt.invoice_id) {
    const { rows } = await pool.query(
      `SELECT public_token FROM pay_invoices WHERE id = $1`,
      [attempt.invoice_id],
    );
    return `/pay/${rows[0]?.public_token}`;
  }
  const { rows } = await pool.query(
    `SELECT public_token FROM pay_links WHERE id = $1`,
    [attempt.link_id],
  );
  return `/pay/l/${rows[0]?.public_token}`;
}

router.get(
  '/return/:provider',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM pay_attempts WHERE id = $1 AND provider = $2`,
      [String(req.query.attempt || ''), req.params.provider],
    );
    const attempt = rows[0];
    if (!attempt) return res.redirect(302, '/');
    const page = await pageFor(attempt);
    if (req.query.result === 'cancel')
      return res.redirect(302, `${page}?result=cancelled`);
    let paid = attempt.status === 'paid';
    if (!paid) {
      const p = PROVIDERS[attempt.provider];
      const conn = await svc.getConnection(attempt.tenant_id, attempt.provider);
      if (p?.handleReturn && conn) {
        const outcome = await p
          .handleReturn({
            ...conn,
            attempt: { ...attempt, amount: Number(attempt.amount) },
          })
          .catch((err) => {
            logger.warn(
              { err: err.message, provider: attempt.provider },
              'payment_return_check_failed',
            );
            return null;
          });
        paid = await finalize(attempt, outcome);
      }
    }
    return res.redirect(302, `${page}?result=${paid ? 'paid' : 'processing'}`);
  }),
);

// ── Webhooks (raw body) ─────────────────────────────────────────────────────
const webhookRouter = express.Router();
webhookRouter.post(
  '/:provider/:tenantId',
  express.raw({ type: '*/*', limit: '1mb' }),
  wrap(async (req, res) => {
    const p = PROVIDERS[req.params.provider];
    if (!p?.verifyWebhook) return res.status(404).end();
    const conn = await svc
      .getConnection(req.params.tenantId, req.params.provider)
      .catch(() => null);
    if (!conn) return res.status(404).end();
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (
      !p.verifyWebhook({
        rawBody,
        headers: req.headers,
        credentials: conn.credentials,
      })
    ) {
      logger.warn(
        { provider: req.params.provider, tenantId: req.params.tenantId },
        'payment_webhook_bad_signature',
      );
      return res.status(401).json({ error: 'Invalid signature' });
    }
    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    const parsed = p.parseWebhook(event);
    if (!parsed) return res.json({ ignored: true });
    let attempt = null;
    if (parsed.attemptId) {
      const { rows } = await pool.query(
        `SELECT * FROM pay_attempts WHERE id = $1 AND tenant_id = $2`,
        [parsed.attemptId, req.params.tenantId],
      );
      attempt = rows[0] || null;
    }
    if (!attempt && parsed.externalRef) {
      const { rows } = await pool.query(
        `SELECT * FROM pay_attempts WHERE tenant_id = $1 AND provider = $2 AND external_ref = $3`,
        [req.params.tenantId, req.params.provider, parsed.externalRef],
      );
      attempt = rows[0] || null;
    }
    if (!attempt) return res.json({ ignored: true, reason: 'unknown payment' });
    const amount =
      parsed.amount ??
      (parsed.amountMajor != null
        ? money.toMinor(parsed.amountMajor, attempt.currency)
        : undefined);
    await finalize(attempt, {
      ...parsed,
      amount,
      currency: parsed.currency || attempt.currency,
    });
    return res.json({ received: true });
  }),
);

// ── Pay page ─────────────────────────────────────────────────────────────────
const { PAGE, SCRIPT } = require('./page/assets');
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.paddle.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "connect-src 'self' https://*.paddle.com",
  'frame-src https://*.paddle.com',
  "form-action 'self' https://accept.authorize.net https://test.authorize.net",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const pageRouter = express.Router();
pageRouter.get('/assets/pay.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(SCRIPT);
});
pageRouter.get(['/l/:token', '/:token'], (_req, res) => {
  res.removeHeader('Content-Security-Policy');
  res.setHeader('Content-Security-Policy', PAGE_CSP);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.type('html').send(PAGE);
});

router.use((err, _req, res, next) => {
  if (err instanceof svc.PayError || err?.statusCode) {
    return res
      .status(err.status || err.statusCode || 400)
      .json({ error: err.message });
  }
  return next(err);
});

module.exports = { router, webhookRouter, pageRouter };
