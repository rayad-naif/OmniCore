import { describe, expect, it } from 'vitest';
import { checkoutMode } from './checkout';

describe('checkout mode', () => {
  it('requires the public Paddle token for transaction checkouts', () => {
    expect(() =>
      checkoutMode({ provider: 'paddle', transactionId: 'txn_123' }, false),
    ).toThrow('VITE_PADDLE_CLIENT_TOKEN');
  });

  it('opens Paddle when configured and redirects for a hosted URL', () => {
    expect(
      checkoutMode({ provider: 'paddle', transactionId: 'txn_123' }, true),
    ).toBe('paddle');
    expect(checkoutMode({ url: 'https://checkout.example.test' }, false)).toBe(
      'redirect',
    );
  });

  it('rejects responses without a checkout destination', () => {
    expect(() => checkoutMode({}, false)).toThrow('hosted checkout URL');
  });
});
