'use strict';

/**
 * email.webhook.controller.js
 * Atelier OmniCore — Section 6: Inbound Mail Parsing Webhook
 *
 * POST /api/webhooks/inbound-mail
 *
 * Compatible with SendGrid Inbound Parse and Resend Inbound webhook formats.
 * Flow:
 *  1. Verify webhook signature (SendGrid DKIM check or shared secret)
 *  2. Extract routing prefix from the To: address (e.g. support@[prefix].iratelier.com)
 *  3. Identify the open conversation via In-Reply-To / Message-ID header
 *  4. Strip quoted reply chains with the QuoteStripper
 *  5. Append a new Message row to the conversation
 *  6. Emit a Socket.io event to the conversation room (if the io instance is set)
 */

const crypto = require('crypto');
const { Router } = require('express');
const { pool }   = require('../lib/db');
const logger     = require('../utils/logger');

const router = Router();

// Injected after Socket.io is initialised — call setIo(io) from server bootstrap
let _io = null;
function setIo(io) { _io = io; }

// ---------------------------------------------------------------------------
// Quote Stripper
// ---------------------------------------------------------------------------
// Regex patterns that match common email client reply-chain delimiters.
// Order matters: more specific patterns first.
const QUOTE_PATTERNS = [
  // Gmail / Apple Mail "On <date> <name> wrote:"
  /\n\s*On .+wrote:\s*[\r\n]+[\s\S]*/i,
  // Outlook-style separator
  /\n[-_]{3,}\s*Original Message\s*[-_]{3,}[\s\S]*/i,
  // Generic "From: …" block that starts a new paragraph
  /\n\s*From:\s+.+[\r\n][\s\S]*/i,
  // Lines starting with > (quoted text)
  /(\n>.*)+/g,
  // Forwarded messages
  /\n\s*-{3,}\s*Forwarded message\s*-{3,}[\s\S]*/i,
  // "Sent from my iPhone / Android"
  /\n\s*Sent from (?:my )?(?:iPhone|Android|iPad|Samsung|Galaxy).*/i,
];

function stripQuotes(rawText) {
  let text = (rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const pattern of QUOTE_PATTERNS) {
    text = text.replace(pattern, '');
  }
  return text.trim();
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------
function verifySignature(req) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) return true;  // Skip verification if not configured

  // SendGrid uses a timestamp + payload HMAC; Resend uses X-Resend-Signature
  const signature = req.headers['x-webhook-signature'] ||
                    req.headers['x-resend-signature']  ||
                    req.headers['x-sendgrid-signature'];

  if (!signature) return false;

  const payload   = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const expected  = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature.replace(/^sha256=/, '')),
    Buffer.from(expected)
  );
}

// ---------------------------------------------------------------------------
// Reply+conv_ address parser
// Detects addresses like:
//   reply+conv_3fa85f64-...@inbound.yourdomain.com
// Returns the UUID if found, otherwise null.
// ---------------------------------------------------------------------------
const REPLY_CONV_RE = /^reply\+conv[_-]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

function parseConvIdFromReplyTo(toAddress) {
  const clean = (toAddress || '').replace(/^.*</, '').replace(/>.*$/, '').trim();
  const local = clean.split('@')[0] || '';
  const m = REPLY_CONV_RE.exec(local);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Routing address parser
// Extracts the inbound_email_prefix from addresses like:
//   support@acme.iratelier.com  →  "acme"
//   acme@mail.iratelier.com     →  "acme"
//   support@acme-brand.iratelier.com  →  "acme-brand"
// Falls back to the full local-part if the subdomain pattern is not found.
// ---------------------------------------------------------------------------
const ROOT_DOMAIN_RE = /^([^@]+)@([^.]+)\.iratelier\.com$/i;

function parseRoutingPrefix(toAddress) {
  const clean = (toAddress || '').replace(/^.*</, '').replace(/>.*$/, '').trim();
  const match = ROOT_DOMAIN_RE.exec(clean);
  if (match) return match[2];          // subdomain = prefix
  // Fallback: use the local-part before the @
  return clean.split('@')[0] || null;
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------
function extractHeader(headers, name) {
  if (!headers) return null;
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

function parseMessageId(raw) {
  if (!raw) return null;
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1] : raw.trim();
}

// ---------------------------------------------------------------------------
// SendGrid payload normaliser
// SendGrid posts multipart/form-data; Express body-parser won't parse it.
// Use `multer` or `busboy` in production. Here we handle the JSON fallback
// that SendGrid offers when "Post raw, full MIME message" is disabled.
// ---------------------------------------------------------------------------
function normaliseSendgrid(body) {
  return {
    to:          body.to    || body.envelope && JSON.parse(body.envelope || '{}').to,
    from:        body.from,
    subject:     body.subject,
    text:        body.text  || '',
    html:        body.html  || '',
    messageId:   body.headers && extractHeader(JSON.parse(body.headers || '{}'), 'message-id'),
    inReplyTo:   body.headers && extractHeader(JSON.parse(body.headers || '{}'), 'in-reply-to'),
    references:  body.headers && extractHeader(JSON.parse(body.headers || '{}'), 'references'),
  };
}

// ---------------------------------------------------------------------------
// Resend payload normaliser (Resend Inbound posts JSON directly)
// ---------------------------------------------------------------------------
function normaliseResend(body) {
  const hdrs = body.headers || {};
  return {
    to:         Array.isArray(body.to) ? body.to[0]?.email : body.to,
    from:       body.from?.email || body.from,
    subject:    body.subject,
    text:       body.text || '',
    html:       body.html || '',
    messageId:  hdrs['message-id'] || hdrs['Message-Id'],
    inReplyTo:  hdrs['in-reply-to'] || hdrs['In-Reply-To'],
    references: hdrs['references']  || hdrs['References'],
  };
}

// ---------------------------------------------------------------------------
// Mailgun payload normaliser
// Mailgun inbound (parsed) posts application/x-www-form-urlencoded with:
//   recipient, sender, Subject, body-plain, body-html, stripped-text,
//   stripped-html, Message-Id, In-Reply-To, References, message-headers
// message-headers is a JSON array: [["Header-Name", "value"], ...]
// ---------------------------------------------------------------------------
function normaliseMailgun(body) {
  // Parse the JSON header array that Mailgun includes
  let hdrs = {};
  try {
    const arr = JSON.parse(body['message-headers'] || '[]');
    if (Array.isArray(arr)) {
      for (const [k, v] of arr) {
        if (typeof k === 'string') hdrs[k.toLowerCase()] = v;
      }
    }
  } catch { /* ignore parse errors */ }

  return {
    to:         body.recipient || body.To || body.to || '',
    from:       body.sender   || body.From || body.from || '',
    subject:    body.Subject  || body.subject || '',
    // Prefer stripped-text (Mailgun already strips the reply chain); fall back to body-plain
    text:       body['stripped-text'] || body['body-plain'] || body.text || '',
    html:       body['stripped-html'] || body['body-html']  || body.html || '',
    messageId:  body['Message-Id'] || body['message-id'] || hdrs['message-id'] || null,
    inReplyTo:  body['In-Reply-To'] || body['in-reply-to'] || hdrs['in-reply-to'] || null,
    references: body['References'] || body['references']   || hdrs['references']  || null,
  };
}

function normalisePayload(body) {
  // Detect provider heuristically
  if (body.envelope !== undefined) return normaliseSendgrid(body);   // SendGrid
  if (body.from?.email !== undefined || body.type === 'email.received') return normaliseResend(body);
  // Mailgun: uses 'recipient' and 'sender' instead of 'to'/'from'
  if (body.recipient !== undefined || body.sender !== undefined || body['body-plain'] !== undefined) {
    return normaliseMailgun(body);
  }
  return normaliseResend(body); // safe default
}

// ---------------------------------------------------------------------------
// POST /api/webhooks/inbound-mail  (legacy)
// POST /api/webhooks/email/inbound (canonical — shown in Settings UI)
// ---------------------------------------------------------------------------
async function handleInboundEmail(req, res) {
  // Respond immediately — email providers retry on non-2xx within seconds
  res.status(200).json({ received: true });

  try {
    if (!verifySignature(req)) {
      console.warn('[email:webhook] signature verification failed');
      return;
    }

    const parsed = normalisePayload(req.body);
    const {
      to, from, subject,
      text, html,
      messageId, inReplyTo, references,
    } = parsed;

    if (!to || !from) {
      console.warn('[email:webhook] missing to/from — skipping', parsed);
      return;
    }

    const toAddr = Array.isArray(to) ? to[0] : to;

    // ── FAST PATH: reply+conv_<uuid>@ addressing ─────────────────────────────
    // When the system sets Reply-To: reply+conv_<uuid>@inbound.domain, the visitor's
    // email client will address their reply directly to this address, letting us
    // thread it into the correct conversation without needing email headers.
    const directConvId = parseConvIdFromReplyTo(toAddr);
    if (directConvId) {
      // Verify the conversation exists and get its tenant
      const { rows: convCheck } = await pool.query(
        `SELECT id, tenant_id, brand_id FROM conversations WHERE id = $1 LIMIT 1`,
        [directConvId]
      );
      if (!convCheck.length) {
        logger.warn({ convId: directConvId }, 'email_webhook_conv_not_found');
        return;
      }
      const { id: conversationId, tenant_id, brand_id } = convCheck[0];

      // Strip quotes and persist
      const rawText   = text || (html || '').replace(/<[^>]+>/g, ' ');
      const cleanBody = stripQuotes(rawText);
      if (!cleanBody) {
        logger.warn({ conversationId }, 'email_webhook_empty_body_after_strip');
        return;
      }

      const attachmentsJson = JSON.stringify([{ email_message_id: parseMessageId(messageId) }]);
      const { rows: newMsg } = await pool.query(
        `INSERT INTO messages (conversation_id, sender_type, message_body, attachments_json)
         VALUES ($1, 'visitor', $2, $3::jsonb)
         RETURNING id, conversation_id, sender_type, message_body, created_at`,
        [conversationId, cleanBody, attachmentsJson]
      );
      await pool.query(
        `UPDATE conversations SET updated_at = NOW(),
           status = CASE WHEN status = 'closed' THEN 'open' ELSE status END
         WHERE id = $1`,
        [conversationId]
      );
      if (_io) _io.to(`conv:${conversationId}`).emit('server:new_message', newMsg[0]);
      logger.info({ conversationId, from }, 'email_webhook_reply_conv_appended');
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const prefix = parseRoutingPrefix(toAddr);
    if (!prefix) {
      console.warn('[email:webhook] could not determine routing prefix from', toAddr);
      return;
    }

    // 1. Resolve the brand from the routing prefix
    const { rows: brandRows } = await pool.query(
      `SELECT b.id AS brand_id, b.tenant_id
       FROM brands b
       WHERE b.inbound_email_prefix = $1 LIMIT 1`,
      [prefix]
    );
    if (!brandRows.length) {
      console.warn('[email:webhook] no brand found for prefix', prefix);
      return;
    }
    const { brand_id, tenant_id } = brandRows[0];

    // 2. Try to find an existing conversation via In-Reply-To / References headers
    let conversationId = null;

    const candidateIds = [inReplyTo, ...(references || '').split(/\s+/)]
      .map(parseMessageId)
      .filter(Boolean);

    if (candidateIds.length) {
      const { rows: msgRows } = await pool.query(
        `SELECT m.conversation_id
         FROM messages m
         WHERE m.attachments_json->>'email_message_id' = ANY($1::text[])
           AND EXISTS (
             SELECT 1 FROM conversations c
             WHERE c.id = m.conversation_id AND c.tenant_id = $2
           )
         LIMIT 1`,
        [candidateIds, tenant_id]
      );
      if (msgRows.length) conversationId = msgRows[0].conversation_id;
    }

    // 3. If no existing thread, create or find the visitor + conversation
    if (!conversationId) {
      // Upsert visitor by email
      const { rows: visitorRows } = await pool.query(
        `INSERT INTO visitors (tenant_id, brand_id, session_token, email)
         VALUES ($1, $2, gen_random_uuid()::text, $3)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [tenant_id, brand_id, from]
      );
      let visitorId = visitorRows[0]?.id;
      if (!visitorId) {
        const { rows } = await pool.query(
          `SELECT id FROM visitors WHERE tenant_id = $1 AND brand_id = $2 AND email = $3 LIMIT 1`,
          [tenant_id, brand_id, from]
        );
        visitorId = rows[0]?.id;
      }

      if (!visitorId) {
        console.error('[email:webhook] could not resolve visitor for', from);
        return;
      }

      const { rows: convRows } = await pool.query(
        `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel, subject)
         VALUES ($1, $2, $3, 'open', 'email', $4)
         RETURNING id`,
        [tenant_id, brand_id, visitorId, subject || '(no subject)']
      );
      conversationId = convRows[0].id;
    }

    // 4. Strip quoted reply chain — prefer plain text, fall back to html-stripped
    const rawText    = text || html.replace(/<[^>]+>/g, ' ');
    const cleanBody  = stripQuotes(rawText);

    if (!cleanBody) {
      console.warn('[email:webhook] message body empty after quote stripping — skipping');
      return;
    }

    // 5. Persist the message (store the email Message-ID for thread linking)
    const attachmentsJson = JSON.stringify([{ email_message_id: parseMessageId(messageId) }]);

    const { rows: newMsg } = await pool.query(
      `INSERT INTO messages
         (conversation_id, sender_type, message_body, attachments_json)
       VALUES ($1, 'visitor', $2, $3::jsonb)
       RETURNING id, conversation_id, sender_type, message_body, created_at`,
      [conversationId, cleanBody, attachmentsJson]
    );

    await pool.query(
      `UPDATE conversations SET updated_at = NOW(), status =
         CASE WHEN status = 'closed' THEN 'open' ELSE status END
       WHERE id = $1`,
      [conversationId]
    );

    // 6. Push to Socket.io room if available
    if (_io) {
      _io.to(`conv:${conversationId}`).emit('server:new_message', newMsg[0]);
    }

    logger.info({ conversationId, from }, 'email_webhook_message_appended');
  } catch (err) {
    logger.error({ err }, 'email_webhook_processing_error');
  }
}

router.post('/inbound-mail',  handleInboundEmail);
router.post('/email/inbound', handleInboundEmail);

module.exports = { router, setIo, stripQuotes };
