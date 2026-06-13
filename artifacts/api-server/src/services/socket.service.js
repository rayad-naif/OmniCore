'use strict';

/**
 * socket.service.js
 * Atelier OmniCore — Section 5: Real-Time Telemetry & Socket Architecture
 *
 * Responsibilities:
 *  - Authenticate incoming connections (visitor session token OR agent JWT)
 *  - Room management: each conversation gets its own room
 *  - client:telemetry_update  — presence / read-receipts / custom analytics
 *  - client:send_message      — visitor or agent sends a chat message
 *  - agent:is_typing          — collision-detection broadcast
 *  - Offline queue drain on reconnect
 *  - Graceful disconnect / cleanup
 */

const { Server }   = require('socket.io');
const { pool }     = require('../../server');   // shared pg Pool

// ---------------------------------------------------------------------------
// In-memory typing registry  { conversationId -> { agentId, displayName, expiresAt } }
// Using memory is fine for a single-process; swap for Redis pub/sub when clustering.
// ---------------------------------------------------------------------------
const typingRegistry = new Map();
const TYPING_TTL_MS  = 5_000;   // auto-clear if no heartbeat in 5 s

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
async function authMiddleware(socket, next) {
  try {
    const { sessionToken, agentToken } = socket.handshake.auth;

    if (agentToken) {
      // Stub: replace with real JWT verification (jsonwebtoken)
      const payload = verifyAgentJwt(agentToken);   // throws on invalid
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
// JWT stub — replace with real verification in production
// ---------------------------------------------------------------------------
function verifyAgentJwt(token) {
  const jwt = require('jsonwebtoken');
  return jwt.verify(token, process.env.JWT_SECRET || 'CHANGE_ME');
}

// ---------------------------------------------------------------------------
// Helper: persist a message row and return it
// ---------------------------------------------------------------------------
async function persistMessage({ conversationId, senderType, senderId, body, attachments = [] }) {
  const { rows } = await pool.query(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_id, message_body, attachments_json)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, conversation_id, sender_type, sender_id,
               message_body, attachments_json, created_at`,
    [conversationId, senderType, senderId, body, JSON.stringify(attachments)]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Helper: update conversation updated_at (keeps SLA timer fresh)
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
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
      credentials: true,
    },
    pingTimeout:  20_000,
    pingInterval: 10_000,
  });

  io.use(authMiddleware);

  io.on('connection', (socket) => {
    const { actorType, tenantId } = socket.data;
    console.log(`[socket] ${actorType} connected  sid=${socket.id}`);

    // ── Join a conversation room ─────────────────────────────────────────────
    socket.on('join:conversation', async ({ conversationId }, ack) => {
      try {
        const conv = await resolveConversation(conversationId, tenantId);
        if (!conv) return ack?.({ error: 'CONVERSATION_NOT_FOUND' });

        await socket.join(`conv:${conversationId}`);
        socket.data.activeConversation = conversationId;

        ack?.({ ok: true, conversationId });
      } catch (err) {
        console.error('[socket] join:conversation error', err.message);
        ack?.({ error: 'SERVER_ERROR' });
      }
    });

    // ── client:send_message ─────────────────────────────────────────────────
    // Payload: { conversationId, body, attachments? }
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

        // Clear typing indicator for this agent (if any)
        if (actorType === 'agent') {
          typingRegistry.delete(conversationId);
          io.to(`conv:${conversationId}`).emit('agent:typing_stopped', { conversationId });
        }

        // Broadcast to everyone in the room (including sender so client confirms delivery)
        io.to(`conv:${conversationId}`).emit('server:new_message', message);

        ack?.({ ok: true, messageId: message.id });
      } catch (err) {
        console.error('[socket] client:send_message error', err.message);
        ack?.({ error: 'SERVER_ERROR' });
      }
    });

    // ── agent:is_typing  (collision detection) ──────────────────────────────
    // Payload: { conversationId, isTyping: boolean }
    socket.on('agent:is_typing', ({ conversationId, isTyping }) => {
      if (actorType !== 'agent') return;

      const room = `conv:${conversationId}`;

      if (isTyping) {
        const existing = typingRegistry.get(conversationId);

        // Collision guard: another agent is already typing
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

        // Broadcast to everyone in the room EXCEPT the typing agent
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

    // ── client:telemetry_update ─────────────────────────────────────────────
    // Payload: { conversationId, event, meta }
    // Lightweight analytics ping — does NOT persist to DB by default.
    socket.on('client:telemetry_update', async ({ conversationId, event, meta }) => {
      try {
        if (!conversationId || !event) return;

        // Broadcast to agents in the room for live presence
        socket.to(`conv:${conversationId}`).emit('server:telemetry', {
          conversationId,
          actorType,
          event,
          meta,
          ts: new Date().toISOString(),
        });

        // Optional: persist specific events (e.g. page_view, widget_open)
        const PERSIST_EVENTS = new Set(['widget_open', 'page_view', 'read_receipt']);
        if (PERSIST_EVENTS.has(event)) {
          // Extend schema with a telemetry_events table for full storage
          // Intentionally left as a hook — plug in your own table.
        }
      } catch (err) {
        console.error('[socket] client:telemetry_update error', err.message);
      }
    });

    // ── Offline queue drain ─────────────────────────────────────────────────
    // Client sends queued messages accumulated during a disconnect.
    // Payload: { messages: [{ conversationId, body, queuedAt }] }
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
            senderType,
            senderId,
            body: item.body.trim(),
          });
          await touchConversation(item.conversationId);
          io.to(`conv:${item.conversationId}`).emit('server:new_message', msg);
          results.push(msg.id);
        } catch { /* skip malformed items */ }
      }
      ack?.({ ok: true, saved: results.length, messageIds: results });
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`[socket] ${actorType} disconnected  sid=${socket.id}  reason=${reason}`);

      // Clean up typing indicator if this agent was the active typer
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

module.exports = { attachSocketServer };
