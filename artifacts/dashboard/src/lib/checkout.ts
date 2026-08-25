export type CheckoutResult = {
  url?: string;
  transactionId?: string;
  provider?: string;
};

export function checkoutMode(
  result: CheckoutResult,
  paddleAvailable: boolean,
): 'paddle' | 'redirect' {
  if (result.transactionId && result.provider === 'paddle') {
    if (!paddleAvailable) {
      throw new Error(
        'Paddle checkout is not configured. Set VITE_PADDLE_CLIENT_TOKEN and rebuild the dashboard.',
      );
    }
    return 'paddle';
  }

  if (result.url) return 'redirect';

  throw new Error('Checkout provider did not return a hosted checkout URL.');
}
