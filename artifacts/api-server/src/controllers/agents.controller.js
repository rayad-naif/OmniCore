'use strict';

/**
 * agents.controller.js
 * GET    /api/agents           — list agents for tenant (admin only)
 * POST   /api/agents           — invite (create) agent  (admin only)
 * DELETE /api/agents/:id       — remove agent            (admin only)
 * PATCH  /api/agents/me        — update own profile      (any auth'd agent)
 *
 * Super-admin account is always excluded from listing and cannot be deleted
 * by any admin or agent.
 */

const { Router }   = require('express');
const bcrypt       = require('bcryptjs');
const crypto       = require('crypto');
const { pool }     = require('../lib/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger       = require('../utils/logger');
const { sendAgentInviteEmail } = require('../services/email.service');

const router = Router();
router.use(requireAuth);

const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();

// ─── GET /api/agents ──────────────────────────────────────────────────────────
router.get('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, is_active, created_at
       FROM agents
       WHERE tenant_id = $1
         AND ($2 = '' OR lower(email) != $2)
       ORDER BY created_at ASC`,
      [req.agent.tenantId, SUPER_ADMIN_EMAIL]
    );
    return res.json(rows);
  } catch (err) { next(err); }
});

// ─── POST /api/agents ─────────────────────────────────────────────────────────
// Invites (creates) an agent. The agent is created with a random throwaway
// password and emailed a "set your password" link (valid 7 days) via platform
// SMTP. The invite link is only returned in the response in non-production.
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { name, email, role = 'agent' } = req.body || {};
    if (!name?.trim() || !email?.trim()) {
      return res.status(400).json({ error: 'name and email are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await pool.query(
      'SELECT id FROM agents WHERE email = $1',
      [normalizedEmail]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    // Random throwaway password — the agent sets their own via the invite link.
    const randomPassword = crypto.randomBytes(24).toString('hex');
    const password_hash = await bcrypt.hash(randomPassword, 10);
    const { rows } = await pool.query(
      `INSERT INTO agents (tenant_id, name, email, role, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, name, email, role, is_active, created_at`,
      [req.agent.tenantId, name.trim(), normalizedEmail, role, password_hash]
    );
    const agent = rows[0];

    // Issue a set-password token (reusing the password reset table, 7-day expiry).
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO password_reset_tokens (agent_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [agent.id, rawToken, expiresAt]
    );

    // Build the invite link (set-password flow reuses the reset_token route).
    const appOrigin = process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
      : (req.headers['x-forwarded-proto'] ? `${req.headers['x-forwarded-proto']}://${req.headers.host}` : `http://${req.headers.host}`);
    const inviteLink = `${appOrigin}/dashboard/?reset_token=${rawToken}`;

    // Resolve the tenant's company name for a friendlier email.
    let companyName = '';
    try {
      const { rows: tRows } = await pool.query('SELECT company_name FROM tenants WHERE id = $1', [req.agent.tenantId]);
      companyName = tRows[0]?.company_name || '';
    } catch { /* non-fatal */ }

    const emailSent = await sendAgentInviteEmail({ to: agent.email, name: agent.name, inviteLink, companyName });

    logger.info({ agentId: agent.id, invitedBy: req.agent.id, emailSent }, 'agent_invited');
    return res.status(201).json({
      ...agent,
      email_sent: emailSent,
      // Only expose the link in non-production (dev convenience / no SMTP).
      ...(process.env.NODE_ENV !== 'production' && { invite_link: inviteLink }),
    });
  } catch (err) { next(err); }
});

// ─── DELETE /api/agents/:id ───────────────────────────────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    if (req.params.id === req.agent.id) {
      return res.status(400).json({ error: 'Cannot remove yourself' });
    }

    // Protect the superadmin account from deletion by any admin / agent
    if (SUPER_ADMIN_EMAIL) {
      const { rows: target } = await pool.query(
        'SELECT email FROM agents WHERE id = $1',
        [req.params.id]
      );
      if (target[0] && target[0].email.toLowerCase() === SUPER_ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Super admin cannot be deleted' });
      }
    }

    const { rowCount } = await pool.query(
      'DELETE FROM agents WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.agent.tenantId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Agent not found' });
    logger.info({ removedId: req.params.id, by: req.agent.id }, 'agent_removed');
    return res.status(204).end();
  } catch (err) { next(err); }
});

// ─── PATCH /api/agents/:id/password ───────────────────────────────────────────
// Admin sets a password directly for an agent in their own tenant. Used when the
// platform email service can't deliver invite / reset links. Tenant-scoped; the
// protected super-admin account can never be targeted by a tenant admin.
router.patch('/:id/password', requireRole('admin'), async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const { rows: target } = await pool.query(
      'SELECT id, email FROM agents WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.agent.tenantId]
    );
    if (!target.length) return res.status(404).json({ error: 'Agent not found' });

    if (SUPER_ADMIN_EMAIL && target[0].email.toLowerCase() === SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Super admin password cannot be changed here' });
    }

    const hash = await bcrypt.hash(String(password), 10);
    const { rows } = await pool.query(
      `UPDATE agents SET password_hash = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING id, name, email, role`,
      [hash, req.params.id, req.agent.tenantId]
    );
    logger.info({ agentId: req.params.id, by: req.agent.id }, 'agent_password_set_by_admin');
    return res.json({ ...rows[0], password_set: true });
  } catch (err) { next(err); }
});

// ─── PATCH /api/agents/me ─────────────────────────────────────────────────────
router.patch('/me', async (req, res, next) => {
  try {
    const { name, password } = req.body || {};
    if (!name?.trim() && !password) {
      return res.status(400).json({ error: 'Provide name or password to update' });
    }
    const updates = [];
    const values  = [];
    if (name?.trim()) {
      values.push(name.trim());
      updates.push(`name = $${values.length}`);
    }
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      const hash = await bcrypt.hash(password, 10);
      values.push(hash);
      updates.push(`password_hash = $${values.length}`);
    }
    values.push(req.agent.id);
    const { rows } = await pool.query(
      `UPDATE agents SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id, name, email, role`,
      values
    );
    return res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
