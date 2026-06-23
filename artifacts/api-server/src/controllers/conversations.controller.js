'use strict';

/**
 * conversations.controller.js
 * Atelier OmniCore — Conversations + Messages + Export + CSAT
 *
 * GET    /api/conversations                        list (paginated, tenant-scoped, RBAC, filtered)
 * GET    /api/conversations/csat                   CSAT report per agent
 * GET    /api/conversations/:id                    single conversation
 * PATCH  /api/conversations/:id                    update status / priority / assignment / is_ticket
 * GET    /api/conversations/:id/messages           message history
 * POST   /api/conversations/:id/messages           agent sends a message
 * PATCH  /api/conversations/:id/messages/:msgId   edit message
 * DELETE /api/conversations/:id/messages/:msgId   delete message
 * GET    /api/conversations/:id/visitor-history    other conversations by same visitor
 * GET    /api/conversations/:id/export             PDF → R2 presigned URL
 */

const { Router }                = require('express');
const { requireAuth }           = require('../middleware/auth');
const { pool }                  = require('../lib/db');
const { handleExportRequest }   = require('../services/export.service');
const { sendStatusChangeEmail, sendAgentReplyEmail } = require('../services/email.service');
const { broadcastToConversation, broadcastToTenant } = require('../services/socket.service');
const logger                    = require('../utils/logger');
const crypto                    = require('crypto');
const fs                        = require('fs');
const path                      = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch(e) {}

const router = Router();
router.use(requireAuth);

// ─── One-time migrations ───────────────────────────────────────────────────────
pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_ticket BOOLEAN NOT NULL DEFAULT false`)
  .catch(err => { if (!err.message?.includes('already exists')) logger.warn({ err: err.message }, 'is_ticket_migration_warning'); });

pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`)
  .catch(() => {});

// Extend the status check constraint to include ticket statuses
pool.query(`
  ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_status_check;
  ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
    CHECK (status IN ('ai_handling','open','closed','pending','submitted','in_progress','waiting_on_customer','resolved'));
`).catch(err => logger.warn({ err: err.message }, 'status_constraint_migration_warning'));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const PAGE_LIMIT = 50;
function tenantId(req) { return req.agent.tenantId; }

// ─── POST /api/conversations/upload — authenticated file upload for agents ────
router.post('/upload', async (req, res, next) => {
  try {
    const { filename, mimeType, data } = req.body || {};
    if (!filename || !data) return res.status(400).json({ error: 'filename and data are required' });
    const buffer   = Buffer.from(data, 'base64');
    const ext      = path.extname(filename) || '';
    const safeName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const filePath = path.join(UPLOADS_DIR, safeName);
    fs.writeFileSync(filePath, buffer);
    logger.info({ filename, size: buffer.length, agentId: req.agent?.id }, 'agent_file_uploaded');
    return res.json({ url: `/api/widget/files/${safeName}`, name: filename, type: mimeType });
  } catch (err) { next(err); }
});

// ─── GET /api/conversations/csat ─────────────────────────────────────────────
router.get('/csat', async (req, res, next) => {
  try {
    const tid         = tenantId(req);
    const { brand_id, date_from, date_to } = req.query;

    const conditions = ['a.tenant_id = $1'];
    const values     = [tid];
    let i = 2;

    const cConditions = ['c.tenant_id = $1'];
    if (brand_id) { cConditions.push(`c.brand_id = $${i}`); conditions.push(`(c.brand_id IS NULL OR c.brand_id = $${i})`); values.push(brand_id); i++; }
    if (date_from) { cConditions.push(`c.updated_at >= $${i}`); values.push(date_from); i++; }
    if (date_to)   { cConditions.push(`c.updated_at <= $${i}`); values.push(date_to);   i++; }

    const cWhere = cConditions.join(' AND ');

    const { rows } = await pool.query(`
      SELECT
        a.id                                                                          AS agent_id,
        a.name                                                                        AS agent_name,
        a.email                                                                       AS agent_email,
        COUNT(DISTINCT c.id)::int                                                     AS total_assigned,
        COUNT(DISTINCT c.id) FILTER (WHERE c.status IN ('closed','resolved'))::int    AS closed_count,
        ROUND(AVG(c.csat_score) FILTER (WHERE c.csat_score IS NOT NULL), 2)           AS avg_csat_score,
        COUNT(c.id) FILTER (WHERE c.csat_score >= 4)::int                             AS positive_ratings,
        COUNT(c.id) FILTER (WHERE c.csat_score = 5)::int                              AS five_star,
        COUNT(c.id) FILTER (WHERE c.csat_score = 4)::int                              AS four_star,
        COUNT(c.id) FILTER (WHERE c.csat_score = 3)::int                              AS three_star,
        COUNT(c.id) FILTER (WHERE c.csat_score = 2)::int                              AS two_star,
        COUNT(c.id) FILTER (WHERE c.csat_score = 1)::int                              AS one_star,
        COUNT(c.id) FILTER (WHERE c.csat_score IS NOT NULL)::int                      AS rated_count,
        ROUND(
          EXTRACT(EPOCH FROM AVG(
            (SELECT MIN(m.created_at) FROM messages m WHERE m.conversation_id = c.id AND m.sender_type = 'agent') - c.created_at
          )) / 60, 1
        )                                                                             AS avg_first_response_minutes,
        COUNT(DISTINCT CASE WHEN DATE(c.updated_at) = CURRENT_DATE AND c.status IN ('closed','resolved') THEN c.id END)::int AS closed_today,
        (SELECT COUNT(DISTINCT mp.conversation_id)
           FROM messages mp
           JOIN conversations cp ON cp.id = mp.conversation_id
           WHERE mp.sender_id = a.id AND mp.sender_type = 'agent'
             AND DATE(mp.created_at) = CURRENT_DATE
             AND cp.tenant_id = a.tenant_id
        )::int                                                                        AS participated_today
      FROM agents a
      LEFT JOIN conversations c ON c.assigned_agent_id = a.id AND ${cWhere}
      WHERE a.tenant_id = $1 AND a.is_active = true
      GROUP BY a.id, a.name, a.email
      ORDER BY avg_csat_score DESC NULLS LAST, total_assigned DESC
    `, values);

    return res.json(rows);
  } catch (err) { next(err); }
});

// ─── GET /api/conversations ───────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const tid      = tenantId(req);
    const { status, is_ticket, brand_id, agent_id, rating, search, date_from, date_to, page: pageQ, limit: limitQ } = req.query;
    const page     = Math.max(1, parseInt(pageQ) || 1);
    const limit    = Math.min(100, parseInt(limitQ) || PAGE_LIMIT);
    const offset   = (page - 1) * limit;

    const conditions = ['c.tenant_id = $1'];
    const values     = [tid];
    let i = 2;

    if (req.agent.role === 'agent') {
      conditions.push(`(c.assigned_agent_id = $${i} OR c.assigned_agent_id IS NULL)`);
      values.push(req.agent.id); i++;
    }
    if (status)    { conditions.push(`c.status = $${i}`);            values.push(status); i++; }
    if (brand_id)  { conditions.push(`c.brand_id = $${i}`);          values.push(brand_id); i++; }
    if (agent_id)  { conditions.push(`c.assigned_agent_id = $${i}`); values.push(agent_id); i++; }
    if (rating)    { conditions.push(`c.csat_score = $${i}`);        values.push(parseInt(rating, 10)); i++; }
    if (date_from) { conditions.push(`c.updated_at >= $${i}`);       values.push(date_from); i++; }
    if (date_to)   { conditions.push(`c.updated_at <= $${i}`);       values.push(date_to); i++; }
    if (search) {
      const q = `%${search}%`;
      conditions.push(`(
        v.email ILIKE $${i} OR v.display_name ILIKE $${i} OR
        c.subject ILIKE $${i} OR
        EXISTS(SELECT 1 FROM messages m2 WHERE m2.conversation_id = c.id AND m2.message_body ILIKE $${i})
      )`);
      values.push(q); i++;
    }
    if (is_ticket === 'true')  conditions.push(`c.is_ticket = true`);
    else if (is_ticket === 'false') conditions.push(`c.is_ticket = false`);

    const where = conditions.join(' AND ');

    const [{ rows: conversations }, { rows: countRow }] = await Promise.all([
      pool.query(
        `SELECT
           c.id, c.status, c.channel, c.priority, c.subject,
           c.created_at, c.updated_at, c.sla_breach_at,
           c.assigned_agent_id, c.is_ticket, c.visitor_id,
           c.csat_score, c.brand_id,
           v.email                                          AS visitor_email,
           COALESCE(v.display_name, v.email, 'Visitor')    AS visitor_name,
           a.name                                           AS agent_name,
           b.brand_name
         FROM conversations c
         LEFT JOIN visitors v ON v.id = c.visitor_id
         LEFT JOIN agents   a ON a.id = c.assigned_agent_id
         LEFT JOIN brands   b ON b.id = c.brand_id
         WHERE ${where}
         ORDER BY c.updated_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        [...values, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM conversations c LEFT JOIN visitors v ON v.id = c.visitor_id WHERE ${where}`, values),
    ]);

    const total = parseInt(countRow[0].count, 10);
    return res.json({
      conversations,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

// ─── GET /api/conversations/:id ───────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         c.*,
         v.email                                          AS visitor_email,
         COALESCE(v.display_name, v.email, 'Visitor')    AS visitor_name,
         a.name                                           AS agent_name,
         b.brand_name
       FROM conversations c
       LEFT JOIN visitors v ON v.id = c.visitor_id
       LEFT JOIN agents   a ON a.id = c.assigned_agent_id
       LEFT JOIN brands   b ON b.id = c.brand_id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [req.params.id, tenantId(req)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Conversation not found' });
    return res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── PATCH /api/conversations/:id ─────────────────────────────────────────────
router.patch('/:id', async (req, res, next) => {
  try {
    const ALLOWED = ['status', 'priority', 'assigned_agent_id', 'subject', 'is_ticket', 'csat_score'];
    const fields  = Object.keys(req.body).filter(k => ALLOWED.includes(k));
    if (!fields.length) return res.status(400).json({ error: 'No valid fields provided' });

    const { rows: beforeRows } = await pool.query(
      `SELECT status, visitor_id, assigned_agent_id FROM conversations WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId(req)]
    );
    if (!beforeRows[0]) return res.status(404).json({ error: 'Conversation not found' });
    const { status: oldStatus, visitor_id: oldVisitorId, assigned_agent_id: oldAgentId } = beforeRows[0];

    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values     = fields.map(f => { const v = req.body[f]; return (v === '' || v === undefined) ? null : v; });
    values.push(req.params.id, tenantId(req));

    const { rows } = await pool.query(
      `UPDATE conversations SET ${setClauses}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
       RETURNING id, status, priority, assigned_agent_id, is_ticket, csat_score, updated_at`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'Conversation not found' });
    logger.info({ conversationId: req.params.id, fields }, 'conversation_patched');

    const newStatus = rows[0].status;
    if (fields.includes('status') && newStatus !== oldStatus) {
      pool.query(`SELECT email FROM visitors WHERE id = $1`, [oldVisitorId])
        .then(({ rows: vRows }) => sendStatusChangeEmail(tenantId(req), req.params.id, oldStatus, newStatus, vRows[0]?.email))
        .catch(() => {});
    }

    const newAgentId = rows[0].assigned_agent_id;
    if (fields.includes('assigned_agent_id') && String(newAgentId) !== String(oldAgentId)) {
      let agentName = null;
      if (newAgentId) {
        const { rows: agRows } = await pool.query('SELECT name FROM agents WHERE id = $1', [newAgentId]);
        agentName = agRows[0]?.name ?? null;
      }
      broadcastToTenant(tenantId(req), 'conversation:assigned', { conversationId: req.params.id, agentId: newAgentId, agentName });
    }

    return res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── GET /api/conversations/:id/messages ─────────────────────────────────────
router.get('/:id/messages', async (req, res, next) => {
  try {
    const { rows: convRows } = await pool.query(
      'SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2',
      [req.params.id, tenantId(req)]
    );
    if (!convRows[0]) return res.status(404).json({ error: 'Conversation not found' });

    const { rows: messages } = await pool.query(
      `SELECT
         m.id, m.conversation_id, m.sender_type, m.message_body,
         m.is_internal_note, m.attachments_json, m.created_at,
         COALESCE(ag.name, vis.display_name, vis.email, m.sender_type) AS sender_name
       FROM messages m
       LEFT JOIN agents   ag  ON (m.sender_type IN ('agent','bot') AND ag.id  = m.sender_id)
       LEFT JOIN visitors vis ON (m.sender_type = 'visitor'         AND vis.id = m.sender_id)
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [req.params.id]
    );
    return res.json(messages);
  } catch (err) { next(err); }
});

// ─── POST /api/conversations/:id/messages ────────────────────────────────────
router.post('/:id/messages', async (req, res, next) => {
  try {
    const { body: messageBody, isInternalNote = false } = req.body || {};
    if (!messageBody?.trim()) return res.status(400).json({ error: 'message body is required' });

    const { rows: convRows } = await pool.query(
      `SELECT id, status, tenant_id FROM conversations WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId(req)]
    );
    if (!convRows[0]) return res.status(404).json({ error: 'Conversation not found' });
    if (convRows[0].status === 'closed') return res.status(409).json({ error: 'Conversation is closed' });

    const { rows: newMsg } = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, message_body, is_internal_note)
       VALUES ($1, 'agent', $2, $3, $4)
       RETURNING id, conversation_id, sender_type, message_body, is_internal_note, created_at`,
      [req.params.id, req.agent.id, messageBody.trim(), Boolean(isInternalNote)]
    );

    const agentRow = await pool.query('SELECT name FROM agents WHERE id = $1', [req.agent.id]);
    const result   = { ...newMsg[0], sender_name: agentRow.rows[0]?.name ?? 'Agent' };

    await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [req.params.id]);
    broadcastToConversation(req.params.id, 'server:new_message', result);
    logger.info({ conversationId: req.params.id, agentId: req.agent.id }, 'agent_message_sent');

    // Non-blocking: email visitor when agent replies (not for internal notes)
    if (!Boolean(isInternalNote)) {
      pool.query(
        `SELECT v.email FROM conversations c JOIN visitors v ON v.id = c.visitor_id WHERE c.id = $1`,
        [req.params.id]
      ).then(({ rows: vr }) => {
        if (vr[0]?.email) {
          sendAgentReplyEmail(req.agent.tenantId, req.params.id, result.sender_name, messageBody, vr[0].email)
            .catch(() => {});
        }
      }).catch(() => {});
    }

    return res.status(201).json(result);
  } catch (err) { next(err); }
});

// ─── PATCH /api/conversations/:id/messages/:msgId ────────────────────────────
router.patch('/:id/messages/:msgId', async (req, res, next) => {
  try {
    const { body: newBody } = req.body || {};
    if (!newBody?.trim()) return res.status(400).json({ error: 'body is required' });

    const { rows: msgRows } = await pool.query(
      `SELECT m.id, m.sender_id FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = $1 AND m.conversation_id = $2 AND c.tenant_id = $3`,
      [req.params.msgId, req.params.id, tenantId(req)]
    );
    if (!msgRows[0]) return res.status(404).json({ error: 'Message not found' });
    if (req.agent.role !== 'admin' && msgRows[0].sender_id !== req.agent.id) {
      return res.status(403).json({ error: 'Not authorized to edit this message' });
    }

    const { rows } = await pool.query(
      `UPDATE messages SET message_body = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, conversation_id, sender_type, message_body, is_internal_note, created_at`,
      [newBody.trim(), req.params.msgId]
    );
    broadcastToConversation(req.params.id, 'server:message_updated', rows[0]);
    return res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── DELETE /api/conversations/:id/messages/:msgId ───────────────────────────
router.delete('/:id/messages/:msgId', async (req, res, next) => {
  try {
    const { rows: msgRows } = await pool.query(
      `SELECT m.id, m.sender_id FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = $1 AND m.conversation_id = $2 AND c.tenant_id = $3`,
      [req.params.msgId, req.params.id, tenantId(req)]
    );
    if (!msgRows[0]) return res.status(404).json({ error: 'Message not found' });
    if (req.agent.role !== 'admin' && msgRows[0].sender_id !== req.agent.id) {
      return res.status(403).json({ error: 'Not authorized to delete this message' });
    }
    await pool.query('DELETE FROM messages WHERE id = $1', [req.params.msgId]);
    broadcastToConversation(req.params.id, 'server:message_deleted', { id: req.params.msgId, conversation_id: req.params.id });
    return res.status(204).end();
  } catch (err) { next(err); }
});

// ─── GET /api/conversations/:id/visitor-history ───────────────────────────────
router.get('/:id/visitor-history', async (req, res, next) => {
  try {
    const { rows: convRows } = await pool.query(
      'SELECT visitor_id FROM conversations WHERE id = $1 AND tenant_id = $2',
      [req.params.id, tenantId(req)]
    );
    if (!convRows[0]) return res.status(404).json({ error: 'Conversation not found' });
    const visitorId = convRows[0].visitor_id;
    if (!visitorId) return res.json([]);

    const { rows } = await pool.query(
      `SELECT c.id, c.status, c.channel, c.subject, c.created_at, c.updated_at, c.priority
       FROM conversations c
       WHERE c.visitor_id = $1 AND c.id != $2
       ORDER BY c.created_at DESC LIMIT 10`,
      [visitorId, req.params.id]
    );
    return res.json(rows);
  } catch (err) { next(err); }
});

// ─── GET /api/conversations/:id/export ───────────────────────────────────────
router.get('/:id/export', handleExportRequest);

module.exports = router;
