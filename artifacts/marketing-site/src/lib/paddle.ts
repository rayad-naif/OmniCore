import { initializePaddle, type Paddle } from '@paddle/paddle-js';

const PADDLE_TOKEN = 'live_6838d19e875acfc8ce29fd0d7d3';

let _paddle: Paddle | undefined;
let _initPromise: Promise<Paddle | undefined> | null = null;

export function getPaddle(): Paddle | undefined {
  return _paddle;
}

export async function ensurePaddle(): Promise<Paddle | undefined> {
  if (_paddle) return _paddle;
  if (_initPromise) return _initPromise;

  _initPromise = initializePaddle({ token: PADDLE_TOKEN }).then((p) => {
    _paddle = p;
    return p;
  });

  return _initPromise;
}
