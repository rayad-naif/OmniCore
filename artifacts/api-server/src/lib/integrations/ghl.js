'use strict';

/**
 * integrations/ghl.js
 * GoHighLevel (HighLevel / LeadConnector) Marketplace app.
 *
 * Install flows
 *   A. From OmniCore: Integrations → GoHighLevel → Connect. We send the admin to
 *      the HighLevel location chooser with a signed `state` (tenant id). The
 *      callback links the location to that workspace immediately.
 *   B. From the HighLevel Marketplace: HighLevel redirects to our callback
 *      without our `state`. We store the install unlinked and redirect to the
 *      dashboard with a short-lived signed claim token; an OmniCore admin who
 *      is signed in links it with one click (POST /api/integrations/ghl/claim).
 *
 * Sync (per connection settings)
 *   syncContacts       OmniCore contact created  → upsert HighLevel contact
 *   syncConversations  OmniCore conversation     → upsert contact, tag "omnicore"
 *   postTranscripts    conversation closed       → transcript note on the contact
 *   inboundMessages    HighLevel InboundMessage  → OmniCore conversation (channel "api");
 *                      agent/AI replies are sent back through HighLevel on the
 *                      same channel (SMS, Email, WhatsApp, FB, IG, Live chat…)
 *   tickets / CSAT     tags "omnicore-ticket", "omnicore-csat-<score>"
 *
 * Environment
 *   GHL_CLIENT_ID, GHL_CLIENT_SECRET   from the HighLevel Marketplace app (Advanced → Auth)
 *   GHL_SCOPES                          space-separated, defaults below
 *   GHL_WEBHOOK_PUBLIC_KEY              PEM (RSA) for the legacy x-wh-signature header
 *   GHL_WEBHOOK_ED25519_PUBLIC_KEY      PEM (Ed25519) for the x-ghl-signature header
 *   GHL_WEBHOOK_SKIP_VERIFY=true        development only
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const logger = require('../../utils/logger');
const { sealJson, openJson } = require('../secretBox');

const API = 'https://services.leadconnectorhq.com';
const AUTHORIZE = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const DEFAULT_SCOPES = [
  'contacts.readonly',
  'contacts.write',
  'conversations.readonly',
  'conversations.write',
  'conversations/message.readonly',
  'conversations/message.write',
  'locations.readonly',
].join(' ');

function configured() {
  return Boolean(process.env.GHL_CLIENT_ID && process.env.GHL_CLIENT_SECRET);
}

function appBase() {
  return (process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '');
}

function redirectUri() {
  return `${appBase()}/api/integrations/ghl/callback`;
}

function stateSecret() {
  return `ghl-state:${process.env.JWT_SECRET}`;
}

function authorizeUrl(tenantId, agentId) {
  if (!configured()) {
    throw Object.assign(
      new Error(
        'GoHighLevel is not configured. Set GHL_CLIENT_ID and GHL_CLIENT_SECRET.',
      ),
      { status: 503 },
    );
  }
  const state = jwt.sign(
    { t: tenantId, a: agentId, n: crypto.randomBytes(8).toString('hex') },
    stateSecret(),
    {
      expiresIn: '15m',
    },
  );
  const p = new URLSearchParams({
    response_type: 'code',
    redirect_uri: redirectUri(),
    client_id: process.env.GHL_CLIENT_ID,
    scope: process.env.GHL_SCOPES || DEFAULT_SCOPES,
    state,
  });
  return `${AUTHORIZE}?${p.toString()}`;
}

function readState(state) {
  if (!state) return null;
  try {
    return jwt.verify(state, stateSecret());
  } catch {
    return null;
  }
}

function claimToken(connectionId) {
  return jwt.sign({ c: connectionId }, `ghl-claim:${process.env.JWT_SECRET}`, {
    expiresIn: '1h',
  });
}

function readClaim(token) {
  try {
    return jwt.verify(token, `ghl-claim:${process.env.JWT_SECRET}`).c;
  } catch {
    return null;
  }
}

async function tokenRequest(params) {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      user_type: 'Location',
      ...params,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(
      new Error(
        json.error_description ||
          json.message ||
          `HighLevel token error ${res.status}`,
      ),
      {
        status: 502,
      },
    );
  }
  return json;
}

/** Exchanges the OAuth code and stores (or updates) the connection. */
async function completeInstall({ code, state }) {
  const tok = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  });
  if (!tok.locationId) {
    throw Object.assign(
      new Error('Install the app on a sub-account (location), not an agency.'),
      { status: 400 },
    );
  }
  const st = readState(state);
  const expiresAt = new Date(
    Date.now() + (Number(tok.expires_in) || 86399) * 1000,
  );
  const sealed = sealJson({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
  });

  let locationName = null;
  try {
    const loc = await rawApi(
      tok.access_token,
      'GET',
      `/locations/${tok.locationId}`,
      null,
      '2021-07-28',
    );
    locationName = loc?.location?.name || null;
  } catch {
    /* optional */
  }

  const brandId = st?.t
    ? (
        await pool.query(
          `SELECT id FROM brands WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
          [st.t],
        )
      ).rows[0]?.id || null
    : null;

  const { rows } = await pool.query(
    `INSERT INTO ghl_connections (tenant_id, location_id, company_id, location_name, brand_id,
                                  tokens_sealed, scopes, expires_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')
     ON CONFLICT (location_id) DO UPDATE SET
       tenant_id     = COALESCE(EXCLUDED.tenant_id, ghl_connections.tenant_id),
       company_id    = EXCLUDED.company_id,
       location_name = COALESCE(EXCLUDED.location_name, ghl_connections.location_name),
       brand_id      = COALESCE(ghl_connections.brand_id, EXCLUDED.brand_id),
       tokens_sealed = EXCLUDED.tokens_sealed,
       scopes        = EXCLUDED.scopes,
       expires_at    = EXCLUDED.expires_at,
       status        = 'active',
       last_error    = NULL,
       updated_at    = NOW()
     RETURNING id, tenant_id, location_id, location_name`,
    [
      st?.t || null,
      tok.locationId,
      tok.companyId || null,
      locationName,
      brandId,
      sealed,
      tok.scope || null,
      expiresAt,
    ],
  );
  return {
    connection: rows[0],
    linkedTenant: st?.t || null,
    agentId: st?.a || null,
  };
}

async function claimConnection(token, tenantId) {
  const id = readClaim(token);
  if (!id)
    throw Object.assign(
      new Error(
        'This install link has expired. Reinstall the app from HighLevel.',
      ),
      { status: 400 },
    );
  const brand = (
    await pool.query(
      `SELECT id FROM brands WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
      [tenantId],
    )
  ).rows[0];
  const { rows } = await pool.query(
    `UPDATE ghl_connections SET tenant_id = $2, brand_id = COALESCE(brand_id, $3), updated_at = NOW()
      WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2)
      RETURNING id, location_id, location_name`,
    [id, tenantId, brand?.id || null],
  );
  if (!rows[0])
    throw Object.assign(
      new Error(
        'This HighLevel location is already linked to another workspace.',
      ),
      { status: 409 },
    );
  return rows[0];
}

/** Returns a valid access token, refreshing (single-use refresh token) under a row lock. */
async function accessToken(connectionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM ghl_connections WHERE id = $1 FOR UPDATE`,
      [connectionId],
    );
    const conn = rows[0];
    if (!conn || conn.status !== 'active')
      throw new Error('HighLevel connection is not active');
    const tokens = openJson(conn.tokens_sealed);
    if (new Date(conn.expires_at).getTime() - Date.now() > 5 * 60 * 1000) {
      await client.query('COMMIT');
      return tokens.access_token;
    }
    const tok = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    });
    await client.query(
      `UPDATE ghl_connections SET tokens_sealed = $2, expires_at = $3, last_error = NULL, updated_at = NOW() WHERE id = $1`,
      [
        connectionId,
        sealJson({
          access_token: tok.access_token,
          refresh_token: tok.refresh_token || tokens.refresh_token,
        }),
        new Date(Date.now() + (Number(tok.expires_in) || 86399) * 1000),
      ],
    );
    await client.query('COMMIT');
    return tok.access_token;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await pool
      .query(`UPDATE ghl_connections SET last_error = $2 WHERE id = $1`, [
        connectionId,
        String(err.message).slice(0, 300),
      ])
      .catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function rawApi(token, method, path, body, version = '2021-07-28') {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: version,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(
      new Error(json.message || json.error || `HighLevel API ${res.status}`),
      { status: res.status },
    );
  }
  return json;
}

async function api(conn, method, path, body, version) {
  return rawApi(await accessToken(conn.id), method, path, body, version);
}

async function getLink(connectionId, kind, omnicoreId) {
  const { rows } = await pool.query(
    `SELECT ghl_id, meta FROM ghl_links WHERE connection_id = $1 AND kind = $2 AND omnicore_id = $3`,
    [connectionId, kind, omnicoreId],
  );
  return rows[0] || null;
}

async function getLinkByGhl(connectionId, kind, ghlId) {
  const { rows } = await pool.query(
    `SELECT omnicore_id, meta FROM ghl_links WHERE connection_id = $1 AND kind = $2 AND ghl_id = $3`,
    [connectionId, kind, ghlId],
  );
  return rows[0] || null;
}

async function setLink(connectionId, kind, omnicoreId, ghlId, meta = {}) {
  await pool.query(
    `INSERT INTO ghl_links (connection_id, kind, omnicore_id, ghl_id, meta) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (connection_id, kind, omnicore_id) DO UPDATE SET ghl_id = EXCLUDED.ghl_id, meta = EXCLUDED.meta`,
    [connectionId, kind, omnicoreId, ghlId, meta],
  );
}

async function ensureContact(conn, contact) {
  if (!contact?.id) return null;
  const existing = await getLink(conn.id, 'contact', contact.id);
  if (existing) return existing.ghl_id;
  if (!contact.email) return null; // HighLevel needs an email or phone to upsert
  const [firstName, ...rest] = (contact.name || '').trim().split(/\s+/);
  const resp = await api(conn, 'POST', '/contacts/upsert', {
    locationId: conn.location_id,
    email: contact.email,
    ...(firstName ? { firstName } : {}),
    ...(rest.length ? { lastName: rest.join(' ') } : {}),
    source: 'OmniCore',
    tags: ['omnicore'],
  });
  const ghlId = resp.contact?.id;
  if (ghlId) await setLink(conn.id, 'contact', contact.id, ghlId);
  return ghlId || null;
}

async function addTags(conn, ghlContactId, tags) {
  if (!ghlContactId || !tags.length) return;
  await api(conn, 'POST', `/contacts/${ghlContactId}/tags`, { tags });
}

async function postTranscript(conn, ghlContactId, conversation) {
  const { rows } = await pool.query(
    `SELECT sender_type, message_body, created_at FROM messages
      WHERE conversation_id = $1 AND is_internal_note = FALSE
      ORDER BY created_at DESC LIMIT 50`,
    [conversation.id],
  );
  const lines = rows
    .reverse()
    .map(
      (m) =>
        `[${new Date(m.created_at).toISOString().slice(0, 16).replace('T', ' ')}] ${m.sender_type}: ${(m.message_body || '').slice(0, 500)}`,
    );
  const header = `OmniCore conversation ${conversation.ticket_number ? `#${conversation.ticket_number} ` : ''}closed${conversation.brand?.name ? ` (${conversation.brand.name})` : ''}\n${conversation.url}\n\n`;
  await api(conn, 'POST', `/contacts/${ghlContactId}/notes`, {
    body: (header + lines.join('\n')).slice(0, 60_000),
  });
}

/** Called by the dispatcher for every OmniCore event. */
async function handleOmniCoreEvent(env) {
  if (!configured()) return;
  const { rows: conns } = await pool.query(
    `SELECT * FROM ghl_connections WHERE tenant_id = $1 AND status = 'active'`,
    [env.tenant_id],
  );
  for (const conn of conns) {
    const s = conn.settings || {};
    const conv = env.data.conversation;
    try {
      switch (env.type) {
        case 'contact.created':
          if (s.syncContacts) await ensureContact(conn, env.data.contact);
          break;
        case 'conversation.created':
          if (s.syncConversations && conv?.contact)
            await ensureContact(conn, conv.contact);
          break;
        case 'ticket.created':
          if (s.syncConversations && conv?.contact) {
            await addTags(conn, await ensureContact(conn, conv.contact), [
              'omnicore-ticket',
            ]);
          }
          break;
        case 'csat.submitted':
          if (s.syncConversations && conv?.contact && conv.csat_score) {
            await addTags(conn, await ensureContact(conn, conv.contact), [
              `omnicore-csat-${conv.csat_score}`,
            ]);
          }
          break;
        case 'conversation.closed':
          if (s.postTranscripts && conv?.contact) {
            const ghlContact =
              (await getLink(conn.id, 'contact', conv.contact.id))?.ghl_id ||
              (await ensureContact(conn, conv.contact));
            if (ghlContact) await postTranscript(conn, ghlContact, conv);
          }
          break;
        case 'message.created': {
          const msg = env.data.message;
          if (
            !s.inboundMessages ||
            !msg ||
            !['agent', 'bot', 'ai'].includes(msg.sender_type) ||
            !msg.body
          )
            break;
          const link = await getLink(
            conn.id,
            'conversation',
            msg.conversation_id,
          );
          if (!link) break; // only conversations that started in HighLevel
          await api(
            conn,
            'POST',
            '/conversations/messages',
            {
              type: link.meta?.messageType || 'SMS',
              contactId: link.meta?.contactId,
              message: msg.body,
              ...(link.meta?.messageType === 'Email'
                ? {
                    subject: conv?.subject || 'Re: your message',
                    html: msg.body,
                  }
                : {}),
            },
            '2021-04-15',
          );
          break;
        }
        default:
          break;
      }
    } catch (err) {
      logger.warn(
        { err: err.message, type: env.type, connectionId: conn.id },
        'ghl_event_sync_failed',
      );
      await pool
        .query(
          `UPDATE ghl_connections SET last_error = $2, updated_at = NOW() WHERE id = $1`,
          [conn.id, String(err.message).slice(0, 300)],
        )
        .catch(() => {});
    }
  }
}

// ── Inbound webhooks from HighLevel ──────────────────────────────────────────
function verifyWebhook(rawBody, headers) {
  if (
    process.env.GHL_WEBHOOK_SKIP_VERIFY === 'true' &&
    process.env.NODE_ENV !== 'production'
  )
    return true;
  const ed = headers['x-ghl-signature'];
  const edKey = process.env.GHL_WEBHOOK_ED25519_PUBLIC_KEY;
  if (ed && edKey) {
    try {
      if (
        crypto.verify(
          null,
          rawBody,
          edKey.replace(/\\n/g, '\n'),
          Buffer.from(String(ed), 'base64'),
        )
      )
        return true;
    } catch {
      /* fall through */
    }
  }
  const rsa = headers['x-wh-signature'];
  const rsaKey = process.env.GHL_WEBHOOK_PUBLIC_KEY;
  if (rsa && rsaKey) {
    try {
      const v = crypto.createVerify('sha256');
      v.update(rawBody);
      v.end();
      if (v.verify(rsaKey.replace(/\\n/g, '\n'), String(rsa), 'base64'))
        return true;
    } catch {
      /* fall through */
    }
  }
  return false;
}

async function connectionForLocation(locationId) {
  const { rows } = await pool.query(
    `SELECT * FROM ghl_connections WHERE location_id = $1`,
    [locationId],
  );
  return rows[0] || null;
}

async function findOrCreateVisitor(conn, ghlContactId, { name, email }) {
  const link = await getLinkByGhl(conn.id, 'contact', ghlContactId);
  if (link) return link.omnicore_id;
  if (email) {
    const { rows } = await pool.query(
      `SELECT id FROM visitors WHERE tenant_id = $1 AND lower(email) = lower($2) ORDER BY created_at LIMIT 1`,
      [conn.tenant_id, email],
    );
    if (rows[0]) {
      await setLink(conn.id, 'contact', rows[0].id, ghlContactId);
      return rows[0].id;
    }
  }
  const { rows } = await pool.query(
    `INSERT INTO visitors (tenant_id, brand_id, session_token, display_name, email)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      conn.tenant_id,
      conn.brand_id,
      `ghl_${crypto.randomBytes(24).toString('hex')}`,
      name || null,
      email || null,
    ],
  );
  // Link before the outbox worker sees contact.created, so we do not echo it back.
  await setLink(conn.id, 'contact', rows[0].id, ghlContactId);
  return rows[0].id;
}

async function handleInboundMessage(conn, body) {
  const s = conn.settings || {};
  if (!s.inboundMessages || !conn.tenant_id || !conn.brand_id)
    return { skipped: 'not linked or disabled' };
  if (body.direction && body.direction !== 'inbound')
    return { skipped: 'outbound' };
  const ghlContactId = body.contactId;
  const ghlConversationId = body.conversationId || `contact:${ghlContactId}`;
  let contact = {};
  try {
    contact =
      (await api(conn, 'GET', `/contacts/${ghlContactId}`)).contact || {};
  } catch {
    /* optional enrichment */
  }
  const visitorId = await findOrCreateVisitor(conn, ghlContactId, {
    name:
      contact.contactName ||
      [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
      contact.phone,
    email: contact.email,
  });

  const existing = await getLinkByGhl(
    conn.id,
    'conversation',
    ghlConversationId,
  );
  let conversationId = existing?.omnicore_id;
  if (conversationId) {
    await pool.query(
      `UPDATE conversations SET status = CASE WHEN status = 'closed' THEN 'open' ELSE status END, updated_at = NOW()
        WHERE id = $1`,
      [conversationId],
    );
  } else {
    const { rows } = await pool.query(
      `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel, subject)
       VALUES ($1, $2, $3, 'open', 'api', $4) RETURNING id`,
      [
        conn.tenant_id,
        conn.brand_id,
        visitorId,
        `${body.messageType || 'Message'} via HighLevel`,
      ],
    );
    conversationId = rows[0].id;
  }
  await setLink(conn.id, 'conversation', conversationId, ghlConversationId, {
    contactId: ghlContactId,
    messageType: body.messageType || 'SMS',
  });
  const attachments = Array.isArray(body.attachments)
    ? body.attachments.map((url) => ({
        url,
        name: String(url).split('/').pop(),
      }))
    : [];
  await pool.query(
    `INSERT INTO messages (conversation_id, sender_type, message_body, attachments_json)
     VALUES ($1, 'visitor', $2, $3)`,
    [
      conversationId,
      body.body || body.message || '',
      JSON.stringify(attachments),
    ],
  );
  return { conversationId };
}

/** Processes one verified HighLevel webhook payload. */
async function handleWebhook(body) {
  const type = body.type;
  const locationId = body.locationId;
  if (type === 'UNINSTALL' || type === 'AppUninstall') {
    if (locationId) {
      await pool.query(
        `UPDATE ghl_connections SET status = 'uninstalled', updated_at = NOW() WHERE location_id = $1`,
        [locationId],
      );
    }
    return { handled: 'uninstall' };
  }
  if (type === 'INSTALL' || type === 'AppInstall')
    return { handled: 'install' };
  const conn = locationId ? await connectionForLocation(locationId) : null;
  if (!conn || conn.status !== 'active') return { skipped: 'unknown location' };

  if (type === 'InboundMessage') return handleInboundMessage(conn, body);
  if (
    (type === 'ContactCreate' || type === 'ContactUpdate') &&
    conn.tenant_id &&
    conn.brand_id &&
    conn.settings?.syncContacts
  ) {
    if (!body.email) return { skipped: 'contact without email' };
    const id = await findOrCreateVisitor(conn, body.id, {
      name:
        body.name || [body.firstName, body.lastName].filter(Boolean).join(' '),
      email: body.email,
    });
    if (type === 'ContactUpdate') {
      await pool.query(
        `UPDATE visitors SET email = COALESCE($2, email), display_name = COALESCE($3, display_name) WHERE id = $1`,
        [id, body.email || null, body.name || null],
      );
    }
    return { visitorId: id };
  }
  if (type === 'ContactDelete' && conn.tenant_id) {
    await pool.query(
      `DELETE FROM ghl_links WHERE connection_id = $1 AND kind = 'contact' AND ghl_id = $2`,
      [conn.id, body.id],
    );
    return { handled: 'contact unlinked' };
  }
  return { skipped: type };
}

async function listConnections(tenantId) {
  const { rows } = await pool.query(
    `SELECT g.id, g.location_id, g.location_name, g.company_id, g.brand_id, b.brand_name, g.settings,
            g.status, g.last_error, g.installed_at, g.expires_at
       FROM ghl_connections g LEFT JOIN brands b ON b.id = g.brand_id
      WHERE g.tenant_id = $1 ORDER BY g.installed_at DESC`,
    [tenantId],
  );
  return rows;
}

module.exports = {
  configured,
  authorizeUrl,
  completeInstall,
  claimConnection,
  claimToken,
  readClaim,
  handleOmniCoreEvent,
  handleWebhook,
  verifyWebhook,
  listConnections,
  redirectUri,
  DEFAULT_SCOPES,
};
