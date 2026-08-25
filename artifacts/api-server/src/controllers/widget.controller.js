'use strict';

/**
 * widget.controller.js
 * Atelier OmniCore — Embeddable visitor chat widget
 *
 * GET  /api/widget/widget.js    serve the embeddable JS bundle
 * POST /api/widget/session      create / restore a visitor session
 * POST /api/widget/upload       upload a file (base64 JSON body)
 * GET  /api/widget/files/:name  serve an uploaded file
 * POST /api/widget/message      send a message with attachments (REST fallback)
 * GET  /api/widget/demo         test page
 * GET  /api/widget/health       liveness check
 */

const { Router }            = require('express');
const express               = require('express');
const crypto                = require('crypto');
const fs                    = require('fs');
const path                  = require('path');
const { pool }              = require('../lib/db');
const logger                = require('../utils/logger');
const { broadcastToTenant, broadcastToConversation, getIo } = require('../services/socket.service');
const { maybeAutoReply } = require('../services/ai.service');
const { R2_ENABLED, uploadToR2, streamFromR2, getPresignedGetUrl } = require('../lib/r2');
const { validateWidgetSessionInput } = require('../lib/requestValidation');

const router = Router();

// Create uploads directory
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch(e) {}

// ── CORS: allow any origin (widget is embedded on customer sites) ─────────────
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',   '*');
  res.setHeader('Access-Control-Allow-Methods',  'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',  'Content-Type');
  // Override helmet's same-origin CORP — widget files are intentionally cross-origin
  res.setHeader('Cross-Origin-Resource-Policy',  'cross-origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Determine the initial status for a new widget conversation. When the tenant
// has the AI bot enabled (feature + auto-reply), conversations start as
// 'ai_handling' so the bot answers first; otherwise they enter the human queue
// as 'open'. The socket auto-reply only fires for 'ai_handling' conversations.
async function pickInitialStatus(tenantId) {
  try {
    const { rows } = await pool.query(
      'SELECT ai_feature_enabled, ai_auto_reply_enabled FROM tenants WHERE id = $1',
      [tenantId]
    );
    if (rows[0] && rows[0].ai_feature_enabled && rows[0].ai_auto_reply_enabled) return 'ai_handling';
  } catch { /* fall back to open */ }
  return 'open';
}

// ── GET /api/widget/health ────────────────────────────────────────────────────
router.get('/health', (_req, res) => res.json({ ok: true }));

// ── GET /api/widget/brand-logo ────────────────────────────────────────────────
router.get('/brand-logo', (_req, res) => {
  const logoPath = path.resolve(__dirname, 'brand-logo.jpg');
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  const stream = fs.createReadStream(logoPath);
  stream.on('error', () => res.status(404).end());
  stream.pipe(res);
});

// ── POST /api/widget/session ──────────────────────────────────────────────────
router.post('/session', async (req, res, next) => {
  try {
    const input = validateWidgetSessionInput(req.body);
    if (!input.ok) return res.status(400).json({ error: input.error });
    const { brandId } = input.value;
    const { sessionToken, visitorName, visitorEmail, timezone, forceNew, referrerUrl } = req.body || {};

    // ── Returning visitor ──────────────────────────────────────────────────────
    if (sessionToken) {
      const { rows: vRows } = await pool.query(
        'SELECT id, tenant_id FROM visitors WHERE session_token = $1 AND brand_id = $2',
        [sessionToken, brandId]
      );
      if (vRows[0]) {
        const visitorId = vRows[0].id;
        const tenantId  = vRows[0].tenant_id;

        // Update identity + timezone if provided
        const updates = [];
        const vals    = [];
        if (visitorName)  { updates.push(`display_name = $${vals.length+1}`); vals.push(visitorName); }
        if (visitorEmail) { updates.push(`email = $${vals.length+1}`);        vals.push(visitorEmail); }
        if (timezone)     { updates.push(`timezone = $${vals.length+1}`);     vals.push(timezone); }
        if (updates.length) {
          await pool.query(
            `UPDATE visitors SET ${updates.join(', ')} WHERE id = $${vals.length+1}`,
            [...vals, visitorId]
          );
        }

        const { rows: bRows }   = await pool.query('SELECT brand_name FROM brands WHERE id = $1', [brandId]);
        const { rows: visData } = await pool.query('SELECT display_name FROM visitors WHERE id = $1', [visitorId]);
        const brandName = bRows[0]?.brand_name || 'Support';

        // ── force_new: always create a fresh conversation, preserve visitor identity ──
        if (forceNew) {
          const convStatus = await pickInitialStatus(tenantId);
          const { rows: nc } = await pool.query(
            `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel, referrer_url)
             VALUES ($1, $2, $3, $5, 'widget', $4) RETURNING id`,
            [tenantId, brandId, visitorId, referrerUrl || null, convStatus]
          );
          const newConvId = nc[0].id;
          try {
            broadcastToTenant(tenantId, 'conversation:created', {
              id: newConvId,
              status: convStatus, channel: 'widget', priority: 'normal', subject: null,
              visitor_name: visData[0]?.display_name || visitorName || 'Visitor',
              visitor_email: visitorEmail || null,
              agent_name: null, brand_name: brandName,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
              sla_breach_at: null, assigned_agent_id: null, unread: 0,
              visitor_id: visitorId,
            });
          } catch { /* non-fatal */ }
          logger.info({ brandId, visitorId, conversationId: newConvId }, 'widget_force_new_conversation');
          return res.json({
            sessionToken,
            conversationId: newConvId,
            messages: [],
            brandName,
            visitorName: visData[0]?.display_name || visitorName || null,
          });
        }

        // If the very last conversation was converted to a ticket with a CSAT
        // survey the visitor hasn't answered yet, surface it so the widget can
        // re-show the survey on reload (recovers a missed live event).
        const { rows: lastRows } = await pool.query(
          `SELECT id, csat_requested, csat_score, is_ticket FROM conversations
           WHERE visitor_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [visitorId]
        );
        if (lastRows[0]?.is_ticket === true && lastRows[0].csat_requested === true && lastRows[0].csat_score === null) {
          return res.json({
            sessionToken,
            conversationId: lastRows[0].id,
            messages: [],
            brandName,
            visitorName: visData[0]?.display_name || visitorName || null,
            csatPending: true,
          });
        }

        // Find the most recent NON-TICKET conversation so we can detect closures.
        // Tickets are email conversations and must never be reloaded into the widget.
        let { rows: cRows } = await pool.query(
          `SELECT id, status, csat_requested, csat_score FROM conversations WHERE visitor_id = $1 AND is_ticket = false ORDER BY created_at DESC LIMIT 1`,
          [visitorId]
        );
        let convId = cRows[0]?.id;
        // If the most recent conversation was closed with a CSAT survey that the
        // visitor hasn't answered/dismissed yet, surface THAT closed conversation
        // (so the widget can re-show the survey) instead of burying it under a new
        // open conversation. Recovers the survey when the live event was missed.
        const csatPending = Boolean(cRows[0]) && cRows[0].status === 'closed'
          && cRows[0].csat_requested === true && cRows[0].csat_score === null;
        if (csatPending) {
          return res.json({
            sessionToken,
            conversationId: convId,
            messages: [],
            brandName,
            visitorName: visData[0]?.display_name || visitorName || null,
            csatPending: true,
          });
        }
        if (!convId || cRows[0]?.status === 'closed') {
          const convStatus = await pickInitialStatus(tenantId);
          const { rows: nc } = await pool.query(
            `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel, referrer_url)
             VALUES ($1, $2, $3, $5, 'widget', $4) RETURNING id`,
            [tenantId, brandId, visitorId, referrerUrl || null, convStatus]
          );
          convId = nc[0].id;
          try {
            broadcastToTenant(tenantId, 'conversation:created', {
              id: convId,
              status: convStatus, channel: 'widget', priority: 'normal', subject: null,
              visitor_name: visData[0]?.display_name || visitorName || 'Visitor',
              visitor_email: visitorEmail || null,
              agent_name: null, brand_name: brandName,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
              sla_breach_at: null, assigned_agent_id: null, unread: 0,
              visitor_id: visitorId,
            });
          } catch { /* non-fatal */ }
        }

        // Recent public messages (exclude internal notes and system messages)
        const { rows: messages } = await pool.query(
          `SELECT m.id, m.conversation_id, m.sender_type, m.message_body, m.attachments_json,
                  m.is_internal_note, m.created_at,
                  COALESCE(a.name, vis.display_name, vis.email, m.sender_type) AS sender_name
           FROM messages m
           LEFT JOIN agents   a   ON (m.sender_type IN ('agent','bot') AND a.id   = m.sender_id)
           LEFT JOIN visitors vis ON (m.sender_type = 'visitor'        AND vis.id = m.sender_id)
           WHERE m.conversation_id = $1 AND m.is_internal_note = FALSE
             AND m.sender_type != 'system'
           ORDER BY m.created_at ASC LIMIT 60`,
          [convId]
        );

        return res.json({
          sessionToken,
          conversationId: convId,
          messages,
          brandName,
          visitorName: visData[0]?.display_name || visitorName || null,
        });
      }
    }

    // ── New visitor ────────────────────────────────────────────────────────────
    const { rows: bRows } = await pool.query(
      'SELECT id, tenant_id, brand_name FROM brands WHERE id = $1', [brandId]
    );
    if (!bRows[0]) return res.status(404).json({ error: 'Brand not found' });
    const { tenant_id, brand_name } = bRows[0];

    // Deduplication: if an email is provided, reuse any existing visitor with
    // the same email + brand so we never create duplicate contacts.
    if (visitorEmail) {
      const { rows: existingRows } = await pool.query(
        `SELECT id FROM visitors WHERE brand_id = $1 AND email = $2 LIMIT 1`,
        [brandId, visitorEmail]
      );
      if (existingRows[0]) {
        const existingId = existingRows[0].id;
        const newToken   = crypto.randomUUID();
        // Update the session token so this browser session is now linked
        const updates = [`session_token = $1`];
        const vals    = [newToken];
        if (visitorName) { updates.push(`display_name = $${vals.length+1}`); vals.push(visitorName); }
        if (timezone)    { updates.push(`timezone = $${vals.length+1}`);     vals.push(timezone); }
        await pool.query(
          `UPDATE visitors SET ${updates.join(', ')} WHERE id = $${vals.length+1}`,
          [...vals, existingId]
        );
        // Create a new conversation for the returning visitor
        const convStatus = await pickInitialStatus(tenant_id);
        const { rows: nc } = await pool.query(
          `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel, referrer_url)
           VALUES ($1, $2, $3, $5, 'widget', $4) RETURNING id`,
          [tenant_id, brandId, existingId, referrerUrl || null, convStatus]
        );
        try {
          broadcastToTenant(tenant_id, 'conversation:created', {
            id: nc[0].id,
            status: convStatus, channel: 'widget', priority: 'normal', subject: null,
            visitor_name: visitorName || visitorEmail, visitor_email: visitorEmail,
            agent_name: null, brand_name,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            sla_breach_at: null, assigned_agent_id: null, unread: 0,
            visitor_id: existingId,
          });
        } catch { /* non-fatal */ }
        logger.info({ brandId, visitorId: existingId, dedup: true }, 'widget_session_dedup_reused');
        return res.json({
          sessionToken: newToken,
          conversationId: nc[0].id,
          messages: [],
          brandName: brand_name,
          visitorName: visitorName || null,
        });
      }
    }

    const newToken = crypto.randomUUID();
    const { rows: vNew } = await pool.query(
      `INSERT INTO visitors (tenant_id, brand_id, session_token, display_name, email, timezone)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenant_id, brandId, newToken, visitorName || null, visitorEmail || null, timezone || null]
    );

    const convStatus = await pickInitialStatus(tenant_id);
    const { rows: cNew } = await pool.query(
      `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel, referrer_url)
       VALUES ($1, $2, $3, $5, 'widget', $4) RETURNING id`,
      [tenant_id, brandId, vNew[0].id, referrerUrl || null, convStatus]
    );

    try {
      broadcastToTenant(tenant_id, 'conversation:created', {
        id: cNew[0].id,
        status: convStatus, channel: 'widget', priority: 'normal', subject: null,
        visitor_name: visitorName || 'Visitor', visitor_email: visitorEmail || null,
        agent_name: null, brand_name,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        sla_breach_at: null, assigned_agent_id: null, unread: 0,
        visitor_id: vNew[0].id,
      });
    } catch { /* non-fatal */ }

    logger.info({ brandId, visitorId: vNew[0].id }, 'widget_session_created');
    return res.json({
      sessionToken: newToken,
      conversationId: cNew[0].id,
      messages: [],
      brandName: brand_name,
      visitorName: visitorName || null,
    });
  } catch (err) { next(err); }
});

// ── POST /api/widget/upload ───────────────────────────────────────────────────
// Accepts base64-encoded file data; stores in R2 (or disk fallback); returns URL.
router.post('/upload', express.json({ limit: '20mb' }), async (req, res, next) => {
  try {
    const { filename, mimeType, data } = req.body || {};
    if (!filename || !data) return res.status(400).json({ error: 'filename and data are required' });
    const buffer   = Buffer.from(data, 'base64');
    const ext      = path.extname(filename) || '';
    const safeName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    if (R2_ENABLED) {
      await uploadToR2(buffer, safeName, mimeType || 'application/octet-stream');
      logger.info({ filename, size: buffer.length, storage: 'r2' }, 'widget_file_uploaded');
    } else {
      fs.writeFileSync(path.join(UPLOADS_DIR, safeName), buffer);
      logger.info({ filename, size: buffer.length, storage: 'disk' }, 'widget_file_uploaded');
    }
    return res.json({ url: `/api/widget/files/${safeName}`, name: filename, type: mimeType });
  } catch (err) { next(err); }
});

// ── GET /api/widget/files/:name ───────────────────────────────────────────────
// Serves files from R2 (presigned-URL redirect) or local disk fallback.
// Using redirect avoids streaming issues and helmet CORP conflicts.
router.get('/files/:name', async (req, res, next) => {
  try {
    const name     = path.basename(req.params.name);
    const filePath = path.join(UPLOADS_DIR, name);
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
    if (R2_ENABLED) {
      // Redirect to a short-lived presigned URL — browser loads directly from R2
      const signedUrl = await getPresignedGetUrl(name, 3600);
      return res.redirect(302, signedUrl);
    }
    return res.status(404).json({ error: 'File not found' });
  } catch (err) { next(err); }
});

// ── POST /api/widget/message ──────────────────────────────────────────────────
// REST fallback for visitor messages that include file attachments.
router.post('/message', async (req, res, next) => {
  try {
    const { conversationId, sessionToken, body: msgBody, attachments } = req.body || {};
    if (!conversationId || !sessionToken) {
      return res.status(400).json({ error: 'conversationId and sessionToken are required' });
    }

    const { rows: vRows } = await pool.query(
      'SELECT id, display_name, email FROM visitors WHERE session_token = $1',
      [sessionToken]
    );
    if (!vRows[0]) return res.status(401).json({ error: 'Invalid session' });
    const visitor = vRows[0];

    const { rows: cRows } = await pool.query(
      `SELECT id, status, tenant_id, is_ticket FROM conversations WHERE id = $1 AND visitor_id = $2`,
      [conversationId, visitor.id]
    );
    if (!cRows[0]) return res.status(404).json({ error: 'Conversation not found' });
    if (cRows[0].is_ticket) return res.status(409).json({ error: 'Conversation has been moved to an email ticket' });
    if (cRows[0].status === 'closed') return res.status(409).json({ error: 'Conversation is closed' });

    const attachmentsJson = (attachments && attachments.length > 0) ? JSON.stringify(attachments) : '[]';
    const { rows: newMsg } = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, message_body, is_internal_note, attachments_json)
       VALUES ($1, 'visitor', $2, $3, false, $4)
       RETURNING id, conversation_id, sender_type, message_body, is_internal_note, attachments_json, created_at`,
      [conversationId, visitor.id, (msgBody || '').trim(), attachmentsJson]
    );

    const result = { ...newMsg[0], sender_name: visitor.display_name || visitor.email || 'Visitor' };
    await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

    // Notify agents currently viewing this conversation
    broadcastToConversation(conversationId, 'server:new_message', result);

    // Notify ALL tenant agents so the inbox sidebar updates (unread count,
    // conversation sort order, toast) even if they haven't opened this conversation.
    try {
      broadcastToTenant(cRows[0].tenant_id, 'conversation:visitor_message', { conversationId, message: result });
    } catch { /* non-fatal */ }

    // Non-blocking: AI bot auto-reply. The widget delivers text messages over
    // REST (not socket), so the bot trigger must live here too — otherwise an
    // ai_handling conversation would show the "AI" label but never get a reply.
    if ((msgBody || '').trim()) {
      maybeAutoReply({ conversationId, tenantId: cRows[0].tenant_id, userMessage: msgBody, io: getIo() })
        .catch(() => { /* non-fatal: handled internally */ });
    }

    return res.status(201).json(result);
  } catch (err) { next(err); }
});

// ── POST /api/widget/csat ─────────────────────────────────────────────────────
// Visitor submits a satisfaction score (1–5) after a conversation is closed.
router.post('/csat', async (req, res, next) => {
  try {
    const { conversationId, sessionToken, score } = req.body || {};
    if (!conversationId || !sessionToken || score === undefined || score === null) {
      return res.status(400).json({ error: 'conversationId, sessionToken, and score are required' });
    }
    const s = parseInt(score, 10);
    if (isNaN(s) || s < 1 || s > 5) {
      return res.status(400).json({ error: 'score must be an integer between 1 and 5' });
    }
    const { rows: vRows } = await pool.query(
      'SELECT id FROM visitors WHERE session_token = $1',
      [sessionToken]
    );
    if (!vRows[0]) return res.status(401).json({ error: 'Invalid session' });
    const { rows } = await pool.query(
      `UPDATE conversations SET csat_score = $1, csat_requested = false, updated_at = NOW()
       WHERE id = $2 AND visitor_id = $3
       RETURNING id`,
      [s, conversationId, vRows[0].id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Conversation not found' });
    logger.info({ conversationId, score: s }, 'widget_csat_submitted');
    return res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/widget/csat/dismiss ─────────────────────────────────────────────
// Visitor chose "Just Close" instead of rating. Clear the pending-survey flag
// so the server does not re-surface the survey on the next session/reload.
router.post('/csat/dismiss', async (req, res, next) => {
  try {
    const { conversationId, sessionToken } = req.body || {};
    if (!conversationId || !sessionToken) {
      return res.status(400).json({ error: 'conversationId and sessionToken are required' });
    }
    const { rows: vRows } = await pool.query(
      'SELECT id FROM visitors WHERE session_token = $1',
      [sessionToken]
    );
    if (!vRows[0]) return res.status(401).json({ error: 'Invalid session' });
    await pool.query(
      `UPDATE conversations SET csat_requested = false, updated_at = NOW()
       WHERE id = $1 AND visitor_id = $2`,
      [conversationId, vRows[0].id]
    );
    logger.info({ conversationId }, 'widget_csat_dismissed');
    return res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/widget/socket.io.js ─────────────────────────────────────────────
// Serves the socket.io client bundle. The engine-level static file serving at
// /api/socket.io/socket.io.js does not respond behind the path proxy, so the
// widget loads the client from this plain Express route instead.
let _sioClientJs = null;
router.get('/socket.io.js', (req, res) => {
  try {
    if (!_sioClientJs) {
      const candidates = [
        path.join(process.cwd(), 'node_modules/socket.io/client-dist/socket.io.min.js'),
        path.join(process.cwd(), '../../node_modules/socket.io/client-dist/socket.io.min.js'),
        path.join(__dirname, '../../node_modules/socket.io/client-dist/socket.io.min.js'),
      ];
      for (const p of candidates) {
        try {
          if (fs.existsSync(p)) { _sioClientJs = fs.readFileSync(p, 'utf8'); break; }
        } catch { /* try next */ }
      }
    }
    if (!_sioClientJs) {
      logger.error('socket.io client bundle not found on disk');
      return res.status(404).type('application/javascript').send('// socket.io client not found');
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(_sioClientJs);
  } catch (err) {
    return res.status(500).type('application/javascript').send('// failed to load socket.io client');
  }
});

// ── GET /api/widget/messages ──────────────────────────────────────────────────
// Polling fallback — returns messages for a visitor's conversation.
// Used by the widget every 5 s when the socket may have dropped.
// Query params: tok (sessionToken), cid (conversationId), after (ISO timestamp, optional)
router.get('/messages', async (req, res, next) => {
  try {
    const { tok, cid, after } = req.query;
    if (!tok || !cid) return res.status(400).json({ error: 'tok and cid are required' });

    const { rows: vRows } = await pool.query(
      'SELECT id FROM visitors WHERE session_token = $1',
      [tok]
    );
    if (!vRows[0]) return res.status(401).json({ error: 'Invalid session' });

    // Note: tickets are NOT excluded here. When an agent converts a live chat
    // to a ticket the widget keeps polling this conversation id — returning a
    // 'closed' state (rather than 403) lets the polling fallback surface the
    // CSAT survey / closed notice even if the live socket event was missed.
    const { rows: cRows } = await pool.query(
      'SELECT id, status, csat_requested, csat_score, is_ticket FROM conversations WHERE id = $1 AND visitor_id = $2',
      [cid, vRows[0].id]
    );
    if (!cRows[0]) return res.status(403).json({ error: 'Forbidden' });

    const params = after ? [cid, after] : [cid];
    const { rows: messages } = await pool.query(
      `SELECT m.id, m.conversation_id, m.sender_type, m.message_body, m.attachments_json,
              m.is_internal_note, m.created_at,
              COALESCE(a.name, vis.display_name, vis.email, m.sender_type) AS sender_name
       FROM messages m
       LEFT JOIN agents   a   ON (m.sender_type IN ('agent','bot') AND a.id   = m.sender_id)
       LEFT JOIN visitors vis ON (m.sender_type = 'visitor'        AND vis.id = m.sender_id)
       WHERE m.conversation_id = $1 AND m.is_internal_note = FALSE
         AND m.sender_type != 'system'
         ${after ? 'AND m.created_at > $2' : ''}
       ORDER BY m.created_at ASC LIMIT 40`,
      params
    );
    // Return conversation state alongside messages so the widget's polling
    // fallback can surface a close / CSAT survey even when the live socket
    // event was missed (otherwise the survey only shows on the next action).
    const isTicket = cRows[0].is_ticket === true;
    return res.json({
      messages,
      status: isTicket ? 'closed' : cRows[0].status,
      csatRequested: cRows[0].csat_requested === true,
      csatScore: cRows[0].csat_score,
      convertedToTicket: isTicket,
    });
  } catch (err) { next(err); }
});

// ── PATCH /api/widget/conversations/:id/read ──────────────────────────────────
// Called by the widget on textarea focus to mark messages as read.
// Emits visitor:read_receipt to the conversation room so agents see the receipt.
router.patch('/conversations/:id/read', async (req, res, next) => {
  try {
    const { sessionToken } = req.body || {};
    const convId = req.params.id;
    if (!sessionToken) return res.status(400).json({ error: 'sessionToken required' });
    const { rows: vRows } = await pool.query(
      'SELECT id FROM visitors WHERE session_token = $1', [sessionToken]
    );
    if (!vRows[0]) return res.status(401).json({ error: 'Invalid session' });
    const { rows: cRows } = await pool.query(
      'SELECT id FROM conversations WHERE id = $1 AND visitor_id = $2 AND is_ticket = false', [convId, vRows[0].id]
    );
    if (!cRows[0]) return res.status(403).json({ error: 'Forbidden' });
    const readAt = new Date().toISOString();
    await pool.query('UPDATE conversations SET visitor_last_read_at = $1 WHERE id = $2', [readAt, convId]);
    broadcastToConversation(convId, 'visitor:read_receipt', { conversationId: convId, readAt });
    return res.json({ ok: true, readAt });
  } catch (err) { next(err); }
});

// ── POST /api/widget/ticket ───────────────────────────────────────────────────
// Visitor submits a support ticket. Creates an email-channel conversation.
router.post('/ticket', async (req, res, next) => {
  try {
    const { brandId, sessionToken, subject, description, priority, visitorName, visitorEmail } = req.body || {};
    if (!brandId)            return res.status(400).json({ error: 'brandId is required' });
    if (!subject?.trim())    return res.status(400).json({ error: 'subject is required' });
    if (!description?.trim())return res.status(400).json({ error: 'description is required' });

    let visitorId, tenantId;

    // Try to find existing visitor by session token
    if (sessionToken) {
      const { rows: vr } = await pool.query(
        `SELECT v.id, v.tenant_id FROM visitors v
         WHERE v.session_token = $1 AND v.brand_id = $2`,
        [sessionToken, brandId]
      );
      if (vr[0]) { visitorId = vr[0].id; tenantId = vr[0].tenant_id; }
    }

    // Fallback: get tenant from brand and create a new visitor
    if (!visitorId) {
      const { rows: br } = await pool.query(`SELECT tenant_id FROM brands WHERE id = $1`, [brandId]);
      if (!br[0]) return res.status(404).json({ error: 'Brand not found' });
      tenantId = br[0].tenant_id;
      const newToken = require('crypto').randomBytes(32).toString('hex');
      const { rows: vNew } = await pool.query(
        `INSERT INTO visitors (tenant_id, brand_id, session_token, display_name, email)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, brandId, newToken, visitorName || 'Visitor', visitorEmail || null]
      );
      visitorId = vNew[0].id;
    } else if (visitorName || visitorEmail) {
      await pool.query(
        `UPDATE visitors SET
           display_name = COALESCE($1, display_name),
           email        = COALESCE($2, email)
         WHERE id = $3`,
        [visitorName || null, visitorEmail || null, visitorId]
      );
    }

    const validPriority = ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal';

    // Create ticket conversation (email channel so it shows as a ticket in inbox)
    const { rows: cr } = await pool.query(
      `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel, subject, priority, is_ticket, ticket_number)
       VALUES ($1, $2, $3, 'open', 'email', $4, $5, true, nextval('conversations_ticket_number_seq'))
       RETURNING id, status, subject, priority, created_at, ticket_number`,
      [tenantId, brandId, visitorId, subject.trim(), validPriority]
    );
    const conv = cr[0];

    // Add description as first message
    await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, message_body)
       VALUES ($1, 'visitor', $2, $3)`,
      [conv.id, visitorId, description.trim()]
    );

    // Notify agents in real time so the ticket appears in the inbox with a toast.
    try {
      const { rows: bRows } = await pool.query('SELECT brand_name FROM brands WHERE id = $1', [brandId]);
      const { rows: vRows } = await pool.query('SELECT display_name, email FROM visitors WHERE id = $1', [visitorId]);
      broadcastToTenant(tenantId, 'conversation:created', {
        id: conv.id,
        status: conv.status, channel: 'email', priority: conv.priority,
        subject: conv.subject, is_ticket: true,
        visitor_name: vRows[0]?.display_name || visitorName || 'Visitor',
        visitor_email: vRows[0]?.email || visitorEmail || null,
        agent_name: null, brand_name: bRows[0]?.brand_name || 'Support',
        created_at: conv.created_at, updated_at: conv.created_at,
        sla_breach_at: null, assigned_agent_id: null, unread: 0,
        visitor_id: visitorId, ticket_number: conv.ticket_number ?? null,
      });
    } catch { /* non-fatal */ }

    logger.info({ conversationId: conv.id, brandId, tenantId }, 'widget_ticket_submitted');
    return res.status(201).json({ ok: true, ticketId: conv.id, subject: conv.subject, ticketNumber: conv.ticket_number });
  } catch (err) { next(err); }
});

// ── GET /api/widget/widget.js ─────────────────────────────────────────────────
const WIDGET_JS = `
/* OmniCore Chat Widget — https://omnicore.chat */
(function(w,d){
'use strict';
var script=d.currentScript||(function(){var ss=d.querySelectorAll('script[src]');for(var i=ss.length-1;i>=0;i--){if(ss[i].src&&ss[i].src.indexOf('widget.js')!==-1)return ss[i];}return null;})();
if(!script)return;
var BRAND_ID=script.getAttribute('data-brand-id');
var LABEL=script.getAttribute('data-label')||'Chat with us';
var COLOR=script.getAttribute('data-color')||'#0284c7';
var API_ORIGIN=(function(){try{return new URL(script.src).origin;}catch(e){return w.location.origin;}})();
var API_BASE=API_ORIGIN+'/api';
if(!BRAND_ID)return;

var SK='omnicore_sid_'+BRAND_ID;
var CK='omnicore_cid_'+BRAND_ID;
var VNK='omnicore_vname_'+BRAND_ID;
var VEK='omnicore_vemail_'+BRAND_ID;
var CSAT_KEY='omni_csat_pending_'+BRAND_ID;

var state={
  open:false,loaded:false,loading:false,
  sessionToken:null,conversationId:null,
  messages:[],socket:null,connected:false,
  brandName:LABEL,unread:0,
  visitorName:null,visitorEmail:null,
  csatShown:false,csatPending:false,csatConvId:null,closedShown:false,
  tab:'chat'
};
try{
  state.sessionToken=localStorage.getItem(SK);
  state.conversationId=localStorage.getItem(CK);
  state.visitorName=localStorage.getItem(VNK);
  state.visitorEmail=localStorage.getItem(VEK);
}catch(e){}

var pendingMessages=new Set();
var msgQueue=[];
var isSending=false;
var pendingFile=null;
function reconcileOptimisticMessage(msg){
  for(var i=0;i<state.messages.length;i++){
    var current=state.messages[i];
    if(current&&String(current.id).indexOf('opt_')===0&&current.sender_type==='visitor'&&current.message_body===msg.message_body){
      state.messages[i]=msg;
      return true;
    }
  }
  return false;
}
var els={};
var _pollTimer=null;
var _lastMsgTime=null;
function startPolling(){
  if(_pollTimer)return;
  _pollTimer=setInterval(function(){
    if(!state.sessionToken||!state.conversationId)return;
    var url=API_BASE+'/widget/messages?tok='+encodeURIComponent(state.sessionToken)+'&cid='+encodeURIComponent(state.conversationId)+(_lastMsgTime?'&after='+encodeURIComponent(_lastMsgTime):'');
    fetch(url).then(function(r){return r.ok?r.json():null;}).then(function(data){
      if(!data)return;
      var isObj=!Array.isArray(data);
      var msgs=isObj?(data.messages||[]):data;
      var hadNew=false;
      msgs.forEach(function(msg){
        if(msg.is_internal_note)return;
         // The REST send adds an optimistic visitor bubble immediately. If
         // polling wins the race against the socket echo, reconcile that
         // bubble instead of rendering the persisted message a second time.
         if(msg.sender_type==='visitor'&&pendingMessages.has(msg.message_body)){
           pendingMessages.delete(msg.message_body);
           reconcileOptimisticMessage(msg);
           return;
         }
        if(state.messages.some(function(m){return m.id===msg.id;}))return;
        state.messages.push(msg);
        appendMsg(msg,true);
        if(msg.sender_type==='agent'||msg.sender_type==='bot'){hadNew=true;}
        if(!state.open){setUnread(state.unread+1);}else{markRead();}
      });
      if(hadNew)playChime();
      if(msgs.length){var last=msgs[msgs.length-1];if(last&&last.created_at)_lastMsgTime=last.created_at;}
      // Polling fallback: if the conversation was closed by an agent, surface
      // the CSAT survey (or a closed notice) immediately instead of waiting for
      // the visitor's next action, then stop polling.
      if(isObj&&data.status==='closed'){
        if(data.csatRequested&&(data.csatScore===null||data.csatScore===undefined)&&!state.csatShown){
          showCsatSurvey(state.conversationId);
        }else if(!data.csatRequested){
          showClosedChip();
        }
        stopPolling();
      }
    }).catch(function(){});
  },3000);
}
function stopPolling(){if(_pollTimer){clearInterval(_pollTimer);_pollTimer=null;}}

function playChime(){
  try{
    var ac=new(w.AudioContext||w.webkitAudioContext)();
    var osc=ac.createOscillator();var gain=ac.createGain();
    osc.connect(gain);gain.connect(ac.destination);
    osc.type='sine';osc.frequency.value=880;
    gain.gain.setValueAtTime(0.3,ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.45);
    osc.start(ac.currentTime);osc.stop(ac.currentTime+0.45);
  }catch(e){}
}

function showClosedChip(){
  if(state.closedShown)return;
  state.closedShown=true;
  if(els.inp){els.inp.disabled=true;els.inp.placeholder='Conversation closed';}
  if(els.snd)els.snd.disabled=true;
  var box=qs('#omni-msgs');
  if(!box)return;
  var notice=ce('div');notice.style.cssText='text-align:center;padding:14px 8px 4px;';
  var chip=ce('span');chip.style.cssText='display:inline-block;padding:4px 12px;background:#fee2e2;color:#991b1b;border-radius:999px;font-size:11px;font-weight:600;';
  chip.textContent='Conversation closed';
  notice.appendChild(chip);box.appendChild(notice);
  var newBtn=ce('button');
  newBtn.textContent='Start new chat';
  newBtn.style.cssText='margin:14px auto 4px;display:block;padding:9px 22px;background:'+COLOR+';color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;';
  newBtn.addEventListener('click',startFreshChat);
  box.appendChild(newBtn);
  box.scrollTop=box.scrollHeight;
}

function markReadRest(){
  if(!state.sessionToken||!state.conversationId)return;
  fetch(API_BASE+'/widget/conversations/'+encodeURIComponent(state.conversationId)+'/read',{
    method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sessionToken:state.sessionToken})
  }).catch(function(){});
}

function ce(tag){return d.createElement(tag);}
function qs(sel,el){return(el||d).querySelector(sel);}

function setUnread(n){
  state.unread=n;
  var b=qs('#omni-badge');
  if(b){b.style.display=n>0?'flex':'none';b.textContent=n>9?'9+':String(n);}
}

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtTime(iso){
  try{
    var dt=new Date(iso),now=new Date(),diff=now-dt;
    if(diff<60000)return 'just now';
    if(diff<3600000)return Math.floor(diff/60000)+'m ago';
    if(dt.toDateString()===now.toDateString())return dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    return dt.toLocaleDateString([],{month:'short',day:'numeric'});
  }catch(e){return '';}
}

function stripHtml(html){
  if(!html||typeof html!=='string')return html||'';
  return html.replace(/<br\\s*\\/?>/gi,'\\n').replace(/<\\/p>/gi,'\\n').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\\n{3,}/g,'\\n\\n').trim();
}

function resolveUrl(url){
  if(!url)return '';
  if(url.indexOf('://')!==-1)return url;
  return API_ORIGIN+url;
}

function openLightbox(src){
  var ov=ce('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:2147483647;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
  var img=ce('img');
  img.src=src;
  img.style.cssText='max-width:92vw;max-height:88vh;object-fit:contain;border-radius:10px;box-shadow:0 12px 60px rgba(0,0,0,.6);';
  var closeBtn=ce('button');
  closeBtn.textContent='\u00d7';
  closeBtn.style.cssText='position:absolute;top:16px;right:20px;background:rgba(255,255,255,.15);border:none;color:#fff;font-size:28px;line-height:1;width:40px;height:40px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;';
  closeBtn.addEventListener('click',function(e){e.stopPropagation();d.body.removeChild(ov);});
  ov.addEventListener('click',function(){d.body.removeChild(ov);});
  img.addEventListener('click',function(e){e.stopPropagation();});
  ov.appendChild(img);
  ov.appendChild(closeBtn);
  d.body.appendChild(ov);
}

function appendMsg(msg,scroll){
  if(msg.is_internal_note)return;
  if(msg.sender_type==='system')return;
  var box=qs('#omni-msgs');
  if(!box)return;
  var isAgent=msg.sender_type==='agent'||msg.sender_type==='bot';
  var wrap=ce('div');
  wrap.style.cssText='display:flex;flex-direction:column;align-items:'+(isAgent?'flex-start':'flex-end')+';gap:2px;margin-bottom:12px;';
  var lbl=ce('span');
  lbl.style.cssText='font-size:10px;color:#94a3b8;'+(isAgent?'margin-left:8px':'margin-right:8px');
  lbl.textContent=(isAgent?(msg.sender_name||'Agent'):(state.visitorName||'You'))+' \u00b7 '+fmtTime(msg.created_at);
  wrap.appendChild(lbl);
  if(msg.message_body){
    var bbl=ce('div');
    var baseStyle='max-width:78%;padding:10px 13px;border-radius:16px;font-size:13px;line-height:1.55;word-break:break-word;';
    var agentStyle='border-bottom-left-radius:4px;background:#f1f5f9;color:#1e293b;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,.05);white-space:pre-wrap;';
    var visitorStyle='border-bottom-right-radius:4px;background:'+COLOR+';color:#fff;';
    bbl.style.cssText=baseStyle+(isAgent?agentStyle:visitorStyle);
    if(isAgent){
      bbl.innerHTML=msg.message_body||'';
      bbl.querySelectorAll('p').forEach(function(p){p.style.margin='0 0 4px 0';});
      bbl.querySelectorAll('p:last-child').forEach(function(p){p.style.marginBottom='0';});
    }else{
      bbl.textContent=stripHtml(msg.message_body||'');
    }
    wrap.appendChild(bbl);
  }
  var atts=[];
  try{if(msg.attachments_json){var p=typeof msg.attachments_json==='string'?JSON.parse(msg.attachments_json):msg.attachments_json;if(Array.isArray(p))atts=p;}}catch(e){}
  atts.forEach(function(att){
    var fullUrl=resolveUrl(att.url||att.attachment_url||'');
    if(!fullUrl)return;
    var isImg=(att.type&&att.type.startsWith('image/'))||/\\.(png|jpe?g|gif|webp|svg)(\\?|$)/i.test(fullUrl);
    var aw=ce('div');aw.style.cssText='max-width:78%;margin-top:6px;';
    if(isImg){
      var thumb=ce('img');
      thumb.src=fullUrl;
      thumb.alt=att.name||'image';
      thumb.style.cssText='max-width:200px;max-height:160px;border-radius:10px;display:block;cursor:zoom-in;object-fit:cover;border:1px solid rgba(0,0,0,.08);';
      thumb.addEventListener('click',function(){openLightbox(fullUrl);});
      aw.appendChild(thumb);
    }else{
      var lnk=ce('a');
      lnk.href=fullUrl;
      lnk.setAttribute('download',att.name||'download');
      lnk.style.cssText='display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:500;'+(isAgent?'background:#e2e8f0;color:#334155;':'background:rgba(255,255,255,.22);color:#fff;');
      lnk.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'+escHtml(att.name||'Download File');
      aw.appendChild(lnk);
    }
    wrap.appendChild(aw);
  });
  box.appendChild(wrap);
  if(scroll!==false)box.scrollTop=box.scrollHeight;
}

function showCsatSurvey(convId){
  var targetConvId=convId||state.conversationId;
  try{if(targetConvId)localStorage.setItem(CSAT_KEY,targetConvId);}catch(e){}
  if(!qs('#omni-msgs')){
    state.csatPending=true;state.csatConvId=targetConvId;return;
  }
  if(state.csatShown)return;
  state.csatShown=true;state.csatPending=false;
  if(els.inp){els.inp.disabled=true;els.inp.placeholder='Conversation closed';}
  if(els.snd)els.snd.disabled=true;
  var box=qs('#omni-msgs');
  if(!box)return;
  var notice=ce('div');
  notice.style.cssText='text-align:center;padding:14px 8px 2px;';
  var chip=ce('span');
  chip.style.cssText='display:inline-block;padding:4px 12px;background:#fee2e2;color:#991b1b;border-radius:999px;font-size:11px;font-weight:600;';
  chip.textContent='Conversation closed';
  notice.appendChild(chip);
  box.appendChild(notice);
  var card=ce('div');
  card.style.cssText='margin:12px 14px 6px;padding:18px 14px;background:#fff;border-radius:14px;border:1px solid #e2e8f0;text-align:center;';
  var title=ce('p');
  title.style.cssText='font-size:14px;font-weight:700;color:#0f172a;margin:0 0 4px;';
  title.textContent='How did we do?';
  var sub=ce('p');
  sub.style.cssText='font-size:12px;color:#64748b;margin:0 0 14px;';
  sub.textContent='Rate your support experience';
  var stars=ce('div');
  stars.id='omni-csat-stars';
  stars.style.cssText='display:flex;justify-content:center;gap:8px;margin-bottom:10px;';
  var fbk=ce('p');
  fbk.id='omni-csat-fbk';
  fbk.style.cssText='font-size:12px;color:#94a3b8;margin:0;min-height:16px;';
  card.appendChild(title);card.appendChild(sub);card.appendChild(stars);card.appendChild(fbk);
  box.appendChild(card);
  box.scrollTop=box.scrollHeight;
  if(state.open)setUnread(0);
  var selectedScore=0;
  for(var i=1;i<=5;i++){
    (function(score){
      var btn=ce('button');
      btn.style.cssText='background:none;border:none;font-size:28px;cursor:pointer;color:#e2e8f0;padding:0;line-height:1;transition:color .15s;';
      btn.textContent='\u2605';
      btn.setAttribute('aria-label',score+' star'+(score>1?'s':''));
      btn.addEventListener('mouseenter',function(){
        if(stars.dataset.locked)return;
        var bs=stars.querySelectorAll('button');
        for(var j=0;j<bs.length;j++){bs[j].style.color=j<score?COLOR:'#e2e8f0';}
      });
      btn.addEventListener('mouseleave',function(){
        if(stars.dataset.locked)return;
        var bs=stars.querySelectorAll('button');
        for(var j=0;j<bs.length;j++){bs[j].style.color=j<selectedScore?COLOR:'#e2e8f0';}
      });
      btn.addEventListener('click',function(){
        if(stars.dataset.locked)return;
        selectedScore=score;
        var bs=stars.querySelectorAll('button');
        for(var j=0;j<bs.length;j++){bs[j].style.color=j<score?COLOR:'#e2e8f0';}
        if(fbk)fbk.textContent='';
      });
      stars.appendChild(btn);
    })(i);
  }
  var actions=ce('div');
  actions.style.cssText='display:flex;gap:8px;margin-top:14px;justify-content:center;';
  var sendBtn=ce('button');
  sendBtn.textContent='Send Rating';
  sendBtn.style.cssText='flex:1;max-width:140px;padding:8px 0;background:'+COLOR+';color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity .12s;';
  var skipBtn=ce('button');
  skipBtn.textContent='Just Close';
  skipBtn.style.cssText='flex:1;max-width:130px;padding:8px 0;background:#f1f5f9;color:#475569;border:none;border-radius:10px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;transition:opacity .12s;';
  function lockCsatActions(){
    sendBtn.disabled=true;skipBtn.disabled=true;
    sendBtn.style.opacity='0.5';skipBtn.style.opacity='0.5';
    stars.dataset.locked='1';
    var bs=stars.querySelectorAll('button');
    for(var j=0;j<bs.length;j++){bs[j].disabled=true;bs[j].style.cursor='default';}
  }
  sendBtn.addEventListener('click',function(){
    if(sendBtn.disabled)return;
    if(!selectedScore){
      if(fbk)fbk.textContent='Please pick a star rating first.';
      fbk.style.color='#ef4444';
      return;
    }
    lockCsatActions();
    submitCsat(selectedScore,targetConvId);
  });
  skipBtn.addEventListener('click',function(){
    if(skipBtn.disabled)return;
    lockCsatActions();
    try{localStorage.removeItem(CSAT_KEY);}catch(e){}
    // Tell the server the survey was dismissed so it won't be re-surfaced on reload.
    try{
      fetch(API_BASE+'/widget/csat/dismiss',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({conversationId:targetConvId||state.conversationId,sessionToken:state.sessionToken})
      }).catch(function(){});
    }catch(e){}
    if(fbk)fbk.textContent='';
    var box2=qs('#omni-msgs');
    if(box2){
      var nb=ce('button');
      nb.textContent='Start new chat';
      nb.style.cssText='margin:14px auto 4px;display:block;padding:9px 22px;background:'+COLOR+';color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;';
      nb.addEventListener('click',startFreshChat);
      box2.appendChild(nb);
      box2.scrollTop=box2.scrollHeight;
    }
  });
  actions.appendChild(sendBtn);
  actions.appendChild(skipBtn);
  card.appendChild(actions);
}

function submitCsat(score,convId){
  var fbk=qs('#omni-csat-fbk');
  if(fbk)fbk.textContent='Submitting\u2026';
  fetch(API_BASE+'/widget/csat',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({conversationId:convId||state.conversationId,sessionToken:state.sessionToken,score:score})
  }).then(function(r){return r.json();}).then(function(){
    try{localStorage.removeItem(CSAT_KEY);}catch(e){}
    if(fbk)fbk.textContent='Thank you for your feedback! \u2764\ufe0f';
    var box=qs('#omni-msgs');
    if(box){
      var newBtn=ce('button');
      newBtn.textContent='Start new chat';
      newBtn.style.cssText='margin:14px auto 4px;display:block;padding:9px 22px;background:'+COLOR+';color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;';
      newBtn.addEventListener('click',startFreshChat);
      box.appendChild(newBtn);
      box.scrollTop=box.scrollHeight;
    }
  }).catch(function(){
    try{localStorage.removeItem(CSAT_KEY);}catch(e){}
    if(fbk)fbk.textContent='Thank you for your feedback! \u2764\ufe0f';
  });
}
function startFreshChat(){
  state.loaded=false;state.messages=[];state.csatShown=false;state.csatPending=false;state.csatConvId=null;state.closedShown=false;
  if(els.msgs){while(els.msgs.firstChild)els.msgs.removeChild(els.msgs.firstChild);}
  if(els.inp){els.inp.disabled=false;els.inp.placeholder='Type a message\u2026';}
  if(els.snd)els.snd.disabled=false;
  stopPolling();_lastMsgTime=null;
  if(state.socket){try{state.socket.disconnect();}catch(e){}state.socket=null;state.connected=false;}
  // Keep sessionToken/visitorName in state and localStorage (preserves visitor identity).
  // Pass forceNew so the server creates a fresh conversation without recreating the visitor.
  startSession(true);
}

function buildDom(){
  if(qs('#omni-widget-root'))return;
  var style=ce('style');
  style.textContent=[
    '#omni-fab{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:'+COLOR+';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,.22);z-index:2147483640;transition:transform .2s;}',
    '#omni-fab:hover{transform:scale(1.08);}',
    '#omni-badge{position:absolute;top:-3px;right:-3px;min-width:18px;height:18px;background:#ef4444;border-radius:9px;display:none;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;padding:0 4px;border:2px solid #fff;}',
    '#omni-widget-root{position:fixed;bottom:90px;right:24px;width:360px;height:580px;background:#f8fafc;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.06);display:flex;flex-direction:column;overflow:hidden;z-index:2147483639;}',
    '@media(max-width:440px){#omni-widget-root{width:calc(100vw - 16px);height:calc(100vh - 96px);bottom:80px;right:8px;border-radius:16px;}}',
    '#omni-header{background:'+COLOR+';padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;}',
    '#omni-title{color:#fff;font-size:15px;font-weight:700;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '#omni-subtitle{color:rgba(255,255,255,.8);font-size:11px;margin:2px 0 0;display:flex;align-items:center;gap:4px;}',
    '#omni-close-btn{background:rgba(255,255,255,.18);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;transition:background .15s;}',
    '#omni-close-btn:hover{background:rgba(255,255,255,.3);}',
    '#omni-prechat{flex:1;display:flex;flex-direction:column;justify-content:center;padding:28px 24px;background:#f8fafc;overflow-y:auto;}',
    '#omni-prechat h3{font-size:17px;font-weight:700;color:#0f172a;margin:0 0 6px;}',
    '#omni-prechat p{font-size:12px;color:#64748b;margin:0 0 22px;line-height:1.6;}',
    '.om-field{margin-bottom:14px;}',
    '.om-field label{display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em;}',
    '.om-field input{width:100%;padding:10px 13px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;background:#fff;transition:border-color .15s;font-family:inherit;}',
    '.om-field input:focus{border-color:'+COLOR+';}',
    '.om-start-btn{width:100%;padding:12px;background:'+COLOR+';color:#fff;border:none;border-radius:11px;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s;letter-spacing:.02em;font-family:inherit;}',
    '.om-start-btn:hover{opacity:.9;}',
    '.om-start-btn:disabled{opacity:.5;cursor:default;}',
    '#omni-loading{flex:1;display:flex;align-items:center;justify-content:center;font-size:13px;color:#94a3b8;font-family:inherit;}',
    '#omni-msgs{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;}',
    '#omni-msgs::-webkit-scrollbar{width:4px;}',
    '#omni-msgs::-webkit-scrollbar-thumb{background:#e2e8f0;border-radius:2px;}',
    '#omni-attach-preview{padding:6px 12px;background:#eff6ff;border-top:1px solid #bfdbfe;display:none;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:#1d4ed8;flex-shrink:0;}',
    '#omni-attach-clear{background:none;border:none;cursor:pointer;color:#60a5fa;font-size:15px;padding:0;line-height:1;flex-shrink:0;}',
    '#omni-composer{padding:10px 12px;background:#fff;border-top:1px solid #e2e8f0;display:flex;align-items:flex-end;gap:8px;flex-shrink:0;}',
    '#omni-inp{flex:1;resize:none;border:1.5px solid #e2e8f0;border-radius:12px;padding:9px 13px;font-size:13px;line-height:1.45;outline:none;max-height:100px;background:#f8fafc;color:#1e293b;transition:border-color .15s;font-family:inherit;}',
    '#omni-inp:focus{border-color:'+COLOR+';background:#fff;}',
    '#omni-inp:disabled{opacity:.5;cursor:not-allowed;}',
    '#omni-file-btn{width:34px;height:34px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#64748b;transition:background .15s;}',
    '#omni-file-btn:hover{background:#e2e8f0;}',
    '#omni-snd{width:36px;height:36px;background:'+COLOR+';border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s;}',
    '#omni-snd:hover{opacity:.9;}',
    '#omni-snd:disabled{opacity:.35;cursor:default;}',
    '#omni-footer{padding:5px;text-align:center;background:#fff;border-top:1px solid #f1f5f9;font-size:9.5px;color:#94a3b8;font-family:inherit;flex-shrink:0;}',
    '#omni-tabs{display:flex;border-bottom:1px solid #e2e8f0;background:#fff;flex-shrink:0;}',
    '.omni-tab{flex:1;padding:9px 0;font-size:12px;font-weight:600;border:none;background:none;cursor:pointer;color:#94a3b8;transition:color .15s,border-color .15s;border-bottom:2px solid transparent;font-family:inherit;}',
    '.omni-tab.active{color:'+COLOR+';border-bottom-color:'+COLOR+';}',
    '#omni-ticket-panel{flex:1;overflow-y:auto;padding:16px;background:#f8fafc;display:none;flex-direction:column;}',
    '#omni-ticket-panel h4{font-size:14px;font-weight:700;color:#0f172a;margin:0 0 4px;}',
    '#omni-ticket-panel p{font-size:12px;color:#64748b;margin:0 0 14px;line-height:1.5;}',
    '.om-tfield{margin-bottom:12px;}',
    '.om-tfield label{display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em;}',
    '.om-tfield input,.om-tfield textarea,.om-tfield select{width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;background:#fff;font-family:inherit;transition:border-color .15s;}',
    '.om-tfield input:focus,.om-tfield textarea:focus,.om-tfield select:focus{border-color:'+COLOR+';}',
    '.om-tfield textarea{resize:vertical;min-height:80px;}',
    '#omni-ticket-submit{width:100%;padding:11px;background:'+COLOR+';color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s;font-family:inherit;margin-top:4px;}',
    '#omni-ticket-submit:disabled{opacity:.5;cursor:default;}',
    '#omni-ticket-msg{font-size:12px;text-align:center;margin-top:10px;min-height:16px;}'
  ].join('');
  d.head.appendChild(style);

  var fab=ce('button');
  fab.id='omni-fab';fab.setAttribute('aria-label','Open chat');
  fab.innerHTML=chatIcon()+'<div id="omni-badge" style="display:none">0</div>';
  d.body.appendChild(fab);
  els.fab=fab;

  var root=ce('div');root.id='omni-widget-root';root.style.display='none';
  root.innerHTML=(
    '<div id="omni-header">'+
      '<div style="flex:1;min-width:0">'+
        '<p id="omni-title">'+escHtml(state.brandName)+'</p>'+
        '<p id="omni-subtitle"><span style="width:7px;height:7px;border-radius:50%;background:#4ade80;display:inline-block;margin-right:4px"></span>Online \u2014 we reply fast</p>'+
      '</div>'+
      '<button id="omni-close-btn" aria-label="Close">\u2715</button>'+
    '</div>'+
    '<div id="omni-tabs">'+
      '<button class="omni-tab active" id="omni-tab-chat">\uD83D\uDCAC Chat</button>'+
      '<button class="omni-tab" id="omni-tab-ticket">\uD83C\uDFAB Submit Ticket</button>'+
    '</div>'+
    '<div id="omni-prechat" style="display:none">'+
      '<h3>\uD83D\uDC4B Welcome!</h3>'+
      '<p>Please introduce yourself so our support team can assist you.</p>'+
      '<div class="om-field"><label>Your Name <span style="color:#ef4444">*</span></label><input id="om-vname" type="text" placeholder="Jane Smith" autocomplete="name"></div>'+
      '<div class="om-field"><label>Email Address</label><input id="om-vemail" type="email" placeholder="jane@example.com" autocomplete="email"></div>'+
      '<button class="om-start-btn" id="om-start-btn">Start Chat \u2192</button>'+
    '</div>'+
    '<div id="omni-loading" style="display:none">Connecting\u2026</div>'+
    '<div id="omni-msgs" style="display:none"></div>'+
    '<div id="omni-attach-preview"><span id="omni-attach-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><button id="omni-attach-clear">\u2715</button></div>'+
    '<div id="omni-composer" style="display:none">'+
      '<button id="omni-file-btn" title="Attach file"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>'+
      '<input type="file" id="omni-file-input" accept="image/*,.pdf,.csv,.doc,.docx,.xls,.xlsx,.txt" style="display:none">'+
      '<textarea id="omni-inp" rows="1" placeholder="Type a message\u2026"></textarea>'+
      '<button id="omni-snd" aria-label="Send"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>'+
    '</div>'+
    '<div id="omni-ticket-panel">'+
      '<h4>\uD83C\uDFAB Submit a Ticket</h4>'+
      '<p>Describe your issue and we\u2019ll get back to you by email.</p>'+
      '<div class="om-tfield"><label>Name</label><input id="om-t-name" type="text" placeholder="Jane Smith" autocomplete="name"></div>'+
      '<div class="om-tfield"><label>Email</label><input id="om-t-email" type="email" placeholder="jane@example.com" autocomplete="email"></div>'+
      '<div class="om-tfield"><label>Subject <span style="color:#ef4444">*</span></label><input id="om-t-subject" type="text" placeholder="Briefly describe your issue"></div>'+
      '<div class="om-tfield"><label>Description <span style="color:#ef4444">*</span></label><textarea id="om-t-desc" placeholder="Tell us more\u2026"></textarea></div>'+
      '<div class="om-tfield"><label>Priority</label><select id="om-t-priority"><option value="normal">Normal</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>'+
      '<button id="omni-ticket-submit">Send Ticket</button>'+
      '<p id="omni-ticket-msg" style="color:#64748b"></p>'+
    '</div>'+
    '<div id="omni-footer">Powered by <strong>OmniCore</strong></div>'
  );
  d.body.appendChild(root);
  els.root=root;

  els.title    =qs('#omni-title');
  els.msgs     =qs('#omni-msgs');
  els.inp      =qs('#omni-inp');
  els.snd      =qs('#omni-snd');
  els.loading  =qs('#omni-loading');
  els.composer =qs('#omni-composer');
  els.prechat  =qs('#omni-prechat');
  els.fileBtn  =qs('#omni-file-btn');
  els.fileInput=qs('#omni-file-input');
  els.attPrev  =qs('#omni-attach-preview');
  els.attName  =qs('#omni-attach-name');

  fab.addEventListener('click',toggle);
  qs('#omni-close-btn').addEventListener('click',close);
  els.inp.addEventListener('input',function(){autoResize();emitTyping();});
  els.inp.addEventListener('focus',function(){if(state.open&&state.conversationId){markRead();markReadRest();}});
  els.inp.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
  els.inp.addEventListener('paste',function(e){
    var items=e.clipboardData&&e.clipboardData.items;
    if(!items)return;
    for(var i=0;i<items.length;i++){
      if(items[i].type.startsWith('image/')){
        e.preventDefault();
        var file=items[i].getAsFile();
        if(!file)continue;
        (function(f){
          var reader=new FileReader();
          reader.onload=function(ev){
            pendingFile={file:f,dataUrl:ev.target.result,name:'paste-'+Date.now()+'.png',type:f.type};
            els.attName.textContent='\uD83D\uDCCE Pasted image';
            els.attPrev.style.display='flex';
            els.inp.placeholder='Add a message (optional)\u2026';
          };
          reader.readAsDataURL(f);
        })(file);
        break;
      }
    }
  });
  els.snd.addEventListener('click',send);
  els.fileBtn.addEventListener('click',function(){els.fileInput.click();});
  els.fileInput.addEventListener('change',onFileSelect);
  qs('#omni-attach-clear').addEventListener('click',clearAttach);
  qs('#om-start-btn').addEventListener('click',submitPreChat);
  qs('#om-vname').addEventListener('keydown',function(e){if(e.key==='Enter'){var em=qs('#om-vemail');em?em.focus():submitPreChat();}});
  qs('#om-vemail').addEventListener('keydown',function(e){if(e.key==='Enter')submitPreChat();});
  qs('#omni-tab-chat').addEventListener('click',function(){switchTab('chat');});
  qs('#omni-tab-ticket').addEventListener('click',function(){switchTab('ticket');});
  qs('#omni-ticket-submit').addEventListener('click',submitTicket);
  enableDrag();
}

// Drag the chat panel around the screen by its header. Switches the panel from
// its default bottom/right anchor to absolute left/top on first drag, and clamps
// the panel within the viewport. Works for mouse and touch.
function enableDrag(){
  var header=qs('#omni-header');
  var root=els.root;
  if(!header||!root)return;
  var dragging=false,sx=0,sy=0,ox=0,oy=0;
  header.style.cursor='move';
  header.style.userSelect='none';
  function start(e){
    if(e.target&&e.target.closest&&e.target.closest('#omni-close-btn'))return;
    dragging=true;
    var pt=e.touches?e.touches[0]:e;
    var r=root.getBoundingClientRect();
    root.style.left=r.left+'px';root.style.top=r.top+'px';
    root.style.right='auto';root.style.bottom='auto';
    sx=pt.clientX;sy=pt.clientY;ox=r.left;oy=r.top;
    d.addEventListener('mousemove',move);d.addEventListener('mouseup',end);
    d.addEventListener('touchmove',move,{passive:false});d.addEventListener('touchend',end);
  }
  function move(e){
    if(!dragging)return;
    if(e.cancelable)e.preventDefault();
    var pt=e.touches?e.touches[0]:e;
    var nx=ox+(pt.clientX-sx),ny=oy+(pt.clientY-sy);
    var maxX=Math.max(0,w.innerWidth-root.offsetWidth);
    var maxY=Math.max(0,w.innerHeight-root.offsetHeight);
    root.style.left=Math.max(0,Math.min(nx,maxX))+'px';
    root.style.top=Math.max(0,Math.min(ny,maxY))+'px';
  }
  function end(){
    dragging=false;
    d.removeEventListener('mousemove',move);d.removeEventListener('mouseup',end);
    d.removeEventListener('touchmove',move);d.removeEventListener('touchend',end);
  }
  header.addEventListener('mousedown',start);
  header.addEventListener('touchstart',start,{passive:true});
}

function switchTab(t){
  state.tab=t;
  var tabChat=qs('#omni-tab-chat');
  var tabTicket=qs('#omni-tab-ticket');
  var ticketPanel=qs('#omni-ticket-panel');
  if(t==='chat'){
    if(tabChat)tabChat.className='omni-tab active';
    if(tabTicket)tabTicket.className='omni-tab';
    if(ticketPanel)ticketPanel.style.display='none';
    if(state.loaded){
      if(els.msgs)els.msgs.style.display='block';
      if(els.composer)els.composer.style.display='flex';
    }else if(!state.visitorName&&!state.sessionToken){
      if(els.prechat)els.prechat.style.display='flex';
    }else if(state.loading){
      if(els.loading)els.loading.style.display='flex';
    }
  }else{
    if(tabChat)tabChat.className='omni-tab';
    if(tabTicket)tabTicket.className='omni-tab active';
    if(ticketPanel)ticketPanel.style.display='flex';
    if(els.prechat)els.prechat.style.display='none';
    if(els.loading)els.loading.style.display='none';
    if(els.msgs)els.msgs.style.display='none';
    if(els.composer)els.composer.style.display='none';
    var tn=qs('#om-t-name');if(tn&&state.visitorName&&!tn.value)tn.value=state.visitorName;
    var te=qs('#om-t-email');if(te&&state.visitorEmail&&!te.value)te.value=state.visitorEmail;
  }
}

function submitTicket(){
  var subj=(qs('#om-t-subject')||{value:''}).value.trim();
  var desc=(qs('#om-t-desc')||{value:''}).value.trim();
  var name=((qs('#om-t-name')||{value:''}).value||'').trim()||state.visitorName||'Visitor';
  var email=((qs('#om-t-email')||{value:''}).value||'').trim()||state.visitorEmail||null;
  var priority=((qs('#om-t-priority')||{value:'normal'}).value)||'normal';
  var msgEl=qs('#omni-ticket-msg');
  var btn=qs('#omni-ticket-submit');
  if(!subj){if(msgEl){msgEl.style.color='#ef4444';msgEl.textContent='Subject is required.';}return;}
  if(!desc){if(msgEl){msgEl.style.color='#ef4444';msgEl.textContent='Description is required.';}return;}
  if(btn)btn.disabled=true;
  if(msgEl){msgEl.style.color='#64748b';msgEl.textContent='Sending\u2026';}
  fetch(API_BASE+'/widget/ticket',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({brandId:BRAND_ID,sessionToken:state.sessionToken,subject:subj,description:desc,priority:priority,visitorName:name,visitorEmail:email})
  }).then(function(r){return r.json();}).then(function(data){
    if(data.ok){
      if(msgEl){msgEl.style.color='#22c55e';msgEl.textContent='\u2713 Ticket submitted! We\u2019ll reply to your email.';}
      var subEl=qs('#om-t-subject');if(subEl)subEl.value='';
      var dscEl=qs('#om-t-desc');if(dscEl)dscEl.value='';
    }else{
      if(msgEl){msgEl.style.color='#ef4444';msgEl.textContent=data.error||'Submission failed.';}
    }
    if(btn)btn.disabled=false;
  }).catch(function(){
    if(msgEl){msgEl.style.color='#ef4444';msgEl.textContent='Network error. Please try again.';}
    if(btn)btn.disabled=false;
  });
}

function chatIcon(){
  return '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;pointer-events:none;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';
}
function closeIcon(){
  return '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
}

function onFileSelect(){
  var file=els.fileInput.files[0];
  if(!file)return;
  if(file.size>5*1024*1024){alert('File too large. Max 5\u202fMB.');return;}
  var reader=new FileReader();
  reader.onload=function(e){
    pendingFile={file:file,dataUrl:e.target.result,name:file.name,type:file.type};
    els.attName.textContent='\uD83D\uDCCE '+file.name;
    els.attPrev.style.display='flex';
    els.inp.placeholder='Add a message (optional)\u2026';
  };
  reader.readAsDataURL(file);
  els.fileInput.value='';
}
function clearAttach(){
  pendingFile=null;
  els.attPrev.style.display='none';
  els.inp.placeholder='Type a message\u2026';
}

function submitPreChat(){
  var nameEl=qs('#om-vname'),emailEl=qs('#om-vemail');
  var name=(nameEl.value||'').trim();
  if(!name){nameEl.focus();nameEl.style.borderColor='#ef4444';return;}
  nameEl.style.borderColor='';
  var email=(emailEl.value||'').trim()||null;
  state.visitorName=name;state.visitorEmail=email;
  try{localStorage.setItem(VNK,name);if(email)localStorage.setItem(VEK,email);}catch(e){}
  els.prechat.style.display='none';
  startSession();
}

function autoResize(){
  els.inp.style.height='auto';
  els.inp.style.height=Math.min(els.inp.scrollHeight,100)+'px';
}

function toggle(){if(state.open)close();else open();}

function open(){
  state.open=true;
  els.root.style.display='flex';
  els.fab.innerHTML=closeIcon()+'<div id="omni-badge" style="display:none">0</div>';
  setUnread(0);
  markRead();
  if(!state.loaded&&!state.loading){
    if(!state.visitorName&&!state.sessionToken){
      els.prechat.style.display='flex';
      setTimeout(function(){var v=qs('#om-vname');if(v)v.focus();},120);
    }else{
      startSession();
    }
  }else if(state.loaded){
    if(state.csatPending&&!state.csatShown)showCsatSurvey(state.csatConvId);
    setTimeout(function(){if(els.msgs)els.msgs.scrollTop=els.msgs.scrollHeight;},50);
  }
}
function markRead(){
  if(state.socket&&state.connected&&state.conversationId){
    state.socket.emit('visitor:mark_read',{conversationId:state.conversationId});
  }
}
function close(){
  state.open=false;
  els.root.style.display='none';
  if(els.fab)els.fab.innerHTML=chatIcon()+'<div id="omni-badge" style="display:none">0</div>';
}

function showLoading(){
  if(els.loading)els.loading.style.display='flex';
  if(els.msgs)els.msgs.style.display='none';
  if(els.composer)els.composer.style.display='none';
}
function showChat(){
  if(els.loading)els.loading.style.display='none';
  if(els.msgs)els.msgs.style.display='block';
  if(els.composer)els.composer.style.display='flex';
}

function startSession(forceNew){
  var csatPendingId=null;
  try{csatPendingId=localStorage.getItem(CSAT_KEY);}catch(e){}
  if(csatPendingId&&!forceNew){
    state.loading=false;state.loaded=true;
    showChat();
    showCsatSurvey(csatPendingId);
    return;
  }
  if(state.loading)return;
  state.loading=true;
  showLoading();
  var tz='';try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(e){}
  fetch(API_BASE+'/widget/session',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      brandId:BRAND_ID,sessionToken:state.sessionToken,
      visitorName:state.visitorName||null,
      visitorEmail:state.visitorEmail||null,
      timezone:tz||null,
      forceNew:forceNew||false,
      referrerUrl:w.location.href||null
    })
  })
  .then(function(r){return r.json();})
  .then(function(data){
    state.loading=false;state.loaded=true;
    state.sessionToken=data.sessionToken;
    state.conversationId=data.conversationId;
    if(data.visitorName&&!state.visitorName)state.visitorName=data.visitorName;
    if(data.brandName)state.brandName=data.brandName;
    try{localStorage.setItem(SK,data.sessionToken);localStorage.setItem(CK,data.conversationId);}catch(e){}
    if(els.title)els.title.textContent=state.brandName;
    state.messages=data.messages||[];
    showChat();
    state.messages.forEach(function(m){appendMsg(m,false);});
    if(els.msgs)els.msgs.scrollTop=els.msgs.scrollHeight;
    _lastMsgTime=state.messages.length?state.messages[state.messages.length-1].created_at:null;
    startPolling();
    initSio();
    // The server reported this conversation was closed with a pending CSAT
    // survey (e.g. the live socket event was missed before this reload).
    // Re-show the survey so it is never silently skipped.
    if(data.csatPending){showCsatSurvey(data.conversationId);}
  })
  .catch(function(){
    state.loading=false;
    if(els.loading){
      els.loading.textContent='Could not connect. Click to retry.';
      els.loading.style.cursor='pointer';
      els.loading.onclick=function(){els.loading.textContent='Connecting\u2026';els.loading.style.cursor='default';startSession();};
    }
  });
}

function initSio(){
  if(state.socket)return;
  var s=ce('script');s.src=API_BASE+'/widget/socket.io.js';
  s.onerror=function(){try{s.parentNode.removeChild(s);}catch(e){}setTimeout(initSio,5000);};
  s.onload=function(){
    if(!w.io){setTimeout(initSio,5000);return;}
    var sk=w.io(API_ORIGIN,{path:'/api/socket.io',auth:{sessionToken:state.sessionToken},transports:['websocket','polling'],reconnectionDelay:1500});
    state.socket=sk;
    sk.on('connect',function(){
      state.connected=true;
      sk.emit('join:conversation',{conversationId:state.conversationId});
      while(msgQueue.length>0)sk.emit('client:send_message',{conversationId:state.conversationId,body:msgQueue.shift()});
      emitPage();
      emitPageView();
    });
    sk.on('disconnect',function(){state.connected=false;});
    sk.on('server:new_message',function(msg){
      if(msg.is_internal_note)return;
      if(msg.sender_type==='system')return;
      if(msg.id&&state.messages.some(function(m){return m.id===msg.id;}))return;
      if(msg.sender_type==='visitor'&&pendingMessages.has(msg.message_body)){
        pendingMessages.delete(msg.message_body);
         reconcileOptimisticMessage(msg);
         return;
      }
      state.messages.push(msg);
      appendMsg(msg,true);
      if(msg.sender_type==='agent'||msg.sender_type==='bot'){playChime();}
      if(state.open){markRead();}else{setUnread(state.unread+1);}
    });
    sk.on('conversation:closed',function(data){
      var cid=(data&&data.conversationId)||state.conversationId;
      if(data&&data.trigger_csat){
        showCsatSurvey(cid);
      }else{
        showClosedChip();
      }
    });
  };
  d.head.appendChild(s);
}

function emitPage(){
  if(!state.socket||!state.connected||!state.conversationId)return;
  state.socket.emit('visitor:page_change',{conversationId:state.conversationId,url:w.location.href});
}
var _typingTimer=null;
function emitTyping(){
  if(!state.socket||!state.connected||!state.conversationId)return;
  state.socket.emit('visitor:is_typing',{conversationId:state.conversationId,isTyping:true});
  clearTimeout(_typingTimer);
  _typingTimer=setTimeout(function(){
    if(state.socket&&state.connected&&state.conversationId)
      state.socket.emit('visitor:is_typing',{conversationId:state.conversationId,isTyping:false});
  },2000);
}
function emitPageView(){
  if(!state.socket||!state.connected||!state.conversationId)return;
  var path=w.location.pathname+(w.location.search||'')+(w.location.hash||'');
  state.socket.emit('client:page_view',{conversationId:state.conversationId,url:w.location.href,path:path});
}
var _lastHref=w.location.href;
var _pvTimer=null;
function onUrlChange(){
  var href=w.location.href;
  if(href===_lastHref)return;
  _lastHref=href;
  emitPage();
  clearTimeout(_pvTimer);
  _pvTimer=setTimeout(emitPageView,300);
}
(function(){
  var origPush=w.history.pushState.bind(w.history);
  var origReplace=w.history.replaceState.bind(w.history);
  w.history.pushState=function(){origPush.apply(this,arguments);onUrlChange();};
  w.history.replaceState=function(){origReplace.apply(this,arguments);onUrlChange();};
})();
w.addEventListener('popstate',onUrlChange);
w.addEventListener('hashchange',onUrlChange);

function uploadFile(pf,cb){
  var comma=pf.dataUrl.indexOf(',');
  var base64=comma>=0?pf.dataUrl.slice(comma+1):pf.dataUrl;
  fetch(API_BASE+'/widget/upload',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({filename:pf.name,mimeType:pf.type,data:base64,conversationId:state.conversationId})
  }).then(function(r){return r.json();}).then(function(d){cb(null,d);}).catch(function(e){cb(e,null);});
}

function sendRest(msgBody,attachments,onDone){
  fetch(API_BASE+'/widget/message',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({conversationId:state.conversationId,sessionToken:state.sessionToken,body:msgBody||'',attachments:attachments||[]})
  }).then(function(r){
    if(r.status===409){
      isSending=false;if(els.snd)els.snd.disabled=false;
      if(onDone)onDone(null);
      resetAndRestart();
      return null;
    }
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.json();
  }).then(function(msg){
    if(msg&&onDone)onDone(msg);
  }).catch(function(){
    if(onDone)onDone(null);
  });
}
function resetAndRestart(){
  isSending=false;
  showClosedChip();
}

function send(){
  var body=(els.inp.value||'').trim();
  var hasFile=!!pendingFile;
  if((!body&&!hasFile)||!state.conversationId||isSending)return;
  isSending=true;
  var sentBody=body;
  els.inp.value='';els.inp.style.height='auto';els.snd.disabled=true;

  if(hasFile){
    var pf=pendingFile;clearAttach();
    uploadFile(pf,function(err,fileData){
      isSending=false;els.snd.disabled=false;
      if(err){appendMsg({id:'err_'+Date.now(),sender_type:'system',message_body:'\u26A0\uFE0F File upload failed.',is_internal_note:false,created_at:new Date().toISOString()},true);return;}
      sendRest(sentBody||'',[{url:fileData.url,name:pf.name,type:pf.type}],function(msg){
        if(msg){
          // Dedup: socket echo may have arrived first and already rendered it
          var already=state.messages.some(function(m){return m.id===msg.id;});
          if(!already){state.messages.push(msg);appendMsg(msg,true);}
        }
      });
    });
    return;
  }

  // ── Text-only message: send via REST (guaranteed delivery + server broadcasts
  // to socket rooms so agents see it in real-time without a page reload).
  //
  // pendingMessages tracks the body so that if the socket echo of this message
  // arrives before or after the REST response, the server:new_message handler
  // deduplicates it and doesn't render a second bubble.
  pendingMessages.add(sentBody);
  appendMsg({id:'opt_'+Date.now(),sender_type:'visitor',message_body:sentBody,is_internal_note:false,created_at:new Date().toISOString()},true);
  sendRest(sentBody,[],function(msg){
    isSending=false;els.snd.disabled=false;
    if(msg){
          // Replace the optimistic bubble with the persisted message. The
          // socket echo may have arrived first, so also avoid adding a second
          // copy when the REST response is already in state.
          var replaced=reconcileOptimisticMessage(msg);
          var already=state.messages.some(function(m){return m.id===msg.id;});
          if(!replaced&&!already)state.messages.push(msg);
      pendingMessages.delete(sentBody); // clean up if REST callback beat the echo
    }
  });
}

buildDom();
w.addEventListener('load',emitPage);
})(window,document);
`;

// ── GET /api/widget/demo ──────────────────────────────────────────────────────
router.get('/demo', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>OmniCore Widget Demo</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;}
  .card{background:#fff;border-radius:16px;padding:48px 40px;max-width:480px;width:100%;box-shadow:0 4px 32px rgba(0,0,0,.1);text-align:center;}
  h1{font-size:24px;font-weight:700;color:#0f172a;margin-bottom:8px;}
  p{color:#64748b;font-size:14px;line-height:1.6;margin-bottom:24px;}
  .badge{display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;margin-bottom:24px;}
  .dot{width:7px;height:7px;border-radius:50%;background:#22c55e;}
  .embed{background:#1e293b;border-radius:10px;padding:16px;margin-top:20px;text-align:left;}
  .embed pre{color:#7dd3fc;font-size:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;}
</style>
</head>
<body>
<div class="card">
  <h1>OmniCore Widget</h1>
  <p>The chat widget is active on this page. Click the <strong>blue bubble</strong> in the bottom-right corner to open it.</p>
  <div class="badge"><span class="dot"></span>Widget loaded &amp; connected</div>
  <p>Embed on any site with one line:</p>
  <div class="embed">
    <pre>&lt;script src="https://YOUR_DOMAIN/api/widget/widget.js"
  data-brand-id="22222222-2222-2222-2222-222222222222"
  data-label="OmniCore Support" defer&gt;&lt;/script&gt;</pre>
  </div>
</div>
<script src="/api/widget/widget.js" data-brand-id="22222222-2222-2222-2222-222222222222" data-label="OmniCore Support" data-color="#0284c7"></script>
</body>
</html>`);
});

router.get('/widget.js', (_req, res) => {
  res.setHeader('Content-Type',                  'application/javascript; charset=utf-8');
  // Short cache so widget updates (tabs, drag, etc.) reach embedded sites quickly.
  res.setHeader('Cache-Control',                 'no-cache, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin',   '*');
  res.setHeader('Cross-Origin-Resource-Policy',  'cross-origin');
  res.send(WIDGET_JS.trimStart());
});

module.exports = router;
