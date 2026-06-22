'use strict';

/**
 * socket.service.js
 * Atelier OmniCore — Real-Time Socket Architecture
 *
 * Responsibilities:
 *  - Authenticate incoming connections (visitor session token OR agent JWT)
 *  - Room management: each conversation gets its own room
 *    Agents also auto-join a tenant-level room `tenant:{tenantId}` so
 *    broadcasts like `conversation:created` reach all connected agents.
 *  - client:send_message      — visitor or agent sends a chat message
 *  - agent:is_typing          — collision-detection broadcast
 *  - Offline queue drain on reconnect
 *  - Graceful disconnect / cleanup
 *  - broadcastToTenant(tenantId, event, data) — exported for use by other
 *    controllers (e.g. widget session endpoint)
 */

const { Server }   = require('socket.io');
const { pool }     = require('../lib/db');

// ---------------------------------------------------------------------------
// In-memory typing registry  { conversationId -> { agentId, displayName, expiresAt } }
// ---------------------------------------------------------------------------
const typingRegistry = new Map();
const TYPING_TTL_MS  = 5_000;

// ---------------------------------------------------------------------------
// Module-level io reference so broadcast helpers can be called externally
// ---------------------------------------------------------------------------
let _io = null;

/**
 * Broadcast an event to all agents connected to a tenant's room.
 * Safe to call before the socket server is initialised (will be a no-op).
 */
function broadcastToTenant(tenantId, event, data) {
  if (!_io) return;
  _io.to(`tenant:${tenantId}`).emit(event, data);
}

/**
 * Broadcast an event to all sockets in a conversation room.
 * Used by the REST POST /messages handler so the widget visitor and
 * other agents see agent replies in real-time without a page refresh.
 */
function broadcastToConversation(conversationId, event, data) {
  if (!_io) return;
  _io.to(`conv:${conversationId}`).emit(event, data);
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
async function authMiddleware(socket, next) {
  try {
    const { sessionToken, agentToken } = socket.handshake.auth;

    if (agentToken) {
      const payload = verifyAgentJwt(agentToken);
      socket.data.actorType = 'agent';
      socket.data.agentId   = payload.sub;
      socket.data.tenantId  = payload.tenantId;
      socket.data.name      = payload.name;
      return next();
    }

    if (sessionToken) {
      const { rows } = await pool.query(
        `SELECT id, tenant_id, brand_id FROM visitors WHERE session_token = $1`,
        [sessionToken]
      );
      if (!rows.length) return next(new Error('VISITOR_NOT_FOUND'));
      socket.data.actorType = 'visitor';
      socket.data.visitorId = rows[0].id;
      socket.data.tenantId  = rows[0].tenant_id;
      socket.data.brandId   = rows[0].brand_id;
      return next();
    }

    next(new Error('UNAUTHENTICATED'));
  } catch (err) {
    next(new Error('AUTH_FAILED'));
  }
}

// ---------------------------------------------------------------------------
// JWT verification
// ---------------------------------------------------------------------------
function verifyAgentJwt(token) {
  const jwt    = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return jwt.verify(token, secret);
}

// ---------------------------------------------------------------------------
// Helper: persist a message row and return it
// ---------------------------------------------------------------------------
async function persistMessage({ conversationId, senderType, senderId, body, attachments = [] }) {
  const attJson = Array.isArray(attachments) && attachments.length > 0
    ? JSON.stringify(attachments)
    : '[]';
  const { rows } = await pool.query(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_id, message_body, attachments_json)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, conversation_id, sender_type, sender_id,
               message_body, attachments_json, created_at`,
    [conversationId, senderType, senderId, body, attJson]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Helper: update conversation updated_at
// ---------------------------------------------------------------------------
async function touchConversation(conversationId) {
  await pool.query(
    `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
    [conversationId]
  );
}

// ---------------------------------------------------------------------------
// Helper: verify the socket actor belongs to this conversation / tenant
// ---------------------------------------------------------------------------
async function resolveConversation(conversationId, tenantId) {
  const { rows } = await pool.query(
    `SELECT id, status, assigned_agent_id, tenant_id, brand_id
     FROM conversations WHERE id = $1 AND tenant_id = $2`,
    [conversationId, tenantId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Typing cleanup scheduler
// ---------------------------------------------------------------------------
function scheduleTypingExpiry(io, conversationId) {
  setTimeout(() => {
    const entry = typingRegistry.get(conversationId);
    if (entry && Date.now() >= entry.expiresAt) {
      typingRegistry.delete(conversationId);
      io.to(`conv:${conversationId}`).emit('agent:typing_stopped', { conversationId });
    }
  }, TYPING_TTL_MS + 100);
}

// ---------------------------------------------------------------------------
// Main export: attach Socket.io to an existing http.Server
// ---------------------------------------------------------------------------
function attachSocketServer(httpServer) {
  const io = new Server(httpServer, {
    path: '/api/socket.io',
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
      credentials: true,
    },
    pingTimeout:  20_000,
    pingInterval: 10_000,
  });

  _io = io;

  io.use(authMiddleware);

  io.on('connection', (socket) => {
    const { actorType, tenantId } = socket.data;

    // Agents auto-join the tenant room so they receive cross-conversation events
    // (e.g. conversation:created from the widget session endpoint)
    if (actorType === 'agent' && tenantId) {
      socket.join(`tenant:${tenantId}`);
    }

    // ── Join a conversation room ─────────────────────────────────────────────
    socket.on('join:conversation', async ({ conversationId }, ack) => {
      try {
        const conv = await resolveConversation(conversationId, tenantId);
        if (!conv) return ack?.({ error: 'CONVERSATION_NOT_FOUND' });

        // Leave the previous conversation room so agents never accumulate
        // stale room memberships that cause duplicate event delivery.
        const prev = socket.data.activeConversation;
        if (prev && prev !== conversationId) {
          socket.leave(`conv:${prev}`);
        }

        await socket.join(`conv:${conversationId}`);
        socket.data.activeConversation = conversationId;

        ack?.({ ok: true, conversationId });
      } catch (err) {
        ack?.({ error: 'SERVER_ERROR' });
      }
    });

    // ── client:send_message ─────────────────────────────────────────────────
    socket.on('client:send_message', async (payload, ack) => {
      try {
        const { conversationId, body, attachments } = payload;
        if (!conversationId || !body?.trim()) {
          return ack?.({ error: 'INVALID_PAYLOAD' });
        }

        const conv = await resolveConversation(conversationId, tenantId);
        if (!conv) return ack?.({ error: 'CONVERSATION_NOT_FOUND' });
        if (conv.status === 'closed') return ack?.({ error: 'CONVERSATION_CLOSED' });

        const senderType = actorType === 'agent' ? 'agent' : 'visitor';
        const senderId   = actorType === 'agent'
          ? socket.data.agentId
          : socket.data.visitorId;

        const message = await persistMessage({
          conversationId,
          senderType,
          senderId,
          body: body.trim(),
          attachments,
        });

        await touchConversation(conversationId);

        if (actorType === 'agent') {
          typingRegistry.delete(conversationId);
          io.to(`conv:${conversationId}`).emit('agent:typing_stopped', { conversationId });
        }

        // Resolve sender display name for UI rendering
        let senderName = actorType === 'agent' ? (socket.data.name || 'Agent') : 'Visitor';
        if (actorType === 'visitor') {
          try {
            const { rows: vr } = await pool.query(
              `SELECT display_name, email FROM visitors WHERE id = $1`,
              [socket.data.visitorId]
            );
            senderName = vr[0]?.display_name || vr[0]?.email || 'Visitor';
          } catch { /* non-fatal */ }
        }
        const enriched = { ...message, sender_name: senderName };

        // Deliver to agents currently viewing this conversation
        io.to(`conv:${conversationId}`).emit('server:new_message', enriched);

        // Also notify ALL tenant agents so the sidebar (inbox) stays live:
        // unread badge, position sort, and toast pop-up — even for agents
        // who have never opened this conversation.
        if (actorType === 'visitor') {
          io.to(`tenant:${tenantId}`).emit('conversation:visitor_message', {
            conversationId,
            message: enriched,
          });
        }

        ack?.({ ok: true, messageId: message.id });
      } catch (err) {
        ack?.({ error: 'SERVER_ERROR' });
      }
    });

    // ── agent:is_typing  (collision detection) ──────────────────────────────
    socket.on('agent:is_typing', ({ conversationId, isTyping }) => {
      if (actorType !== 'agent') return;

      const room = `conv:${conversationId}`;

      if (isTyping) {
        const existing = typingRegistry.get(conversationId);

        if (existing && existing.agentId !== socket.data.agentId) {
          socket.emit('agent:typing_collision', {
            conversationId,
            agentId:     existing.agentId,
            displayName: existing.displayName,
          });
          return;
        }

        typingRegistry.set(conversationId, {
          agentId:     socket.data.agentId,
          displayName: socket.data.name || 'Agent',
          expiresAt:   Date.now() + TYPING_TTL_MS,
        });

        socket.to(room).emit('agent:is_typing', {
          conversationId,
          agentId:     socket.data.agentId,
          displayName: socket.data.name || 'Agent',
        });

        scheduleTypingExpiry(io, conversationId);
      } else {
        typingRegistry.delete(conversationId);
        socket.to(room).emit('agent:typing_stopped', { conversationId });
      }
    });

    // ── visitor:page_change ─────────────────────────────────────────────────
    // Emitted by the widget whenever the visitor navigates to a new URL.
    // Forward to all agents watching that conversation so they see the
    // "Current Page" field update in real-time.
    socket.on('visitor:page_change', ({ conversationId, url }) => {
      if (actorType !== 'visitor') return;
      if (!conversationId || !url) return;
      socket.to(`conv:${conversationId}`).emit('visitor:page_change', {
        conversationId, url,
      });
    });

    // ── client:telemetry_update ─────────────────────────────────────────────
    socket.on('client:telemetry_update', async ({ conversationId, event, meta }) => {
      try {
        if (!conversationId || !event) return;
        socket.to(`conv:${conversationId}`).emit('server:telemetry', {
          conversationId, actorType, event, meta, ts: new Date().toISOString(),
        });
      } catch { /* ignore */ }
    });

    // ── Offline queue drain ─────────────────────────────────────────────────
    socket.on('client:drain_queue', async ({ messages }, ack) => {
      if (!Array.isArray(messages) || !messages.length) return ack?.({ ok: true, saved: 0 });

      const results = [];
      for (const item of messages) {
        try {
          const conv = await resolveConversation(item.conversationId, tenantId);
          if (!conv || conv.status === 'closed') continue;

          const senderType = actorType === 'agent' ? 'agent' : 'visitor';
          const senderId   = actorType === 'agent' ? socket.data.agentId : socket.data.visitorId;

          const msg = await persistMessage({
            conversationId: item.conversationId,
            senderType, senderId, body: item.body.trim(),
          });
          await touchConversation(item.conversationId);
          io.to(`conv:${item.conversationId}`).emit('server:new_message', msg);
          results.push(msg.id);
        } catch { /* skip malformed items */ }
      }
      ack?.({ ok: true, saved: results.length, messageIds: results });
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      if (actorType === 'agent') {
        const convId = socket.data.activeConversation;
        if (convId) {
          const entry = typingRegistry.get(convId);
          if (entry?.agentId === socket.data.agentId) {
            typingRegistry.delete(convId);
            io.to(`conv:${convId}`).emit('agent:typing_stopped', { conversationId: convId });
          }
        }
      }
    });
  });

  return io;
}

module.exports = { attachSocketServer, broadcastToTenant, broadcastToConversation };
