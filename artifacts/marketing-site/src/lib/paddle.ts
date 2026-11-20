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

export function getPaddle(): Paddle | undefined {
  return _paddle;
}

export async function ensurePaddle(): Promise<Paddle | undefined> {
  if (!PADDLE_TOKEN) return undefined;
  if (_paddle) return _paddle;
  if (_initPromise) return _initPromise;

  _initPromise = initializePaddle({
    token: PADDLE_TOKEN,
    environment: PADDLE_ENVIRONMENT,
  }).then((p) => {
    _paddle = p;
    return p;
  });

  return _initPromise;
}
