'use strict';

/**
 * payments/service.js — invoices, estimates, payments, gift cards, coupons.
 * Every function takes the workspace id first and only touches its rows.
 */

const crypto = require('node:crypto');
const { pool } = require('../lib/db');
const logger = require('../utils/logger');
const { seal, openJson, sealJson } = require('../lib/secretBox');
const { ensureSchema } = require('./schema');
const money = require('./money');
const { PROVIDERS } = require('./providers');

const ACTIVE_STATUSES = ['sent', 'viewed', 'partially_paid', 'overdue'];

class PayError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const publicBase = () =>
  String(process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '');
const newToken = () => crypto.randomBytes(18).toString('base64url');
const invoiceUrl = (inv) => `${publicBase()}/pay/${inv.public_token}`;
const linkUrl = (link) => `${publicBase()}/pay/l/${link.public_token}`;

// ── Workspace gate + settings ───────────────────────────────────────────────
async function workspace(tenantId) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, company_name, payments_feature_enabled AS enabled FROM tenants WHERE id = $1`,
    [tenantId],
  );
  return rows[0] || null;
}

async function getSettings(tenantId) {
  await ensureSchema();
  await pool.query(
    `INSERT INTO pay_settings (tenant_id, business_name)
     SELECT id, company_name FROM tenants WHERE id = $1
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId],
  );
  const { rows } = await pool.query(
    `SELECT * FROM pay_settings WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows[0];
}

const SETTING_FIELDS = {
  business_name: 200,
  business_email: 200,
  business_phone: 60,
  business_address: 500,
  logo_url: 500,
  invoice_prefix: 20,
  estimate_prefix: 20,
  payment_terms: 200,
  footer_note: 1000,
  email_subject: 200,
  email_message: 2000,
  review_url: 500,
};

async function updateSettings(tenantId, body = {}) {
  await getSettings(tenantId);
  const sets = [];
  const vals = [tenantId];
  const add = (col, v) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  for (const [k, max] of Object.entries(SETTING_FIELDS)) {
    if (body[k] !== undefined) add(k, String(body[k] || '').slice(0, max));
  }
  if (body.logo_url && !/^https:\/\//i.test(body.logo_url))
    throw new PayError('Logo URL must start with https://');
  if (body.review_url && !/^https:\/\//i.test(body.review_url))
    throw new PayError('Review link must start with https://');
  if (body.default_currency !== undefined)
    add('default_currency', money.normCurrency(body.default_currency));
  if (body.default_tax_rate !== undefined)
    add(
      'default_tax_rate',
      Math.min(100, Math.max(0, Number(body.default_tax_rate) || 0)),
    );
  if (body.review_request !== undefined)
    add('review_request', Boolean(body.review_request));
  if (body.next_invoice_number !== undefined)
    add(
      'next_invoice_number',
      Math.max(1, Number(body.next_invoice_number) || 1),
    );
  if (!sets.length) return getSettings(tenantId);
  const { rows } = await pool.query(
    `UPDATE pay_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE tenant_id = $1 RETURNING *`,
    vals,
  );
  return rows[0];
}

async function nextNumber(tenantId, kind) {
  const settings = await getSettings(tenantId);
  const col =
    kind === 'estimate' ? 'next_estimate_number' : 'next_invoice_number';
  const { rows } = await pool.query(
    `UPDATE pay_settings SET ${col} = ${col} + 1 WHERE tenant_id = $1 RETURNING ${col} - 1 AS n`,
    [tenantId],
  );
  const prefix =
    kind === 'estimate' ? settings.estimate_prefix : settings.invoice_prefix;
  return `${prefix}${rows[0].n}`;
}

// ── Processors ───────────────────────────────────────────────────────────────
async function listConnections(tenantId) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT provider, status, environment, settings, connected_by, connected_at FROM pay_providers WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows.map((r) => {
    // Never expose secrets; only the public parts of settings.
    const { client_token: _ct, ...settings } = r.settings || {};
    return { ...r, settings };
  });
}

async function getConnection(tenantId, provider) {
  const { rows } = await pool.query(
    `SELECT * FROM pay_providers WHERE tenant_id = $1 AND provider = $2 AND status = 'connected'`,
    [tenantId, provider],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    credentials: row.credentials_sealed ? openJson(row.credentials_sealed) : {},
  };
}

function webhookUrl(tenantId, provider) {
  return `${publicBase()}/api/pay/webhooks/${provider}/${tenantId}`;
}

async function connectProvider(tenantId, provider, credentials, by) {
  const p = PROVIDERS[provider];
  if (!p) throw new PayError('Unknown payment method', 404);
  if (
    p.kind === 'online' &&
    !/^https:\/\//.test(publicBase()) &&
    process.env.NODE_ENV === 'production'
  ) {
    throw new PayError(
      'PUBLIC_APP_URL must be an https:// address before connecting online processors',
    );
  }
  const ws = await workspace(tenantId);
  const existing = await getConnection(tenantId, provider);
  if (existing && p.disconnect) await p.disconnect(existing).catch(() => {});
  const result = await p.connect({
    credentials: credentials || {},
    webhookUrl: webhookUrl(tenantId, provider),
    workspaceName: ws?.company_name || 'Workspace',
  });
  await pool.query(
    `INSERT INTO pay_providers (tenant_id, provider, status, environment, credentials_sealed, settings, connected_by)
     VALUES ($1, $2, 'connected', $3, $4, $5, $6)
     ON CONFLICT (tenant_id, provider) DO UPDATE SET
       status = 'connected', environment = EXCLUDED.environment, credentials_sealed = EXCLUDED.credentials_sealed,
       settings = EXCLUDED.settings, connected_by = EXCLUDED.connected_by, updated_at = NOW()`,
    [
      tenantId,
      provider,
      result.environment || 'live',
      result.credentials && Object.keys(result.credentials).length
        ? sealJson(result.credentials)
        : null,
      result.settings || {},
      by || null,
    ],
  );
  return {
    provider,
    environment: result.environment,
    settings: result.settings,
  };
}

async function disconnectProvider(tenantId, provider) {
  const conn = await getConnection(tenantId, provider);
  if (conn && PROVIDERS[provider]?.disconnect)
    await PROVIDERS[provider].disconnect(conn).catch(() => {});
  await pool.query(
    `DELETE FROM pay_providers WHERE tenant_id = $1 AND provider = $2`,
    [tenantId, provider],
  );
}

/** Methods a document may be paid with (connected ∩ allowed list). */
async function availableMethods(tenantId, allowed) {
  const { rows } = await pool.query(
    `SELECT provider, environment, settings FROM pay_providers WHERE tenant_id = $1 AND status = 'connected'`,
    [tenantId],
  );
  return rows
    .filter(
      (r) =>
        PROVIDERS[r.provider] &&
        (!allowed || !allowed.length || allowed.includes(r.provider)),
    )
    .map((r) => ({
      provider: r.provider,
      label: PROVIDERS[r.provider].label,
      kind: PROVIDERS[r.provider].kind,
      environment: r.environment,
    }));
}

// ── Coupons ──────────────────────────────────────────────────────────────────
async function findCoupon(tenantId, code, currency) {
  if (!code) return null;
  const { rows } = await pool.query(
    `SELECT * FROM pay_coupons WHERE tenant_id = $1 AND upper(code) = upper($2)`,
    [tenantId, String(code).trim()],
  );
  const c = rows[0];
  if (!c || !c.active) throw new PayError('That coupon code is not valid');
  if (c.expires_at && new Date(c.expires_at) < new Date())
    throw new PayError('That coupon has expired');
  if (c.max_redemptions && c.redemptions >= c.max_redemptions)
    throw new PayError('That coupon has been used up');
  if (c.kind === 'fixed' && c.currency && c.currency !== currency)
    throw new PayError('That coupon is for another currency');
  return c;
}

// ── Invoices & estimates ─────────────────────────────────────────────────────
function shapeInvoice(inv) {
  if (!inv) return null;
  const status = money.deriveStatus(inv);
  return {
    ...inv,
    subtotal: Number(inv.subtotal),
    tax_total: Number(inv.tax_total),
    discount_total: Number(inv.discount_total),
    total: Number(inv.total),
    amount_paid: Number(inv.amount_paid),
    balance: Math.max(0, Number(inv.total) - Number(inv.amount_paid)),
    status,
    public_url: invoiceUrl(inv),
  };
}

async function buildDocument(tenantId, body, existing = null) {
  const settings = await getSettings(tenantId);
  const currency = money.normCurrency(
    body.currency || existing?.currency || settings.default_currency,
  );
  const couponCode =
    body.coupon_code !== undefined
      ? String(body.coupon_code || '').trim()
      : existing?.coupon_code;
  const coupon = couponCode
    ? await findCoupon(tenantId, couponCode, currency)
    : null;
  const totals = money.computeTotals(body.line_items ?? existing?.line_items, {
    discount:
      body.discount ?? body.discount_total ?? existing?.discount_manual ?? 0,
    coupon,
    currency,
  });
  if (!totals.items.length)
    throw new PayError(
      'Add at least one line item with a description and quantity',
    );
  const email = String(
    body.customer_email ?? existing?.customer_email ?? '',
  ).trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new PayError('Customer email is not valid');
  const name = String(
    body.customer_name ?? existing?.customer_name ?? '',
  ).trim();
  if (!name && !email) throw new PayError('Add the customer name or email');
  const allowed = Array.isArray(body.allowed_methods)
    ? body.allowed_methods.filter((m) => PROVIDERS[m])
    : existing?.allowed_methods || null;
  return {
    currency,
    coupon,
    totals,
    fields: {
      customer_name: name.slice(0, 200),
      customer_email: email.slice(0, 200),
      customer_phone: String(
        body.customer_phone ?? existing?.customer_phone ?? '',
      ).slice(0, 60),
      customer_address: String(
        body.customer_address ?? existing?.customer_address ?? '',
      ).slice(0, 500),
      contact_id: body.contact_id ?? existing?.contact_id ?? null,
      title: String(body.title ?? existing?.title ?? '').slice(0, 200),
      due_date:
        body.due_date !== undefined
          ? body.due_date || null
          : existing?.due_date || null,
      issue_date:
        body.issue_date ||
        existing?.issue_date ||
        new Date().toISOString().slice(0, 10),
      payment_terms: String(
        body.payment_terms ?? existing?.payment_terms ?? settings.payment_terms,
      ).slice(0, 200),
      notes: String(body.notes ?? existing?.notes ?? '').slice(0, 4000),
      allowed_methods: allowed && allowed.length ? allowed : null,
    },
  };
}

async function createDocument(tenantId, body, { kind = 'invoice', by } = {}) {
  const doc = await buildDocument(tenantId, body);
  const number = await nextNumber(tenantId, kind);
  const f = doc.fields;
  const { rows } = await pool.query(
    `INSERT INTO pay_invoices
       (tenant_id, kind, number, status, contact_id, customer_name, customer_email, customer_phone, customer_address,
        title, currency, line_items, subtotal, tax_total, discount_total, coupon_code, total, issue_date, due_date,
        payment_terms, notes, allowed_methods, public_token, created_by)
     VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING *`,
    [
      tenantId,
      kind,
      number,
      f.contact_id,
      f.customer_name,
      f.customer_email,
      f.customer_phone,
      f.customer_address,
      f.title,
      doc.currency,
      JSON.stringify(doc.totals.items),
      doc.totals.subtotal,
      doc.totals.tax_total,
      doc.totals.discount_total,
      doc.coupon?.code || null,
      doc.totals.total,
      f.issue_date,
      f.due_date,
      f.payment_terms,
      f.notes,
      f.allowed_methods,
      newToken(),
      by || null,
    ],
  );
  if (doc.coupon)
    await pool.query(
      `UPDATE pay_coupons SET redemptions = redemptions + 1 WHERE id = $1`,
      [doc.coupon.id],
    );
  return shapeInvoice(rows[0]);
}

async function getDocument(tenantId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM pay_invoices WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return shapeInvoice(rows[0]);
}

async function updateDocument(tenantId, id, body) {
  const cur = await getDocument(tenantId, id);
  if (!cur) throw new PayError('Not found', 404);
  if (cur.status === 'void')
    throw new PayError('A void document cannot be edited');
  if (cur.amount_paid > 0 && body.line_items)
    throw new PayError('Line items cannot change after a payment was recorded');
  const doc = await buildDocument(tenantId, body, cur);
  const f = doc.fields;
  const { rows } = await pool.query(
    `UPDATE pay_invoices SET
       contact_id=$3, customer_name=$4, customer_email=$5, customer_phone=$6, customer_address=$7, title=$8,
       currency=$9, line_items=$10, subtotal=$11, tax_total=$12, discount_total=$13, coupon_code=$14, total=$15,
       issue_date=$16, due_date=$17, payment_terms=$18, notes=$19, allowed_methods=$20, updated_at=NOW()
     WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [
      tenantId,
      id,
      f.contact_id,
      f.customer_name,
      f.customer_email,
      f.customer_phone,
      f.customer_address,
      f.title,
      doc.currency,
      JSON.stringify(doc.totals.items),
      doc.totals.subtotal,
      doc.totals.tax_total,
      doc.totals.discount_total,
      doc.coupon?.code || null,
      doc.totals.total,
      f.issue_date,
      f.due_date,
      f.payment_terms,
      f.notes,
      f.allowed_methods,
    ],
  );
  return shapeInvoice(rows[0]);
}

async function listDocuments(
  tenantId,
  { kind = 'invoice', status, q, limit = 50, offset = 0 } = {},
) {
  await ensureSchema();
  const vals = [tenantId, kind];
  const where = ['tenant_id = $1', 'kind = $2'];
  if (q) {
    vals.push(`%${String(q).toLowerCase()}%`);
    where.push(
      `(lower(customer_name) LIKE $${vals.length} OR lower(customer_email) LIKE $${vals.length} OR lower(number) LIKE $${vals.length})`,
    );
  }
  const { rows } = await pool.query(
    `SELECT * FROM pay_invoices WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${Math.min(200, Number(limit) || 50)} OFFSET ${Math.max(0, Number(offset) || 0)}`,
    vals,
  );
  const docs = rows.map(shapeInvoice);
  return status ? docs.filter((d) => d.status === status) : docs;
}

async function setStatus(tenantId, id, status, extra = '') {
  const { rows } = await pool.query(
    `UPDATE pay_invoices SET status = $3, updated_at = NOW() ${extra} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, id, status],
  );
  return shapeInvoice(rows[0]);
}

async function voidDocument(tenantId, id) {
  const cur = await getDocument(tenantId, id);
  if (!cur) throw new PayError('Not found', 404);
  if (cur.amount_paid > 0)
    throw new PayError('Refund the recorded payments before voiding');
  return setStatus(tenantId, id, 'void');
}

async function convertEstimate(tenantId, id, by) {
  const est = await getDocument(tenantId, id);
  if (!est || est.kind !== 'estimate')
    throw new PayError('Estimate not found', 404);
  if (est.converted_invoice_id)
    return getDocument(tenantId, est.converted_invoice_id);
  const inv = await createDocument(
    tenantId,
    {
      ...est,
      discount: est.coupon_code ? 0 : est.discount_total,
      coupon_code: null,
      line_items: est.line_items,
    },
    { kind: 'invoice', by },
  );
  await pool.query(
    `UPDATE pay_invoices SET converted_invoice_id = $3, status = CASE WHEN status = 'draft' THEN 'accepted' ELSE status END WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, inv.id],
  );
  return inv;
}

// ── Sending ──────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
}

function fill(template, vars) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_m, k) =>
    vars[k] !== undefined ? String(vars[k]) : '',
  );
}

function documentEmail(settings, doc, message) {
  const label = doc.kind === 'estimate' ? 'estimate' : 'invoice';
  const url = invoiceUrl(doc);
  const rows = doc.line_items
    .map(
      (it) =>
        `<tr><td style="padding:6px 0;color:#334155">${esc(it.description)} × ${esc(it.quantity)}</td><td style="padding:6px 0;text-align:right;color:#334155">${esc(money.format(it.amount, doc.currency))}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="padding:24px 28px;border-bottom:1px solid #e2e8f0">
      ${settings.logo_url ? `<img src="${esc(settings.logo_url)}" alt="" style="max-height:40px;margin-bottom:8px">` : ''}
      <div style="font-size:18px;font-weight:bold;color:#0f172a">${esc(settings.business_name)}</div>
      <div style="font-size:13px;color:#64748b">${label[0].toUpperCase() + label.slice(1)} ${esc(doc.number)}</div>
    </div>
    <div style="padding:24px 28px">
      <p style="font-size:14px;color:#334155;line-height:1.6">${esc(message)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">${rows}
        <tr><td style="padding-top:12px;font-weight:bold;color:#0f172a">Total</td><td style="padding-top:12px;text-align:right;font-weight:bold;color:#0f172a">${esc(money.format(doc.total, doc.currency))}</td></tr>
        ${doc.amount_paid ? `<tr><td style="color:#64748b">Balance due</td><td style="text-align:right;color:#64748b">${esc(money.format(doc.balance, doc.currency))}</td></tr>` : ''}
      </table>
      ${doc.due_date ? `<p style="font-size:13px;color:#64748b">Due ${esc(String(doc.due_date).slice(0, 10))}</p>` : ''}
      <p style="text-align:center;margin:28px 0 8px"><a href="${esc(url)}" style="display:inline-block;background:#0284c7;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold">${doc.kind === 'estimate' ? 'View estimate' : 'View and pay'}</a></p>
    </div>
    ${settings.footer_note ? `<div style="padding:16px 28px;background:#f8fafc;font-size:12px;color:#64748b">${esc(settings.footer_note)}</div>` : ''}
  </div></body></html>`;
}

async function sendDocument(tenantId, id, { to, subject, message } = {}) {
  const doc = await getDocument(tenantId, id);
  if (!doc) throw new PayError('Not found', 404);
  if (doc.status === 'void')
    throw new PayError('A void document cannot be sent');
  const recipient = String(to || doc.customer_email || '').trim();
  if (!recipient) throw new PayError('Add the customer email first');
  const settings = await getSettings(tenantId);
  const vars = {
    number: doc.number,
    business: settings.business_name,
    customer: doc.customer_name,
    total: money.format(doc.total, doc.currency),
  };
  const { sendWorkspaceEmail } = require('../services/email.service');
  const sent = await sendWorkspaceEmail({
    tenantId,
    to: recipient,
    subject: fill(subject || settings.email_subject, vars),
    html: documentEmail(
      settings,
      doc,
      fill(message || settings.email_message, vars),
    ),
    fromName: settings.business_name,
  });
  if (!sent)
    throw new PayError(
      'No mail server is set up. Add one under Email / SMTP (or ask the platform admin for Platform SMTP).',
    );
  const status = doc.status === 'draft' ? 'sent' : doc.status;
  await pool.query(
    `UPDATE pay_invoices SET sent_at = NOW(), status = CASE WHEN status = 'draft' THEN $3 ELSE status END, updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, status],
  );
  return getDocument(tenantId, id);
}

/** Marks a draft as sent without emailing (link copied / shown in person). */
async function markSent(tenantId, id) {
  await pool.query(
    `UPDATE pay_invoices SET status = 'sent', sent_at = COALESCE(sent_at, NOW()), updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2 AND status = 'draft'`,
    [tenantId, id],
  );
  return getDocument(tenantId, id);
}

// ── Payments ─────────────────────────────────────────────────────────────────
async function notifyPayment(tenantId, tx) {
  try {
    require('../services/socket.service').broadcastToTenant(
      tenantId,
      'payment:received',
      {
        id: tx.id,
        amount: Number(tx.amount),
        currency: tx.currency,
        provider: tx.provider,
        customer: tx.customer_name || tx.customer_email || '',
        invoice_id: tx.invoice_id,
        status: tx.status,
      },
    );
  } catch {
    /* real-time is best effort */
  }
}

async function sendReceipt(tenantId, tx) {
  if (!tx.customer_email || tx.status !== 'succeeded') return;
  const settings = await getSettings(tenantId);
  const { sendWorkspaceEmail } = require('../services/email.service');
  const review =
    settings.review_request && settings.review_url
      ? `<p style="font-size:14px;color:#334155">Happy with our work? <a href="${esc(settings.review_url)}">Leave us a review</a>, it helps a lot.</p>`
      : '';
  await sendWorkspaceEmail({
    tenantId,
    to: tx.customer_email,
    subject: `Payment received — ${settings.business_name}`,
    fromName: settings.business_name,
    html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;margin:0">
      <div style="max-width:520px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px 28px">
        <div style="font-size:18px;font-weight:bold;color:#0f172a">${esc(settings.business_name)}</div>
        <p style="font-size:14px;color:#334155">Thank you${tx.customer_name ? `, ${esc(tx.customer_name)}` : ''}. We received your payment of
        <strong>${esc(money.format(tx.amount, tx.currency))}</strong>${tx.reference ? ` (reference ${esc(tx.reference)})` : ''}.</p>
        ${review}
      </div></body></html>`,
  }).catch((err) =>
    logger.warn({ err: err.message }, 'payment_receipt_failed'),
  );
}

/** Applies a succeeded transaction to its invoice / payment link. */
async function applyTransaction(client, tx) {
  if (tx.status !== 'succeeded') return;
  if (tx.invoice_id) {
    const { rows } = await client.query(
      `UPDATE pay_invoices SET amount_paid = amount_paid + $3, updated_at = NOW(),
              status = CASE WHEN status IN ('draft') THEN 'sent' ELSE status END,
              paid_at = CASE WHEN amount_paid + $3 >= total THEN NOW() ELSE paid_at END
        WHERE tenant_id = $1 AND id = $2 AND currency = $4 RETURNING *`,
      [tx.tenant_id, tx.invoice_id, tx.amount, money.normCurrency(tx.currency)],
    );
    if (rows[0] && Number(rows[0].amount_paid) >= Number(rows[0].total)) {
      await client.query(
        `UPDATE pay_invoices SET status = 'paid' WHERE id = $1`,
        [tx.invoice_id],
      );
    }
  }
  if (tx.link_id) {
    await client.query(
      `UPDATE pay_links SET payments_count = payments_count + 1, collected = collected + $2, updated_at = NOW() WHERE id = $1`,
      [tx.link_id, tx.amount],
    );
  }
}

/**
 * Records money for a workspace. Idempotent per (provider, external_id).
 * status: 'succeeded' (applied now) or 'pending' (manual methods, confirmed later).
 */
async function recordPayment(tenantId, p) {
  await ensureSchema();
  const client = await pool.connect();
  let tx = null;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO pay_transactions
         (tenant_id, invoice_id, link_id, attempt_id, gift_card_id, provider, external_id, amount, currency, status,
          method, customer_name, customer_email, reference, note, confirmed_by, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, CASE WHEN $10 = 'succeeded' THEN NOW() END)
       ON CONFLICT (provider, external_id) WHERE external_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        tenantId,
        p.invoice_id || null,
        p.link_id || null,
        p.attempt_id || null,
        p.gift_card_id || null,
        p.provider,
        p.external_id || null,
        Math.round(p.amount),
        money.normCurrency(p.currency),
        p.status || 'succeeded',
        p.method || p.provider,
        String(p.customer_name || '').slice(0, 200),
        String(p.customer_email || '').slice(0, 200),
        String(p.reference || '').slice(0, 200),
        String(p.note || '').slice(0, 1000),
        p.confirmed_by || null,
      ],
    );
    tx = rows[0] || null;
    if (tx) await applyTransaction(client, tx);
    if (p.attempt_id) {
      await client.query(
        `UPDATE pay_attempts SET status = $2, completed_at = NOW() WHERE id = $1`,
        [p.attempt_id, tx?.status === 'pending' ? 'pending' : 'paid'],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (tx) {
    await notifyPayment(tenantId, tx);
    if (tx.status === 'succeeded') await sendReceipt(tenantId, tx);
  }
  return tx;
}

async function confirmPending(tenantId, txId, by) {
  const client = await pool.connect();
  let tx;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE pay_transactions SET status = 'succeeded', confirmed_by = $3, confirmed_at = NOW()
        WHERE tenant_id = $1 AND id = $2 AND status = 'pending' RETURNING *`,
      [tenantId, txId, by || null],
    );
    tx = rows[0];
    if (!tx) throw new PayError('No pending payment with that id', 404);
    await applyTransaction(client, tx);
    if (tx.attempt_id)
      await client.query(
        `UPDATE pay_attempts SET status = 'paid' WHERE id = $1`,
        [tx.attempt_id],
      );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await notifyPayment(tenantId, tx);
  await sendReceipt(tenantId, tx);
  return tx;
}

async function rejectPending(tenantId, txId, by) {
  const { rows } = await pool.query(
    `UPDATE pay_transactions SET status = 'failed', confirmed_by = $3, confirmed_at = NOW(), note = note || ' (rejected)'
      WHERE tenant_id = $1 AND id = $2 AND status = 'pending' RETURNING *`,
    [tenantId, txId, by || null],
  );
  if (!rows[0]) throw new PayError('No pending payment with that id', 404);
  return rows[0];
}

/** Marks a succeeded payment refunded (money is returned in the processor's own dashboard). */
async function markRefunded(tenantId, txId, by) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE pay_transactions SET status = 'refunded', note = note || $3
        WHERE tenant_id = $1 AND id = $2 AND status = 'succeeded' RETURNING *`,
      [tenantId, txId, ` (refund recorded by ${by || 'staff'})`],
    );
    const tx = rows[0];
    if (!tx) throw new PayError('No succeeded payment with that id', 404);
    if (tx.invoice_id) {
      await client.query(
        `UPDATE pay_invoices SET amount_paid = GREATEST(0, amount_paid - $2), paid_at = NULL,
                status = CASE WHEN status = 'paid' THEN 'sent' ELSE status END, updated_at = NOW() WHERE id = $1`,
        [tx.invoice_id, tx.amount],
      );
    }
    if (tx.gift_card_id) {
      await client.query(
        `UPDATE pay_gift_cards SET balance = balance + $2, updated_at = NOW(),
                activity = activity || jsonb_build_array(jsonb_build_object('type','refund','amount',$2::bigint,'at',NOW(),'by',$3::text))
          WHERE id = $1`,
        [tx.gift_card_id, tx.amount, by || null],
      );
    }
    await client.query('COMMIT');
    return tx;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function listTransactions(
  tenantId,
  { status, provider, limit = 100, offset = 0 } = {},
) {
  const vals = [tenantId];
  const where = ['t.tenant_id = $1'];
  if (status) {
    vals.push(status);
    where.push(`t.status = $${vals.length}`);
  }
  if (provider) {
    vals.push(provider);
    where.push(`t.provider = $${vals.length}`);
  }
  const { rows } = await pool.query(
    `SELECT t.*, i.number AS invoice_number, l.title AS link_title
       FROM pay_transactions t
       LEFT JOIN pay_invoices i ON i.id = t.invoice_id
       LEFT JOIN pay_links l ON l.id = t.link_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.created_at DESC LIMIT ${Math.min(500, Number(limit) || 100)} OFFSET ${Math.max(0, Number(offset) || 0)}`,
    vals,
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

// ── Gift cards ───────────────────────────────────────────────────────────────
function giftCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i += 1) s += alphabet[bytes[i] % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

async function issueGiftCard(tenantId, body, by) {
  await ensureSchema();
  const settings = await getSettings(tenantId);
  const currency = money.normCurrency(
    body.currency || settings.default_currency,
  );
  const amount = Math.round(Number(body.amount) || 0);
  if (amount <= 0) throw new PayError('Gift card amount must be positive');
  const code = String(body.code || giftCode())
    .trim()
    .toUpperCase()
    .slice(0, 40);
  try {
    const { rows } = await pool.query(
      `INSERT INTO pay_gift_cards (tenant_id, code, currency, initial_balance, balance, recipient_name, recipient_email, message, expires_at, activity)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8, jsonb_build_array(jsonb_build_object('type','issue','amount',$4::bigint,'at',NOW(),'by',$9::text)))
       RETURNING *`,
      [
        tenantId,
        code,
        currency,
        amount,
        String(body.recipient_name || '').slice(0, 200),
        String(body.recipient_email || '').slice(0, 200),
        String(body.message || '').slice(0, 1000),
        body.expires_at || null,
        by || null,
      ],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505')
      throw new PayError('That gift card code is already used', 409);
    throw err;
  }
}

async function findGiftCard(tenantId, code) {
  const { rows } = await pool.query(
    `SELECT * FROM pay_gift_cards WHERE tenant_id = $1 AND upper(code) = upper($2)`,
    [tenantId, String(code || '').trim()],
  );
  const g = rows[0];
  if (!g) throw new PayError('Gift card not found', 404);
  return g;
}

/** Spends from a gift card, optionally against an invoice (records a transaction). */
async function redeemGiftCard(
  tenantId,
  { code, amount, invoice_id, by, customer_name, customer_email },
) {
  const card = await findGiftCard(tenantId, code);
  if (card.status !== 'active')
    throw new PayError('This gift card is not active');
  if (card.expires_at && new Date(card.expires_at) < new Date())
    throw new PayError('This gift card has expired');
  let spend = Math.round(Number(amount) || 0);
  if (invoice_id) {
    const inv = await getDocument(tenantId, invoice_id);
    if (!inv) throw new PayError('Invoice not found', 404);
    if (inv.currency !== card.currency)
      throw new PayError('The gift card currency does not match the invoice');
    spend = spend > 0 ? Math.min(spend, inv.balance) : inv.balance;
  }
  spend = Math.min(spend, Number(card.balance));
  if (spend <= 0)
    throw new PayError('Nothing to redeem: the balance or amount is zero');
  const { rowCount } = await pool.query(
    `UPDATE pay_gift_cards SET balance = balance - $3, updated_at = NOW(),
            activity = activity || jsonb_build_array(jsonb_build_object('type','redeem','amount',$3::bigint,'at',NOW(),'by',$4::text,'invoice_id',$5::text))
      WHERE tenant_id = $1 AND id = $2 AND balance >= $3 AND status = 'active'`,
    [tenantId, card.id, spend, by || null, invoice_id || null],
  );
  if (!rowCount)
    throw new PayError('The gift card balance changed, try again', 409);
  const tx = await recordPayment(tenantId, {
    invoice_id,
    gift_card_id: card.id,
    provider: 'gift_card',
    external_id: `gc_${card.id}_${Date.now()}`,
    amount: spend,
    currency: card.currency,
    method: 'gift_card',
    reference: card.code,
    customer_name,
    customer_email,
    confirmed_by: by,
  });
  return { card: await findGiftCard(tenantId, card.code), transaction: tx };
}

async function voidGiftCard(tenantId, id, by) {
  const { rows } = await pool.query(
    `UPDATE pay_gift_cards SET status = 'void', updated_at = NOW(),
            activity = activity || jsonb_build_array(jsonb_build_object('type','void','amount',balance,'at',NOW(),'by',$3::text))
      WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, id, by || null],
  );
  if (!rows[0]) throw new PayError('Not found', 404);
  return rows[0];
}

// ── Customers & stats ────────────────────────────────────────────────────────
async function customers(tenantId, q) {
  const vals = [tenantId];
  let filter = '';
  if (q) {
    vals.push(`%${String(q).toLowerCase()}%`);
    filter = `AND (lower(customer_name) LIKE $2 OR lower(customer_email) LIKE $2)`;
  }
  const { rows } = await pool.query(
    `SELECT COALESCE(NULLIF(lower(customer_email), ''), lower(customer_name)) AS key,
            MAX(customer_name) AS name, MAX(customer_email) AS email, MAX(customer_phone) AS phone,
            COUNT(*) FILTER (WHERE kind = 'invoice')::int AS invoices,
            SUM(amount_paid) FILTER (WHERE kind = 'invoice')::bigint AS paid,
            SUM(GREATEST(total - amount_paid, 0)) FILTER (WHERE kind = 'invoice' AND status NOT IN ('void','draft'))::bigint AS outstanding,
            MAX(created_at) AS last_activity, MAX(currency) AS currency
       FROM pay_invoices WHERE tenant_id = $1 ${filter}
      GROUP BY 1 ORDER BY MAX(created_at) DESC LIMIT 500`,
    vals,
  );
  return rows.map((r) => ({
    ...r,
    paid: Number(r.paid || 0),
    outstanding: Number(r.outstanding || 0),
  }));
}

async function stats(tenantId) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT
       (SELECT COALESCE(SUM(amount),0) FROM pay_transactions WHERE tenant_id = $1 AND status = 'succeeded' AND created_at > NOW() - INTERVAL '30 days')::bigint AS collected_30d,
       (SELECT COUNT(*) FROM pay_transactions WHERE tenant_id = $1 AND status = 'pending')::int AS pending_confirmations,
       (SELECT COALESCE(SUM(total - amount_paid),0) FROM pay_invoices WHERE tenant_id = $1 AND kind = 'invoice' AND status IN ('sent','viewed','partially_paid','overdue'))::bigint AS outstanding,
       (SELECT COUNT(*) FROM pay_invoices WHERE tenant_id = $1 AND kind = 'invoice' AND status IN ('sent','viewed','partially_paid') AND due_date < CURRENT_DATE AND total > amount_paid)::int AS overdue,
       (SELECT COUNT(*) FROM pay_invoices WHERE tenant_id = $1 AND kind = 'invoice' AND status = 'paid' AND paid_at > NOW() - INTERVAL '30 days')::int AS paid_30d,
       (SELECT default_currency FROM pay_settings WHERE tenant_id = $1) AS currency`,
    [tenantId],
  );
  const r = rows[0];
  return {
    ...r,
    collected_30d: Number(r.collected_30d),
    outstanding: Number(r.outstanding),
    currency: r.currency || 'usd',
  };
}

module.exports = {
  PayError,
  ACTIVE_STATUSES,
  workspace,
  getSettings,
  updateSettings,
  listConnections,
  getConnection,
  connectProvider,
  disconnectProvider,
  availableMethods,
  webhookUrl,
  findCoupon,
  createDocument,
  getDocument,
  updateDocument,
  listDocuments,
  setStatus,
  voidDocument,
  convertEstimate,
  sendDocument,
  markSent,
  recordPayment,
  confirmPending,
  rejectPending,
  markRefunded,
  listTransactions,
  issueGiftCard,
  findGiftCard,
  redeemGiftCard,
  voidGiftCard,
  customers,
  stats,
  newToken,
  invoiceUrl,
  linkUrl,
  shapeInvoice,
  seal,
};
