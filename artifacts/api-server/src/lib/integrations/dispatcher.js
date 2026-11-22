'use strict';

/**
 * integrations/dispatcher.js
 * Turns outbox rows (integration_events) into deliveries and sends them.
 *
 *   outbox worker   every OUTBOX_INTERVAL ms: claims pending events with
 *                   FOR UPDATE SKIP LOCKED (safe with several API instances),
 *                   builds the full public payload, fans out to
 *                     - webhook_endpoints subscribed to the event
 *                     - chat connectors (Slack / Discord / Microsoft Teams)
 *                     - GoHighLevel sync (lib/integrations/ghl.js)
 *   delivery worker sends due webhook_deliveries with exponential back-off
 *                   (1m, 5m, 30m, 2h, 6h, 12h → then 'failed').
 *
 * Outgoing webhook request:
 *   POST <url>
 *   Content-Type: application/json
 *   User-Agent: OmniCore-Webhooks/1.0
 *   OmniCore-Event: conversation.created
 *   OmniCore-Delivery: <delivery id>
 *   OmniCore-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 */

const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { pool } = require('../db');
const logger = require('../../utils/logger');
const { open, openJson } = require('../secretBox');
const { ensureIntegrationsSchema } = require('./schema');

const EVENT_TYPES = {
  'conversation.created':
    'A new conversation started (chat, email, API or GoHighLevel)',
  'conversation.closed': 'A conversation was closed',
  'conversation.reopened': 'A closed conversation was reopened',
  'conversation.status_changed': 'Status changed between open / pending / bot',
  'conversation.assigned': 'A conversation was assigned or unassigned',
  'conversation.priority_changed': 'Priority changed',
  'message.created': 'A visitor, agent or AI message was sent',
  'note.created': 'An internal note was added',
  'ticket.created': 'A ticket was created or a conversation became a ticket',
  'csat.submitted': 'A customer rated a conversation',
  'contact.created': 'A new contact (visitor) was created',
};

const BACKOFF_MINUTES = [1, 5, 30, 120, 360, 720];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
const OUTBOX_INTERVAL = 3000;
const DELIVERY_INTERVAL = 5000;

// ── Payload builders ─────────────────────────────────────────────────────────
async function loadConversation(id) {
  const { rows } = await pool.query(
    `SELECT c.id, c.tenant_id, c.brand_id, b.brand_name, c.status, c.priority, c.channel,
            c.subject, c.is_ticket, c.ticket_number, c.csat_score, c.referrer_url,
            c.assigned_agent_id, a.name AS assigned_agent_name, a.email AS assigned_agent_email,
            c.created_at, c.updated_at,
            v.id AS contact_id, v.display_name AS contact_name, v.email AS contact_email
       FROM conversations c
       LEFT JOIN brands b   ON b.id = c.brand_id
       LEFT JOIN agents a   ON a.id = c.assigned_agent_id
       LEFT JOIN visitors v ON v.id = c.visitor_id
      WHERE c.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    brand: r.brand_id ? { id: r.brand_id, name: r.brand_name } : null,
    status: r.status,
    priority: r.priority,
    channel: r.channel,
    subject: r.subject,
    is_ticket: r.is_ticket,
    ticket_number: r.ticket_number,
    csat_score: r.csat_score,
    referrer_url: r.referrer_url,
    assignee: r.assigned_agent_id
      ? {
          id: r.assigned_agent_id,
          name: r.assigned_agent_name,
          email: r.assigned_agent_email,
        }
      : null,
    contact: r.contact_id
      ? { id: r.contact_id, name: r.contact_name, email: r.contact_email }
      : null,
    url: `${(process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '')}/dashboard/?conversation=${r.id}`,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function loadMessage(id) {
  const { rows } = await pool.query(
    `SELECT m.id, m.conversation_id, m.sender_type, m.sender_id, m.message_body,
            m.is_internal_note, m.attachments_json, m.created_at, a.name AS agent_name
       FROM messages m LEFT JOIN agents a ON a.id = m.sender_id AND m.sender_type = 'agent'
      WHERE m.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    conversation_id: r.conversation_id,
    sender_type: r.sender_type,
    sender: r.agent_name ? { id: r.sender_id, name: r.agent_name } : null,
    body: r.message_body,
    is_internal_note: r.is_internal_note,
    attachments: Array.isArray(r.attachments_json)
      ? r.attachments_json.map((x) => ({
          name: x.name || x.filename,
          url: x.url,
          type: x.mimeType || x.type,
        }))
      : [],
    created_at: r.created_at,
  };
}

async function loadContact(id) {
  const { rows } = await pool.query(
    `SELECT v.id, v.display_name, v.email, v.brand_id, b.brand_name, v.timezone,
            v.location_city, v.created_at
       FROM visitors v LEFT JOIN brands b ON b.id = v.brand_id WHERE v.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    name: r.display_name,
    email: r.email,
    brand: r.brand_id ? { id: r.brand_id, name: r.brand_name } : null,
    timezone: r.timezone,
    city: r.location_city,
    created_at: r.created_at,
  };
}

/** Builds the public event envelope sent to every subscriber. */
async function buildEnvelope(evt) {
  const data = { ...evt.payload };
  if (
    evt.event_type.startsWith('message.') ||
    evt.event_type === 'note.created'
  ) {
    data.message = await loadMessage(evt.resource_id);
    if (data.message)
      data.conversation = await loadConversation(data.message.conversation_id);
  } else if (evt.event_type === 'contact.created') {
    data.contact = await loadContact(evt.resource_id);
  } else {
    data.conversation = await loadConversation(evt.resource_id);
  }
  return {
    id: `evt_${evt.id}`,
    type: evt.event_type,
    created_at: evt.created_at,
    tenant_id: evt.tenant_id,
    data,
  };
}

function subscribed(events, type) {
  return (events || []).some(
    (e) =>
      e === '*' ||
      e === type ||
      (e.endsWith('.*') && type.startsWith(e.slice(0, -1))),
  );
}

// ── SSRF guard ───────────────────────────────────────────────────────────────
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return (
    v6 === '::1' ||
    v6 === '::' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('fe80')
  );
}

/** Rejects non-HTTPS (in production) and URLs resolving to private networks. */
async function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Object.assign(new Error('Invalid URL'), { status: 400 });
  }
  const allowHttp =
    process.env.NODE_ENV !== 'production' ||
    process.env.WEBHOOKS_ALLOW_HTTP === 'true';
  if (!(u.protocol === 'https:' || (allowHttp && u.protocol === 'http:'))) {
    throw Object.assign(new Error('Webhook URLs must use https://'), {
      status: 400,
    });
  }
  if (process.env.WEBHOOKS_ALLOW_PRIVATE === 'true') return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length)
    throw Object.assign(new Error(`Cannot resolve ${host}`), { status: 400 });
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw Object.assign(
      new Error('Webhook URL points to a private or internal address'),
      { status: 400 },
    );
  }
  return u;
}

function sign(secret, body, ts = Math.floor(Date.now() / 1000)) {
  const v1 = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${body}`)
    .digest('hex');
  return `t=${ts},v1=${v1}`;
}

// ── Chat connector formatting ────────────────────────────────────────────────
function describe(env) {
  const c = env.data.conversation;
  const who = c?.contact?.name || c?.contact?.email || 'A visitor';
  const brand = c?.brand?.name ? ` · ${c.brand.name}` : '';
  switch (env.type) {
    case 'conversation.created':
      return `💬 New ${c?.channel || ''} conversation from ${who}${brand}`;
    case 'ticket.created':
      return `🎫 Ticket #${c?.ticket_number ?? ''} (${c?.priority || 'normal'}) from ${who}${brand}${c?.subject ? `: ${c.subject}` : ''}`;
    case 'message.created': {
      const m = env.data.message;
      const from =
        m?.sender_type === 'visitor' ? who : m?.sender?.name || m?.sender_type;
      return `✉️ ${from}${brand}: ${(m?.body || '').slice(0, 300)}`;
    }
    case 'conversation.closed':
      return `✅ Conversation with ${who} closed${brand}`;
    case 'conversation.assigned':
      return `👤 Conversation with ${who} assigned to ${c?.assignee?.name || 'nobody'}${brand}`;
    case 'csat.submitted':
      return `⭐ ${who} rated the conversation ${'★'.repeat(c?.csat_score || 0)} (${c?.csat_score}/5)${brand}`;
    case 'contact.created':
      return `🆕 New contact: ${env.data.contact?.name || env.data.contact?.email || 'anonymous visitor'}`;
    default:
      return `${env.type}${brand}`;
  }
}

function chatBody(provider, env) {
  const text = describe(env);
  const url = env.data.conversation?.url;
  if (provider === 'slack') {
    return { text: url ? `${text}\n<${url}|Open in OmniCore>` : text };
  }
  if (provider === 'discord') {
    return {
      content: url ? `${text}\n${url}` : text,
      allowed_mentions: { parse: [] },
    };
  }
  // Microsoft Teams incoming webhook / Workflows (MessageCard is accepted by both)
  return {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: text.slice(0, 80),
    text,
    ...(url
      ? {
          potentialAction: [
            {
              '@type': 'OpenUri',
              name: 'Open in OmniCore',
              targets: [{ os: 'default', uri: url }],
            },
          ],
        }
      : {}),
  };
}

// ── Fan-out ──────────────────────────────────────────────────────────────────
async function fanOut(evt) {
  const env = await buildEnvelope(evt);

  const { rows: hooks } = await pool.query(
    `SELECT id, events FROM webhook_endpoints WHERE tenant_id = $1 AND is_active = TRUE`,
    [evt.tenant_id],
  );
  for (const h of hooks) {
    if (!subscribed(h.events, evt.event_type)) continue;
    await pool.query(
      `INSERT INTO webhook_deliveries (tenant_id, target_kind, target_id, event_id, event_type, payload)
       VALUES ($1, 'webhook', $2, $3, $4, $5)`,
      [evt.tenant_id, h.id, evt.id, evt.event_type, env],
    );
  }

  const { rows: chats } = await pool.query(
    `SELECT id, provider, events FROM tenant_integrations
      WHERE tenant_id = $1 AND is_active = TRUE AND provider IN ('slack','discord','teams')`,
    [evt.tenant_id],
  );
  for (const c of chats) {
    if (!subscribed(c.events, evt.event_type)) continue;
    if (
      evt.event_type === 'message.created' &&
      env.data.message?.sender_type !== 'visitor'
    )
      continue;
    await pool.query(
      `INSERT INTO webhook_deliveries (tenant_id, target_kind, target_id, event_id, event_type, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        evt.tenant_id,
        c.provider,
        c.id,
        evt.id,
        evt.event_type,
        chatBody(c.provider, env),
      ],
    );
  }

  // GoHighLevel two-way sync runs inline (it has its own idempotent mapping).
  try {
    await require('./ghl').handleOmniCoreEvent(env);
  } catch (err) {
    logger.warn({ err: err.message, type: evt.event_type }, 'ghl_sync_failed');
  }
}

async function processOutbox(batch = 50) {
  const client = await pool.connect();
  let handled = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM integration_events
        WHERE processed_at IS NULL AND attempts < 5
        ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [batch],
    );
    for (const evt of rows) {
      try {
        await fanOut(evt);
        await client.query(
          `UPDATE integration_events SET processed_at = NOW(), attempts = attempts + 1 WHERE id = $1`,
          [evt.id],
        );
      } catch (err) {
        await client.query(
          `UPDATE integration_events SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
          [evt.id, String(err.message).slice(0, 500)],
        );
        logger.warn(
          { err: err.message, eventId: evt.id },
          'integration_event_failed',
        );
      }
      handled += 1;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return handled;
}

// ── Delivery ─────────────────────────────────────────────────────────────────
async function resolveTarget(d) {
  if (d.target_kind === 'webhook') {
    const { rows } = await pool.query(
      `SELECT url, secret_sealed, is_active FROM webhook_endpoints WHERE id = $1`,
      [d.target_id],
    );
    if (!rows[0] || !rows[0].is_active) return null;
    return { url: rows[0].url, secret: open(rows[0].secret_sealed) };
  }
  const { rows } = await pool.query(
    `SELECT config_sealed, is_active FROM tenant_integrations WHERE id = $1`,
    [d.target_id],
  );
  if (!rows[0] || !rows[0].is_active) return null;
  return { url: openJson(rows[0].config_sealed).webhookUrl, secret: null };
}

/** Sends one delivery row. Returns { ok, status, body, error, durationMs }. */
async function sendDelivery(d) {
  const target = await resolveTarget(d);
  if (!target?.url)
    return { ok: false, error: 'Target disabled or missing', terminal: true };
  await assertSafeUrl(target.url);
  const body = JSON.stringify(d.payload);
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'OmniCore-Webhooks/1.0',
  };
  if (target.secret) {
    headers['OmniCore-Event'] = d.event_type;
    headers['OmniCore-Delivery'] = String(d.id);
    headers['OmniCore-Signature'] = sign(target.secret, body);
  }
  const started = Date.now();
  try {
    const res = await fetch(target.url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const text = (await res.text().catch(() => '')).slice(0, 1000);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      body: text,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, error: err.message, durationMs: Date.now() - started };
  }
}

async function processDeliveries(batch = 25) {
  const { rows } = await pool.query(
    `UPDATE webhook_deliveries SET status = 'sending'
      WHERE id IN (SELECT id FROM webhook_deliveries
                    WHERE status = 'pending' AND next_attempt_at <= NOW()
                    ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [batch],
  );
  await Promise.all(
    rows.map(async (d) => {
      let r;
      try {
        r = await sendDelivery(d);
      } catch (err) {
        r = { ok: false, error: err.message, terminal: err.status === 400 };
      }
      const attempts = d.attempts + 1;
      const done = r.ok || r.terminal || attempts >= MAX_ATTEMPTS;
      await pool.query(
        `UPDATE webhook_deliveries SET
           status = $2, attempts = $3, response_status = $4, response_body = $5, error = $6,
           duration_ms = $7, delivered_at = CASE WHEN $8 THEN NOW() ELSE delivered_at END,
           next_attempt_at = NOW() + ($9 || ' minutes')::interval
         WHERE id = $1`,
        [
          d.id,
          r.ok ? 'delivered' : done ? 'failed' : 'pending',
          attempts,
          r.status ?? null,
          r.body ?? null,
          r.error ?? null,
          r.durationMs ?? null,
          r.ok,
          String(
            BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)],
          ),
        ],
      );
      if (d.target_kind === 'webhook') {
        await pool.query(
          `UPDATE webhook_endpoints SET last_delivery_at = NOW(), last_status = $2,
             failure_streak = CASE WHEN $3 THEN 0 ELSE failure_streak + 1 END
           WHERE id = $1`,
          [d.target_id, r.status ?? null, r.ok],
        );
      } else if (!r.ok && done) {
        await pool.query(
          `UPDATE tenant_integrations SET last_error = $2 WHERE id = $1`,
          [d.target_id, r.error || `HTTP ${r.status}`],
        );
      }
    }),
  );
  return rows.length;
}

async function purgeOld() {
  await pool.query(
    `DELETE FROM integration_events WHERE processed_at < NOW() - INTERVAL '7 days'`,
  );
  await pool.query(
    `DELETE FROM webhook_deliveries WHERE created_at < NOW() - INTERVAL '30 days'`,
  );
}

let started = false;
/** Starts the background workers. Set INTEGRATIONS_WORKER=false to disable on an instance. */
async function startIntegrationWorkers() {
  if (started || process.env.INTEGRATIONS_WORKER === 'false') return;
  started = true;
  await ensureIntegrationsSchema();
  let outboxBusy = false;
  let deliveryBusy = false;
  setInterval(async () => {
    if (outboxBusy) return;
    outboxBusy = true;
    try {
      while ((await processOutbox()) === 50) {
        /* drain */
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'outbox_worker_error');
    } finally {
      outboxBusy = false;
    }
  }, OUTBOX_INTERVAL).unref?.();
  setInterval(async () => {
    if (deliveryBusy) return;
    deliveryBusy = true;
    try {
      await processDeliveries();
    } catch (err) {
      logger.warn({ err: err.message }, 'delivery_worker_error');
    } finally {
      deliveryBusy = false;
    }
  }, DELIVERY_INTERVAL).unref?.();
  setInterval(() => purgeOld().catch(() => {}), 6 * 60 * 60 * 1000).unref?.();
  logger.info('integration_workers_started');
}

module.exports = {
  EVENT_TYPES,
  startIntegrationWorkers,
  processOutbox,
  processDeliveries,
  sendDelivery,
  buildEnvelope,
  assertSafeUrl,
  isPrivateIp,
  sign,
  subscribed,
  chatBody,
  describe,
};
