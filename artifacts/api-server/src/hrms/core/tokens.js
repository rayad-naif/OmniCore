'use strict';

/**
 * hrms/core/tokens.js
 * HR module tokens. Separate signing keys (derived from JWT_SECRET, or
 * HRMS_JWT_SECRET when set) so an HR token can never be used as an OmniCore
 * dashboard token or the other way round. Every token carries `tid`, the
 * workspace it belongs to.
 */

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

function secret(kind) {
  const root = process.env.HRMS_JWT_SECRET || process.env.JWT_SECRET;
  if (!root) throw new Error('JWT_SECRET is not set');
  return crypto
    .createHmac('sha256', root)
    .update(`omnicore-hrms:${kind}`)
    .digest('hex');
}

const ACCESS_TTL = () => process.env.HRMS_ACCESS_TOKEN_TTL || '12h';
const REFRESH_TTL = () => process.env.HRMS_REFRESH_TOKEN_TTL || '30d';

function signAccess(user, tenantId, extra = {}) {
  return jwt.sign(
    { id: String(user._id || user.id), role: user.role, tid: String(tenantId), ...extra },
    secret('access'),
    { expiresIn: ACCESS_TTL(), audience: 'omnicore-hrms' },
  );
}

function signRefresh(user, tenantId) {
  return jwt.sign(
    { id: String(user._id || user.id), tid: String(tenantId) },
    secret('refresh'),
    { expiresIn: REFRESH_TTL(), audience: 'omnicore-hrms-refresh' },
  );
}

function verifyAccess(token) {
  return jwt.verify(token, secret('access'), { audience: 'omnicore-hrms' });
}

function verifyRefresh(token) {
  return jwt.verify(token, secret('refresh'), {
    audience: 'omnicore-hrms-refresh',
  });
}

/** Reads (without trusting) the workspace id of an access token. */
function peekTenant(token) {
  try {
    return verifyAccess(token).tid || null;
  } catch {
    return null;
  }
}

/** HMAC used to sign file URLs (see core/storage.js). */
function fileSignature(value) {
  return crypto
    .createHmac('sha256', secret('files'))
    .update(String(value))
    .digest('base64url')
    .slice(0, 32);
}

module.exports = {
  signAccess,
  signRefresh,
  verifyAccess,
  verifyRefresh,
  peekTenant,
  fileSignature,
  ACCESS_TTL,
};
