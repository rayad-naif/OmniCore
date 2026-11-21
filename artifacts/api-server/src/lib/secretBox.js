'use strict';

/**
 * secretBox.js
 * AES-256-GCM encryption for secrets stored in the database (integration
 * tokens, webhook signing secrets, chat webhook URLs).
 *
 * Key: INTEGRATIONS_ENCRYPTION_KEY (64 hex chars = 32 bytes). When unset, a key
 * is derived from JWT_SECRET so development works out of the box — set a
 * dedicated key in production so rotating JWT_SECRET does not orphan secrets.
 *
 * Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>"
 */

const crypto = require('crypto');

function key() {
  const hex = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  const base = process.env.JWT_SECRET;
  if (!base)
    throw new Error('INTEGRATIONS_ENCRYPTION_KEY or JWT_SECRET must be set');
  return crypto
    .createHash('sha256')
    .update(`omnicore-integrations:${base}`)
    .digest();
}

function seal(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([
    cipher.update(String(plain), 'utf8'),
    cipher.final(),
  ]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

function open(sealed) {
  if (!sealed) return null;
  const [v, iv, tag, data] = String(sealed).split(':');
  if (v !== 'v1' || !iv || !tag || !data)
    throw new Error('Unsupported secret format');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function sealJson(obj) {
  return seal(JSON.stringify(obj ?? {}));
}

function openJson(sealed) {
  const s = open(sealed);
  return s ? JSON.parse(s) : {};
}

/** Shows only the last 4 characters, e.g. for webhook URLs or keys in the UI. */
function mask(value, visible = 4) {
  if (!value) return '';
  const s = String(value);
  return s.length <= visible ? '••••' : `••••${s.slice(-visible)}`;
}

module.exports = { seal, open, sealJson, openJson, mask };
