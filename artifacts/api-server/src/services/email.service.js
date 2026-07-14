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
const fs         = require('fs');
const path       = require('path');
const { pool }   = require('../lib/db');
const logger     = require('../utils/logger');
const { R2_ENABLED, getPresignedGetUrl } = require('../lib/r2');

// Uploaded widget/dashboard files live here (same dir widget.controller uses)
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

/**
 * Load the binary content of an uploaded file referenced by a local
 * `/api/widget/files/<name>` URL. Tries local disk first, then R2.
 * Returns a Buffer or null if the file cannot be resolved.
 */
async function loadUploadedFileContent(url) {
  const m = String(url).match(/^\/api\/widget\/files\/([^/?#]+)$/);
  if (!m) return null;
  const name = path.basename(decodeURIComponent(m[1]));
  try {
    const filePath = path.join(UPLOADS_DIR, name);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
    if (R2_ENABLED) {
      const signedUrl = await getPresignedGetUrl(name, 300);
      const resp = await fetch(signedUrl);
      if (resp.ok) return Buffer.from(await resp.arrayBuffer());
    }
  } catch (err) {
    logger.warn({ err, name }, 'email_attachment_file_load_failed');
  }
  return null;
}

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
async function sendAgentReplyEmail(tenantId, conversationId, agentName, messageBody, visitorEmail, attachments = []) {
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

  // Classify attachments into three buckets:
  //   inlineImages  — data-URI images → embedded as CID inline attachments
  //   fileAttach    — data-URI non-images → regular downloadable attachment
  //   urlLinks      — hosted-URL files → clickable link in the HTML
  const inlineImages  = [];
  const fileAttach    = [];
  const urlLinks      = [];
  const mailerAttachments = [];

  const addBuffer = (buf, mimeType, name) => {
    if (mimeType.startsWith('image/')) {
      const cid = `img-${Math.random().toString(36).slice(2)}@omnicore`;
      const filename = name || `image.${mimeType.split('/')[1] || 'png'}`;
      inlineImages.push({ cid, mimeType, name: filename });
      mailerAttachments.push({ filename, content: buf, contentType: mimeType, cid });
    } else {
      const filename = name || 'attachment';
      fileAttach.push(filename);
      mailerAttachments.push({ filename, content: buf, contentType: mimeType });
    }
  };

  for (const a of (Array.isArray(attachments) ? attachments : [])) {
    if (!a || !a.url) continue;
    const dataMatch = a.url.match(/^data:([^;]+);base64,(.+)$/s);
    if (dataMatch) {
      const [, mimeType, b64] = dataMatch;
      addBuffer(Buffer.from(b64, 'base64'), mimeType, a.name);
      continue;
    }
    // Locally uploaded files (`/api/widget/files/<name>`) — load the binary
    // content and embed directly; a relative URL is dead inside an email.
    if (a.url.startsWith('/api/widget/files/')) {
      const buf = await loadUploadedFileContent(a.url);
      if (buf) {
        addBuffer(buf, a.type || 'application/octet-stream', a.name);
        continue;
      }
    }
    // Other relative URLs: make them absolute using the public domain so the
    // link works from the recipient's inbox. Absolute URLs pass through as-is.
    if (a.url.startsWith('/')) {
      const domain = (process.env.REPLIT_DOMAINS || '').split(',')[0].trim();
      if (domain) {
        urlLinks.push({ ...a, url: `https://${domain}${a.url}` });
        continue;
      }
      // No public domain known and file couldn't be loaded — skip dead link
      logger.warn({ url: a.url }, 'email_attachment_unresolvable_relative_url');
      continue;
    }
    urlLinks.push(a);
  }

  // Inline images rendered as <img> blocks
  const inlineImgHtml = inlineImages.map(im =>
    `<div style="margin:8px 0;"><img src="cid:${im.cid}" alt="${im.name}" style="max-width:100%;border-radius:6px;display:block;" /></div>`
  ).join('');

  // Non-image data-URI files — show file count notice
  const fileAttachHtml = fileAttach.length > 0
    ? `<div style="margin-top:12px;padding:10px 14px;background:#f1f5f9;border-radius:6px;font-size:12px;color:#475569;">
        📎 ${fileAttach.length} file${fileAttach.length > 1 ? 's' : ''} attached: ${fileAttach.join(', ')}
      </div>`
    : '';

  // Hosted-URL files — clickable links
  const urlLinksHtml = urlLinks.length > 0
    ? `<div style="margin-top:16px;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.04em;">Attachments</p>
        ${urlLinks.map(a => `<a href="${a.url}" style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;background:#e0f2fe;color:#0369a1;border-radius:4px;font-size:12px;text-decoration:none;">${a.name || 'File'}</a>`).join('')}
      </div>`
    : '';

  const html = brandedEmail({
    title:    `${agentName} replied to your ticket`,
    preview:  `"${preview}"`,
    bodyHtml: `<p style="font-size:13px;color:#64748b;">
      To continue the conversation, simply reply to this email or visit our support portal.
    </p>${inlineImgHtml}${fileAttachHtml}${urlLinksHtml}`,
    footer,
  });

  const mailOpts = {
    from: fromAddress(cfg), to: visitorEmail,
    subject: `Re: Your support ticket — ${agentName} replied`, html,
  };
  if (replyTo) mailOpts.replyTo = replyTo;
  if (mailerAttachments.length > 0) mailOpts.attachments = mailerAttachments;

  try {
    await buildTransporter(cfg).sendMail(mailOpts);
    logger.info({ tenantId, conversationId, agentName, visitorEmail, attachmentCount: mailerAttachments.length }, 'agent_reply_email_sent');
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
 * Send a ticket-created confirmation to the visitor.
 * Triggered when an agent converts a conversation to a ticket.
 */
async function sendTicketCreatedEmail(tenantId, conversationId, ticketNumber, visitorEmail, subject, summary) {
  if (!visitorEmail) return;
  const safeSummary = summary
    ? String(summary).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : '';
  let cfg;
  try { cfg = await getTenantSmtpConfig(tenantId); } catch (err) {
    logger.warn({ err, tenantId }, 'smtp_config_load_failed'); return;
  }
  if (!cfg) return;

  const replyTo  = replyToAddress(conversationId, cfg);
  const mailOpts = {
    from: fromAddress(cfg), to: visitorEmail,
    subject: `Your ticket has been created — #${ticketNumber}`,
    html: brandedEmail({
      title:   `Ticket #${ticketNumber} created`,
      preview: subject ? `Regarding: <em>${subject}</em>` : undefined,
      bodyHtml: `
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;margin:0 0 16px;">
          <p style="margin:0;font-size:13px;color:#0369a1;font-weight:600;">Ticket number: <span style="font-size:18px;">#${ticketNumber}</span></p>
        </div>
        ${safeSummary ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin:0 0 16px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.04em;">Summary of your conversation</p>
          <p style="margin:0;font-size:13px;color:#475569;line-height:1.55;white-space:pre-line;">${safeSummary}</p>
        </div>` : ''}
        <p style="font-size:13px;color:#64748b;">
          Our support team has received your message and will get back to you shortly.
          Use the ticket number above if you need to reference this case.
        </p>
        ${replyTo ? `<p style="font-size:13px;color:#64748b;">You can also reply directly to this email to add more information to your ticket.</p>` : ''}`,
      footer: 'You received this because you submitted a support request.',
    }),
  };
  if (replyTo) mailOpts.replyTo = replyTo;

  try {
    await buildTransporter(cfg).sendMail(mailOpts);
    logger.info({ tenantId, conversationId, ticketNumber, visitorEmail }, 'ticket_created_email_sent');
  } catch (err) {
    logger.warn({ err, tenantId, conversationId }, 'ticket_created_email_failed');
  }
}

/**
 * Send a test email to verify SMTP config.
 * Returns { ok: true } or throws with a descriptive message.
 */
async function sendSmtpTestEmail(tenantId) {
  const cfg = await getTenantSmtpConfig(tenantId);
  if (!cfg) throw Object.assign(new Error('SMTP not configured or not enabled'), { status: 400 });

  const transporter = buildTransporter(cfg);
  await transporter.verify(); // throws if credentials/host are wrong

  const to = cfg.notification_email || fromAddress(cfg);
  await transporter.sendMail({
    from:    fromAddress(cfg),
    to,
    subject: 'OmniCore SMTP Test — connection verified',
    html:    brandedEmail({
      title:    'SMTP connection test',
      preview:  'Your SMTP configuration is working correctly.',
      bodyHtml: `<p style="font-size:13px;color:#64748b;">
        This message confirms that OmniCore can send emails on behalf of <strong>${fromAddress(cfg)}</strong>.<br/>
        All ticket notifications and status updates will be delivered from this address.
      </p>`,
      footer: 'Sent from OmniCore SMTP test.',
    }),
  });

  logger.info({ tenantId, to }, 'smtp_test_email_sent');
  return { ok: true, to };
}

// ---------------------------------------------------------------------------
// Platform (super-admin) SMTP — powers system/transactional emails
// (password reset, agent invite, account/plan notifications). This is owned
// by the super admin and is independent of any per-tenant SMTP config.
// ---------------------------------------------------------------------------

/**
 * Read the single-row platform SMTP config.
 * Returns the config object only when usable (enabled + host + pass + a
 * username or from_email), otherwise null. Tolerates a missing table so the
 * app degrades gracefully before the migration has run.
 */
async function getPlatformSmtpConfig() {
  try {
    const { rows } = await pool.query(
      `SELECT smtp_config_json FROM platform_settings WHERE id = 1`
    );
    if (!rows.length) return null;
    const cfg = rows[0].smtp_config_json;
    if (!cfg || !cfg.enabled || !cfg.host || !cfg.pass || (!cfg.user && !cfg.from_email)) return null;
    return cfg;
  } catch (err) {
    logger.warn({ err: err.message }, 'platform_smtp_config_load_failed');
    return null;
  }
}

/**
 * Send a system/transactional email via platform SMTP.
 * Non-throwing — returns true if sent, false if skipped (no platform SMTP
 * configured) or if sending failed. Safe for fire-and-forget notifications.
 */
async function sendSystemEmail({ to, subject, title, preview, bodyHtml, footer }) {
  if (!to) return false;
  const cfg = await getPlatformSmtpConfig();
  if (!cfg) {
    logger.info({ to, subject }, 'system_email_no_platform_smtp_skipped');
    return false;
  }
  const html = brandedEmail({ title: title || subject, preview, bodyHtml: bodyHtml || '', footer });
  try {
    await buildTransporter(cfg).sendMail({ from: fromAddress(cfg), to, subject, html });
    logger.info({ to, subject }, 'system_email_sent');
    return true;
  } catch (err) {
    logger.warn({ err: err.message, to, subject }, 'system_email_failed');
    return false;
  }
}

/**
 * Verify platform SMTP and send a test email.
 * Throws (with descriptive message) on error — used by the test endpoint.
 */
async function sendPlatformSmtpTestEmail(toOverride) {
  const cfg = await getPlatformSmtpConfig();
  if (!cfg) throw Object.assign(new Error('Platform SMTP not configured or not enabled'), { status: 400 });

  const transporter = buildTransporter(cfg);
  await transporter.verify();

  const to = toOverride || fromAddress(cfg);
  await transporter.sendMail({
    from:    fromAddress(cfg),
    to,
    subject: 'OmniCore Platform SMTP Test — connection verified',
    html:    brandedEmail({
      title:    'Platform SMTP connection test',
      preview:  'Your platform email configuration is working correctly.',
      bodyHtml: `<p style="font-size:13px;color:#64748b;">
        This confirms OmniCore can send system emails — password resets, account invites,
        and plan/account notifications — from <strong>${fromAddress(cfg)}</strong>.
      </p>`,
      footer: 'Sent from OmniCore platform SMTP test.',
    }),
  });

  logger.info({ to }, 'platform_smtp_test_email_sent');
  return { ok: true, to };
}

/**
 * Send a welcome/invite email with a link for the new agent to set their own
 * password. Uses platform SMTP. Returns true if sent, false otherwise.
 */
async function sendAgentInviteEmail({ to, name, inviteLink, companyName, ctaLabel }) {
  const buttonLabel = ctaLabel || 'Set Your Password';
  const bodyHtml = `<p style="font-size:14px;color:#475569;margin:0 0 16px;">
      You've been invited to join ${companyName ? `<strong>${companyName}</strong> on ` : ''}OmniCore.
      Set your password to activate your account and get started.
    </p>
    <p style="margin:0 0 20px;">
      <a href="${inviteLink}" style="display:inline-block;padding:10px 20px;background:#0284c7;color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">
        ${buttonLabel}
      </a>
    </p>
    <p style="font-size:12px;color:#94a3b8;">This invite link expires in 7 days.</p>`;
  return sendSystemEmail({
    to,
    subject: "You've been invited to OmniCore",
    title:   `Welcome${name ? `, ${name}` : ''}`,
    preview: 'Set your password to get started.',
    bodyHtml,
    footer:  'You received this because an administrator invited you to OmniCore.',
  });
}

/**
 * Notify a tenant admin about an account or plan change. Uses platform SMTP.
 */
async function sendAccountUpdateEmail({ to, subject, heading, message }) {
  return sendSystemEmail({
    to,
    subject,
    title:    heading,
    preview:  message,
    bodyHtml: `<p style="font-size:13px;color:#64748b;">${message}</p>`,
    footer:   'You received this because you administer an OmniCore workspace.',
  });
}

/**
 * Send a password reset link. Prefers platform SMTP (works for any tenant,
 * including brand-new ones), falling back to the tenant's own SMTP config.
 * Returns true if an email was sent, false otherwise.
 */
async function sendPasswordResetEmail(tenantId, agentEmail, agentName, resetLink) {
  const preview  = `Hi ${agentName}, we received a request to reset your OmniCore password.`;
  const bodyHtml = `<p style="margin:0 0 20px;">
      <a href="${resetLink}" style="display:inline-block;padding:10px 20px;background:#0284c7;color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">
        Reset Password
      </a>
    </p>
    <p style="font-size:12px;color:#94a3b8;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>`;
  const footer   = 'You received this because a password reset was requested for your OmniCore account.';

  // 1. Try platform SMTP first.
  const sentViaPlatform = await sendSystemEmail({
    to: agentEmail, subject: 'OmniCore: Reset your password',
    title: 'Reset your password', preview, bodyHtml, footer,
  });
  if (sentViaPlatform) return true;

  // 2. Fall back to the tenant's own SMTP config.
  let cfg;
  try { cfg = await getTenantSmtpConfig(tenantId); } catch { cfg = null; }
  if (!cfg) {
    logger.info({ tenantId, agentEmail }, 'password_reset_no_smtp_skipped');
    return false;
  }

  const html = brandedEmail({ title: 'Reset your password', preview, bodyHtml, footer });
  try {
    await buildTransporter(cfg).sendMail({
      from: fromAddress(cfg), to: agentEmail,
      subject: 'OmniCore: Reset your password', html,
    });
    logger.info({ tenantId, agentEmail }, 'password_reset_email_sent');
    return true;
  } catch (err) {
    logger.warn({ err, tenantId, agentEmail }, 'password_reset_email_failed');
    return false;
  }
}

module.exports = {
  sendStatusChangeEmail,
  sendAgentReplyEmail,
  sendNewVisitorMessageEmail,
  sendPasswordResetEmail,
  sendTicketCreatedEmail,
  sendSmtpTestEmail,
  getPlatformSmtpConfig,
  sendSystemEmail,
  sendPlatformSmtpTestEmail,
  sendAgentInviteEmail,
  sendAccountUpdateEmail,
};
