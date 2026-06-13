'use strict';

/**
 * auth.js
 * Atelier OmniCore — Shared Express auth middleware
 *
 * requireAuth(req, res, next)
 *   Verifies the Bearer JWT in Authorization header.
 *   Sets req.agent = { id, tenantId, role, email, name } on success.
 *
 * requireRole(...roles)
 *   Factory — returns middleware that passes only if req.agent.role is in the set.
 *   Must be placed after requireAuth.
 */

const jwt    = require('jsonwebtoken');
const logger = require('../utils/logger');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token  = header.slice(7);
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    logger.error('JWT_SECRET is not configured');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  try {
    const payload = jwt.verify(token, secret);
    req.agent = {
      id:       payload.sub,
      tenantId: payload.tenantId,
      role:     payload.role,
      email:    payload.email,
      name:     payload.name,
    };
    next();
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
    return res.status(401).json({ error: code });
  }
}

function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.agent) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!roles.includes(req.agent.role)) {
      return res.status(403).json({
        error: `Forbidden — requires one of: ${roles.join(', ')}`,
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
