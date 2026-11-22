'use strict';

/**
 * stores/service.js — online stores for workspaces.
 *
 * Hosted stores: WordPress + WooCommerce created on a store server (store_hosts,
 * artifacts/store-agent) with a template, AI-written content, a platform sub-domain
 * and an optional custom domain. Connected stores: an existing WooCommerce store
 * linked with a REST API key. Both sync orders and customers (webhooks + periodic
 * sync) and can take payment through OmniCore (WordPress plugin "OmniCore Commerce").
 */

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const { pool } = require('../lib/db');
const logger = require('../utils/logger');
const { seal, open, sealJson, openJson } = require('../lib/secretBox');
const { ensureSchema } = require('./schema');
const wc = require('./wc');
const agent = require('./agentClient');
const cloudflare = require('./cloudflare');
const design = require('./design');

class StoreError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const RESERVED = new Set([
  'www',
  'api',
  'app',
  'admin',
  'agent',
  'mail',
  'smtp',
  'ftp',
  'stores',
  'store',
  'shop',
  'dashboard',
  'static',
  'cdn',
  'status',
  'help',
  'support',
  'edge',
  'origin',
  'ns1',
  'ns2',
]);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const HOST_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ZERO_DECIMAL = new Set([
  'jpy',
  'krw',
  'vnd',
  'clp',
  'isk',
  'ugx',
  'xaf',
  'xof',
  'pyg',
]);

const callbackBase = () =>
  String(
    process.env.STORES_CALLBACK_URL || process.env.PUBLIC_APP_URL || '',
  ).replace(/\/+$/, '');
const now = () => new Date();
const toMinor = (amount, currency) =>
  Math.round(
    Number(amount || 0) *
      (ZERO_DECIMAL.has(String(currency).toLowerCase()) ? 1 : 100),
  );

// ── Workspace and plan ───────────────────────────────────────────────────────
async function workspace(tenantId) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, company_name, stores_feature_enabled, max_stores, ai_feature_enabled, payments_feature_enabled, default_timezone
       FROM tenants WHERE id = $1`,
    [tenantId],
  );
  const t = rows[0];
  if (!t) return null;
  return {
    enabled: Boolean(t.stores_feature_enabled),
    max_stores: Number(t.max_stores ?? 1),
    ai: t.ai_feature_enabled !== false,
    payments: Boolean(t.payments_feature_enabled),
    company_name: t.company_name,
    timezone: t.default_timezone || 'UTC',
  };
}

// ── Shaping ──────────────────────────────────────────────────────────────────
function shape(s, host) {
  if (!s) return null;
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    status: s.status,
    template: s.template,
    brand_color: s.brand_color,
    business_description: s.business_description,
    subdomain: s.subdomain,
    custom_domain: s.custom_domain,
    domain_status: s.domain_status,
    domain_detail: s.domain_detail,
    site_url: s.site_url,
    admin_url: s.site_url ? `${s.site_url}/wp-admin/` : null,
    currency: s.currency,
    checkout_enabled: s.checkout_enabled,
    plugin_connected: Boolean(s.plugin_seen_at),
    plugin_version: s.plugin_version,
    stats: s.stats || {},
    last_sync_at: s.last_sync_at,
    sync_error: s.sync_error,
    error: s.error,
    host: host
      ? {
          name: host.name,
          cname_target: host.cname_target || host.base_domain,
          public_ip: host.public_ip,
        }
      : undefined,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

async function rawStore(tenantId, id) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT * FROM stores WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [id, tenantId],
  );
  if (!rows[0]) throw new StoreError('Store not found', 404);
  return rows[0];
}

async function hostById(id) {
  if (!id) return null;
  const { rows } = await pool.query(`SELECT * FROM store_hosts WHERE id = $1`, [
    id,
  ]);
  return rows[0] || null;
}

async function listStores(tenantId) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT s.*, h.name AS host_name, h.cname_target, h.base_domain, h.public_ip
       FROM stores s LEFT JOIN store_hosts h ON h.id = s.host_id
      WHERE s.tenant_id = $1 AND s.deleted_at IS NULL ORDER BY s.created_at DESC`,
    [tenantId],
  );
  return rows.map((r) =>
    shape(
      r,
      r.host_name
        ? {
            name: r.host_name,
            cname_target: r.cname_target,
            base_domain: r.base_domain,
            public_ip: r.public_ip,
          }
        : null,
    ),
  );
}

async function getStore(tenantId, id) {
  const s = await rawStore(tenantId, id);
  const host = await hostById(s.host_id);
  const { rows: jobs } = await pool.query(
    `SELECT id, kind, status, error, log, attempts, created_at, updated_at FROM store_jobs
      WHERE store_id = $1 ORDER BY created_at DESC LIMIT 8`,
    [id],
  );
  return { ...shape(s, host), jobs };
}

async function platformInfo() {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT h.id, h.base_domain, h.capacity,
            (SELECT COUNT(*)::int FROM stores s WHERE s.host_id = h.id AND s.deleted_at IS NULL) AS used
       FROM store_hosts h WHERE h.active`,
  );
  return {
    hosting_available: rows.some((r) => r.used < r.capacity),
    base_domains: [...new Set(rows.map((r) => r.base_domain))],
    cloudflare: cloudflare.configured(),
  };
}

async function countStores(tenantId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM stores WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenantId],
  );
  return rows[0].n;
}

async function assertCapacity(tenantId) {
  const ws = await workspace(tenantId);
  if (!ws?.enabled)
    throw new StoreError(
      "Online stores are not included in this workspace's plan.",
      403,
    );
  const used = await countStores(tenantId);
  if (used >= ws.max_stores)
    throw new StoreError(
      `Your plan allows ${ws.max_stores} store${ws.max_stores === 1 ? '' : 's'}. Delete one or upgrade to add more.`,
      403,
    );
  return ws;
}

// ── Jobs ─────────────────────────────────────────────────────────────────────
async function enqueue(store, kind, payload = {}, delayMs = 0) {
  const { rows } = await pool.query(
    `INSERT INTO store_jobs (store_id, tenant_id, kind, payload, run_after)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' milliseconds')::interval) RETURNING id`,
    [store.id, store.tenant_id, kind, JSON.stringify(payload), String(delayMs)],
  );
  return rows[0].id;
}

// ── Hosted stores ────────────────────────────────────────────────────────────
async function pickHost() {
  const { rows } = await pool.query(
    `SELECT h.*, (SELECT COUNT(*)::int FROM stores s WHERE s.host_id = h.id AND s.deleted_at IS NULL) AS used
       FROM store_hosts h WHERE h.active ORDER BY used ASC, h.created_at ASC`,
  );
  const host = rows.find((h) => h.used < h.capacity);
  if (!host)
    throw new StoreError(
      'Store hosting is not available right now (no store server with free space). Please contact support.',
      503,
    );
  return host;
}

function cleanSlug(raw) {
  const slug = String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!SLUG_RE.test(slug))
    throw new StoreError(
      'Choose a web address of 3–40 letters, numbers or dashes.',
    );
  if (RESERVED.has(slug))
    throw new StoreError('That web address is reserved. Choose another one.');
  return slug;
}

async function slugAvailable(slug) {
  const host = await pickHost().catch(() => null);
  if (!host) return { available: false, reason: 'hosting unavailable' };
  const sub = `${cleanSlug(slug)}.${host.base_domain}`;
  const { rows } = await pool.query(
    `SELECT 1 FROM stores WHERE lower(subdomain) = lower($1) AND deleted_at IS NULL`,
    [sub],
  );
  return { available: !rows.length, subdomain: sub };
}

async function createHosted(tenantId, by, body) {
  const ws = await assertCapacity(tenantId);
  const name = String(body.name || '')
    .trim()
    .slice(0, 120);
  if (name.length < 2) throw new StoreError('Give your store a name.');
  const slug = cleanSlug(body.slug || name);
  const template = design.TEMPLATES[body.template] ? body.template : 'minimal';
  const brandColor = /^#[0-9a-f]{6}$/i.test(body.brand_color || '')
    ? body.brand_color.toLowerCase()
    : null;
  const currency = /^[a-z]{3}$/i.test(body.currency || '')
    ? body.currency.toLowerCase()
    : 'usd';
  const host = await pickHost();
  const subdomain = `${slug}.${host.base_domain}`;
  const id = crypto.randomUUID();
  const agentId = `s-${id.replace(/-/g, '')}`;
  try {
    await pool.query(
      `INSERT INTO stores (id, tenant_id, kind, name, status, host_id, agent_store_id, template, brand_color,
          business_description, subdomain, site_url, currency, admin_email, connect_secret_sealed, checkout_enabled, created_by)
       VALUES ($1,$2,'hosted',$3,'provisioning',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        tenantId,
        name,
        host.id,
        agentId,
        template,
        brandColor,
        String(body.description || '').slice(0, 1500),
        subdomain,
        null,
        currency,
        String(body.email || by.email || '').slice(0, 200),
        seal(crypto.randomBytes(32).toString('hex')),
        ws.payments,
        by.email || null,
      ],
    );
  } catch (err) {
    if (err.code === '23505')
      throw new StoreError(
        'That web address is already taken. Choose another one.',
        409,
      );
    throw err;
  }
  const store = await rawStore(tenantId, id);
  await enqueue(store, 'provision', {
    phase: 'content',
    use_ai: body.use_ai !== false,
    country: String(body.country || '').slice(0, 10),
    city: String(body.city || '').slice(0, 80),
    phone: String(body.phone || '').slice(0, 40),
  });
  logger.info({ tenantId, storeId: id, subdomain }, 'store_provision_queued');
  return getStore(tenantId, id);
}

async function retryProvision(tenantId, id) {
  const s = await rawStore(tenantId, id);
  if (s.kind !== 'hosted' || s.status !== 'failed')
    throw new StoreError('Only a store that failed to set up can be retried.');
  await pool.query(
    `UPDATE stores SET status = 'provisioning', error = NULL, updated_at = NOW() WHERE id = $1`,
    [id],
  );
  await enqueue(s, 'provision', {
    phase: s.design ? 'submit' : 'content',
    use_ai: true,
  });
  return getStore(tenantId, id);
}

/** Builds the full agent spec for a store (content must already be in s.design). */
async function agentSpec(s, extra = {}) {
  const ws = await workspace(s.tenant_id);
  const content =
    s.design?.content ||
    design.fallbackContent(
      design.TEMPLATES[s.template] || design.TEMPLATES.minimal,
      {
        name: s.name,
        description: s.business_description,
        currency: s.currency,
      },
    );
  const spec = design.buildSpec({
    template: s.template,
    brandColor: s.brand_color,
    content,
    name: s.name,
    email: s.admin_email,
    city: s.design?.city,
    phone: s.design?.phone,
  });
  return {
    ...spec,
    timezone: ws?.timezone,
    store: {
      currency: s.currency,
      country: s.design?.country || '',
      city: s.design?.city || '',
      email: s.admin_email,
    },
    omnicore: {
      api_url: callbackBase(),
      store_id: s.id,
      secret: open(s.connect_secret_sealed),
      checkout_enabled: Boolean(s.checkout_enabled && ws?.payments),
    },
    ...extra,
  };
}

async function redesign(tenantId, id, body) {
  const s = await rawStore(tenantId, id);
  if (s.kind !== 'hosted')
    throw new StoreError(
      'Only stores hosted here can be redesigned from OmniCore.',
    );
  if (s.status !== 'active')
    throw new StoreError('The store must be live to change its design.', 409);
  const template = design.TEMPLATES[body.template] ? body.template : s.template;
  const brandColor =
    body.brand_color === ''
      ? null
      : /^#[0-9a-f]{6}$/i.test(body.brand_color || '')
        ? body.brand_color.toLowerCase()
        : s.brand_color;
  const description =
    body.description !== undefined
      ? String(body.description).slice(0, 1500)
      : s.business_description;
  await pool.query(
    `UPDATE stores SET template = $2, brand_color = $3, business_description = $4, updated_at = NOW() WHERE id = $1`,
    [id, template, brandColor, description],
  );
  await enqueue(s, 'redesign', {
    rewrite: Boolean(body.rewrite_content),
    use_ai: body.use_ai !== false,
  });
  return getStore(tenantId, id);
}

// ── Connected stores ─────────────────────────────────────────────────────────
async function connectStore(tenantId, by, body) {
  const ws = await assertCapacity(tenantId);
  const siteUrl = wc.normalizeSiteUrl(body.site_url);
  const key = String(body.consumer_key || '').trim();
  const secret = String(body.consumer_secret || '').trim();
  if (!/^ck_[a-f0-9]{20,64}$/.test(key) || !/^cs_[a-f0-9]{20,64}$/.test(secret))
    throw new StoreError(
      'Paste the Consumer key (ck_…) and Consumer secret (cs_…) from WooCommerce → Settings → Advanced → REST API.',
    );
  const conn = {
    site_url: siteUrl,
    consumer_key: key,
    consumer_secret: secret,
  };
  const facts = await wc.probe(conn);
  const id = crypto.randomUUID();
  const name = String(body.name || new URL(siteUrl).hostname).slice(0, 120);
  await pool.query(
    `INSERT INTO stores (id, tenant_id, kind, name, status, site_url, currency, wc_keys_sealed, connect_secret_sealed,
        checkout_enabled, stats, created_by)
     VALUES ($1,$2,'connected',$3,'active',$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      tenantId,
      name,
      siteUrl,
      facts.currency,
      sealJson({ consumer_key: key, consumer_secret: secret }),
      seal(crypto.randomBytes(32).toString('hex')),
      ws.payments,
      JSON.stringify({ products: facts.products, orders_remote: facts.orders }),
      by.email || null,
    ],
  );
  const store = await rawStore(tenantId, id);
  await setupWebhooks(store).catch((err) =>
    pool.query(`UPDATE stores SET sync_error = $2 WHERE id = $1`, [
      id,
      `Webhooks not created: ${err.message}`,
    ]),
  );
  await enqueue(store, 'sync', { full: true });
  return getStore(tenantId, id);
}

function keysOf(s) {
  const k = openJson(s.wc_keys_sealed);
  if (!k) throw new StoreError('This store has no API key yet.', 409);
  return {
    site_url: s.site_url,
    consumer_key: k.consumer_key,
    consumer_secret: k.consumer_secret,
  };
}

async function setupWebhooks(s) {
  const conn = keysOf(s);
  const old = Array.isArray(s.webhook_ids) ? s.webhook_ids : [];
  for (const wid of old) await wc.deleteWebhook(conn, wid);
  const secret = crypto.randomBytes(24).toString('hex');
  const delivery = `${callbackBase()}/api/stores/webhooks/${s.id}`;
  const ids = [];
  for (const topic of ['order.created', 'order.updated', 'customer.created']) {
    ids.push(
      await wc.createWebhook(conn, {
        name: `OmniCore ${topic}`,
        topic,
        deliveryUrl: delivery,
        secret,
      }),
    );
  }
  await pool.query(
    `UPDATE stores SET webhook_secret_sealed = $2, webhook_ids = $3, updated_at = NOW() WHERE id = $1`,
    [s.id, seal(secret), JSON.stringify(ids)],
  );
}

// ── Common store actions ─────────────────────────────────────────────────────
async function updateStore(tenantId, id, body) {
  const s = await rawStore(tenantId, id);
  const sets = [];
  const vals = [id];
  if (body.name !== undefined) {
    const n = String(body.name).trim().slice(0, 120);
    if (n.length < 2) throw new StoreError('Store name is too short.');
    vals.push(n);
    sets.push(`name = $${vals.length}`);
  }
  if (body.checkout_enabled !== undefined) {
    vals.push(Boolean(body.checkout_enabled));
    sets.push(`checkout_enabled = $${vals.length}`);
  }
  if (sets.length)
    await pool.query(
      `UPDATE stores SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
      vals,
    );
  if (
    body.checkout_enabled !== undefined &&
    s.kind === 'hosted' &&
    s.status === 'active'
  )
    await enqueue(s, 'redesign', { settings_only: true });
  return getStore(tenantId, id);
}

async function suspendStore(tenantId, id, { resume = false } = {}) {
  const s = await rawStore(tenantId, id);
  if (s.kind !== 'hosted')
    throw new StoreError('Only hosted stores can be paused.');
  const host = await hostById(s.host_id);
  await agent.call(
    host,
    'POST',
    `/v1/stores/${s.agent_store_id}/${resume ? 'resume' : 'suspend'}`,
    {},
  );
  await pool.query(
    `UPDATE stores SET status = $2, updated_at = NOW() WHERE id = $1`,
    [id, resume ? 'active' : 'suspended'],
  );
  return getStore(tenantId, id);
}

async function deleteStore(tenantId, id) {
  const s = await rawStore(tenantId, id);
  if (s.kind === 'connected') {
    if (s.wc_keys_sealed) {
      const conn = keysOf(s);
      for (const wid of s.webhook_ids || []) await wc.deleteWebhook(conn, wid);
    }
    await pool.query(
      `UPDATE stores SET status = 'deleted', deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id],
    );
    return { ok: true };
  }
  if (s.domain_detail?.cf_id)
    await cloudflare.deleteHostname(s.domain_detail.cf_id);
  await pool.query(
    `UPDATE stores SET status = 'deleting', updated_at = NOW() WHERE id = $1`,
    [id],
  );
  await enqueue(s, 'delete', { phase: 'submit' });
  return { ok: true, status: 'deleting' };
}

/** One-time sign-in link to the store's WordPress admin (verified by the OmniCore plugin). */
async function ssoUrl(tenantId, id, email, redirect) {
  const s = await rawStore(tenantId, id);
  if (!s.site_url) throw new StoreError('The store is not ready yet.', 409);
  if (s.kind === 'connected' && !s.plugin_seen_at)
    return { url: `${s.site_url}/wp-admin/`, sso: false };
  const payload = Buffer.from(
    JSON.stringify({
      m: email || '',
      e: Math.floor(Date.now() / 1000) + 120,
      n: crypto.randomBytes(12).toString('hex'),
      r: redirect || '',
    }),
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', open(s.connect_secret_sealed))
    .update(`sso.${payload}`)
    .digest('hex');
  return { url: `${s.site_url}/?omnicore_sso=${payload}.${sig}`, sso: true };
}

async function connectionKey(tenantId, id) {
  const s = await rawStore(tenantId, id);
  const data = { u: callbackBase(), s: s.id, k: open(s.connect_secret_sealed) };
  return {
    key: `ocs1.${Buffer.from(JSON.stringify(data)).toString('base64url')}`,
    plugin_url: '/api/stores/plugin.zip',
  };
}

async function adminPassword(tenantId, id) {
  const s = await rawStore(tenantId, id);
  if (s.kind !== 'hosted' || !s.design?.admin_sealed)
    throw new StoreError(
      'No stored administrator password for this store.',
      404,
    );
  return openJson(s.design.admin_sealed);
}

// ── Custom domains (hosted stores) ───────────────────────────────────────────
async function setCustomDomain(tenantId, id, rawDomain) {
  const s = await rawStore(tenantId, id);
  if (s.kind !== 'hosted')
    throw new StoreError(
      'Custom domains are set in your own hosting for connected stores.',
    );
  if (!['active', 'suspended'].includes(s.status))
    throw new StoreError('Wait until the store is live.', 409);
  const domain = String(rawDomain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!HOST_RE.test(domain))
    throw new StoreError('Enter a domain like shop.example.com.');
  const host = await hostById(s.host_id);
  if (domain === host.base_domain || domain.endsWith(`.${host.base_domain}`))
    throw new StoreError('Use your own domain, not the platform domain.');
  const { rows } = await pool.query(
    `SELECT 1 FROM stores WHERE (lower(custom_domain) = $1 OR lower(subdomain) = $1) AND deleted_at IS NULL AND id <> $2`,
    [domain, id],
  );
  if (rows.length)
    throw new StoreError('That domain is already used by another store.', 409);
  if (s.domain_detail?.cf_id)
    await cloudflare.deleteHostname(s.domain_detail.cf_id);
  let detail = {
    mode: 'dns',
    records: [
      host.public_ip
        ? { type: 'A', name: domain, value: host.public_ip, purpose: 'routing' }
        : {
            type: 'CNAME',
            name: domain,
            value: host.cname_target || host.base_domain,
            purpose: 'routing',
          },
    ],
  };
  if (cloudflare.configured()) {
    const cf = await cloudflare.createHostname(domain);
    detail = {
      mode: 'cloudflare',
      cf_id: cf.id,
      status: cf.status,
      ssl_status: cf.ssl_status,
      records: [
        {
          type: 'CNAME',
          name: domain,
          value: host.cname_target || host.base_domain,
          purpose: 'routing',
        },
        ...cf.records,
      ],
      errors: cf.errors,
    };
  }
  await pool.query(
    `UPDATE stores SET custom_domain = $2, domain_status = 'pending', domain_detail = $3, updated_at = NOW() WHERE id = $1`,
    [id, domain, JSON.stringify(detail)],
  );
  await pool.query(
    `DELETE FROM store_jobs WHERE store_id = $1 AND kind = 'domain_check' AND status = 'queued'`,
    [id],
  );
  await enqueue(s, 'domain_check', { started: Date.now() }, 5000);
  return getStore(tenantId, id);
}

async function removeCustomDomain(tenantId, id) {
  const s = await rawStore(tenantId, id);
  if (!s.custom_domain) return getStore(tenantId, id);
  if (s.domain_detail?.cf_id)
    await cloudflare.deleteHostname(s.domain_detail.cf_id);
  if (s.domain_status === 'active') {
    const host = await hostById(s.host_id);
    await agent.call(host, 'PUT', `/v1/stores/${s.agent_store_id}/domains`, {
      hostnames: [s.subdomain],
      primary: s.subdomain,
      acme_hosts: [],
    });
    await pool.query(`UPDATE stores SET site_url = $2 WHERE id = $1`, [
      id,
      `${siteScheme(host)}://${s.subdomain}`,
    ]);
  }
  await pool.query(
    `UPDATE stores SET custom_domain = NULL, domain_status = NULL, domain_detail = NULL, updated_at = NOW() WHERE id = $1`,
    [id],
  );
  return getStore(tenantId, id);
}

const siteScheme = (host) =>
  host?.last_health?.tls_mode === 'off' ? 'http' : 'https';

/** True when the domain's DNS points at the store server (direct mode). */
async function dnsPointsHere(domain, host) {
  // The system resolver (getaddrinfo) so local overrides and split-horizon DNS count too.
  const addrs = async (name) =>
    (await dns.lookup(name, { all: true, family: 4 }).catch(() => [])).map(
      (a) => a.address,
    );
  try {
    const theirs = await addrs(domain);
    if (host.public_ip && theirs.includes(host.public_ip)) return true;
    const target = host.cname_target || host.base_domain;
    const c = await dns.resolveCname(domain).catch(() => []);
    if (c.some((x) => x.replace(/\.$/, '') === target)) return true;
    // Proxied through Cloudflare the addresses are Cloudflare's: accept a match with the target's.
    const mine = await addrs(target);
    return theirs.length > 0 && theirs.every((ip) => mine.includes(ip));
  } catch {
    return false;
  }
}

// ── Orders, customers and sync ───────────────────────────────────────────────
async function upsertContact(tenantId, email, name) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e || !e.includes('@')) return null;
  const { rows } = await pool.query(
    `SELECT id FROM visitors WHERE tenant_id = $1 AND lower(email) = $2 ORDER BY last_seen_at DESC LIMIT 1`,
    [tenantId, e],
  );
  if (rows[0]) {
    if (name)
      await pool.query(
        `UPDATE visitors SET display_name = COALESCE(NULLIF(display_name, ''), $2) WHERE id = $1`,
        [rows[0].id, name],
      );
    return rows[0].id;
  }
  const { rows: brands } = await pool.query(
    `SELECT id FROM brands WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [tenantId],
  );
  if (!brands[0]) return null;
  const { rows: created } = await pool.query(
    `INSERT INTO visitors (tenant_id, brand_id, session_token, email, display_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      tenantId,
      brands[0].id,
      `store_${crypto.randomBytes(18).toString('hex')}`,
      e,
      name || null,
    ],
  );
  return created[0].id;
}

async function upsertOrder(s, o) {
  // Block-checkout drafts are carts, not orders yet.
  if (!o || !o.id || o.status === 'checkout-draft') return null;
  const currency = String(o.currency || s.currency || 'usd').toLowerCase();
  const name = [o.billing?.first_name, o.billing?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  const email = String(o.billing?.email || '').trim();
  const contactId = await upsertContact(s.tenant_id, email, name).catch(
    () => null,
  );
  const items = Array.isArray(o.line_items)
    ? o.line_items.reduce((n, li) => n + Number(li.quantity || 0), 0)
    : 0;
  const lean = {
    id: o.id,
    number: o.number,
    status: o.status,
    currency,
    total: o.total,
    payment_method_title: o.payment_method_title,
    billing: o.billing,
    shipping: o.shipping,
    line_items: (o.line_items || []).map((li) => ({
      name: li.name,
      quantity: li.quantity,
      total: li.total,
      sku: li.sku,
    })),
    customer_note: o.customer_note,
  };
  await pool.query(
    `INSERT INTO store_orders (tenant_id, store_id, external_id, number, status, currency, total, customer_name, customer_email,
        contact_id, items_count, payment_method, payment_method_title, created_remote, updated_remote, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (store_id, external_id) DO UPDATE SET
       number = EXCLUDED.number, status = EXCLUDED.status, currency = EXCLUDED.currency, total = EXCLUDED.total,
       customer_name = EXCLUDED.customer_name, customer_email = EXCLUDED.customer_email,
       contact_id = COALESCE(EXCLUDED.contact_id, store_orders.contact_id), items_count = EXCLUDED.items_count,
       payment_method = EXCLUDED.payment_method, payment_method_title = EXCLUDED.payment_method_title,
       updated_remote = EXCLUDED.updated_remote, raw = EXCLUDED.raw, updated_at = NOW()`,
    [
      s.tenant_id,
      s.id,
      Number(o.id),
      String(o.number || o.id),
      o.status,
      currency,
      toMinor(o.total, currency),
      name,
      email,
      contactId,
      items,
      o.payment_method || null,
      o.payment_method_title || null,
      o.date_created_gmt ? `${o.date_created_gmt}Z` : null,
      o.date_modified_gmt ? `${o.date_modified_gmt}Z` : null,
      JSON.stringify(lean),
    ],
  );
  return true;
}

async function refreshStats(s) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS orders,
            COALESCE(SUM(total) FILTER (WHERE status IN ('processing','completed') AND created_remote > NOW() - INTERVAL '30 days'), 0)::bigint AS revenue_30d,
            COUNT(*) FILTER (WHERE created_remote > NOW() - INTERVAL '30 days')::int AS orders_30d,
            COUNT(*) FILTER (WHERE status IN ('processing','on-hold','pending'))::int AS open_orders,
            COUNT(DISTINCT lower(customer_email)) FILTER (WHERE customer_email <> '')::int AS customers
       FROM store_orders WHERE store_id = $1`,
    [s.id],
  );
  let remote = {};
  if (s.wc_keys_sealed) remote = await wc.counts(keysOf(s)).catch(() => ({}));
  const stats = {
    ...(s.stats || {}),
    ...rows[0],
    revenue_30d: Number(rows[0].revenue_30d),
    ...(remote.products !== undefined ? { products: remote.products } : {}),
  };
  await pool.query(`UPDATE stores SET stats = $2 WHERE id = $1`, [
    s.id,
    JSON.stringify(stats),
  ]);
}

async function syncStore(s, { full = false } = {}) {
  const conn = keysOf(s);
  const since =
    full || !s.last_sync_at
      ? null
      : new Date(new Date(s.last_sync_at).getTime() - 10 * 60 * 1000);
  const started = now();
  let page = 1;
  let count = 0;
  for (;;) {
    const { orders, totalPages } = await wc.listOrders(conn, {
      page,
      perPage: 50,
      modifiedAfter: since,
    });
    for (const o of orders) {
      await upsertOrder(s, o);
      count += 1;
    }
    if (page >= totalPages || !orders.length || page >= (full ? 40 : 10)) break;
    page += 1;
  }
  await refreshStats({ ...s, last_sync_at: started });
  await pool.query(
    `UPDATE stores SET last_sync_at = $2, sync_error = NULL, updated_at = NOW() WHERE id = $1`,
    [s.id, started],
  );
  return { synced: count };
}

async function requestSync(tenantId, id) {
  const s = await rawStore(tenantId, id);
  if (!s.wc_keys_sealed)
    throw new StoreError('The store is not ready yet.', 409);
  await enqueue(s, 'sync', { full: false });
  return { queued: true };
}

async function listOrders(tenantId, storeId, { page = 1, limit = 25 } = {}) {
  await ensureSchema();
  const lim = Math.min(100, Math.max(1, Number(limit) || 25));
  const off = (Math.max(1, Number(page) || 1) - 1) * lim;
  const params = [tenantId];
  let where = 'o.tenant_id = $1';
  if (storeId) {
    params.push(storeId);
    where += ` AND o.store_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT o.id, o.store_id, s.name AS store_name, o.external_id, o.number, o.status, o.currency, o.total,
            o.customer_name, o.customer_email, o.contact_id, o.items_count, o.payment_method_title, o.created_remote
       FROM store_orders o JOIN stores s ON s.id = o.store_id
      WHERE ${where} ORDER BY o.created_remote DESC NULLS LAST LIMIT ${lim} OFFSET ${off}`,
    params,
  );
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
}

// ── Webhooks from WooCommerce ────────────────────────────────────────────────
async function handleWebhook(storeId, rawBody, headers) {
  await ensureSchema();
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return { status: 404 };
  const { rows } = await pool.query(
    `SELECT * FROM stores WHERE id = $1 AND deleted_at IS NULL`,
    [storeId],
  );
  const s = rows[0];
  if (!s || !s.webhook_secret_sealed) return { status: 404 };
  const text = rawBody.toString('utf8');
  // WooCommerce pings a new webhook with a form body "webhook_id=N" (unsigned).
  if (/^webhook_id=\d+$/.test(text.trim()))
    return { status: 200, body: { ok: true } };
  if (
    !wc.verifyWebhook(
      rawBody,
      headers['x-wc-webhook-signature'],
      open(s.webhook_secret_sealed),
    )
  )
    return { status: 401 };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { status: 400 };
  }
  const topic = String(headers['x-wc-webhook-topic'] || '');
  if (topic.startsWith('order.')) {
    const saved = await upsertOrder(s, data);
    if (!saved) {
      // WooCommerce fires the first webhooks of a block checkout while the order is still a
      // draft (empty payload): fetch it a moment later instead.
      const { rowCount } = await pool.query(
        `SELECT 1 FROM store_jobs WHERE store_id = $1 AND kind = 'sync' AND status = 'queued'`,
        [s.id],
      );
      if (!rowCount) await enqueue(s, 'sync', { full: false }, 15000);
      return { status: 200, body: { ok: true, deferred: true } };
    }
    await refreshStats(s).catch(() => {});
    try {
      require('../services/socket.service').broadcastToTenant(
        s.tenant_id,
        'store:order',
        {
          store_id: s.id,
          store: s.name,
          number: data.number,
          status: data.status,
          total: toMinor(data.total, data.currency || s.currency),
          currency: String(data.currency || s.currency || '').toLowerCase(),
          created: topic === 'order.created',
        },
      );
    } catch {}
  } else if (topic.startsWith('customer.')) {
    await upsertContact(
      s.tenant_id,
      data.email,
      [data.first_name, data.last_name].filter(Boolean).join(' '),
    );
  }
  return { status: 200, body: { ok: true } };
}

// ── OmniCore Commerce plugin (signed with the store's connection secret) ──────
async function verifyPlugin(headers, rawBody) {
  await ensureSchema();
  const storeId = String(headers['x-omnicore-store'] || '');
  const ts = String(headers['x-omnicore-timestamp'] || '');
  const sig = String(headers['x-omnicore-signature'] || '').toLowerCase();
  if (
    !/^[0-9a-f-]{36}$/i.test(storeId) ||
    !/^\d+$/.test(ts) ||
    !/^[a-f0-9]{64}$/.test(sig)
  )
    throw new StoreError('Unauthorized', 401);
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300)
    throw new StoreError('Request expired; check the server clock.', 401);
  const { rows } = await pool.query(
    `SELECT * FROM stores WHERE id = $1 AND deleted_at IS NULL`,
    [storeId],
  );
  const s = rows[0];
  if (!s) throw new StoreError('Unauthorized', 401);
  const expected = crypto
    .createHmac('sha256', open(s.connect_secret_sealed))
    .update(`${ts}.${rawBody.toString('utf8')}`)
    .digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)))
    throw new StoreError('Unauthorized', 401);
  return s;
}

async function pluginHello(s, body) {
  const site = body.site_url ? wc.normalizeSiteUrl(body.site_url) : null;
  await pool.query(
    `UPDATE stores SET plugin_seen_at = NOW(), plugin_version = $2, site_url = COALESCE(site_url, $3), updated_at = NOW() WHERE id = $1`,
    [s.id, String(body.plugin_version || '').slice(0, 20), site],
  );
  const ws = await workspace(s.tenant_id);
  return {
    ok: true,
    store: s.name,
    checkout_available: Boolean(ws?.payments && s.checkout_enabled),
  };
}

/** Creates (or reuses) an OmniCore invoice for a WooCommerce order and returns its pay page. */
async function pluginCheckout(s, body) {
  const pay = require('../payments/service');
  const ws = await workspace(s.tenant_id);
  if (!ws?.payments || !s.checkout_enabled)
    throw new StoreError(
      'OmniCore checkout is turned off for this store.',
      409,
    );
  const orderId = Number(body.order_id);
  if (!orderId || !body.order_key) throw new StoreError('Missing order.');
  await pool.query(`UPDATE stores SET plugin_seen_at = NOW() WHERE id = $1`, [
    s.id,
  ]);

  const existing = await pool.query(
    `SELECT * FROM pay_invoices WHERE tenant_id = $1 AND source = 'woocommerce'
        AND source_ref->>'store_id' = $2 AND source_ref->>'order_id' = $3 AND status NOT IN ('void','paid')
      ORDER BY created_at DESC LIMIT 1`,
    [s.tenant_id, s.id, String(orderId)],
  );
  const currency = String(body.currency || s.currency || 'usd').toLowerCase();
  const totalMinor = toMinor(body.total, currency);
  if (existing.rows[0] && Number(existing.rows[0].total) === totalMinor) {
    const inv = existing.rows[0];
    return { invoice_id: inv.id, pay_url: pay.invoiceUrl(inv) };
  }
  for (const inv of existing.rows)
    await pay.voidDocument(s.tenant_id, inv.id).catch(() => {});

  // Payments stores amounts in minor units (cents), like `totalMinor`.
  const items = (Array.isArray(body.items) ? body.items : [])
    .slice(0, 100)
    .map((it) => {
      const qty = Math.max(1, Number(it.quantity) || 1);
      return {
        description: String(it.name || 'Item').slice(0, 200),
        quantity: qty,
        unit_price: Math.round(toMinor(it.total, currency) / qty),
      };
    });
  for (const [label, v] of [
    ['Shipping', toMinor(body.shipping_total, currency)],
    ['Tax', toMinor(body.tax_total, currency)],
  ]) {
    if (v > 0) items.push({ description: label, quantity: 1, unit_price: v });
  }
  const discount = toMinor(body.discount_total, currency);
  const lineSum =
    items.reduce((n, it) => n + it.unit_price * it.quantity, 0) - discount;
  // Itemised when the lines add up to the order total exactly; otherwise one line for the order.
  const exact = items.length > 0 && lineSum === totalMinor;
  const lineItems = exact
    ? items
    : [
        {
          description: `Order #${String(body.number || orderId).slice(0, 40)} from ${s.name}`,
          quantity: 1,
          unit_price: totalMinor,
        },
      ];

  const customer = body.customer || {};
  const doc = await pay.createDocument(
    s.tenant_id,
    {
      customer_name: String(
        customer.name || customer.email || 'Customer',
      ).slice(0, 200),
      customer_email: String(customer.email || '').slice(0, 200),
      customer_phone: String(customer.phone || '').slice(0, 60),
      customer_address: String(customer.address || '').slice(0, 1000),
      title: `Order #${String(body.number || orderId).slice(0, 40)} · ${s.name}`,
      currency,
      line_items: lineItems,
      discount: exact ? discount : 0,
      notes: '',
    },
    { kind: 'invoice', by: `store:${s.name}` },
  );
  const returnUrl = /^https?:\/\//.test(String(body.return_url || ''))
    ? String(body.return_url).slice(0, 1000)
    : null;
  await pool.query(
    `UPDATE pay_invoices SET source = 'woocommerce', source_ref = $2 WHERE id = $1`,
    [
      doc.id,
      JSON.stringify({
        store_id: s.id,
        order_id: String(orderId),
        order_key: String(body.order_key),
        return_url: returnUrl,
        store_name: s.name,
      }),
    ],
  );
  const sent = await pay.markSent(s.tenant_id, doc.id);
  if (Number(sent.total) !== totalMinor) {
    await pay.voidDocument(s.tenant_id, doc.id).catch(() => {});
    throw new StoreError(
      'The order total could not be matched; please contact the shop.',
      422,
    );
  }
  return { invoice_id: sent.id, pay_url: pay.invoiceUrl(sent) };
}

/** Payment events from Invoices & Payments → the WooCommerce order (via the plugin). */
async function onPaymentEvent(tenantId, tx, event) {
  if (!tx?.invoice_id) return;
  const { rows } = await pool.query(
    `SELECT source, source_ref FROM pay_invoices WHERE id = $1 AND tenant_id = $2`,
    [tx.invoice_id, tenantId],
  );
  const inv = rows[0];
  if (!inv || inv.source !== 'woocommerce' || !inv.source_ref?.store_id) return;
  const map = {
    recorded:
      tx.status === 'pending'
        ? 'pending'
        : tx.status === 'succeeded'
          ? 'paid'
          : null,
    confirmed: 'paid',
    rejected: 'failed',
    refunded: 'refunded',
  };
  const wcEvent = map[event];
  if (!wcEvent) return;
  const { rows: st } = await pool.query(
    `SELECT * FROM stores WHERE id = $1 AND deleted_at IS NULL`,
    [inv.source_ref.store_id],
  );
  if (!st[0]) return;
  const zero = ZERO_DECIMAL.has(String(tx.currency));
  await enqueue(st[0], 'payment_callback', {
    order_id: Number(inv.source_ref.order_id),
    order_key: inv.source_ref.order_key,
    event: wcEvent,
    amount: zero ? String(tx.amount) : (Number(tx.amount) / 100).toFixed(2),
    currency: String(tx.currency).toUpperCase(),
    transaction_id: tx.external_id || tx.id,
    method: tx.provider,
    method_label: tx.method || tx.provider,
  });
}

async function sendPaymentCallback(s, payload) {
  if (!s.site_url) throw new Error('Store has no address');
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto
    .createHmac('sha256', open(s.connect_secret_sealed))
    .update(`${ts}.${body}`)
    .digest('hex');
  const res = await fetch(`${s.site_url}/wp-json/omnicore/v1/payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OmniCore-Store': s.id,
      'X-OmniCore-Timestamp': ts,
      'X-OmniCore-Signature': sig,
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      data.message || data.error || `Store answered HTTP ${res.status}`,
    );
  return data;
}

module.exports = {
  StoreError,
  workspace,
  listStores,
  getStore,
  rawStore,
  hostById,
  platformInfo,
  slugAvailable,
  createHosted,
  retryProvision,
  agentSpec,
  redesign,
  connectStore,
  setupWebhooks,
  updateStore,
  suspendStore,
  deleteStore,
  ssoUrl,
  connectionKey,
  adminPassword,
  setCustomDomain,
  removeCustomDomain,
  dnsPointsHere,
  siteScheme,
  syncStore,
  requestSync,
  listOrders,
  upsertOrder,
  refreshStats,
  handleWebhook,
  verifyPlugin,
  pluginHello,
  pluginCheckout,
  onPaymentEvent,
  sendPaymentCallback,
  enqueue,
  keysOf,
  callbackBase,
  toMinor,
};
