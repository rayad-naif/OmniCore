'use strict';

/**
 * conversations.controller.js
 * Atelier OmniCore — Conversations + Messages + Export
 *
 * GET    /api/conversations                  list (paginated, tenant-scoped, RBAC)
 *                                            ?is_ticket=true  → tickets only
 * GET    /api/conversations/:id              single conversation
 * PATCH  /api/conversations/:id             update status / priority / assignment / is_ticket
 *                                            → triggers SMTP email on status change
 *                                            → broadcasts conversation:assigned via socket
 * GET    /api/conversations/:id/messages     message history
 * POST   /api/conversations/:id/messages     agent sends a message
 *                                            → broadcasts server:new_message to conv room
 * GET    /api/conversations/:id/export       PDF → R2 presigned URL
 */

const { Router }                = require('express');
const { requireAuth }           = require('../middleware/auth');
const { pool }                  = require('../lib/db');
const { handleExportRequest }   = require('../services/export.service');
const { sendStatusChangeEmail } = require('../services/email.service');
const { broadcastToConversation, broadcastToTenant } = require('../services/socket.service');
const logger                    = require('../utils/logger');

const router = Router();
router.use(requireAuth);

// ─── One-time migration: is_ticket column ─────────────────────────────────────
pool.query(`
  ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS is_ticket BOOLEAN NOT NULL DEFAULT false
`).catch(err => {
  if (!err.message?.includes('already exists')) {
    logger.warn({ err: err.message }, 'is_ticket_migration_warning');
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const PAGE_LIMIT = 25;
function tenantId(req) { return req.agent.tenantId; }

// ─── GET /api/conversations ───────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const tid      = tenantId(req);
    const status   = req.query.status;
    const isTicket = req.query.is_ticket;   // 'true' | 'false' | undefined
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const limit    = Math.min(100, parseInt(req.query.limit) || PAGE_LIMIT);
    const offset   = (page - 1) * limit;

    const conditions = ['c.tenant_id = $1'];
    const values     = [tid];

    // RBAC: agents only see their own or unassigned conversations
    if (req.agent.role === 'agent') {
      conditions.push(
        `(c.assigned_agent_id = $${values.length + 1} OR c.assigned_agent_id IS NULL)`
      );
      values.push(req.agent.id);
    }

    if (status) {
      conditions.push(`c.status = $${values.length + 1}`);
      values.push(status);
    }

    if (isTicket === 'true') {
      conditions.push(`c.is_ticket = true`);
    } else if (isTicket === 'false') {
      conditions.push(`c.is_ticket = false`);
    }

    const where = conditions.join(' AND ');

    const [{ rows: conversations }, { rows: countRow }] = await Promise.all([
      pool.query(
        `SELECT
           c.id, c.status, c.channel, c.priority, c.subject,
           c.created_at, c.updated_at, c.sla_breach_at,
           c.assigned_agent_id, c.is_ticket,
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
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM conversations c WHERE ${where}`,
        values
      ),
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
    const ALLOWED = ['status', 'priority', 'assigned_agent_id', 'subject', 'is_ticket'];
    const fields  = Object.keys(req.body).filter(k => ALLOWED.includes(k));

    if (!fields.length) {
      return res.status(400).json({ error: 'No valid fields provided' });
    }

    // Fetch pre-update state for comparisons
    const { rows: beforeRows } = await pool.query(
      `SELECT status, visitor_id, assigned_agent_id
       FROM conversations WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId(req)]
    );
    if (!beforeRows[0]) return res.status(404).json({ error: 'Conversation not found' });
    const oldStatus    = beforeRows[0].status;
    const oldVisitorId = beforeRows[0].visitor_id;
    const oldAgentId   = beforeRows[0].assigned_agent_id;

    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values     = fields.map(f => {
      const v = req.body[f];
      return (v === '' || v === undefined) ? null : v;
    });
    values.push(req.params.id, tenantId(req));

    const { rows } = await pool.query(
      `UPDATE conversations
       SET ${setClauses}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
       RETURNING id, status, priority, assigned_agent_id, is_ticket, updated_at`,
      values
    );

    if (!rows[0]) return res.status(404).json({ error: 'Conversation not found' });
    logger.info({ conversationId: req.params.id, fields }, 'conversation_patched');

    // Fire-and-forget email alert on status change
    const newStatus  = rows[0].status;
    if (fields.includes('status') && newStatus !== oldStatus) {
      pool.query(`SELECT email FROM visitors WHERE id = $1`, [oldVisitorId])
        .then(({ rows: vRows }) => {
          sendStatusChangeEmail(
            tenantId(req), req.params.id, oldStatus, newStatus, vRows[0]?.email
          );
        }).catch(() => {});
    }

    // Broadcast conversation:assigned when assignment changes
    const newAgentId = rows[0].assigned_agent_id;
    if (fields.includes('assigned_agent_id') && String(newAgentId) !== String(oldAgentId)) {
      let agentName = null;
      if (newAgentId) {
        const { rows: agRows } = await pool.query(
          'SELECT name FROM agents WHERE id = $1', [newAgentId]
        );
        agentName = agRows[0]?.name ?? null;
      }
      broadcastToTenant(tenantId(req), 'conversation:assigned', {
        conversationId: req.params.id,
        agentId:   newAgentId,
        agentName,
      });
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

    if (!messageBody?.trim()) {
      return res.status(400).json({ error: 'message body is required' });
    }

    const { rows: convRows } = await pool.query(
      `SELECT id, status, tenant_id FROM conversations
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId(req)]
    );
    if (!convRows[0]) return res.status(404).json({ error: 'Conversation not found' });
    if (convRows[0].status === 'closed') {
      return res.status(409).json({ error: 'Conversation is closed' });
    }

    const { rows: newMsg } = await pool.query(
      `INSERT INTO messages
         (conversation_id, sender_type, sender_id, message_body, is_internal_note)
       VALUES ($1, 'agent', $2, $3, $4)
       RETURNING id, conversation_id, sender_type, message_body,
                 is_internal_note, created_at`,
      [req.params.id, req.agent.id, messageBody.trim(), Boolean(isInternalNote)]
    );

    const agentRow = await pool.query('SELECT name FROM agents WHERE id = $1', [req.agent.id]);
    const result   = { ...newMsg[0], sender_name: agentRow.rows[0]?.name ?? 'Agent' };

    await pool.query(
      'UPDATE conversations SET updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );

    // Broadcast to the conversation room so the visitor widget and
    // other agents in the room see the agent reply in real-time.
    broadcastToConversation(req.params.id, 'server:new_message', result);

    logger.info(
      { conversationId: req.params.id, agentId: req.agent.id },
      'agent_message_sent'
    );

    return res.status(201).json(result);
  } catch (err) { next(err); }
});

// ─── GET /api/conversations/:id/export ───────────────────────────────────────
router.get('/:id/export', handleExportRequest);

module.exports = router;
