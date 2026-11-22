'use strict';

/**
 * publicApi.js
 * Atelier OmniCore — Public REST API v1 (mounted at /api/v1).
 *
 * Auth: workspace API key from Integrations → REST API.
 *   Authorization: Bearer ock_…      (or)   X-API-Key: ock_…
 * Scopes: "read" for GET, "write" for POST/PATCH.
 * Rate limit: API_RATE_LIMIT_PER_MINUTE per key (default 120). Headers:
 *   X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After (on 429)
 *
 *   GET    /me                              workspace + key info
 *   GET    /brands
 *   GET    /agents
 *   GET    /conversations                   ?status=&brand_id=&is_ticket=&updated_since=&limit=&page=
 *   GET    /conversations/:id
 *   PATCH  /conversations/:id               { status?, priority?, assigned_agent_id? }
 *   GET    /conversations/:id/messages      ?limit=&page=
 *   POST   /conversations/:id/messages      { body, internal? }  (sent as an agent message / note)
 *   POST   /tickets                         { brand_id, email, name?, subject, description, priority? }
 *   GET    /contacts                        ?email=&q=&limit=&page=
 *   GET    /contacts/:id
 *   GET    /contacts/:id/conversations
 *
 *   Invoicing & payments (plans with that module):
 *   GET    /invoices                        ?kind=invoice|estimate&status=&q=&limit=
 *   GET    /invoices/:id
 *   POST   /invoices                        { customer_name, customer_email, line_items:[{description, quantity, unit_price (cents), taxable?, tax_rate?}], currency?, due_date?, send? }
 *   GET    /payments                        ?status=pending|succeeded&provider=
 *   POST   /payments/:id/confirm            confirm a pending manual payment (e.g. cash collected on delivery)
 *   POST   /payments/:id/reject
 */

const crypto = require('crypto');
const express = require('express');
const { pool } = require('../lib/db');
const { ensureIntegrationsSchema } = require('../lib/integrations/schema');

const router = express.Router();
const buckets = new Map();
const STATUSES = [
  'ai_handling',
  'open',
  'closed',
  'pending',
  'submitted',
  'in_progress',
  'waiting_on_customer',
  'resolved',
];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function paging(q, max = 100) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 25, 1), max);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}

function rateLimit(keyId) {
  const limit = parseInt(process.env.API_RATE_LIMIT_PER_MINUTE || '120', 10);
  const now = Date.now();
  const b = buckets.get(keyId) || { start: now, count: 0 };
  if (now - b.start >= 60_000) {
    b.start = now;
    b.count = 0;
  }
  b.count += 1;
  buckets.set(keyId, b);
  return {
    limit,
    remaining: Math.max(0, limit - b.count),
    retryAfter: Math.ceil((b.start + 60_000 - now) / 1000),
    ok: b.count <= limit,
  };
}

router.use(
  wrap(async (req, res, next) => {
    await ensureIntegrationsSchema();
    const header = req.headers.authorization || '';
    const raw = header.startsWith('Bearer ')
      ? header.slice(7).trim()
      : String(req.headers['x-api-key'] || '').trim();
    if (!raw.startsWith('ock_'))
      return res.status(401).json({ error: 'Missing API key' });
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const { rows } = await pool.query(
      `SELECT k.id, k.tenant_id, k.name, k.scopes, k.expires_at, k.revoked_at, t.company_name
         FROM api_keys k JOIN tenants t ON t.id = k.tenant_id WHERE k.key_hash = $1`,
      [hash],
    );
    const key = rows[0];
    if (
      !key ||
      key.revoked_at ||
      (key.expires_at && new Date(key.expires_at) < new Date())
    ) {
      return res
        .status(401)
        .json({ error: 'Invalid, revoked or expired API key' });
    }
    const rl = rateLimit(key.id);
    res.setHeader('X-RateLimit-Limit', rl.limit);
    res.setHeader('X-RateLimit-Remaining', rl.remaining);
    if (!rl.ok) {
      res.setHeader('Retry-After', rl.retryAfter);
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    const needed = req.method === 'GET' ? 'read' : 'write';
    if (!key.scopes.includes(needed))
      return res
        .status(403)
        .json({ error: `This key lacks the "${needed}" scope` });
    req.apiKey = {
      id: key.id,
      tenantId: key.tenant_id,
      name: key.name,
      scopes: key.scopes,
      company: key.company_name,
    };
    pool
      .query(
        `UPDATE api_keys SET last_used_at = NOW(), last_used_ip = $2 WHERE id = $1`,
        [key.id, req.ip],
      )
      .catch(() => {});
    next();
  }),
);

const T = (req) => req.apiKey.tenantId;

router.get('/me', (req, res) => {
  res.json({
    workspace: { id: req.apiKey.tenantId, name: req.apiKey.company },
    key: {
      id: req.apiKey.id,
      name: req.apiKey.name,
      scopes: req.apiKey.scopes,
    },
  });
});

router.get(
  '/brands',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, brand_name AS name, created_at FROM brands WHERE tenant_id = $1 ORDER BY created_at`,
      [T(req)],
    );
    res.json({ data: rows });
  }),
);

router.get(
  '/agents',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, is_active FROM agents WHERE tenant_id = $1 ORDER BY name`,
      [T(req)],
    );
    res.json({ data: rows });
  }),
);

const CONV_COLS = `c.id, c.brand_id, c.status, c.priority, c.channel, c.subject, c.is_ticket, c.ticket_number,
  c.csat_score, c.assigned_agent_id, c.visitor_id AS contact_id, v.display_name AS contact_name,
  v.email AS contact_email, c.created_at, c.updated_at`;

router.get(
  '/conversations',
  wrap(async (req, res) => {
    const { limit, offset, page } = paging(req.query);
    const where = ['c.tenant_id = $1'];
    const params = [T(req)];
    const add = (sql, v) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (req.query.status) add('c.status = ?', String(req.query.status));
    if (req.query.brand_id) add('c.brand_id = ?', String(req.query.brand_id));
    if (req.query.is_ticket !== undefined)
      add('c.is_ticket = ?', req.query.is_ticket === 'true');
    if (req.query.updated_since)
      add('c.updated_at >= ?', new Date(String(req.query.updated_since)));
    const { rows } = await pool.query(
      `SELECT ${CONV_COLS} FROM conversations c LEFT JOIN visitors v ON v.id = c.visitor_id
        WHERE ${where.join(' AND ')} ORDER BY c.updated_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json({ data: rows, page, limit });
  }),
);

async function convOr404(req, res) {
  const { rows } = await pool.query(
    `SELECT ${CONV_COLS} FROM conversations c LEFT JOIN visitors v ON v.id = c.visitor_id WHERE c.id = $1 AND c.tenant_id = $2`,
    [req.params.id, T(req)],
  );
  if (!rows[0]) res.status(404).json({ error: 'Conversation not found' });
  return rows[0];
}

router.get(
  '/conversations/:id',
  wrap(async (req, res) => {
    const c = await convOr404(req, res);
    if (c) res.json({ data: c });
  }),
);

router.patch(
  '/conversations/:id',
  wrap(async (req, res) => {
    const { status, priority, assigned_agent_id } = req.body || {};
    if (status && !STATUSES.includes(status))
      return res
        .status(400)
        .json({ error: `status must be one of ${STATUSES.join(', ')}` });
    if (priority && !PRIORITIES.includes(priority))
      return res
        .status(400)
        .json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
    if (assigned_agent_id) {
      const { rows } = await pool.query(
        `SELECT 1 FROM agents WHERE id = $1 AND tenant_id = $2`,
        [assigned_agent_id, T(req)],
      );
      if (!rows[0]) return res.status(400).json({ error: 'Unknown agent' });
    }
    const { rowCount } = await pool.query(
      `UPDATE conversations SET status = COALESCE($3, status), priority = COALESCE($4, priority),
         assigned_agent_id = CASE WHEN $5::boolean THEN $6::uuid ELSE assigned_agent_id END, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [
        req.params.id,
        T(req),
        status || null,
        priority || null,
        assigned_agent_id !== undefined,
        assigned_agent_id || null,
      ],
    );
    if (!rowCount)
      return res.status(404).json({ error: 'Conversation not found' });
    const c = await convOr404(req, res);
    if (c) res.json({ data: c });
  }),
);

router.get(
  '/conversations/:id/messages',
  wrap(async (req, res) => {
    if (!(await convOr404(req, res))) return;
    const { limit, offset, page } = paging(req.query, 200);
    const { rows } = await pool.query(
      `SELECT id, sender_type, sender_id, message_body AS body, is_internal_note, attachments_json AS attachments, created_at
         FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT ${limit} OFFSET ${offset}`,
      [req.params.id],
    );
    res.json({ data: rows, page, limit });
  }),
);

router.post(
  '/conversations/:id/messages',
  wrap(async (req, res) => {
    const { body, internal } = req.body || {};
    if (!body || !String(body).trim())
      return res.status(400).json({ error: 'body is required' });
    if (!(await convOr404(req, res))) return;
    const { rows } = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, message_body, is_internal_note)
       VALUES ($1, 'agent', $2, $3)
       RETURNING id, sender_type, message_body AS body, is_internal_note, created_at`,
      [req.params.id, String(body).slice(0, 20000), Boolean(internal)],
    );
    await pool.query(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      [req.params.id],
    );
    // Push to open dashboards and (for non-internal, non-ticket chats) the visitor's widget.
    const {
      broadcastToConversation,
      broadcastToVisitor,
    } = require('../services/socket.service');
    const live = {
      ...rows[0],
      message_body: rows[0].body,
      conversation_id: req.params.id,
    };
    broadcastToConversation(req.params.id, 'server:new_message', live);
    const { rows: cv } = await pool.query(
      `SELECT visitor_id, is_ticket FROM conversations WHERE id = $1`,
      [req.params.id],
    );
    if (!internal && cv[0]?.visitor_id && !cv[0].is_ticket) {
      broadcastToVisitor(cv[0].visitor_id, 'server:new_message', live);
    }
    res.status(201).json({ data: rows[0] });
  }),
);

router.post(
  '/tickets',
  wrap(async (req, res) => {
    const {
      brand_id,
      email,
      name,
      subject,
      description,
      priority = 'normal',
    } = req.body || {};
    if (!brand_id || !email || !subject)
      return res
        .status(400)
        .json({ error: 'brand_id, email and subject are required' });
    if (!PRIORITIES.includes(priority))
      return res
        .status(400)
        .json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
    const { rows: b } = await pool.query(
      `SELECT id FROM brands WHERE id = $1 AND tenant_id = $2`,
      [brand_id, T(req)],
    );
    if (!b[0]) return res.status(400).json({ error: 'Unknown brand' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let { rows: v } = await client.query(
        `SELECT id FROM visitors WHERE tenant_id = $1 AND lower(email) = lower($2) ORDER BY created_at LIMIT 1`,
        [T(req), email],
      );
      if (!v[0]) {
        ({ rows: v } = await client.query(
          `INSERT INTO visitors (tenant_id, brand_id, session_token, display_name, email) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [
            T(req),
            brand_id,
            `api_${crypto.randomBytes(24).toString('hex')}`,
            name || null,
            email,
          ],
        ));
      }
      const { rows: n } = await client.query(
        `SELECT nextval('conversations_ticket_number_seq') AS next`,
      );
      const { rows: c } = await client.query(
        `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel, subject, priority, is_ticket, ticket_number)
         VALUES ($1,$2,$3,'open','api',$4,$5,TRUE,$6) RETURNING id, ticket_number`,
        [
          T(req),
          brand_id,
          v[0].id,
          String(subject).slice(0, 300),
          priority,
          n[0].next,
        ],
      );
      if (description) {
        await client.query(
          `INSERT INTO messages (conversation_id, sender_type, message_body) VALUES ($1, 'visitor', $2)`,
          [c[0].id, String(description).slice(0, 20000)],
        );
      }
      await client.query('COMMIT');
      res.status(201).json({
        data: {
          id: c[0].id,
          ticket_number: c[0].ticket_number,
          contact_id: v[0].id,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }),
);

router.get(
  '/contacts',
  wrap(async (req, res) => {
    const { limit, offset, page } = paging(req.query);
    const params = [T(req)];
    let where = 'tenant_id = $1';
    if (req.query.email) {
      params.push(String(req.query.email));
      where += ` AND lower(email) = lower($${params.length})`;
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q)}%`);
      where += ` AND (display_name ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT id, display_name AS name, email, brand_id, timezone, location_city AS city, last_seen_at, created_at
         FROM visitors WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json({ data: rows, page, limit });
  }),
);

router.get(
  '/contacts/:id',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, display_name AS name, email, brand_id, timezone, location_city AS city, last_seen_at, created_at
         FROM visitors WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, T(req)],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Contact not found' });
    res.json({ data: rows[0] });
  }),
);

router.get(
  '/contacts/:id/conversations',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${CONV_COLS} FROM conversations c LEFT JOIN visitors v ON v.id = c.visitor_id
        WHERE c.visitor_id = $1 AND c.tenant_id = $2 ORDER BY c.created_at DESC LIMIT 100`,
      [req.params.id, T(req)],
    );
    res.json({ data: rows });
  }),
);

// ── Invoicing & payments ─────────────────────────────────────────────────────
const paySvc = require('../payments/service');

const payGate = wrap(async (req, res, next) => {
  const ws = await paySvc.workspace(T(req));
  if (!ws?.enabled) {
    return res.status(403).json({
      error: "Invoicing & payments is not included in this workspace's plan",
    });
  }
  return next();
});

const payError = (fn) =>
  wrap(async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (err instanceof paySvc.PayError || err?.statusCode) {
        return res
          .status(err.status || err.statusCode || 400)
          .json({ error: err.message });
      }
      throw err;
    }
  });

router.get(
  '/invoices',
  payGate,
  payError(async (req, res) => {
    const kind = req.query.kind === 'estimate' ? 'estimate' : 'invoice';
    res.json({
      data: await paySvc.listDocuments(T(req), {
        kind,
        status: req.query.status,
        q: req.query.q,
        limit: req.query.limit,
      }),
    });
  }),
);

router.get(
  '/invoices/:id',
  payGate,
  payError(async (req, res) => {
    const doc = await paySvc.getDocument(T(req), req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  }),
);

router.post(
  '/invoices',
  payGate,
  payError(async (req, res) => {
    const kind = req.body?.kind === 'estimate' ? 'estimate' : 'invoice';
    let doc = await paySvc.createDocument(T(req), req.body || {}, {
      kind,
      by: `api:${req.apiKey.name}`,
    });
    if (req.body?.send) doc = await paySvc.sendDocument(T(req), doc.id, {});
    res.status(201).json(doc);
  }),
);

router.get(
  '/payments',
  payGate,
  payError(async (req, res) => {
    res.json({
      data: await paySvc.listTransactions(T(req), {
        status: req.query.status,
        provider: req.query.provider,
        limit: req.query.limit,
      }),
    });
  }),
);

router.post(
  '/payments/:id/confirm',
  payGate,
  payError(async (req, res) => {
    res.json(
      await paySvc.confirmPending(
        T(req),
        req.params.id,
        `api:${req.apiKey.name}`,
      ),
    );
  }),
);

router.post(
  '/payments/:id/reject',
  payGate,
  payError(async (req, res) => {
    res.json(
      await paySvc.rejectPending(
        T(req),
        req.params.id,
        `api:${req.apiKey.name}`,
      ),
    );
  }),
);

router.use((req, res) =>
  res.status(404).json({ error: 'Unknown API endpoint' }),
);

module.exports = router;
