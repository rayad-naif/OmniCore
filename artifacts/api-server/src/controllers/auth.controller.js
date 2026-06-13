'use strict';

/**
 * auth.controller.js
 * Atelier OmniCore — Agent authentication
 *
 * POST /api/auth/login    → { accessToken, agent }  +  httpOnly refresh cookie
 * POST /api/auth/refresh  → { accessToken, agent }     (reads refresh cookie)
 * POST /api/auth/logout   → clears cookie
 *
 * Token design:
 *  Access token  — JWT, 15 min,  in-memory on client
 *  Refresh token — JWT, 7 days,  httpOnly cookie  "omnicore_rt"
 */

const { Router } = require('express');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const { pool }   = require('../lib/db');
const logger     = require('../utils/logger');

const router = Router();

const ACCESS_TTL  = '15m';
const REFRESH_TTL = '7d';
const COOKIE_NAME = 'omnicore_rt';

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path:     '/api/auth',
  maxAge:   7 * 24 * 60 * 60 * 1000,   // 7 days ms
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not configured');
  return s;
}

function signAccess(agent) {
  return jwt.sign(
    {
      tenantId: agent.tenant_id,
      role:     agent.role,
      email:    agent.email,
      name:     agent.name,
    },
    getSecret(),
    { subject: String(agent.id), expiresIn: ACCESS_TTL }
  );
}

function signRefresh(agentId, tenantId) {
  return jwt.sign(
    { tenantId, type: 'refresh' },
    getSecret(),
    { subject: String(agentId), expiresIn: REFRESH_TTL }
  );
}

function safeAgent(row) {
  return {
    id:       row.id,
    tenantId: row.tenant_id,
    role:     row.role,
    email:    row.email,
    name:     row.name,
  };
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email?.trim() || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const { rows } = await pool.query(
      `SELECT id, tenant_id, name, email, role, password_hash, is_active
       FROM agents WHERE email = $1 LIMIT 1`,
      [email.trim().toLowerCase()]
    );

    const agent = rows[0];
    if (!agent) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!agent.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    const valid = await bcrypt.compare(password, agent.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken  = signAccess(agent);
    const refreshToken = signRefresh(agent.id, agent.tenant_id);

    res.cookie(COOKIE_NAME, refreshToken, COOKIE_OPTS);
    logger.info({ agentId: agent.id, tenantId: agent.tenant_id }, 'agent_login');

    return res.json({ accessToken, agent: safeAgent(agent) });
  } catch (err) {
    logger.error({ err }, 'login_error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'No refresh token' });

    let payload;
    try {
      payload = jwt.verify(token, getSecret());
    } catch {
      res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 });
      return res.status(401).json({ error: 'Refresh token expired or invalid' });
    }

    if (payload.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const { rows } = await pool.query(
      `SELECT id, tenant_id, name, email, role, is_active
       FROM agents WHERE id = $1 LIMIT 1`,
      [payload.sub]
    );

    const agent = rows[0];
    if (!agent || !agent.is_active) {
      res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 });
      return res.status(401).json({ error: 'Agent not found or deactivated' });
    }

    const accessToken  = signAccess(agent);
    const refreshToken = signRefresh(agent.id, agent.tenant_id);

    // Rotate refresh token
    res.cookie(COOKIE_NAME, refreshToken, COOKIE_OPTS);

    return res.json({ accessToken, agent: safeAgent(agent) });
  } catch (err) {
    logger.error({ err }, 'refresh_error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 });
  return res.status(200).json({ ok: true });
});

module.exports = router;
