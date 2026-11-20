import { initializePaddle, type Paddle } from '@paddle/paddle-js';

const PADDLE_TOKEN = import.meta.env.VITE_PADDLE_CLIENT_TOKEN;

// Paddle client-side tokens are prefixed `test_` (sandbox) or `live_`
// (production). Paddle.js defaults to production, so a sandbox token must be
// paired with environment: 'sandbox' or checkout fails to open.
const PADDLE_ENVIRONMENT: 'sandbox' | 'production' = PADDLE_TOKEN?.startsWith(
  'test_',
)
  ? 'sandbox'
  : 'production';

let _paddle: Paddle | undefined;
let _initPromise: Promise<Paddle | undefined> | null = null;
let _initializedWithCustomer: string | null = null;

export function getPaddle(): Paddle | undefined {
  return _paddle;
}

export async function ensurePaddle(
  paddleCustomerId?: string | null,
): Promise<Paddle | undefined> {
  if (!PADDLE_TOKEN) return undefined;
  const ctmId =
    (paddleCustomerId?.startsWith('ctm_') ? paddleCustomerId : null) ?? null;

  if (_paddle) {
    if (ctmId && ctmId !== _initializedWithCustomer) {
      _initializedWithCustomer = ctmId;
      // Re-initialize with the customer ID so Retain can track this customer
      _paddle = undefined;
      _initPromise = null;
      return ensurePaddle(ctmId);
    }
    return _paddle;
  }

  if (_initPromise) {
    return _initPromise;
  }

  const opts: Parameters<typeof initializePaddle>[0] = {
    token: PADDLE_TOKEN,
    environment: PADDLE_ENVIRONMENT,
  };
  if (ctmId) {
    opts.pwCustomer = { id: ctmId };
    _initializedWithCustomer = ctmId;
  }

  _initPromise = initializePaddle(opts).then((p) => {
    _paddle = p;
    return p;
  });

  return _initPromise;
}
