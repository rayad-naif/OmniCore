'use strict';
const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const randomToken = (bytes) => b64u(crypto.randomBytes(bytes || 24));
const sha256 = (s) =>
  crypto.createHash('sha256').update(String(s)).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a)),
    y = Buffer.from(String(b));
  if (x.length !== y.length) {
    crypto.timingSafeEqual(x, x);
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

/* ---------- passwords (scrypt) ---------- */
const scrypt = (pw, salt) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(
      String(pw),
      salt,
      64,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (e, k) => (e ? reject(e) : resolve(k)),
    );
  });
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return 'scrypt$' + b64u(salt) + '$' + b64u(await scrypt(pw, salt));
}
let dummyHash = null;
async function verifyPassword(pw, stored) {
  const real =
    typeof stored === 'string' &&
    stored.startsWith('scrypt$') &&
    stored.split('$').length === 3;
  if (!dummyHash) dummyHash = hashPassword('acc-dummy-password');
  const parts = (real ? stored : await dummyHash).split('$');
  const want = Buffer.from(parts[2], 'base64url');
  const got = await scrypt(pw, Buffer.from(parts[1], 'base64url'));
  return crypto.timingSafeEqual(want, got) && real;
}

/* ---------- sessions (HMAC) + secrets at rest (AES-256-GCM) ---------- */
function createSecurity(sessionSecret, encryptionKey) {
  const macKey = crypto
    .createHash('sha256')
    .update('acc-mac:' + sessionSecret)
    .digest();
  const encKey = crypto
    .createHash('sha256')
    .update('acc-enc:' + (encryptionKey || sessionSecret))
    .digest();
  const mac = (s) =>
    crypto.createHmac('sha256', macKey).update(s).digest('base64url');

  function sign(obj) {
    const body = b64u(JSON.stringify(obj));
    return body + '.' + mac(body);
  }
  function unsign(token) {
    if (typeof token !== 'string') return null;
    const i = token.lastIndexOf('.');
    if (i < 1) return null;
    const body = token.slice(0, i),
      sig = token.slice(i + 1);
    if (!safeEqual(sig, mac(body))) return null;
    try {
      const obj = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (obj.exp && Date.now() > obj.exp) return null;
      return obj;
    } catch {
      return null;
    }
  }

  function encrypt(plain) {
    if (plain === undefined || plain === null || plain === '') return '';
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return 'v1:' + b64u(iv) + ':' + b64u(c.getAuthTag()) + ':' + b64u(enc);
  }
  function decrypt(blob) {
    if (typeof blob !== 'string' || !blob.startsWith('v1:')) return '';
    try {
      const [, iv, tag, data] = blob.split(':');
      const d = crypto.createDecipheriv(
        'aes-256-gcm',
        encKey,
        Buffer.from(iv, 'base64url'),
      );
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        d.update(Buffer.from(data, 'base64url')),
        d.final(),
      ]).toString('utf8');
    } catch {
      return '';
    }
  }

  return { sign, unsign, encrypt, decrypt };
}

// Show only the tail of a secret in the UI.
function mask(s) {
  if (!s) return '';
  s = String(s);
  return s.length <= 6 ? '••••' : '••••' + s.slice(-4);
}

/* ---------- Twilio request signature (X-Twilio-Signature) ---------- */
function twilioSignature(authToken, url, params) {
  const data = Object.keys(params || {})
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(data, 'utf8'))
    .digest('base64');
}
function verifyTwilio(authToken, url, params, signature) {
  if (!authToken || !signature) return false;
  return safeEqual(twilioSignature(authToken, url, params), signature);
}

/* ---------- Twilio Voice SDK access token (JWT HS256, no SDK needed) ---------- */
function twilioAccessToken({
  accountSid,
  apiKeySid,
  apiKeySecret,
  identity,
  twimlAppSid,
  ttl,
}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' };
  const payload = {
    jti: apiKeySid + '-' + now,
    iss: apiKeySid,
    sub: accountSid,
    iat: now,
    nbf: now,
    exp: now + (ttl || 3600),
    grants: {
      identity,
      voice: {
        incoming: { allow: true },
        outgoing: twimlAppSid ? { application_sid: twimlAppSid } : undefined,
      },
    },
  };
  const part = (o) => b64u(JSON.stringify(o));
  const unsigned = part(header) + '.' + part(payload);
  return (
    unsigned +
    '.' +
    b64u(crypto.createHmac('sha256', apiKeySecret).update(unsigned).digest())
  );
}

/* ---------- tiny fixed-window rate limiter ---------- */
function rateLimiter(limit, windowMs) {
  const hits = new Map();
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs);
  if (t.unref) t.unref();
  return function (key) {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) {
      h = { n: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    h.n += 1;
    return h.n <= limit;
  };
}

/* ---------- HighLevel custom-page SSO (CryptoJS AES "Salted__") ---------- */
function decryptGhlSso(payload, key) {
  try {
    const raw = Buffer.from(String(payload || ''), 'base64');
    if (
      raw.length < 32 ||
      raw.subarray(0, 8).toString('latin1') !== 'Salted__' ||
      !key
    )
      return null;
    const salt = raw.subarray(8, 16);
    let d = Buffer.alloc(0),
      prev = Buffer.alloc(0);
    while (d.length < 48) {
      prev = crypto
        .createHash('md5')
        .update(Buffer.concat([prev, Buffer.from(key, 'utf8'), salt]))
        .digest();
      d = Buffer.concat([d, prev]);
    }
    const dec = crypto.createDecipheriv(
      'aes-256-cbc',
      d.subarray(0, 32),
      d.subarray(32, 48),
    );
    const obj = JSON.parse(
      Buffer.concat([dec.update(raw.subarray(16)), dec.final()]).toString(
        'utf8',
      ),
    );
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}
// Test helper: produce a payload in the same format.
function encryptGhlSso(obj, key) {
  const salt = crypto.randomBytes(8);
  let d = Buffer.alloc(0),
    prev = Buffer.alloc(0);
  while (d.length < 48) {
    prev = crypto
      .createHash('md5')
      .update(Buffer.concat([prev, Buffer.from(key, 'utf8'), salt]))
      .digest();
    d = Buffer.concat([d, prev]);
  }
  const c = crypto.createCipheriv(
    'aes-256-cbc',
    d.subarray(0, 32),
    d.subarray(32, 48),
  );
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([Buffer.from('Salted__', 'latin1'), salt, enc]).toString(
    'base64',
  );
}

module.exports = {
  createSecurity,
  randomToken,
  sha256,
  safeEqual,
  mask,
  rateLimiter,
  hashPassword,
  verifyPassword,
  twilioSignature,
  verifyTwilio,
  twilioAccessToken,
  decryptGhlSso,
  encryptGhlSso,
};
