'use strict';

/**
 * socket.service.js
 * Atelier OmniCore — Real-Time Socket Architecture
 */

const { Server }   = require('socket.io');
const { pool }     = require('../lib/db');
const { sendNewVisitorMessageEmail } = require('./email.service');

// ---------------------------------------------------------------------------
// AI subject generation — async, non-blocking, gracefully degraded
// ---------------------------------------------------------------------------
async function maybeGenerateSubject(conversationId, firstMessageBody) {
  try {
    const { rows } = await pool.query(
      `SELECT subject FROM conversations WHERE id = $1`, [conversationId]
    );
    if (!rows[0] || rows[0].subject) return; // already has a subject

    let subject = `Re: ${firstMessageBody.slice(0, 80)}`;

    const genAI = (() => { try { return require('./ai.service'); } catch { return null; } })();
    if (genAI?.rephraseText && process.env.GEMINI_API_KEY) {
      try {
        const raw = await genAI.rephraseText({
          draft: `Summarise this customer support message in one short title (max 8 words, no quotes, no full stop): "${firstMessageBody}"`,
          tone: 'concise',
        });
        if (raw?.trim()) subject = `Re: ${raw.trim()}`;
      } catch { /* use fallback */ }
    }

    await pool.query(
      `UPDATE conversations SET subject = $1, updated_at = NOW() WHERE id = $2`,
      [subject, conversationId]
    );
  } catch { /* non-fatal */ }
}

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

/**
 * Broadcast an event directly to a visitor's personal room.
 * Used as a fallback so agent REST-sent messages reach the widget even
 * when the visitor socket hasn't successfully joined the conv room yet.
 */
function broadcastToVisitor(visitorId, event, data) {
  if (!_io) return;
  _io.to(`vis:${visitorId}`).emit(event, data);
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
async function persistMessage({ conversationId, senderType, senderId, body, attachments = [], isInternalNote = false }) {
  const attJson = Array.isArray(attachments) && attachments.length > 0
    ? JSON.stringify(attachments)
    : '[]';
  const { rows } = await pool.query(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_id, message_body, attachments_json, is_internal_note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, conversation_id, sender_type, sender_id,
               message_body, attachments_json, is_internal_note, created_at`,
    [conversationId, senderType, senderId, body, attJson, Boolean(isInternalNote)]
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
    `SELECT id, status, assigned_agent_id, tenant_id, brand_id, visitor_id
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
      origin: true,   // reflect request origin — required for credentials with socket.io
      credentials: true,
    },
    pingTimeout:  8_000,
    pingInterval: 5_000,
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
    // Visitors auto-join a personal room so agent replies reach them even if
    // they haven't yet successfully joined the conv room (race conditions, reconnects).
    if (actorType === 'visitor' && socket.data.visitorId) {
      socket.join(`vis:${socket.data.visitorId}`);
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

        // Notify agents in this conv that visitor came online
        if (actorType === 'visitor') {
          socket.to(`conv:${conversationId}`).emit('visitor:online', { conversationId });
        }

        ack?.({ ok: true, conversationId });
      } catch (err) {
        ack?.({ error: 'SERVER_ERROR' });
      }
    });

    // ── client:send_message ─────────────────────────────────────────────────
    socket.on('client:send_message', async (payload, ack) => {
      try {
        const { conversationId, body, attachments, isInternalNote } = payload;
        const hasBody = body?.trim();
        const hasAtts = Array.isArray(attachments) && attachments.length > 0;
        if (!conversationId || (!hasBody && !hasAtts)) {
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
          body: hasBody ? body.trim() : '',
          attachments,
          isInternalNote: actorType === 'agent' ? Boolean(isInternalNote) : false,
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

        // Deliver to everyone in the conversation room.
        // For AGENT messages, exclude the sender (they have the message optimistically).
        // For VISITOR messages, broadcast to all (agents viewing the conv need it).
        if (actorType === 'agent') {
          // Broadcast to conv room (excludes agent sender — they have optimistic UI).
          // Also emit directly to visitor's personal room so the widget receives it
          // even if it missed the conv room join (reconnect race condition).
          socket.broadcast.to(`conv:${conversationId}`).emit('server:new_message', enriched);
          if (conv.visitor_id) {
            io.to(`vis:${conv.visitor_id}`).emit('server:new_message', enriched);
          }
        } else {
          io.to(`conv:${conversationId}`).emit('server:new_message', enriched);
        }

        // Also notify ALL tenant agents so the sidebar (inbox) stays live:
        // unread badge, position sort, and toast pop-up — even for agents
        // who have never opened this conversation.
        if (actorType === 'visitor') {
          io.to(`tenant:${tenantId}`).emit('conversation:visitor_message', {
            conversationId,
            message: enriched,
          });

          // Non-blocking: auto-generate subject on first visitor message
          const msgBody = hasBody ? body.trim() : '';
          if (msgBody) {
            maybeGenerateSubject(conversationId, msgBody).catch(() => {});
          }

          // Non-blocking: AI bot auto-reply (fires when conversation is in
          // ai_handling status). Shared with the REST widget handler.
          if (msgBody) {
            const { maybeAutoReply } = require('./ai.service');
            maybeAutoReply({ conversationId, tenantId, userMessage: msgBody, io })
              .catch(() => { /* non-fatal: handled internally */ });
          }

          // Non-blocking: email the tenant's notification_email address
          sendNewVisitorMessageEmail(tenantId, conversationId, senderName, hasBody ? body.trim() : '')
            .catch(() => {});
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

    // ── visitor:mark_read ──────────────────────────────────────────────────
    // Emitted by the widget when the visitor sees new messages.
    // Stores a timestamp and notifies agents viewing this conversation.
    socket.on('visitor:mark_read', async ({ conversationId }) => {
      if (actorType !== 'visitor' || !conversationId) return;
      try {
        const conv = await resolveConversation(conversationId, tenantId);
        if (!conv) return;
        const readAt = new Date().toISOString();
        await pool.query(
          `UPDATE conversations SET visitor_last_read_at = $1 WHERE id = $2`,
          [readAt, conversationId]
        );
        socket.to(`conv:${conversationId}`).emit('visitor:read_receipt', {
          conversationId, readAt,
        });
      } catch { /* non-fatal */ }
    });

    // ── visitor:is_typing ───────────────────────────────────────────────────
    // Emitted by the widget when the visitor starts/stops typing.
    // Forward to all agents watching that conversation.
    socket.on('visitor:is_typing', ({ conversationId, isTyping }) => {
      if (actorType !== 'visitor') return;
      if (!conversationId) return;
      const room = `conv:${conversationId}`;
      if (isTyping) {
        socket.to(room).emit('visitor:is_typing', {
          conversationId,
          displayName: socket.data.visitorName || 'Visitor',
        });
      } else {
        socket.to(room).emit('visitor:typing_stopped', { conversationId });
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
      // Persist so the dashboard shows the current page even if no agent was
      // in the room when this event fired.
      pool.query(`UPDATE conversations SET current_url = $1 WHERE id = $2`, [url, conversationId])
        .catch(() => {});
    });

    // ── client:page_view ────────────────────────────────────────────────────
    // Emitted by the widget on each URL change (debounced 300 ms) and on init.
    // Inserts a system message into the conversation timeline so agents see a
    // timestamped trail of pages the visitor visited.
    socket.on('client:page_view', async ({ conversationId, path, url }) => {
      if (actorType !== 'visitor') return;
      if (!conversationId || !path) return;
      try {
        const conv = await resolveConversation(conversationId, tenantId);
        if (!conv) return;

        // Persist the latest full URL for the dashboard "Current Page" field.
        if (url) {
          pool.query(`UPDATE conversations SET current_url = $1 WHERE id = $2`, [url, conversationId])
            .catch(() => {});
        }

        const content = `Visited: ${path}`;
        const { rows } = await pool.query(
          `INSERT INTO messages
             (conversation_id, sender_type, message_body, is_internal_note, attachments_json)
           VALUES ($1, 'system', $2, false, '[]')
           RETURNING id, conversation_id, sender_type, message_body, is_internal_note,
                     attachments_json, created_at`,
          [conversationId, content]
        );
        const msg = { ...rows[0], sender_name: 'System' };

        // Broadcast only to agents watching this conversation (not back to visitor)
        socket.to(`conv:${conversationId}`).emit('server:new_message', msg);

        // Update visitor last_seen_at
        await pool.query(
          `UPDATE visitors SET last_seen_at = NOW() WHERE id = $1`,
          [socket.data.visitorId]
        );
      } catch { /* non-fatal */ }
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
      if (actorType === 'visitor') {
        const convId = socket.data.activeConversation;
        if (convId) {
          // Notify agents in conv room + all agents in tenant room so the
          // "online" badge clears even if the agent hasn't opened this conv.
          io.to(`conv:${convId}`).emit('visitor:offline', { conversationId: convId });
          if (tenantId) {
            io.to(`tenant:${tenantId}`).emit('visitor:offline', { conversationId: convId });
          }
        }
      }
    });
  });

  return io;
}

/** Returns the live Socket.io server instance (or null before init). */
function getIo() { return _io; }

module.exports = { attachSocketServer, broadcastToTenant, broadcastToConversation, broadcastToVisitor, getIo };
