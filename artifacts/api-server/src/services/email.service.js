'use strict';

/**
 * email.service.js
 * Atelier OmniCore — Outbound email via tenant-configured SMTP.
 *
 * Each tenant can store their SMTP credentials in tenants.smtp_config_json:
 * {
 *   host: "smtp.example.com",
 *   port: 587,
 *   secure: false,
 *   user: "apikey",
 *   pass: "SG.xxx",
 *   from_email: "support@example.com",
 *   enabled: true
 * }
 *
 * If no SMTP config is present, or enabled=false, emails are skipped silently.
 */

const nodemailer = require('nodemailer');
const { pool }   = require('../lib/db');
const logger     = require('../utils/logger');

/**
 * Load tenant SMTP config from the DB.
 * Returns null if the tenant has no SMTP configured or enabled=false.
 */
async function getTenantSmtpConfig(tenantId) {
  const { rows } = await pool.query(
    `SELECT smtp_config_json FROM tenants WHERE id = $1`,
    [tenantId]
  );
  if (!rows.length) return null;
  const cfg = rows[0].smtp_config_json;
  if (!cfg || !cfg.enabled || !cfg.host || !cfg.user || !cfg.pass) return null;
  return cfg;
}

/**
 * Build a nodemailer transporter from stored SMTP config.
 */
function buildTransporter(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port || 587,
    secure: Boolean(cfg.secure),
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

/**
 * Send an email alert when a conversation's status changes.
 *
 * @param {string} tenantId
 * @param {string} conversationId
 * @param {string} oldStatus
 * @param {string} newStatus
 * @param {string} [visitorEmail] — recipient; skipped if null/undefined
 */
async function sendStatusChangeEmail(tenantId, conversationId, oldStatus, newStatus, visitorEmail) {
  if (!visitorEmail) return;          // no email address to send to
  if (oldStatus === newStatus) return;

  let cfg;
  try {
    cfg = await getTenantSmtpConfig(tenantId);
  } catch (err) {
    logger.warn({ err, tenantId }, 'smtp_config_load_failed');
    return;
  }
  if (!cfg) return;  // SMTP not configured / disabled

  const statusLabels = {
    open:        'Opened',
    closed:      'Resolved',
    pending:     'Pending',
    ai_handling: 'Handled by AI',
  };
  const fromLabel  = statusLabels[oldStatus]  ?? oldStatus;
  const toLabel    = statusLabels[newStatus]  ?? newStatus;

  const subject = `Your support ticket status: ${toLabel}`;
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b;">
      <h2 style="color:#0284c7;margin:0 0 16px;">Ticket Update</h2>
      <p>Your support ticket status has changed from
         <strong>${fromLabel}</strong> to <strong>${toLabel}</strong>.</p>
      <p style="color:#64748b;font-size:13px;">Conversation ID: ${conversationId}</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/>
      <p style="color:#94a3b8;font-size:11px;">
        Powered by OmniCore · Do not reply to this email.
      </p>
    </div>
  `;

  try {
    const transporter = buildTransporter(cfg);
    await transporter.sendMail({
      from:    cfg.from_email || cfg.user,
      to:      visitorEmail,
      subject,
      html,
    });
    logger.info({ tenantId, conversationId, newStatus, visitorEmail }, 'status_email_sent');
  } catch (err) {
    logger.warn({ err, tenantId, conversationId }, 'status_email_failed');
    // Non-fatal — never crash the request due to email failures
  }
}

module.exports = { sendStatusChangeEmail };
