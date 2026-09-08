import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

const { getPaddlePriceId, verifyPaddleWebhook } = require('./paddleClient.js');
const originalStarterPrice = process.env.PADDLE_STARTER_PRICE_ID;
const originalMissingPrice = process.env.PADDLE_MISSING_PRICE_ID;

afterEach(() => {
  if (originalStarterPrice === undefined)
    delete process.env.PADDLE_STARTER_PRICE_ID;
  else process.env.PADDLE_STARTER_PRICE_ID = originalStarterPrice;
  if (originalMissingPrice === undefined)
    delete process.env.PADDLE_MISSING_PRICE_ID;
  else process.env.PADDLE_MISSING_PRICE_ID = originalMissingPrice;
});

describe('Paddle configuration and webhook verification', () => {
  it('reads plan price IDs from the canonical uppercase environment key', () => {
    process.env.PADDLE_STARTER_PRICE_ID = 'pri_starter';
    delete process.env.PADDLE_MISSING_PRICE_ID;

    expect(getPaddlePriceId('starter')).toBe('pri_starter');
    expect(getPaddlePriceId('missing')).toBeNull();
  });

  it('accepts a correctly signed JSON webhook payload', () => {
    const body = Buffer.from('{"event_type":"transaction.completed"}');
    const timestamp = '1700000000';
    const secret = 'webhook-secret';
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}:${body.toString('utf8')}`)
      .digest('hex');

    expect(
      verifyPaddleWebhook(body, secret, `ts=${timestamp};h1=${signature}`),
    ).toEqual({ event_type: 'transaction.completed' });
  });

  it('rejects malformed, unsigned, or tampered webhook data', () => {
    const body = Buffer.from('{"event_type":"transaction.completed"}');

    expect(verifyPaddleWebhook(body, '', 'ts=1;h1=abc')).toBeNull();
    expect(verifyPaddleWebhook(body, 'secret', 'ts=1')).toBeNull();
    expect(verifyPaddleWebhook(body, 'secret', 'ts=1;h1=deadbeef')).toBeNull();
    expect(
      verifyPaddleWebhook(
        Buffer.from('not-json'),
        'secret',
        'ts=1;h1=deadbeef',
      ),
    ).toBeNull();
  });
});
