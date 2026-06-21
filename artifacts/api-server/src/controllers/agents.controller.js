'use strict';

/**
 * agents.controller.js
 * GET    /api/agents           — list agents for tenant (admin only)
 * POST   /api/agents           — invite (create) agent  (admin only)
 * DELETE /api/agents/:id       — remove agent            (admin only)
 * PATCH  /api/agents/me        — update own profile      (any auth'd agent)
 */

const { Router }   = require('express');
const bcrypt       = require('bcryptjs');
const { pool }     = require('../lib/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger       = require('../utils/logger');

const router = Router();
router.use(requireAuth);

// ─── GET /api/agents ──────────────────────────────────────────────────────────
router.get('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, is_active, created_at
       FROM agents
       WHERE tenant_id = $1
       ORDER BY created_at ASC`,
      [req.agent.tenantId]
    );
    return res.json(rows);
  } catch (err) { next(err); }
});

// ─── POST /api/agents ─────────────────────────────────────────────────────────
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { name, email, role = 'agent', password = 'Welcome1!' } = req.body || {};
    if (!name?.trim() || !email?.trim()) {
      return res.status(400).json({ error: 'name and email are required' });
    }

    const existing = await pool.query(
      'SELECT id FROM agents WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO agents (tenant_id, name, email, role, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, name, email, role, is_active, created_at`,
      [req.agent.tenantId, name.trim(), email.trim().toLowerCase(), role, password_hash]
    );
    logger.info({ agentId: rows[0].id, invitedBy: req.agent.id }, 'agent_invited');
    return res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ─── DELETE /api/agents/:id ───────────────────────────────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    if (req.params.id === req.agent.id) {
      return res.status(400).json({ error: 'Cannot remove yourself' });
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
