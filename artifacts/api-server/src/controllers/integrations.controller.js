'use strict';

/**
 * integrations.controller.js
 * Atelier OmniCore — Integrations marketplace API (workspace scope).
 * Mounted at /api/integrations. Requires the "settings" feature permission
 * (read for GET, edit for writes). Admins always pass.
 *
 *   GET    /catalog                         every integration + connection state
 *   GET    /events                          event types available to subscribers
 *
 *   GET    /webhooks                        list endpoints
 *   POST   /webhooks                        { url, description?, events[] } → returns signing secret once
 *   PATCH  /webhooks/:id                    { url?, description?, events?, is_active? }
 *   DELETE /webhooks/:id
 *   POST   /webhooks/:id/rotate-secret      → new secret (shown once)
 *   POST   /webhooks/:id/test               sends a signed "ping" synchronously
 *   GET    /webhooks/:id/deliveries         last 100 deliveries
 *   POST   /deliveries/:id/retry            re-queue a failed delivery
 *
 *   GET    /api-keys                        list (never returns the key)
 *   POST   /api-keys                        { name, scopes: ['read'|'write'], expires_in_days? } → key shown once
 *   DELETE /api-keys/:id                    revoke
 *
 *   GET    /connectors                      Slack / Discord / Teams channels
 *   POST   /connectors                      { provider, name, webhookUrl, events[] }
 *   PATCH  /connectors/:id                  { name?, webhookUrl?, events?, is_active? }
 *   DELETE /connectors/:id
 *   POST   /connectors/:id/test
 *
 *   GET    /ghl                             { configured, connections[] }
 *   GET    /ghl/connect                     → { url } HighLevel install URL
 *   POST   /ghl/claim                       { token } link a Marketplace install to this workspace
 *   PATCH  /ghl/:id                         { brand_id?, settings? }
 *   DELETE /ghl/:id                         disconnect
 *
 * Public (no auth, mounted separately in app.ts / below):
 *   GET    /api/integrations/ghl/callback   OAuth redirect target
 *   POST   /api/integrations/ghl/webhook    HighLevel webhooks (raw body, signature-verified)
 */

const crypto = require('crypto');
const express = require('express');
const { pool } = require('../lib/db');
const logger = require('../utils/logger');
const {
  requireAuth,
  requirePermissionByMethod,
  applyWorkspaceOverride,
} = require('../middleware/auth');
const { seal, sealJson, openJson, mask } = require('../lib/secretBox');
const { ensureIntegrationsSchema } = require('../lib/integrations/schema');
const dispatcher = require('../lib/integrations/dispatcher');
const ghl = require('../lib/integrations/ghl');
const { recordAudit } = require('../lib/audit');

const CHAT_PROVIDERS = {
  slack: {
    name: 'Slack',
    urlPattern: /^https:\/\/hooks\.slack\.com\/services\//,
  },
  discord: {
    name: 'Discord',
    urlPattern: /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//,
  },
  teams: {
    name: 'Microsoft Teams',
    urlPattern:
      /^https:\/\/([a-z0-9-]+\.)*(webhook\.office\.com|logic\.azure\.com|environment\.api\.powerplatform\.com)\//,
  },
};

const VALID_EVENTS = new Set(['*', ...Object.keys(dispatcher.EVENT_TYPES)]);

function cleanEvents(events) {
  const list = Array.isArray(events) && events.length ? events : ['*'];
  const bad = list.filter(
    (e) => !VALID_EVENTS.has(e) && !/^[a-z]+\.\*$/.test(e),
  );
  if (bad.length)
    throw Object.assign(new Error(`Unknown event types: ${bad.join(', ')}`), {
      status: 400,
    });
  return [...new Set(list)];
}

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const router = express.Router();
router.use(
  requireAuth,
  applyWorkspaceOverride,
  wrap(async (req, res, next) => {
    await ensureIntegrationsSchema();
    next();
  }),
);
router.use(requirePermissionByMethod('settings'));

// ── Catalog ──────────────────────────────────────────────────────────────────
router.get(
  '/catalog',
  wrap(async (req, res) => {
    const t = req.agent.tenantId;
    const [hooks, keys, chats, ghlConns] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS n FROM webhook_endpoints WHERE tenant_id = $1 AND is_active`,
        [t],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM api_keys WHERE tenant_id = $1 AND revoked_at IS NULL`,
        [t],
      ),
      pool.query(
        `SELECT provider, COUNT(*)::int AS n FROM tenant_integrations WHERE tenant_id = $1 AND is_active GROUP BY provider`,
        [t],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM ghl_connections WHERE tenant_id = $1 AND status = 'active'`,
        [t],
      ),
    ]);
    const chatCount = Object.fromEntries(
      chats.rows.map((r) => [r.provider, r.n]),
    );
    res.json({
      integrations: [
        {
          id: 'gohighlevel',
          name: 'GoHighLevel',
          category: 'CRM',
          description:
            'Two-way sync of contacts and conversations; reply to SMS, email, WhatsApp and social messages from OmniCore.',
          connected: ghlConns.rows[0].n,
          available: ghl.configured(),
        },
        {
          id: 'webhooks',
          name: 'Webhooks',
          category: 'Developer',
          description:
            'Signed real-time HTTP callbacks for conversations, messages, tickets, CSAT and contacts.',
          connected: hooks.rows[0].n,
          available: true,
        },
        {
          id: 'api',
          name: 'REST API',
          category: 'Developer',
          description:
            'Read and update conversations, messages, contacts and tickets with workspace API keys.',
          connected: keys.rows[0].n,
          available: true,
        },
        {
          id: 'slack',
          name: 'Slack',
          category: 'Notifications',
          description:
            'Post new conversations, tickets, messages and ratings to a Slack channel.',
          connected: chatCount.slack || 0,
          available: true,
        },
        {
          id: 'discord',
          name: 'Discord',
          category: 'Notifications',
          description: 'Send support activity to a Discord channel.',
          connected: chatCount.discord || 0,
          available: true,
        },
        {
          id: 'teams',
          name: 'Microsoft Teams',
          category: 'Notifications',
          description:
            'Send support activity to a Teams channel via an incoming webhook or Workflows.',
          connected: chatCount.teams || 0,
          available: true,
        },
        {
          id: 'zapier',
          name: 'Zapier',
          category: 'Automation',
          description:
            'Use Webhooks by Zapier as a trigger and the REST API as an action to connect 7,000+ apps.',
          connected: hooks.rows[0].n + keys.rows[0].n,
          available: true,
          via: ['webhooks', 'api'],
        },
        {
          id: 'make',
          name: 'Make',
          category: 'Automation',
          description:
            'Custom webhook trigger plus HTTP modules with your API key.',
          connected: hooks.rows[0].n + keys.rows[0].n,
          available: true,
          via: ['webhooks', 'api'],
        },
        {
          id: 'n8n',
          name: 'n8n',
          category: 'Automation',
          description:
            'Webhook trigger node plus HTTP Request node with your API key.',
          connected: hooks.rows[0].n + keys.rows[0].n,
          available: true,
          via: ['webhooks', 'api'],
        },
      ],
    });
  }),
);

router.get('/events', (req, res) => {
  res.json({
    events: Object.entries(dispatcher.EVENT_TYPES).map(
      ([type, description]) => ({ type, description }),
    ),
  });
});

// ── Webhooks ─────────────────────────────────────────────────────────────────
function newSecret() {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

router.get(
  '/webhooks',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, url, description, events, is_active, failure_streak, last_delivery_at, last_status, created_at
         FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [req.agent.tenantId],
    );
    res.json(rows);
  }),
);

router.post(
  '/webhooks',
  wrap(async (req, res) => {
    const { url, description, events } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url is required' });
    await dispatcher.assertSafeUrl(url);
    const secret = newSecret();
    const { rows } = await pool.query(
      `INSERT INTO webhook_endpoints (tenant_id, url, description, events, secret_sealed, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, url, description, events, is_active, created_at`,
      [
        req.agent.tenantId,
        url,
        description || null,
        cleanEvents(events),
        seal(secret),
        req.agent.id,
      ],
    );
    res.status(201).json({ ...rows[0], secret });
  }),
);

router.patch(
  '/webhooks/:id',
  wrap(async (req, res) => {
    const { url, description, events, is_active } = req.body || {};
    if (url) await dispatcher.assertSafeUrl(url);
    const { rows } = await pool.query(
      `UPDATE webhook_endpoints SET
         url = COALESCE($3, url), description = COALESCE($4, description),
         events = COALESCE($5, events), is_active = COALESCE($6, is_active),
         failure_streak = CASE WHEN $6 IS TRUE THEN 0 ELSE failure_streak END,
         updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, url, description, events, is_active`,
      [
        req.params.id,
        req.agent.tenantId,
        url || null,
        description ?? null,
        events ? cleanEvents(events) : null,
        typeof is_active === 'boolean' ? is_active : null,
      ],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Webhook not found' });
    res.json(rows[0]);
  }),
);

router.delete(
  '/webhooks/:id',
  wrap(async (req, res) => {
    const { rowCount } = await pool.query(
      `DELETE FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.agent.tenantId],
    );
    if (!rowCount) return res.status(404).json({ error: 'Webhook not found' });
    res.status(204).end();
  }),
);

router.post(
  '/webhooks/:id/rotate-secret',
  wrap(async (req, res) => {
    const secret = newSecret();
    const { rowCount } = await pool.query(
      `UPDATE webhook_endpoints SET secret_sealed = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.agent.tenantId, seal(secret)],
    );
    if (!rowCount) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ secret });
  }),
);

router.post(
  '/webhooks/:id/test',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.agent.tenantId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Webhook not found' });
    const payload = {
      id: `evt_test_${Date.now()}`,
      type: 'ping',
      created_at: new Date().toISOString(),
      tenant_id: req.agent.tenantId,
      data: { message: 'This is a test delivery from OmniCore.' },
    };
    const { rows: d } = await pool.query(
      `INSERT INTO webhook_deliveries (tenant_id, target_kind, target_id, event_type, payload, status)
       VALUES ($1,'webhook',$2,'ping',$3,'sending') RETURNING *`,
      [req.agent.tenantId, req.params.id, payload],
    );
    let r;
    try {
      r = await dispatcher.sendDelivery(d[0]);
    } catch (err) {
      r = { ok: false, error: err.message };
    }
    await pool.query(
      `UPDATE webhook_deliveries SET status = $2, attempts = 1, response_status = $3, response_body = $4, error = $5,
         duration_ms = $6, delivered_at = CASE WHEN $7 THEN NOW() END WHERE id = $1`,
      [
        d[0].id,
        r.ok ? 'delivered' : 'failed',
        r.status ?? null,
        r.body ?? null,
        r.error ?? null,
        r.durationMs ?? null,
        r.ok,
      ],
    );
    res.json({
      ok: r.ok,
      status: r.status ?? null,
      error: r.error ?? null,
      body: r.body ?? null,
      duration_ms: r.durationMs ?? null,
    });
  }),
);

router.get(
  '/webhooks/:id/deliveries',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT d.id, d.event_type, d.status, d.attempts, d.response_status, d.error, d.duration_ms,
              d.created_at, d.delivered_at, d.next_attempt_at, d.payload, LEFT(d.response_body, 300) AS response_body
         FROM webhook_deliveries d
         JOIN webhook_endpoints w ON w.id = d.target_id AND w.tenant_id = $2
        WHERE d.target_id = $1 ORDER BY d.created_at DESC LIMIT 100`,
      [req.params.id, req.agent.tenantId],
    );
    res.json(rows);
  }),
);

router.post(
  '/deliveries/:id/retry',
  wrap(async (req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE webhook_deliveries SET status = 'pending', next_attempt_at = NOW(), attempts = 0
        WHERE id = $1 AND tenant_id = $2 AND status IN ('failed','delivered')`,
      [req.params.id, req.agent.tenantId],
    );
    if (!rowCount) return res.status(404).json({ error: 'Delivery not found' });
    res.json({ queued: true });
  }),
);

// ── API keys ─────────────────────────────────────────────────────────────────
router.get(
  '/api-keys',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT k.id, k.name, k.prefix, k.scopes, k.last_used_at, k.last_used_ip, k.expires_at, k.revoked_at, k.created_at,
              a.name AS created_by_name
         FROM api_keys k LEFT JOIN agents a ON a.id = k.created_by
        WHERE k.tenant_id = $1 ORDER BY k.created_at DESC`,
      [req.agent.tenantId],
    );
    res.json(rows);
  }),
);

router.post(
  '/api-keys',
  wrap(async (req, res) => {
    const { name, scopes, expires_in_days } = req.body || {};
    if (!name?.trim())
      return res.status(400).json({ error: 'name is required' });
    const sc = Array.isArray(scopes) && scopes.length ? scopes : ['read'];
    if (sc.some((s) => !['read', 'write'].includes(s)))
      return res
        .status(400)
        .json({ error: 'scopes must be "read" and/or "write"' });
    const raw = `ock_${crypto.randomBytes(24).toString('base64url')}`;
    const days = Number(expires_in_days) > 0 ? Number(expires_in_days) : null;
    const { rows } = await pool.query(
      `INSERT INTO api_keys (tenant_id, name, prefix, key_hash, scopes, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $6::int IS NULL THEN NULL ELSE NOW() + ($6::int || ' days')::interval END, $7)
       RETURNING id, name, prefix, scopes, expires_at, created_at`,
      [
        req.agent.tenantId,
        name.trim(),
        raw.slice(0, 12),
        crypto.createHash('sha256').update(raw).digest('hex'),
        [...new Set(sc)],
        days,
        req.agent.id,
      ],
    );
    res.status(201).json({ ...rows[0], key: raw });
  }),
);

router.delete(
  '/api-keys/:id',
  wrap(async (req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
      [req.params.id, req.agent.tenantId],
    );
    if (!rowCount) return res.status(404).json({ error: 'API key not found' });
    res.status(204).end();
  }),
);

// ── Chat connectors (Slack / Discord / Teams) ───────────────────────────────
function validateChatUrl(provider, url) {
  const p = CHAT_PROVIDERS[provider];
  if (!p)
    throw Object.assign(new Error('provider must be slack, discord or teams'), {
      status: 400,
    });
  if (!url || !p.urlPattern.test(url)) {
    throw Object.assign(
      new Error(`That does not look like a ${p.name} incoming webhook URL`),
      { status: 400 },
    );
  }
}

router.get(
  '/connectors',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, provider, name, config_sealed, events, is_active, last_error, created_at
         FROM tenant_integrations WHERE tenant_id = $1 AND provider IN ('slack','discord','teams')
        ORDER BY created_at DESC`,
      [req.agent.tenantId],
    );
    res.json(
      rows.map(({ config_sealed, ...r }) => ({
        ...r,
        webhookUrl: mask(openJson(config_sealed).webhookUrl, 6),
      })),
    );
  }),
);

router.post(
  '/connectors',
  wrap(async (req, res) => {
    const { provider, name, webhookUrl, events } = req.body || {};
    validateChatUrl(provider, webhookUrl);
    const { rows } = await pool.query(
      `INSERT INTO tenant_integrations (tenant_id, provider, name, config_sealed, events, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, provider, name, events, is_active, created_at`,
      [
        req.agent.tenantId,
        provider,
        name || CHAT_PROVIDERS[provider].name,
        sealJson({ webhookUrl }),
        cleanEvents(
          events?.length
            ? events
            : ['conversation.created', 'ticket.created', 'csat.submitted'],
        ),
        req.agent.id,
      ],
    );
    res.status(201).json(rows[0]);
  }),
);

router.patch(
  '/connectors/:id',
  wrap(async (req, res) => {
    const { name, webhookUrl, events, is_active } = req.body || {};
    const { rows: cur } = await pool.query(
      `SELECT provider FROM tenant_integrations WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.agent.tenantId],
    );
    if (!cur[0]) return res.status(404).json({ error: 'Connector not found' });
    if (webhookUrl) validateChatUrl(cur[0].provider, webhookUrl);
    const { rows } = await pool.query(
      `UPDATE tenant_integrations SET name = COALESCE($3, name),
         config_sealed = COALESCE($4, config_sealed), events = COALESCE($5, events),
         is_active = COALESCE($6, is_active), last_error = CASE WHEN $6 IS TRUE THEN NULL ELSE last_error END, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING id, provider, name, events, is_active`,
      [
        req.params.id,
        req.agent.tenantId,
        name || null,
        webhookUrl ? sealJson({ webhookUrl }) : null,
        events ? cleanEvents(events) : null,
        typeof is_active === 'boolean' ? is_active : null,
      ],
    );
    res.json(rows[0]);
  }),
);

router.delete(
  '/connectors/:id',
  wrap(async (req, res) => {
    const { rowCount } = await pool.query(
      `DELETE FROM tenant_integrations WHERE id = $1 AND tenant_id = $2 AND provider IN ('slack','discord','teams')`,
      [req.params.id, req.agent.tenantId],
    );
    if (!rowCount)
      return res.status(404).json({ error: 'Connector not found' });
    res.status(204).end();
  }),
);

router.post(
  '/connectors/:id/test',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, provider FROM tenant_integrations WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.agent.tenantId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Connector not found' });
    const env = { type: 'ping', tenant_id: req.agent.tenantId, data: {} };
    const body = dispatcher.chatBody(rows[0].provider, env);
    if (body.text !== undefined)
      body.text =
        '✅ OmniCore is connected. You will receive support notifications here.';
    if (body.content !== undefined)
      body.content =
        '✅ OmniCore is connected. You will receive support notifications here.';
    const r = await dispatcher.sendDelivery({
      id: 0,
      target_kind: rows[0].provider,
      target_id: rows[0].id,
      event_type: 'ping',
      payload: body,
    });
    res.json({ ok: r.ok, status: r.status ?? null, error: r.error ?? null });
  }),
);

// ── GoHighLevel ──────────────────────────────────────────────────────────────
router.get(
  '/ghl',
  wrap(async (req, res) => {
    res.json({
      configured: ghl.configured(),
      redirectUri: ghl.redirectUri(),
      webhookUrl: `${(process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '')}/api/integrations/ghl/webhook`,
      connections: await ghl.listConnections(req.agent.tenantId),
    });
  }),
);

router.get(
  '/ghl/connect',
  wrap(async (req, res) => {
    res.json({ url: ghl.authorizeUrl(req.agent.tenantId, req.agent.id) });
  }),
);

router.post(
  '/ghl/claim',
  wrap(async (req, res) => {
    const conn = await ghl.claimConnection(req.body?.token, req.agent.tenantId);
    req.auditExtra = { locationId: conn.location_id };
    res.json(conn);
  }),
);

router.patch(
  '/ghl/:id',
  wrap(async (req, res) => {
    const { brand_id, settings } = req.body || {};
    if (brand_id) {
      const { rows } = await pool.query(
        `SELECT 1 FROM brands WHERE id = $1 AND tenant_id = $2`,
        [brand_id, req.agent.tenantId],
      );
      if (!rows[0]) return res.status(400).json({ error: 'Unknown brand' });
    }
    const allowed = [
      'syncContacts',
      'syncConversations',
      'postTranscripts',
      'inboundMessages',
    ];
    const patch = Object.fromEntries(
      Object.entries(settings || {}).filter(
        ([k, v]) => allowed.includes(k) && typeof v === 'boolean',
      ),
    );
    const { rows } = await pool.query(
      `UPDATE ghl_connections SET brand_id = COALESCE($3, brand_id), settings = settings || $4::jsonb, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 RETURNING id, brand_id, settings`,
      [
        req.params.id,
        req.agent.tenantId,
        brand_id || null,
        JSON.stringify(patch),
      ],
    );
    if (!rows[0])
      return res.status(404).json({ error: 'Connection not found' });
    res.json(rows[0]);
  }),
);

router.delete(
  '/ghl/:id',
  wrap(async (req, res) => {
    const { rowCount } = await pool.query(
      `DELETE FROM ghl_connections WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.agent.tenantId],
    );
    if (!rowCount)
      return res.status(404).json({ error: 'Connection not found' });
    res.status(204).end();
  }),
);

// ── Public GoHighLevel endpoints (no OmniCore session) ──────────────────────
const publicRouter = express.Router();

publicRouter.get(
  '/ghl/callback',
  wrap(async (req, res) => {
    const base = `${(process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '')}/dashboard/`;
    if (req.query.error || !req.query.code) {
      return res.redirect(
        `${base}?integration=ghl&status=error&message=${encodeURIComponent(String(req.query.error_description || req.query.error || 'missing code'))}`,
      );
    }
    try {
      await ensureIntegrationsSchema();
      const { connection, linkedTenant, agentId } = await ghl.completeInstall({
        code: String(req.query.code),
        state: req.query.state ? String(req.query.state) : null,
      });
      void recordAudit({
        action: 'integrations.ghl.install',
        category: 'integrations',
        tenantId: linkedTenant,
        actorType: linkedTenant ? 'agent' : 'webhook',
        actorId: agentId,
        actorName: linkedTenant ? null : 'HighLevel Marketplace',
        resourceType: 'ghl_connection',
        resourceId: connection.id,
        summary: `HighLevel location ${connection.location_name || connection.location_id} installed`,
        metadata: { locationId: connection.location_id },
        req,
      });
      if (linkedTenant)
        return res.redirect(`${base}?integration=ghl&status=connected`);
      return res.redirect(
        `${base}?integration=ghl&claim=${encodeURIComponent(ghl.claimToken(connection.id))}`,
      );
    } catch (err) {
      logger.error({ err: err.message }, 'ghl_install_failed');
      return res.redirect(
        `${base}?integration=ghl&status=error&message=${encodeURIComponent(err.message)}`,
      );
    }
  }),
);

/** Raw-body handler; mounted in app.ts BEFORE express.json(). */
async function ghlWebhookHandler(req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!ghl.verifyWebhook(raw, req.headers)) {
    void recordAudit({
      action: 'integrations.ghl.webhook_rejected',
      category: 'security',
      actorType: 'webhook',
      actorName: 'HighLevel',
      outcome: 'denied',
      summary: 'HighLevel webhook signature missing or invalid',
      req,
    });
    return res.status(401).json({ error: 'Invalid signature' });
  }
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  try {
    await ensureIntegrationsSchema();
    const result = await ghl.handleWebhook(body);
    if (
      ['INSTALL', 'UNINSTALL', 'AppInstall', 'AppUninstall'].includes(body.type)
    ) {
      void recordAudit({
        action: `integrations.ghl.${String(body.type).toLowerCase()}`,
        category: 'integrations',
        actorType: 'webhook',
        actorName: 'HighLevel',
        summary: `HighLevel ${body.type} for location ${body.locationId || '?'}`,
        metadata: { locationId: body.locationId, companyId: body.companyId },
        req,
      });
    }
    return res.json({ received: true, ...result });
  } catch (err) {
    logger.error({ err: err.message, type: body?.type }, 'ghl_webhook_failed');
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = { router, publicRouter, ghlWebhookHandler };
