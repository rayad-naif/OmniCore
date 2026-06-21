'use strict';

const { Router } = require('express');
const bcrypt     = require('bcryptjs');
const { pool }   = require('../lib/db');

const router = Router();

/**
 * POST /api/auth/signup
 * Body: { companyName, adminName, adminEmail, password }
 */
router.post('/', async (req, res, next) => {
  const { companyName, adminName, adminEmail, password } = req.body || {};

  if (!companyName || !adminName || !adminEmail || !password) {
    return res.status(400).json({
      error: 'companyName, adminName, adminEmail, and password are required',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [tenant] } = await client.query(
      `INSERT INTO tenants (tenant_name, plan, plan_status)
       VALUES ($1, 'free', 'active')
       RETURNING id`,
      [companyName],
    );

    const passwordHash = await bcrypt.hash(password, 12);

    await client.query(
      `INSERT INTO agents (tenant_id, name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, 'admin', TRUE)`,
      [tenant.id, adminName, adminEmail, passwordHash],
    );

    await client.query('COMMIT');
    return res.status(201).json({ tenantId: tenant.id, success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
