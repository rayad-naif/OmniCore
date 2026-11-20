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
  it('defaults to Paddle when no provider is configured', () => {
    delete process.env.BILLING_PROVIDER;
    expect(getActiveProvider()).toBe('paddle');
  });

  it('selects legacy Stripe only when explicitly configured', () => {
    process.env.BILLING_PROVIDER = 'Stripe';
    expect(getActiveProvider()).toBe('stripe');
  });

  it('selects Paddle case-insensitively', () => {
    process.env.BILLING_PROVIDER = 'PADDLE';
    expect(getActiveProvider()).toBe('paddle');
  });

  it('falls back to Paddle for unsupported provider values', () => {
    process.env.BILLING_PROVIDER = 'stripe-test';
    expect(getActiveProvider()).toBe('paddle');
  });
});
