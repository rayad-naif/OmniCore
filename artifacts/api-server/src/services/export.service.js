/**
 * export.service.js
 * Atelier OmniCore — Conversation PDF export
 *
 * Builds a styled PDF transcript for a conversation using PDFKit,
 * uploads the result to Cloudflare R2, and returns a signed, time-limited
 * download URL (default TTL 15 minutes).
 *
 * Route wired in server.js:
 *   GET /api/conversations/:id/export   (auth middleware required)
 *
 * Required env vars:
 *   R2_ACCOUNT_ID       — Cloudflare account ID
 *   R2_ACCESS_KEY_ID    — R2 Access Key ID
 *   R2_SECRET_ACCESS_KEY— R2 Secret Access Key
 *   R2_BUCKET_NAME      — bucket name
 *   R2_PUBLIC_DOMAIN    — optional: public bucket domain (skipped if presigning)
 *
 * Dependencies: pdfkit  (already a common Node dep; add with pnpm add pdfkit @aws-sdk/client-s3 @aws-sdk/s3-request-presigner)
 */

'use strict';

const { Readable }       = require('node:stream');
const { buffer: toBuffer } = require('node:stream/consumers');
const PDFDocument        = require('pdfkit');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { pool }  = require('../lib/db');
const logger    = require('../utils/logger');

// ─── R2 / S3 client ───────────────────────────────────────────────────────────
function getR2Client() {
  const endpoint = process.env.R2_ENDPOINT;
  if (!endpoint) throw new Error('R2_ENDPOINT not set');
  return new S3Client({
    region:   'auto',
    endpoint,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID     || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: false,
  });
}

// ─── Colour palette ───────────────────────────────────────────────────────────
const COLORS = {
  brand:      '#6366f1',  // violet-600
  agentBg:    '#6366f1',
  visitorBg:  '#f1f5f9',  // slate-100
  noteBg:     '#fef3c7',  // amber-100
  noteBorder: '#f59e0b',
  systemText: '#94a3b8',  // slate-400
  bodyText:   '#1e293b',  // slate-900
  mutedText:  '#64748b',  // slate-500
  white:      '#ffffff',
  pageBg:     '#f8fafc',  // slate-50
  divider:    '#e2e8f0',  // slate-200
};

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD    = 'Helvetica-Bold';
const FONT_OBLIQUE = 'Helvetica-Oblique';
const PAGE_W       = 595.28;   // A4 pt
const MARGIN       = 48;
const CONTENT_W    = PAGE_W - MARGIN * 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour:  '2-digit', minute: '2-digit',
  });
}

function senderLabel(msg) {
  if (msg.is_internal_note)            return 'Internal Note';
  if (msg.sender_type === 'agent')     return msg.sender_name || 'Agent';
  if (msg.sender_type === 'ai_bot')    return 'AI Bot';
  if (msg.sender_type === 'system')    return 'System';
  return msg.visitor_email || msg.visitor_name || 'Visitor';
}

/**
 * Strip HTML tags from stored rich-text bodies so they render as plain text
 * in the PDF. This is intentionally simple — no full HTML renderer.
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g,  '<')
    .replace(/&gt;/g,  '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .trim();
}

// ─── PDF builder ──────────────────────────────────────────────────────────────
/**
 * @param {object} conversation  — full conversation row from DB
 * @param {object[]} messages    — message rows
 * @param {object} brand         — { name, logoUrl? }
 * @returns {Promise<Buffer>}    — completed PDF as a Buffer
 */
async function buildPdf(conversation, messages, brand) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size:    'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title:   `Conversation #${conversation.id}`,
        Author:  brand.name || 'OmniCore',
        Subject: 'Support Conversation Transcript',
        Creator: 'Atelier OmniCore',
      },
    });

    const chunks = [];
    doc.on('data',  c  => chunks.push(c));
    doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
    doc.on('error', err => reject(err));

    // ── Page background ──────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, doc.page.height).fill(COLORS.pageBg);

    // ── Header band ──────────────────────────────────────────────────────────
    const headerH = 72;
    doc.rect(0, 0, PAGE_W, headerH).fill(COLORS.brand);

    doc.fillColor(COLORS.white)
      .font(FONT_BOLD).fontSize(16)
      .text(brand.name || 'OmniCore', MARGIN, 20, { width: CONTENT_W / 2 });

    doc.font(FONT_REGULAR).fontSize(9)
      .text('Conversation Transcript', MARGIN, 40, { width: CONTENT_W / 2 });

    doc.font(FONT_REGULAR).fontSize(8)
      .text(`Exported ${fmtDateTime(new Date().toISOString())}`, MARGIN + CONTENT_W / 2, 40, {
        width: CONTENT_W / 2, align: 'right',
      });

    // ── Metadata block ───────────────────────────────────────────────────────
    let y = headerH + 20;

    doc.rect(MARGIN, y, CONTENT_W, 70)
      .fill(COLORS.white)
      .stroke(COLORS.divider);

    y += 10;
    const metaLeft  = MARGIN + 12;
    const metaRight = PAGE_W / 2 + 12;
    const metaRows  = [
      ['Conversation ID', `#${conversation.id}`],
      ['Status',          conversation.status?.replace('_', ' ') || '—'],
      ['Channel',         conversation.channel || '—'],
    ];
    const metaRows2 = [
      ['Visitor',     conversation.visitor_email || conversation.visitor_name || 'Anonymous'],
      ['Opened',      fmtDateTime(conversation.created_at)],
      ['Resolved',    fmtDateTime(conversation.resolved_at)],
    ];

    metaRows.forEach(([label, value], i) => {
      const rowY = y + i * 16;
      doc.fillColor(COLORS.mutedText).font(FONT_BOLD).fontSize(7)
        .text(label.toUpperCase(), metaLeft, rowY, { width: 80 });
      doc.fillColor(COLORS.bodyText).font(FONT_REGULAR).fontSize(8)
        .text(value, metaLeft + 85, rowY, { width: CONTENT_W / 2 - 85 });
    });
    metaRows2.forEach(([label, value], i) => {
      const rowY = y + i * 16;
      doc.fillColor(COLORS.mutedText).font(FONT_BOLD).fontSize(7)
        .text(label.toUpperCase(), metaRight, rowY, { width: 80 });
      doc.fillColor(COLORS.bodyText).font(FONT_REGULAR).fontSize(8)
        .text(value, metaRight + 85, rowY, { width: CONTENT_W / 2 - 85 });
    });

    y = headerH + 20 + 70 + 16;

    // ── Section heading ──────────────────────────────────────────────────────
    doc.fillColor(COLORS.mutedText).font(FONT_BOLD).fontSize(7)
      .text('MESSAGES', MARGIN, y);
    y += 14;

    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y)
      .stroke(COLORS.divider);
    y += 10;

    // ── Messages ─────────────────────────────────────────────────────────────
    const BUBBLE_RADIUS = 6;
    const BUBBLE_PAD    = 10;
    const MAX_BUBBLE_W  = CONTENT_W * 0.72;

    for (const msg of messages) {
      const isVisitor = msg.sender_type === 'visitor';
      const isNote    = !!msg.is_internal_note;
      const isSystem  = msg.sender_type === 'system';
      const bodyText  = stripHtml(msg.message_body || '');

      if (!bodyText && !isSystem) continue;

      if (isSystem) {
        // System message — centred, muted
        doc.fillColor(COLORS.systemText).font(FONT_OBLIQUE).fontSize(8)
          .text(bodyText, MARGIN, y, { width: CONTENT_W, align: 'center' });
        y += doc.heightOfString(bodyText, { width: CONTENT_W }) + 8;
        continue;
      }

      // Measure text height
      const textW      = MAX_BUBBLE_W - BUBBLE_PAD * 2;
      const labelH     = 10;
      const textH      = doc.font(FONT_REGULAR).fontSize(9).heightOfString(bodyText, { width: textW });
      const timeH      = 8;
      const bubbleH    = labelH + textH + timeH + BUBBLE_PAD * 2;

      // Check page break
      if (y + bubbleH > doc.page.height - MARGIN) {
        doc.addPage();
        // Re-draw page bg on new page
        doc.rect(0, 0, PAGE_W, doc.page.height).fill(COLORS.pageBg);
        y = MARGIN;
      }

      // Bubble position
      const bubbleX = isVisitor
        ? MARGIN
        : MARGIN + CONTENT_W - MAX_BUBBLE_W;

      const bgColor = isNote   ? COLORS.noteBg
                    : isVisitor ? COLORS.visitorBg
                    : COLORS.agentBg;

      // Draw bubble background
      doc.roundedRect(bubbleX, y, MAX_BUBBLE_W, bubbleH, BUBBLE_RADIUS)
        .fill(bgColor);

      // Note left border stripe
      if (isNote) {
        doc.rect(bubbleX, y, 3, bubbleH).fill(COLORS.noteBorder);
      }

      // Sender label
      const labelColor = isNote ? '#92400e' : isVisitor ? COLORS.mutedText : COLORS.white;
      doc.fillColor(labelColor).font(FONT_BOLD).fontSize(7)
        .text(senderLabel(msg), bubbleX + BUBBLE_PAD, y + BUBBLE_PAD, { width: textW });

      // Body text
      const textColor = isNote ? '#78350f' : isVisitor ? COLORS.bodyText : COLORS.white;
      doc.fillColor(textColor).font(FONT_REGULAR).fontSize(9)
        .text(bodyText, bubbleX + BUBBLE_PAD, y + BUBBLE_PAD + labelH, { width: textW });

      // Timestamp
      const timeColor = isNote ? '#a16207' : isVisitor ? COLORS.systemText : 'rgba(255,255,255,0.6)';
      doc.fillColor(timeColor).font(FONT_REGULAR).fontSize(7)
        .text(fmtDateTime(msg.created_at),
          bubbleX + BUBBLE_PAD,
          y + BUBBLE_PAD + labelH + textH + 2,
          { width: textW, align: 'right' });

      y += bubbleH + 8;
    }

    // ── Footer on last page ───────────────────────────────────────────────────
    y += 16;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).stroke(COLORS.divider);
    y += 8;
    doc.fillColor(COLORS.systemText).font(FONT_REGULAR).fontSize(7)
      .text(
        `Generated by Atelier OmniCore · ${fmtDateTime(new Date().toISOString())} · ${messages.length} message${messages.length !== 1 ? 's' : ''}`,
        MARGIN, y, { width: CONTENT_W, align: 'center' }
      );

    doc.end();
  });
}

// ─── Upload to R2 ─────────────────────────────────────────────────────────────
async function uploadToR2(pdfBuffer, key) {
  const client = getR2Client();
  await client.send(new PutObjectCommand({
    Bucket:      process.env.R2_BUCKET_NAME,
    Key:         key,
    Body:        pdfBuffer,
    ContentType: 'application/pdf',
    // Auto-delete after 1 hour (requires lifecycle rules on the bucket, but metadata here for ref)
    Metadata: { 'omnicore-export': 'true', 'ttl': '3600' },
  }));
}

// ─── Generate presigned GET URL (15 min) ─────────────────────────────────────
async function presignGetUrl(key, ttlSeconds = 900) {
  const client = getR2Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key:    key,
      ResponseContentDisposition: `attachment; filename="${key.split('/').pop()}"`,
    }),
    { expiresIn: ttlSeconds }
  );
}

// ─── Main export function ─────────────────────────────────────────────────────
/**
 * exportConversation
 *
 * @param {string|number} conversationId
 * @param {string|number} tenantId        — for ownership check
 * @returns {Promise<{ downloadUrl: string, filename: string, expiresIn: number }>}
 */
async function exportConversation(conversationId, tenantId) {
  // 1. Load conversation (ownership check via tenant_id)
  const { rows: convRows } = await pool.query(
    `SELECT c.*, b.brand_name
     FROM conversations c
     LEFT JOIN brands b ON b.id = c.brand_id
     WHERE c.id = $1 AND c.tenant_id = $2`,
    [conversationId, tenantId]
  );
  if (!convRows[0]) throw Object.assign(new Error('Conversation not found'), { status: 404 });
  const conversation = convRows[0];

  // 2. Load messages
  const { rows: messages } = await pool.query(
    `SELECT m.*, a.name AS sender_name
     FROM messages m
     LEFT JOIN agents a ON a.id = m.sender_id
     WHERE m.conversation_id = $1
     ORDER BY m.created_at ASC`,
    [conversationId]
  );

  // 3. Build PDF
  const brand = { name: conversation.brand_name || 'OmniCore' };
  const pdfBuffer = await buildPdf(conversation, messages, brand);

  // 4. Upload to R2
  const timestamp = Date.now();
  const filename  = `transcript-${conversationId}-${timestamp}.pdf`;
  const key       = `exports/tenant-${tenantId}/${filename}`;
  await uploadToR2(pdfBuffer, key);

  // 5. Presign download URL (15 min)
  const TTL_SECONDS = 900;
  const downloadUrl = await presignGetUrl(key, TTL_SECONDS);

  logger.info({ conversationId, tenantId, key }, 'export_generated');

  return { downloadUrl, filename, expiresIn: TTL_SECONDS };
}

// ─── Express route handler ────────────────────────────────────────────────────
/**
 * GET /api/conversations/:id/export
 *
 * Returns { downloadUrl, filename, expiresIn } on success.
 * The client should immediately redirect or open the downloadUrl.
 */
async function handleExportRequest(req, res) {
  const conversationId = req.params.id;
  const tenantId       = req.agent?.tenantId;

  if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

  // Check R2 config before doing any work
  if (!process.env.R2_ENDPOINT || !process.env.R2_BUCKET_NAME) {
    logger.warn('R2 not configured — returning inline PDF instead');
    // Fallback: stream PDF directly to response (no persistent storage)
    return streamPdfDirect(req, res, conversationId, tenantId);
  }

  try {
    const result = await exportConversation(conversationId, tenantId);
    return res.json(result);
  } catch (err) {
    logger.error({ err, conversationId, tenantId }, 'export_error');
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Export failed' });
  }
}

/**
 * Fallback: stream PDF bytes directly when R2 is not configured.
 * Useful in development.
 */
async function streamPdfDirect(req, res, conversationId, tenantId) {
  try {
    const { rows: convRows } = await pool.query(
      `SELECT c.*, b.brand_name FROM conversations c
       LEFT JOIN brands b ON b.tenant_id = c.tenant_id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [conversationId, tenantId]
    );
    if (!convRows[0]) return res.status(404).json({ error: 'Conversation not found' });

    const { rows: messages } = await pool.query(
      `SELECT m.*, a.name AS sender_name FROM messages m
       LEFT JOIN agents a ON a.id = m.sender_id
       WHERE m.conversation_id = $1 ORDER BY m.created_at ASC`,
      [conversationId]
    );

    const brand = { name: convRows[0].brand_name || 'OmniCore' };
    const pdfBuffer = await buildPdf(convRows[0], messages, brand);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="transcript-${conversationId}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (err) {
    logger.error({ err, conversationId }, 'export_stream_error');
    return res.status(500).json({ error: err.message || 'Export failed' });
  }
}

module.exports = { handleExportRequest, exportConversation, buildPdf };
