'use strict';

/**
 * email.service.js
 * Atelier OmniCore — Outbound email via tenant-configured SMTP.
 *
 * Each tenant stores SMTP credentials in tenants.smtp_config_json:
 * {
 *   host: "smtp.example.com",
 *   port: 587,
 *   secure: false,
 *   user: "apikey",
 *   pass: "SG.xxx",
 *   from_email: "support@example.com",
 *   enabled: true,
 *   notification_email: "owner@example.com"   ← tenant owner alert address
 * }
 */

const nodemailer = require('nodemailer');
const { pool }   = require('../lib/db');
const logger     = require('../utils/logger');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getTenantSmtpConfig(tenantId) {
  const { rows } = await pool.query(
    `SELECT smtp_config_json FROM tenants WHERE id = $1`,
    [tenantId]
  );
  if (!rows.length) return null;
  const cfg = rows[0].smtp_config_json;
  // user may be empty if from_email is used as the SMTP username (e.g. Mailgun)
  if (!cfg || !cfg.enabled || !cfg.host || !cfg.pass || (!cfg.user && !cfg.from_email)) return null;
  return cfg;
}

function buildTransporter(cfg) {
  return nodemailer.createTransport({
    host:   cfg.host,
    port:   cfg.port || 587,
    secure: Boolean(cfg.secure),
    // Many providers (Mailgun, SendGrid) use the from_email as the SMTP username
    auth:   { user: cfg.user || cfg.from_email, pass: cfg.pass },
  });
}

function fromAddress(cfg) {
  return cfg.from_email || cfg.user;
}

/**
 * Build the Reply-To address for conversation threading.
 * When a visitor hits Reply in their email client, their MUA sends to this
 * address, which the inbound webhook parses to route directly into the right
 * conversation without relying on In-Reply-To headers.
 *
 * Format: reply+conv_<uuid>@<domain>
 *
 * Domain resolution order:
 *  1. cfg.inbound_email_domain  (saved in SMTP settings UI)
 *  2. domain part of cfg.from_email  (auto-extracted fallback)
 *  3. INBOUND_EMAIL_DOMAIN env var   (server-level fallback)
 *
 * If none of the above resolve, Reply-To is omitted and header-based
 * threading (In-Reply-To / References) continues to work as a fallback.
 */
function replyToAddress(conversationId, cfg) {
  if (!conversationId) return null;
  let domain = (cfg && cfg.inbound_email_domain) || process.env.INBOUND_EMAIL_DOMAIN || null;
  if (!domain && cfg && cfg.from_email) {
    const at = (cfg.from_email || '').lastIndexOf('@');
    if (at !== -1) domain = cfg.from_email.slice(at + 1);
  }
  if (!domain) return null;
  return `reply+conv_${conversationId}@${domain}`;
}

/** Strip HTML tags to get a plain-text excerpt */
function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** Build a branded wrapper for transactional HTML emails */
function brandedEmail({ title, preview, bodyHtml, footer = '' }) {
  return `
  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:0;color:#1e293b;">
    <div style="background:#0284c7;padding:20px 28px;">
      <h1 style="margin:0;font-size:18px;color:#fff;letter-spacing:-0.3px;">OmniCore</h1>
    </div>
    <div style="padding:28px;">
      <h2 style="margin:0 0 12px;font-size:15px;color:#0f172a;">${title}</h2>
      ${preview ? `<p style="margin:0 0 16px;color:#475569;font-size:14px;">${preview}</p>` : ''}
      ${bodyHtml}
      ${footer ? `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/>
      <p style="color:#94a3b8;font-size:11px;">${footer}</p>` : ''}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send an email when a conversation's status changes.
 * (e.g. ticket resolved / reopened)
 */
async function sendStatusChangeEmail(tenantId, conversationId, oldStatus, newStatus, visitorEmail) {
  if (!visitorEmail || oldStatus === newStatus) return;

  let cfg;
  try { cfg = await getTenantSmtpConfig(tenantId); } catch (err) {
    logger.warn({ err, tenantId }, 'smtp_config_load_failed'); return;
  }
  if (!cfg) return;

  const statusLabels = { open: 'Open', closed: 'Resolved', pending: 'Pending', ai_handling: 'Handled by AI',
    submitted: 'Submitted', in_progress: 'In Progress', waiting_on_customer: 'Waiting on Customer', resolved: 'Resolved' };
  const toLabel = statusLabels[newStatus] ?? newStatus;

  const html = brandedEmail({
    title:    'Ticket Status Update',
    preview:  `Your support ticket is now <strong>${toLabel}</strong>.`,
    bodyHtml: `<p style="font-size:13px;color:#64748b;">Conversation ID: <code>${conversationId}</code></p>`,
    footer:   'You received this because you opened a support ticket. Do not reply to this email.',
  });

  try {
    await buildTransporter(cfg).sendMail({
      from: fromAddress(cfg), to: visitorEmail,
      subject: `Your support ticket: ${toLabel}`, html,
    });
    logger.info({ tenantId, conversationId, newStatus, visitorEmail }, 'status_email_sent');
  } catch (err) {
    logger.warn({ err, tenantId, conversationId }, 'status_email_failed');
  }
}

/**
 * Notify visitor that an agent replied to their conversation / ticket.
 * Only sent when not an internal note.
 */
async function sendAgentReplyEmail(tenantId, conversationId, agentName, messageBody, visitorEmail) {
  if (!visitorEmail) return;

  let cfg;
  try { cfg = await getTenantSmtpConfig(tenantId); } catch (err) {
    logger.warn({ err, tenantId }, 'smtp_config_load_failed'); return;
  }
  if (!cfg) return;

  const replyTo = replyToAddress(conversationId, cfg);
  const footer  = replyTo
    ? 'Simply reply to this email — your reply will be routed directly back to your support thread.'
    : 'You received this because you have an open support ticket. Do not reply directly to this email.';

  const preview = stripHtml(messageBody).slice(0, 200);
  const html = brandedEmail({
    title:    `${agentName} replied to your ticket`,
    preview:  `"${preview}"`,
    bodyHtml: `<p style="font-size:13px;color:#64748b;">
      To continue the conversation, simply reply to this email or visit our support portal.
    </p>`,
    footer,
  });

  const mailOpts = {
    from: fromAddress(cfg), to: visitorEmail,
    subject: `Re: Your support ticket — ${agentName} replied`, html,
  };
  if (replyTo) mailOpts.replyTo = replyTo;

  try {
    await buildTransporter(cfg).sendMail(mailOpts);
    logger.info({ tenantId, conversationId, agentName, visitorEmail }, 'agent_reply_email_sent');
  } catch (err) {
    logger.warn({ err, tenantId, conversationId }, 'agent_reply_email_failed');
  }
}

/**
 * Notify the tenant's notification_email when a new visitor message arrives.
 * Recipient is smtp_config_json.notification_email (set in Workspace → SMTP settings).
 */
async function sendNewVisitorMessageEmail(tenantId, conversationId, visitorName, messageBody) {
  let cfg;
  try { cfg = await getTenantSmtpConfig(tenantId); } catch (err) {
    logger.warn({ err, tenantId }, 'smtp_config_load_failed'); return;
  }
  if (!cfg || !cfg.notification_email) return;

  const preview = stripHtml(messageBody).slice(0, 300);
  const html = brandedEmail({
    title:    `New message from ${visitorName}`,
    preview:  `"${preview}"`,
    bodyHtml: `<p style="font-size:13px;color:#64748b;">
      A visitor sent a new chat message. Log in to OmniCore to reply.
    </p>
    <p style="font-size:12px;color:#94a3b8;">Conversation ID: <code>${conversationId}</code></p>`,
    footer:   'You received this because you configured inbox notifications in OmniCore.',
  });

  try {
    await buildTransporter(cfg).sendMail({
      from: fromAddress(cfg), to: cfg.notification_email,
      subject: `💬 New message from ${visitorName}`, html,
    });
    logger.info({ tenantId, conversationId, visitorName }, 'visitor_message_notification_sent');
  } catch (err) {
    logger.warn({ err, tenantId, conversationId }, 'visitor_message_notification_failed');
  }
}

/**
 * Send a password reset link to an agent.
 */
async function sendPasswordResetEmail(tenantId, agentEmail, agentName, resetLink) {
  let cfg;
  try { cfg = await getTenantSmtpConfig(tenantId); } catch { cfg = null; }

  if (!cfg) {
    logger.info({ tenantId, agentEmail }, 'password_reset_no_smtp_skipped');
    return;
  }

  const html = brandedEmail({
    title:    'Reset your password',
    preview:  `Hi ${agentName}, we received a request to reset your OmniCore password.`,
    bodyHtml: `<p style="margin:0 0 20px;">
      <a href="${resetLink}" style="display:inline-block;padding:10px 20px;background:#0284c7;color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">
        Reset Password
      </a>
    </p>
    <p style="font-size:12px;color:#94a3b8;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
    footer: 'You received this because a password reset was requested for your OmniCore account.',
  });

  try {
    await buildTransporter(cfg).sendMail({
      from: fromAddress(cfg), to: agentEmail,
      subject: 'OmniCore: Reset your password', html,
    });
    logger.info({ tenantId, agentEmail }, 'password_reset_email_sent');
  } catch (err) {
    logger.warn({ err, tenantId, agentEmail }, 'password_reset_email_failed');
  }
}

module.exports = {
  sendStatusChangeEmail,
  sendAgentReplyEmail,
  sendNewVisitorMessageEmail,
  sendPasswordResetEmail,
};
