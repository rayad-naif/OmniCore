import { initializePaddle, type Paddle } from '@paddle/paddle-js';

const PADDLE_TOKEN = import.meta.env.VITE_PADDLE_CLIENT_TOKEN;

let _paddle: Paddle | undefined;
let _initPromise: Promise<Paddle | undefined> | null = null;

export function getPaddle(): Paddle | undefined {
  return _paddle;
}

export async function ensurePaddle(): Promise<Paddle | undefined> {
  if (!PADDLE_TOKEN) return undefined;
  if (_paddle) return _paddle;
  if (_initPromise) return _initPromise;

  _initPromise = initializePaddle({ token: PADDLE_TOKEN }).then((p) => {
    _paddle = p;
    return p;
  });

  return _initPromise;
}
