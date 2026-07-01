'use strict';

/**
 * auth.controller.js
 * POST /api/auth/login           → { accessToken, agent } + httpOnly refresh cookie
 * POST /api/auth/refresh         → { accessToken, agent }
 * POST /api/auth/logout          → clears cookie
 * POST /api/auth/forgot-password → generates reset token, returns link (or emails if SMTP set)
 * POST /api/auth/reset-password  → validates token, sets new password
 */

const { Router } = require('express');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const crypto     = require('crypto');
const { pool }   = require('../lib/db');
const logger     = require('../utils/logger');
const { sendPasswordResetEmail } = require('../services/email.service');
const { effectivePermissions } = require('../lib/permissions');

const router = Router();

const ACCESS_TTL  = '15m';
const REFRESH_TTL = '7d';
const COOKIE_NAME = 'omnicore_rt';

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path:     '/api/auth',
  maxAge:   7 * 24 * 60 * 60 * 1000,
};

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not configured');
  return s;
}

function signAccess(agent) {
  return jwt.sign(
    {
      tenantId:     agent.tenant_id,
      role:         agent.role,
      email:        agent.email,
      name:         agent.name,
      permissions:  agent.permissions_json || {},
      isSuperAdmin: !!(process.env.SUPER_ADMIN_EMAIL && agent.email === process.env.SUPER_ADMIN_EMAIL),
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
  const isSuperAdmin = !!(process.env.SUPER_ADMIN_EMAIL && row.email === process.env.SUPER_ADMIN_EMAIL);
  return {
    id:           row.id,
    tenantId:     row.tenant_id,
    role:         row.role,
    email:        row.email,
    name:         row.name,
    isSuperAdmin,
    // Effective (resolved) permissions for UI gating. Admins/super admins → full.
    permissions:  effectivePermissions({
      role: isSuperAdmin ? 'admin' : row.role,
      permissions: row.permissions_json || {},
    }),
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
      `SELECT id, tenant_id, name, email, role, password_hash, is_active, permissions_json
       FROM agents WHERE email = $1 LIMIT 1`,
      [email.trim().toLowerCase()]
    );

    const agent = rows[0];
    if (!agent) return res.status(401).json({ error: 'Invalid credentials' });
    if (!agent.is_active) return res.status(403).json({ error: 'Account is deactivated' });

    const valid = await bcrypt.compare(password, agent.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

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
      `SELECT id, tenant_id, name, email, role, is_active, permissions_json
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

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
// Works for agents, admins, and super admin. Finds the agent by email,
// creates a time-limited reset token (1 hour), and either:
//   • Sends a reset email via the tenant's SMTP config (if configured), OR
//   • Returns the reset link in the response body (dev/fallback mode).
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email?.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }

    const { rows } = await pool.query(
      `SELECT id, tenant_id, name, email FROM agents WHERE email = $1 AND is_active = TRUE LIMIT 1`,
      [email.trim().toLowerCase()]
    );

    // Always return 200 to avoid email enumeration
    if (!rows.length) {
      return res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
    }

    const agent = rows[0];

    // Expire any existing unused tokens for this agent
    await pool.query(
      `UPDATE password_reset_tokens SET used_at = NOW()
       WHERE agent_id = $1 AND used_at IS NULL`,
      [agent.id]
    );

    // Generate secure random token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `INSERT INTO password_reset_tokens (agent_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [agent.id, rawToken, expiresAt]
    );

    // Build reset link on the public domain (PUBLIC_APP_URL, then REPLIT_DOMAINS).
    const { publicAppUrl } = require('../lib/env');
    const appOrigin = publicAppUrl(req);
    const resetLink = `${appOrigin}/dashboard/?reset_token=${rawToken}`;

    // Send reset email via platform SMTP (falling back to tenant SMTP).
    const emailSent = await sendPasswordResetEmail(agent.tenant_id, agent.email, agent.name, resetLink);

    logger.info({ agentId: agent.id }, 'forgot_password_requested');

    return res.json({
      ok: true,
      message: emailSent
        ? 'Reset link sent to your email.'
        : 'If that email exists, a reset link has been sent.',
      // Only expose link in non-production (dev convenience)
      ...(process.env.NODE_ENV !== 'production' && { reset_link: resetLink }),
    });
  } catch (err) {
    logger.error({ err }, 'forgot_password_error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token?.trim() || !password) {
      return res.status(400).json({ error: 'token and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const { rows } = await pool.query(
      `SELECT prt.id, prt.agent_id, prt.expires_at, a.email, a.name, a.tenant_id
       FROM password_reset_tokens prt
       JOIN agents a ON a.id = prt.agent_id
       WHERE prt.token = $1 AND prt.used_at IS NULL`,
      [token.trim()]
    );

    if (!rows.length) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const row = rows[0];
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
    }

    const hash = await bcrypt.hash(password, 12);

    await pool.query(`UPDATE agents SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, row.agent_id]);
    await pool.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);

    logger.info({ agentId: row.agent_id }, 'password_reset_success');
    return res.json({ ok: true, message: 'Password updated. You can now sign in.' });
  } catch (err) {
    logger.error({ err }, 'reset_password_error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
