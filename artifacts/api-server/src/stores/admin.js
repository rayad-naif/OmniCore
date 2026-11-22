'use strict';

/**
 * stores/admin.js — /api/super-admin/stores (platform super admins).
 *
 *   GET    /hosts · POST /hosts {name, agent_url, secret, base_domain, cname_target, public_ip, capacity}
 *   PATCH  /hosts/:id · DELETE /hosts/:id · POST /hosts/:id/check
 *   GET    /all?q=                     every store on the platform
 *   POST   /:id/suspend · /:id/resume  pause or resume any hosted store
 */

const express = require('express');
const { requireAuth, isSuperAdminAgent } = require('../middleware/auth');
const { pool } = require('../lib/db');
const { seal } = require('../lib/secretBox');
const { ensureSchema } = require('./schema');
const agent = require('./agentClient');
const svc = require('./service');

const router = express.Router();
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const HOST =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

router.use(
  requireAuth,
  wrap(async (req, res, next) => {
    if (!(await isSuperAdminAgent(req.agent)))
      return res.status(403).json({ error: 'Forbidden — super admin only' });
    await ensureSchema();
    return next();
  }),
);

function hostShape(h) {
  return {
    id: h.id,
    name: h.name,
    agent_url: h.agent_url,
    base_domain: h.base_domain,
    cname_target: h.cname_target,
    public_ip: h.public_ip,
    capacity: h.capacity,
    active: h.active,
    used: h.used ?? undefined,
    last_seen_at: h.last_seen_at,
    last_health: h.last_health,
    created_at: h.created_at,
  };
}

function validateHost(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) {
    out.name = String(body.name || '')
      .trim()
      .slice(0, 80);
    if (!out.name)
      throw Object.assign(new Error('Name is required'), { status: 400 });
  }
  if (!partial || body.agent_url !== undefined) {
    let u;
    try {
      u = new URL(String(body.agent_url || ''));
    } catch {
      throw Object.assign(
        new Error(
          'Agent URL must be a full URL, e.g. https://agent.stores.example.com',
        ),
        { status: 400 },
      );
    }
    if (!['https:', 'http:'].includes(u.protocol))
      throw Object.assign(new Error('Agent URL must use https://'), {
        status: 400,
      });
    out.agent_url = u.toString().replace(/\/+$/, '');
  }
  if (!partial || body.base_domain !== undefined) {
    out.base_domain = String(body.base_domain || '')
      .trim()
      .toLowerCase();
    if (!HOST.test(out.base_domain))
      throw Object.assign(
        new Error('Store domain must look like stores.example.com'),
        { status: 400 },
      );
  }
  if (body.cname_target !== undefined) {
    out.cname_target =
      String(body.cname_target || '')
        .trim()
        .toLowerCase() || null;
    if (out.cname_target && !HOST.test(out.cname_target))
      throw Object.assign(new Error('CNAME target must be a host name'), {
        status: 400,
      });
  }
  if (body.public_ip !== undefined) {
    out.public_ip = String(body.public_ip || '').trim() || null;
    if (out.public_ip && !IPV4.test(out.public_ip))
      throw Object.assign(new Error('Public IP must be an IPv4 address'), {
        status: 400,
      });
  }
  if (body.capacity !== undefined) {
    out.capacity = Math.max(1, Math.min(1000, Number(body.capacity) || 40));
  }
  if (body.active !== undefined) out.active = Boolean(body.active);
  if (!partial || body.secret) {
    const secret = String(body.secret || '');
    if (secret.length < 32)
      throw Object.assign(
        new Error(
          'Agent secret must be at least 32 characters (AGENT_SECRET on the store server)',
        ),
        { status: 400 },
      );
    out.secret_sealed = seal(secret);
  }
  return out;
}

router.get(
  '/hosts',
  wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT h.*, (SELECT COUNT(*)::int FROM stores s WHERE s.host_id = h.id AND s.deleted_at IS NULL) AS used
         FROM store_hosts h ORDER BY h.created_at`,
    );
    res.json({
      hosts: rows.map(hostShape),
      cloudflare: require('./cloudflare').configured(),
    });
  }),
);

router.post(
  '/hosts',
  wrap(async (req, res) => {
    const v = validateHost(req.body || {});
    const health = await agent
      .call({ ...v, name: v.name }, 'GET', '/v1/health')
      .catch((err) => ({ ok: false, error: err.message }));
    const { rows } = await pool.query(
      `INSERT INTO store_hosts (name, agent_url, secret_sealed, base_domain, cname_target, public_ip, capacity, last_health, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, 40),$8, CASE WHEN $9 THEN NOW() END) RETURNING *`,
      [
        v.name,
        v.agent_url,
        v.secret_sealed,
        v.base_domain,
        v.cname_target ?? null,
        v.public_ip ?? null,
        v.capacity ?? null,
        JSON.stringify(health),
        Boolean(health.ok),
      ],
    );
    res.status(201).json({ host: hostShape(rows[0]), health });
  }),
);

router.patch(
  '/hosts/:id',
  wrap(async (req, res) => {
    const v = validateHost(req.body || {}, true);
    const keys = Object.keys(v);
    if (!keys.length)
      return res.status(400).json({ error: 'Nothing to update' });
    const { rows } = await pool.query(
      `UPDATE store_hosts SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, ...keys.map((k) => v[k])],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    return res.json({ host: hostShape(rows[0]) });
  }),
);

router.delete(
  '/hosts/:id',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM stores WHERE host_id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (rows[0].n)
      return res.status(409).json({
        error:
          'Move or delete the stores on this server first, or set it inactive.',
      });
    await pool.query(`DELETE FROM store_hosts WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true });
  }),
);

router.post(
  '/hosts/:id/check',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM store_hosts WHERE id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const health = await agent
      .call(rows[0], 'GET', '/v1/health')
      .catch((err) => ({ ok: false, error: err.message }));
    await pool.query(
      `UPDATE store_hosts SET last_health = $2, last_seen_at = CASE WHEN $3 THEN NOW() ELSE last_seen_at END WHERE id = $1`,
      [rows[0].id, JSON.stringify(health), Boolean(health.ok)],
    );
    return res.json({ health });
  }),
);

router.get(
  '/all',
  wrap(async (req, res) => {
    const q = String(req.query.q || '')
      .trim()
      .toLowerCase();
    const params = [];
    let where = 's.deleted_at IS NULL';
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (lower(s.name) LIKE $1 OR lower(coalesce(s.subdomain,'')) LIKE $1 OR lower(coalesce(s.custom_domain,'')) LIKE $1 OR lower(coalesce(s.site_url,'')) LIKE $1 OR lower(t.company_name) LIKE $1)`;
    }
    const { rows } = await pool.query(
      `SELECT s.id, s.kind, s.name, s.status, s.subdomain, s.custom_domain, s.domain_status, s.site_url, s.stats, s.error,
              s.created_at, t.company_name, h.name AS host_name
         FROM stores s JOIN tenants t ON t.id = s.tenant_id LEFT JOIN store_hosts h ON h.id = s.host_id
        WHERE ${where} ORDER BY s.created_at DESC LIMIT 500`,
      params,
    );
    res.json({ stores: rows });
  }),
);

for (const action of ['suspend', 'resume']) {
  router.post(
    `/:id/${action}`,
    wrap(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT tenant_id FROM stores WHERE id = $1 AND deleted_at IS NULL`,
        [req.params.id],
      );
      if (!rows[0]) return res.status(404).json({ error: 'Not found' });
      return res.json(
        await svc.suspendStore(rows[0].tenant_id, req.params.id, {
          resume: action === 'resume',
        }),
      );
    }),
  );
}

router.use((err, _req, res, next) => {
  if (err?.status) return res.status(err.status).json({ error: err.message });
  return next(err);
});

module.exports = router;
