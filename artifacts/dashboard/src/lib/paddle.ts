import { initializePaddle, type Paddle } from '@paddle/paddle-js';

const PADDLE_TOKEN = 'live_6838d19e875acfc8ce29fd0d7d3';

let _paddle: Paddle | undefined;
let _initPromise: Promise<Paddle | undefined> | null = null;
let _initializedWithCustomer: string | null = null;

export function getPaddle(): Paddle | undefined {
  return _paddle;
}

export async function ensurePaddle(paddleCustomerId?: string | null): Promise<Paddle | undefined> {
  const ctmId = (paddleCustomerId?.startsWith('ctm_') ? paddleCustomerId : null) ?? null;

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

  const opts: Parameters<typeof initializePaddle>[0] = { token: PADDLE_TOKEN };
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
