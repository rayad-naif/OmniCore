'use strict';

/**
 * payments/money.js — amounts in integer minor units (cents).
 */

// ISO 4217 currencies with no minor unit (amount 100 = 100, not 1.00).
const ZERO_DECIMAL = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

const CURRENCY_RE = /^[a-z]{3}$/;

function normCurrency(c, fallback = 'usd') {
  const v = String(c || '')
    .trim()
    .toLowerCase();
  return CURRENCY_RE.test(v) ? v : fallback;
}

const decimals = (currency) =>
  ZERO_DECIMAL.has(normCurrency(currency)) ? 0 : 2;

/** "12.5" / 12.5 → 1250 (for 2-decimal currencies). */
function toMinor(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** decimals(currency));
}

/** 1250 → "12.50" */
function toMajorString(minor, currency) {
  const d = decimals(currency);
  return (Number(minor || 0) / 10 ** d).toFixed(d);
}

function format(minor, currency) {
  const cur = normCurrency(currency).toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur,
    }).format(Number(minor || 0) / 10 ** decimals(currency));
  } catch {
    return `${toMajorString(minor, currency)} ${cur}`;
  }
}

/**
 * Normalises line items and computes totals.
 * items: [{ description, quantity, unit_price (minor), taxable, tax_rate (percent), product_id? }]
 * discount: fixed minor amount; coupon: { kind: 'percent'|'fixed', value } (applied to subtotal).
 */
function computeTotals(
  rawItems,
  { discount = 0, coupon = null, currency = 'usd' } = {},
) {
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map((it) => ({
      description: String(it?.description || '')
        .trim()
        .slice(0, 500),
      quantity: Math.max(0, Number(it?.quantity) || 0),
      unit_price: Math.max(0, Math.round(Number(it?.unit_price) || 0)),
      taxable: Boolean(it?.taxable),
      tax_rate: Math.min(100, Math.max(0, Number(it?.tax_rate) || 0)),
      product_id: it?.product_id || null,
    }))
    .filter((it) => it.description && it.quantity > 0);

  let subtotal = 0;
  let tax = 0;
  for (const it of items) {
    const line = Math.round(it.quantity * it.unit_price);
    it.amount = line;
    subtotal += line;
    if (it.taxable && it.tax_rate > 0)
      tax += Math.round((line * it.tax_rate) / 100);
  }
  let discountTotal = Math.max(0, Math.round(Number(discount) || 0));
  if (coupon) {
    if (coupon.kind === 'percent') {
      discountTotal += Math.round(
        (subtotal * Math.min(100, Number(coupon.value) || 0)) / 100,
      );
    } else {
      discountTotal += toMinor(coupon.value, currency);
    }
  }
  discountTotal = Math.min(discountTotal, subtotal + tax);
  return {
    items,
    subtotal,
    tax_total: tax,
    discount_total: discountTotal,
    total: Math.max(0, subtotal + tax - discountTotal),
  };
}

/** Invoice status from amounts and dates (draft/void/accepted are kept as-is). */
function deriveStatus(inv, today = new Date()) {
  if (['draft', 'void'].includes(inv.status)) return inv.status;
  if (inv.kind === 'estimate') return inv.status;
  const balance = Number(inv.total) - Number(inv.amount_paid);
  if (Number(inv.total) > 0 && balance <= 0) return 'paid';
  const due = inv.due_date ? new Date(inv.due_date) : null;
  const overdue =
    due && due.toISOString().slice(0, 10) < today.toISOString().slice(0, 10);
  if (Number(inv.amount_paid) > 0)
    return overdue ? 'overdue' : 'partially_paid';
  return overdue ? 'overdue' : inv.status === 'viewed' ? 'viewed' : 'sent';
}

module.exports = {
  normCurrency,
  decimals,
  toMinor,
  toMajorString,
  format,
  computeTotals,
  deriveStatus,
};
