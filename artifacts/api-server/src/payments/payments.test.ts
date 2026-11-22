import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const money = require('./money.js');
const stripe = require('./providers/stripe.js');
const paddle = require('./providers/paddle.js');
const anet = require('./providers/authorizenet.js');
const manual = require('./providers/manual.js');
const { flatten } = require('./providers/http.js');
const { catalog } = require('./providers/index.js');

afterEach(() => vi.unstubAllGlobals());

describe('money', () => {
  it('computes line totals, tax, coupon and fixed discounts in cents', () => {
    const t = money.computeTotals(
      [
        {
          description: 'Repair',
          quantity: 2,
          unit_price: 5000,
          taxable: true,
          tax_rate: 8.25,
        },
        { description: 'Fee', quantity: 1, unit_price: 1999 },
        { description: '', quantity: 1, unit_price: 100 },
      ],
      { discount: 500, coupon: { kind: 'percent', value: 10 } },
    );
    expect(t.items).toHaveLength(2);
    expect([t.subtotal, t.tax_total, t.discount_total, t.total]).toEqual([
      11999, 825, 1700, 11124,
    ]);
    expect(
      money.computeTotals(
        [{ description: 'x', quantity: 1, unit_price: 100 }],
        { discount: 999 },
      ).total,
    ).toBe(0);
  });

  it('handles zero-decimal currencies and formatting', () => {
    expect(money.toMinor('12.5', 'usd')).toBe(1250);
    expect(money.toMinor(1000, 'jpy')).toBe(1000);
    expect(money.toMajorString(1250, 'usd')).toBe('12.50');
    expect(money.format(1250, 'usd')).toBe('$12.50');
    expect(money.normCurrency('PKR')).toBe('pkr');
    expect(money.normCurrency('nope!')).toBe('usd');
  });

  it('derives invoice status', () => {
    const past = '2020-01-01';
    expect(
      money.deriveStatus({
        kind: 'invoice',
        status: 'sent',
        total: 100,
        amount_paid: 100,
      }),
    ).toBe('paid');
    expect(
      money.deriveStatus({
        kind: 'invoice',
        status: 'sent',
        total: 100,
        amount_paid: 40,
      }),
    ).toBe('partially_paid');
    expect(
      money.deriveStatus({
        kind: 'invoice',
        status: 'viewed',
        total: 100,
        amount_paid: 0,
        due_date: past,
      }),
    ).toBe('overdue');
    expect(
      money.deriveStatus({
        kind: 'invoice',
        status: 'draft',
        total: 100,
        amount_paid: 0,
      }),
    ).toBe('draft');
    expect(
      money.deriveStatus({
        kind: 'invoice',
        status: 'void',
        total: 100,
        amount_paid: 0,
      }),
    ).toBe('void');
  });
});

describe('processor webhooks', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));

  it('verifies Stripe signatures with a 5-minute window', () => {
    const secret = 'whsec_x';
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto
      .createHmac('sha256', secret)
      .update(`${t}.${body}`)
      .digest('hex');
    const creds = { webhook_secret: secret };
    expect(
      stripe.verifyWebhook({
        rawBody: body,
        headers: { 'stripe-signature': `t=${t},v1=${v1}` },
        credentials: creds,
      }),
    ).toBe(true);
    expect(
      stripe.verifyWebhook({
        rawBody: body,
        headers: { 'stripe-signature': `t=${t},v1=${'0'.repeat(64)}` },
        credentials: creds,
      }),
    ).toBe(false);
    const old = t - 600;
    const vOld = crypto
      .createHmac('sha256', secret)
      .update(`${old}.${body}`)
      .digest('hex');
    expect(
      stripe.verifyWebhook({
        rawBody: body,
        headers: { 'stripe-signature': `t=${old},v1=${vOld}` },
        credentials: creds,
      }),
    ).toBe(false);
    const parsed = stripe.parseWebhook({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          client_reference_id: 'a1',
          payment_intent: 'pi_1',
          amount_total: 500,
          currency: 'usd',
          payment_status: 'paid',
        },
      },
    });
    expect(parsed).toMatchObject({
      attemptId: 'a1',
      externalId: 'pi_1',
      amount: 500,
      paid: true,
    });
    expect(stripe.parseWebhook({ type: 'customer.created' })).toBeNull();
  });

  it('verifies Paddle signatures', () => {
    const secret = 'pdl_ntfset_x';
    const ts = Math.floor(Date.now() / 1000);
    const h1 = crypto
      .createHmac('sha256', secret)
      .update(`${ts}:${body}`)
      .digest('hex');
    expect(
      paddle.verifyWebhook({
        rawBody: body,
        headers: { 'paddle-signature': `ts=${ts};h1=${h1}` },
        credentials: { webhook_secret: secret },
      }),
    ).toBe(true);
    expect(
      paddle.verifyWebhook({
        rawBody: body,
        headers: { 'paddle-signature': `ts=${ts};h1=${h1.replace(/.$/, '0')}` },
        credentials: { webhook_secret: secret },
      }),
    ).toBe(false);
    const p = paddle.parseWebhook({
      event_type: 'transaction.completed',
      data: {
        id: 'txn_1',
        currency_code: 'EUR',
        custom_data: { omnicore_attempt: 'a2' },
        details: { totals: { grand_total: '1999' } },
      },
    });
    expect(p).toMatchObject({
      attemptId: 'a2',
      amount: 1999,
      currency: 'eur',
      paid: true,
    });
  });

  it('verifies Authorize.net signatures (key as text or hex)', () => {
    const key = 'A1B2C3D4E5F6';
    const sigText = crypto
      .createHmac('sha512', Buffer.from(key))
      .update(body)
      .digest('hex')
      .toUpperCase();
    const sigHex = crypto
      .createHmac('sha512', Buffer.from(key, 'hex'))
      .update(body)
      .digest('hex');
    expect(
      anet.verifyWebhook({
        rawBody: body,
        headers: { 'x-anet-signature': `sha512=${sigText}` },
        credentials: { signature_key: key },
      }),
    ).toBe(true);
    expect(
      anet.verifyWebhook({
        rawBody: body,
        headers: { 'x-anet-signature': `sha512=${sigHex}` },
        credentials: { signature_key: key },
      }),
    ).toBe(true);
    expect(
      anet.verifyWebhook({
        rawBody: body,
        headers: { 'x-anet-signature': 'sha512=00' },
        credentials: { signature_key: key },
      }),
    ).toBe(false);
    expect(anet.refFor('11111111-2222-3333-4444-555555555555')).toHaveLength(
      20,
    );
  });
});

describe('processors', () => {
  it('lists eight payment methods without secrets', () => {
    const c = catalog();
    expect(c.map((p: { key: string }) => p.key)).toEqual([
      'paddle',
      'stripe',
      'paypal',
      'square',
      'authorize_net',
      'payoneer',
      'bank_transfer',
      'cod',
    ]);
  });

  it('builds Stripe-style form fields', () => {
    expect(
      flatten({
        a: 1,
        line_items: [{ price_data: { currency: 'usd' } }],
        tags: ['x'],
      }),
    ).toEqual({
      a: '1',
      'line_items[0][price_data][currency]': 'usd',
      'tags[0]': 'x',
    });
  });

  it('rejects malformed keys before contacting Stripe', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      stripe.connect({
        credentials: { secret_key: 'pk_live_123' },
        webhookUrl: 'https://x',
      }),
    ).rejects.toThrow(/secret key/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('creates a Stripe Checkout Session for the exact amount', async () => {
    let sent = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent = String(init.body);
        return new Response(
          JSON.stringify({
            id: 'cs_9',
            url: 'https://checkout.stripe.com/c/cs_9',
          }),
          { status: 200 },
        );
      }),
    );
    const r = await stripe.createCheckout({
      credentials: { secret_key: 'sk_test_1' },
      attempt: {
        id: 'att-1',
        amount: 12345,
        currency: 'eur',
        description: 'Invoice INV-1',
        customer_email: '',
      },
      urls: { success: 'https://s', cancel: 'https://c' },
    });
    expect(r).toMatchObject({
      type: 'redirect',
      url: 'https://checkout.stripe.com/c/cs_9',
      externalRef: 'cs_9',
    });
    const form = new URLSearchParams(sent);
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('12345');
    expect(form.get('line_items[0][price_data][currency]')).toBe('eur');
    expect(form.get('client_reference_id')).toBe('att-1');
  });

  it('validates manual methods', async () => {
    await expect(
      manual.bank_transfer.connect({ credentials: {} }),
    ).rejects.toThrow(/Bank details/);
    await expect(
      manual.payoneer.connect({
        credentials: { instructions: 'x', payment_url: 'http://a' },
      }),
    ).rejects.toThrow(/https/);
    const cod = await manual.cod.connect({ credentials: {} });
    expect(
      (await manual.cod.createCheckout({ settings: cod.settings }))
        .instructions,
    ).toMatch(/cash/i);
  });
});
