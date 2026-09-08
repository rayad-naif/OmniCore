import { afterEach, describe, expect, it } from 'vitest';

const { getActiveProvider } = require('./billingProvider.js');
const originalProvider = process.env.BILLING_PROVIDER;

afterEach(() => {
  if (originalProvider === undefined) {
    delete process.env.BILLING_PROVIDER;
  } else {
    process.env.BILLING_PROVIDER = originalProvider;
  }
});

describe('active billing provider selection', () => {
  it('defaults to Stripe when no provider is configured', () => {
    delete process.env.BILLING_PROVIDER;
    expect(getActiveProvider()).toBe('stripe');
  });

  it('selects Paddle case-insensitively', () => {
    process.env.BILLING_PROVIDER = 'PADDLE';
    expect(getActiveProvider()).toBe('paddle');
  });

  it('fails closed to Stripe for unsupported provider values', () => {
    process.env.BILLING_PROVIDER = 'stripe-test';
    expect(getActiveProvider()).toBe('stripe');
  });
});
