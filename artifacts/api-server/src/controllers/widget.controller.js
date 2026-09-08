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

const { Router } = require('express');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pool } = require('../lib/db');
const logger = require('../utils/logger');
const {
  broadcastToTenant,
  broadcastToConversation,
  getIo,
} = require('../services/socket.service');
const { maybeAutoReply } = require('../services/ai.service');
const {
  R2_ENABLED,
  uploadToR2,
  streamFromR2,
  getPresignedGetUrl,
} = require('../lib/r2');
const { validateWidgetSessionInput } = require('../lib/requestValidation');
const { WIDGET_JS } = require('../widget/widgetScript');
const { renderWidgetDemoPage } = require('../widget/demoPage');
const {
  pickInitialStatus: pickWidgetInitialStatus,
  visitorUpdateFields,
  widgetMessageAccessError,
  visitorOwnsConversation,
} = require('../lib/widgetSession');

const router = Router();

// Create uploads directory
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (e) {}

// ── CORS: allow any origin (widget is embedded on customer sites) ─────────────
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Override helmet's same-origin CORP — widget files are intentionally cross-origin
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Determine the initial status for a new widget conversation. When the tenant
// has the AI bot enabled (feature + auto-reply), conversations start as
// 'ai_handling' so the bot answers first; otherwise they enter the human queue
// as 'open'. The socket auto-reply only fires for 'ai_handling' conversations.
function pickInitialStatus(tenantId) {
  return pickWidgetInitialStatus(pool.query.bind(pool), tenantId);
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
    const {
      sessionToken,
      visitorName,
      visitorEmail,
      timezone,
      forceNew,
      referrerUrl,
    } = req.body || {};

    // ── Returning visitor ──────────────────────────────────────────────────────
    if (sessionToken) {
      const { rows: vRows } = await pool.query(
        'SELECT id, tenant_id FROM visitors WHERE session_token = $1 AND brand_id = $2',
        [sessionToken, brandId],
      );
      if (vRows[0]) {
        const visitorId = vRows[0].id;
        const tenantId = vRows[0].tenant_id;

        // Update identity + timezone if provided
        const { fields, values } = visitorUpdateFields({
          visitorName,
          visitorEmail,
          timezone,
        });
        if (fields.length) {
          await pool.query(
            `UPDATE visitors SET ${fields.map((field, index) => `${field} = $${index + 1}`).join(', ')} WHERE id = $${values.length + 1}`,
            [...values, visitorId],
          );
        }

        const { rows: bRows } = await pool.query(
          'SELECT brand_name FROM brands WHERE id = $1',
          [brandId],
        );
        const { rows: visData } = await pool.query(
          'SELECT display_name FROM visitors WHERE id = $1',
          [visitorId],
        );
        const brandName = bRows[0]?.brand_name || 'Support';

        // ── force_new: always create a fresh conversation, preserve visitor identity ──
        if (forceNew) {
          const convStatus = await pickInitialStatus(tenantId);
          const { rows: nc } = await pool.query(
            `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel, referrer_url)
             VALUES ($1, $2, $3, $5, 'widget', $4) RETURNING id`,
            [tenantId, brandId, visitorId, referrerUrl || null, convStatus],
          );
          const newConvId = nc[0].id;
          try {
            broadcastToTenant(tenantId, 'conversation:created', {
              id: newConvId,
              status: convStatus,
              channel: 'widget',
              priority: 'normal',
              subject: null,
              visitor_name:
                visData[0]?.display_name || visitorName || 'Visitor',
              visitor_email: visitorEmail || null,
              agent_name: null,
              brand_name: brandName,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              sla_breach_at: null,
              assigned_agent_id: null,
              unread: 0,
              visitor_id: visitorId,
            });
          } catch {
            /* non-fatal */
          }
          logger.info(
            { brandId, visitorId, conversationId: newConvId },
            'widget_force_new_conversation',
          );
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
          [visitorId],
        );
        if (
          lastRows[0]?.is_ticket === true &&
          lastRows[0].csat_requested === true &&
          lastRows[0].csat_score === null
        ) {
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
          [visitorId],
        );
        let convId = cRows[0]?.id;
        // If the most recent conversation was closed with a CSAT survey that the
        // visitor hasn't answered/dismissed yet, surface THAT closed conversation
        // (so the widget can re-show the survey) instead of burying it under a new
        // open conversation. Recovers the survey when the live event was missed.
        const csatPending =
          Boolean(cRows[0]) &&
          cRows[0].status === 'closed' &&
          cRows[0].csat_requested === true &&
          cRows[0].csat_score === null;
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
            [tenantId, brandId, visitorId, referrerUrl || null, convStatus],
          );
          convId = nc[0].id;
          try {
            broadcastToTenant(tenantId, 'conversation:created', {
              id: convId,
              status: convStatus,
              channel: 'widget',
              priority: 'normal',
              subject: null,
              visitor_name:
                visData[0]?.display_name || visitorName || 'Visitor',
              visitor_email: visitorEmail || null,
              agent_name: null,
              brand_name: brandName,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              sla_breach_at: null,
              assigned_agent_id: null,
              unread: 0,
              visitor_id: visitorId,
            });
          } catch {
            /* non-fatal */
          }
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
          [convId],
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
      'SELECT id, tenant_id, brand_name FROM brands WHERE id = $1',
      [brandId],
    );
    if (!bRows[0]) return res.status(404).json({ error: 'Brand not found' });
    const { tenant_id, brand_name } = bRows[0];

    // Deduplication: if an email is provided, reuse any existing visitor with
    // the same email + brand so we never create duplicate contacts.
    if (visitorEmail) {
      const { rows: existingRows } = await pool.query(
        `SELECT id FROM visitors WHERE brand_id = $1 AND email = $2 LIMIT 1`,
        [brandId, visitorEmail],
      );
      if (existingRows[0]) {
        const existingId = existingRows[0].id;
        const newToken = crypto.randomUUID();
        // Update the session token so this browser session is now linked
        const updates = [`session_token = $1`];
        const vals = [newToken];
        if (visitorName) {
          updates.push(`display_name = $${vals.length + 1}`);
          vals.push(visitorName);
        }
        if (timezone) {
          updates.push(`timezone = $${vals.length + 1}`);
          vals.push(timezone);
        }
        await pool.query(
          `UPDATE visitors SET ${updates.join(', ')} WHERE id = $${vals.length + 1}`,
          [...vals, existingId],
        );
        // Create a new conversation for the returning visitor
        const convStatus = await pickInitialStatus(tenant_id);
        const { rows: nc } = await pool.query(
          `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel, referrer_url)
           VALUES ($1, $2, $3, $5, 'widget', $4) RETURNING id`,
          [tenant_id, brandId, existingId, referrerUrl || null, convStatus],
        );
        try {
          broadcastToTenant(tenant_id, 'conversation:created', {
            id: nc[0].id,
            status: convStatus,
            channel: 'widget',
            priority: 'normal',
            subject: null,
            visitor_name: visitorName || visitorEmail,
            visitor_email: visitorEmail,
            agent_name: null,
            brand_name,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            sla_breach_at: null,
            assigned_agent_id: null,
            unread: 0,
            visitor_id: existingId,
          });
        } catch {
          /* non-fatal */
        }
        logger.info(
          { brandId, visitorId: existingId, dedup: true },
          'widget_session_dedup_reused',
        );
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
      [
        tenant_id,
        brandId,
        newToken,
        visitorName || null,
        visitorEmail || null,
        timezone || null,
      ],
    );

    const convStatus = await pickInitialStatus(tenant_id);
    const { rows: cNew } = await pool.query(
      `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel, referrer_url)
       VALUES ($1, $2, $3, $5, 'widget', $4) RETURNING id`,
      [tenant_id, brandId, vNew[0].id, referrerUrl || null, convStatus],
    );

    try {
      broadcastToTenant(tenant_id, 'conversation:created', {
        id: cNew[0].id,
        status: convStatus,
        channel: 'widget',
        priority: 'normal',
        subject: null,
        visitor_name: visitorName || 'Visitor',
        visitor_email: visitorEmail || null,
        agent_name: null,
        brand_name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sla_breach_at: null,
        assigned_agent_id: null,
        unread: 0,
        visitor_id: vNew[0].id,
      });
    } catch {
      /* non-fatal */
    }

    logger.info({ brandId, visitorId: vNew[0].id }, 'widget_session_created');
    return res.json({
      sessionToken: newToken,
      conversationId: cNew[0].id,
      messages: [],
      brandName: brand_name,
      visitorName: visitorName || null,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/widget/upload ───────────────────────────────────────────────────
// Accepts base64-encoded file data; stores in R2 (or disk fallback); returns URL.
router.post(
  '/upload',
  express.json({ limit: '20mb' }),
  async (req, res, next) => {
    try {
      const { filename, mimeType, data } = req.body || {};
      if (!filename || !data)
        return res
          .status(400)
          .json({ error: 'filename and data are required' });
      const buffer = Buffer.from(data, 'base64');
      const ext = path.extname(filename) || '';
      const safeName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      if (R2_ENABLED) {
        await uploadToR2(
          buffer,
          safeName,
          mimeType || 'application/octet-stream',
        );
        logger.info(
          { filename, size: buffer.length, storage: 'r2' },
          'widget_file_uploaded',
        );
      } else {
        fs.writeFileSync(path.join(UPLOADS_DIR, safeName), buffer);
        logger.info(
          { filename, size: buffer.length, storage: 'disk' },
          'widget_file_uploaded',
        );
      }
      return res.json({
        url: `/api/widget/files/${safeName}`,
        name: filename,
        type: mimeType,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/widget/files/:name ───────────────────────────────────────────────
// Serves files from R2 (presigned-URL redirect) or local disk fallback.
// Using redirect avoids streaming issues and helmet CORP conflicts.
router.get('/files/:name', async (req, res, next) => {
  try {
    const name = path.basename(req.params.name);
    const filePath = path.join(UPLOADS_DIR, name);
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
    if (R2_ENABLED) {
      // Redirect to a short-lived presigned URL — browser loads directly from R2
      const signedUrl = await getPresignedGetUrl(name, 3600);
      return res.redirect(302, signedUrl);
    }
    return res.status(404).json({ error: 'File not found' });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/widget/message ──────────────────────────────────────────────────
// REST fallback for visitor messages that include file attachments.
router.post('/message', async (req, res, next) => {
  try {
    const {
      conversationId,
      sessionToken,
      body: msgBody,
      attachments,
    } = req.body || {};
    if (!conversationId || !sessionToken) {
      return res
        .status(400)
        .json({ error: 'conversationId and sessionToken are required' });
    }

    const { rows: vRows } = await pool.query(
      'SELECT id, display_name, email FROM visitors WHERE session_token = $1',
      [sessionToken],
    );
    if (!vRows[0]) return res.status(401).json({ error: 'Invalid session' });
    const visitor = vRows[0];

    const { rows: cRows } = await pool.query(
      `SELECT id, status, tenant_id, is_ticket, visitor_id FROM conversations WHERE id = $1`,
      [conversationId],
    );
    const accessError = widgetMessageAccessError(cRows[0], visitor.id);
    if (accessError) {
      const status = accessError === 'Conversation not found' ? 404 : 409;
      return res.status(status).json({ error: accessError });
    }

    const attachmentsJson =
      attachments && attachments.length > 0
        ? JSON.stringify(attachments)
        : '[]';
    const { rows: newMsg } = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, message_body, is_internal_note, attachments_json)
       VALUES ($1, 'visitor', $2, $3, false, $4)
       RETURNING id, conversation_id, sender_type, message_body, is_internal_note, attachments_json, created_at`,
      [conversationId, visitor.id, (msgBody || '').trim(), attachmentsJson],
    );

    const result = {
      ...newMsg[0],
      sender_name: visitor.display_name || visitor.email || 'Visitor',
    };
    await pool.query(
      'UPDATE conversations SET updated_at = NOW() WHERE id = $1',
      [conversationId],
    );

    // Notify agents currently viewing this conversation
    broadcastToConversation(conversationId, 'server:new_message', result);

    // Notify ALL tenant agents so the inbox sidebar updates (unread count,
    // conversation sort order, toast) even if they haven't opened this conversation.
    try {
      broadcastToTenant(cRows[0].tenant_id, 'conversation:visitor_message', {
        conversationId,
        message: result,
      });
    } catch {
      /* non-fatal */
    }

    // Non-blocking: AI bot auto-reply. The widget delivers text messages over
    // REST (not socket), so the bot trigger must live here too — otherwise an
    // ai_handling conversation would show the "AI" label but never get a reply.
    if ((msgBody || '').trim()) {
      maybeAutoReply({
        conversationId,
        tenantId: cRows[0].tenant_id,
        userMessage: msgBody,
        io: getIo(),
      }).catch(() => {
        /* non-fatal: handled internally */
      });
    }

    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/widget/csat ─────────────────────────────────────────────────────
// Visitor submits a satisfaction score (1–5) after a conversation is closed.
router.post('/csat', async (req, res, next) => {
  try {
    const { conversationId, sessionToken, score } = req.body || {};
    if (
      !conversationId ||
      !sessionToken ||
      score === undefined ||
      score === null
    ) {
      return res.status(400).json({
        error: 'conversationId, sessionToken, and score are required',
      });
    }
    const s = parseInt(score, 10);
    if (isNaN(s) || s < 1 || s > 5) {
      return res
        .status(400)
        .json({ error: 'score must be an integer between 1 and 5' });
    }
    const { rows: vRows } = await pool.query(
      'SELECT id FROM visitors WHERE session_token = $1',
      [sessionToken],
    );
    if (!vRows[0]) return res.status(401).json({ error: 'Invalid session' });
    const { rows } = await pool.query(
      `UPDATE conversations SET csat_score = $1, csat_requested = false, updated_at = NOW()
       WHERE id = $2 AND visitor_id = $3
       RETURNING id`,
      [s, conversationId, vRows[0].id],
    );
    if (!rows[0])
      return res.status(404).json({ error: 'Conversation not found' });
    logger.info({ conversationId, score: s }, 'widget_csat_submitted');
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/widget/csat/dismiss ─────────────────────────────────────────────
// Visitor chose "Just Close" instead of rating. Clear the pending-survey flag
// so the server does not re-surface the survey on the next session/reload.
router.post('/csat/dismiss', async (req, res, next) => {
  try {
    const { conversationId, sessionToken } = req.body || {};
    if (!conversationId || !sessionToken) {
      return res
        .status(400)
        .json({ error: 'conversationId and sessionToken are required' });
    }
    const { rows: vRows } = await pool.query(
      'SELECT id FROM visitors WHERE session_token = $1',
      [sessionToken],
    );
    if (!vRows[0]) return res.status(401).json({ error: 'Invalid session' });
    await pool.query(
      `UPDATE conversations SET csat_requested = false, updated_at = NOW()
       WHERE id = $1 AND visitor_id = $2`,
      [conversationId, vRows[0].id],
    );
    logger.info({ conversationId }, 'widget_csat_dismissed');
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
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
        path.join(
          process.cwd(),
          'node_modules/socket.io/client-dist/socket.io.min.js',
        ),
        path.join(
          process.cwd(),
          '../../node_modules/socket.io/client-dist/socket.io.min.js',
        ),
        path.join(
          __dirname,
          '../../node_modules/socket.io/client-dist/socket.io.min.js',
        ),
      ];
      for (const p of candidates) {
        try {
          if (fs.existsSync(p)) {
            _sioClientJs = fs.readFileSync(p, 'utf8');
            break;
          }
        } catch {
          /* try next */
        }
      }
    }
    if (!_sioClientJs) {
      logger.error('socket.io client bundle not found on disk');
      return res
        .status(404)
        .type('application/javascript')
        .send('// socket.io client not found');
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(_sioClientJs);
  } catch (err) {
    return res
      .status(500)
      .type('application/javascript')
      .send('// failed to load socket.io client');
  }
});

// ── GET /api/widget/messages ──────────────────────────────────────────────────
// Polling fallback — returns messages for a visitor's conversation.
// Used by the widget every 5 s when the socket may have dropped.
// Query params: tok (sessionToken), cid (conversationId), after (ISO timestamp, optional)
router.get('/messages', async (req, res, next) => {
  try {
    const { tok, cid, after } = req.query;
    if (!tok || !cid)
      return res.status(400).json({ error: 'tok and cid are required' });

    const { rows: vRows } = await pool.query(
      'SELECT id FROM visitors WHERE session_token = $1',
      [tok],
    );
    if (!vRows[0]) return res.status(401).json({ error: 'Invalid session' });

    // Note: tickets are NOT excluded here. When an agent converts a live chat
    // to a ticket the widget keeps polling this conversation id — returning a
    // 'closed' state (rather than 403) lets the polling fallback surface the
    // CSAT survey / closed notice even if the live socket event was missed.
    const { rows: cRows } = await pool.query(
      'SELECT id, status, csat_requested, csat_score, is_ticket, visitor_id FROM conversations WHERE id = $1',
      [cid],
    );
    if (!visitorOwnsConversation(cRows[0], vRows[0].id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

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
      params,
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
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/widget/conversations/:id/read ──────────────────────────────────
// Called by the widget on textarea focus to mark messages as read.
// Emits visitor:read_receipt to the conversation room so agents see the receipt.
router.patch('/conversations/:id/read', async (req, res, next) => {
  try {
    const { sessionToken } = req.body || {};
    const convId = req.params.id;
    if (!sessionToken)
      return res.status(400).json({ error: 'sessionToken required' });
    const { rows: vRows } = await pool.query(
      'SELECT id FROM visitors WHERE session_token = $1',
      [sessionToken],
    );
    if (!vRows[0]) return res.status(401).json({ error: 'Invalid session' });
    const { rows: cRows } = await pool.query(
      'SELECT id, visitor_id, is_ticket FROM conversations WHERE id = $1',
      [convId],
    );
    if (!visitorOwnsConversation(cRows[0], vRows[0].id) || cRows[0].is_ticket) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const readAt = new Date().toISOString();
    await pool.query(
      'UPDATE conversations SET visitor_last_read_at = $1 WHERE id = $2',
      [readAt, convId],
    );
    broadcastToConversation(convId, 'visitor:read_receipt', {
      conversationId: convId,
      readAt,
    });
    return res.json({ ok: true, readAt });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/widget/ticket ───────────────────────────────────────────────────
// Visitor submits a support ticket. Creates an email-channel conversation.
router.post('/ticket', async (req, res, next) => {
  try {
    const {
      brandId,
      sessionToken,
      subject,
      description,
      priority,
      visitorName,
      visitorEmail,
    } = req.body || {};
    if (!brandId) return res.status(400).json({ error: 'brandId is required' });
    if (!subject?.trim())
      return res.status(400).json({ error: 'subject is required' });
    if (!description?.trim())
      return res.status(400).json({ error: 'description is required' });

    let visitorId, tenantId;

    // Try to find existing visitor by session token
    if (sessionToken) {
      const { rows: vr } = await pool.query(
        `SELECT v.id, v.tenant_id FROM visitors v
         WHERE v.session_token = $1 AND v.brand_id = $2`,
        [sessionToken, brandId],
      );
      if (vr[0]) {
        visitorId = vr[0].id;
        tenantId = vr[0].tenant_id;
      }
    }

    // Fallback: get tenant from brand and create a new visitor
    if (!visitorId) {
      const { rows: br } = await pool.query(
        `SELECT tenant_id FROM brands WHERE id = $1`,
        [brandId],
      );
      if (!br[0]) return res.status(404).json({ error: 'Brand not found' });
      tenantId = br[0].tenant_id;
      const newToken = require('crypto').randomBytes(32).toString('hex');
      const { rows: vNew } = await pool.query(
        `INSERT INTO visitors (tenant_id, brand_id, session_token, display_name, email)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          tenantId,
          brandId,
          newToken,
          visitorName || 'Visitor',
          visitorEmail || null,
        ],
      );
      visitorId = vNew[0].id;
    } else if (visitorName || visitorEmail) {
      await pool.query(
        `UPDATE visitors SET
           display_name = COALESCE($1, display_name),
           email        = COALESCE($2, email)
         WHERE id = $3`,
        [visitorName || null, visitorEmail || null, visitorId],
      );
    }

    const validPriority = ['low', 'normal', 'high', 'urgent'].includes(priority)
      ? priority
      : 'normal';

    // Create ticket conversation (email channel so it shows as a ticket in inbox)
    const { rows: cr } = await pool.query(
      `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel, subject, priority, is_ticket, ticket_number)
       VALUES ($1, $2, $3, 'open', 'email', $4, $5, true, nextval('conversations_ticket_number_seq'))
       RETURNING id, status, subject, priority, created_at, ticket_number`,
      [tenantId, brandId, visitorId, subject.trim(), validPriority],
    );
    const conv = cr[0];

    // Add description as first message
    await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, message_body)
       VALUES ($1, 'visitor', $2, $3)`,
      [conv.id, visitorId, description.trim()],
    );

    // Notify agents in real time so the ticket appears in the inbox with a toast.
    try {
      const { rows: bRows } = await pool.query(
        'SELECT brand_name FROM brands WHERE id = $1',
        [brandId],
      );
      const { rows: vRows } = await pool.query(
        'SELECT display_name, email FROM visitors WHERE id = $1',
        [visitorId],
      );
      broadcastToTenant(tenantId, 'conversation:created', {
        id: conv.id,
        status: conv.status,
        channel: 'email',
        priority: conv.priority,
        subject: conv.subject,
        is_ticket: true,
        visitor_name: vRows[0]?.display_name || visitorName || 'Visitor',
        visitor_email: vRows[0]?.email || visitorEmail || null,
        agent_name: null,
        brand_name: bRows[0]?.brand_name || 'Support',
        created_at: conv.created_at,
        updated_at: conv.created_at,
        sla_breach_at: null,
        assigned_agent_id: null,
        unread: 0,
        visitor_id: visitorId,
        ticket_number: conv.ticket_number ?? null,
      });
    } catch {
      /* non-fatal */
    }

    logger.info(
      { conversationId: conv.id, brandId, tenantId },
      'widget_ticket_submitted',
    );
    return res.status(201).json({
      ok: true,
      ticketId: conv.id,
      subject: conv.subject,
      ticketNumber: conv.ticket_number,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/widget/widget.js ─────────────────────────────────────────────────
// ── GET /api/widget/demo ──────────────────────────────────────────────────────
router.get('/demo', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderWidgetDemoPage());
});

router.get('/widget.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  // Short cache so widget updates (tabs, drag, etc.) reach embedded sites quickly.
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(WIDGET_JS.trimStart());
});

module.exports = router;
