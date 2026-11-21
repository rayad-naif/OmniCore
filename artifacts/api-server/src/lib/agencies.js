'use strict';

/**
 * agencies.js
 * Atelier OmniCore — agency (reseller) layer and white-labeling.
 *
 * Model (like GoHighLevel's agency → sub-accounts):
 *   platform (super admin)
 *     └─ agency            branding, custom domains, own AI key, client limits
 *          └─ workspaces   tenants with tenants.agency_id = agency.id
 *
 * An agency's staff are agents in the agency's *home workspace* who are listed
 * in agency_members. They manage their client workspaces from Dashboard → Agency
 * and can "view as" any of them. Clients only ever see the agency's brand on the
 * agency's domains, login page, dashboard, chat widget and system emails.
 */

const crypto = require('crypto');
const dns = require('dns').promises;
const { pool } = require('./db');
const logger = require('../utils/logger');

const DEFAULT_BRANDING = Object.freeze({
  appName: 'OmniCore',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#0284c7',
  accentColor: '#C9A450',
  loginTitle: null,
  loginSubtitle: null,
  supportEmail: null,
  supportUrl: null,
  customCss: '',
  hidePoweredBy: false,
  emailFromName: null,
});

const BRANDING_KEYS = Object.keys(DEFAULT_BRANDING);
const HEX = /^#[0-9a-fA-F]{6}$/;

let schemaReady = null;
function ensureAgencySchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock(hashtext($1))', [
          'omnicore_agency_schema',
        ]);
        await client.query(`
          CREATE TABLE IF NOT EXISTS agencies (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name            TEXT NOT NULL,
            slug            TEXT UNIQUE,
            home_tenant_id  UUID UNIQUE,
            status          TEXT NOT NULL DEFAULT 'active',
            branding        JSONB NOT NULL DEFAULT '{}'::jsonb,
            ai_config_sealed TEXT,
            max_workspaces  INTEGER NOT NULL DEFAULT 25,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE TABLE IF NOT EXISTS agency_members (
            agency_id   UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
            agent_id    UUID NOT NULL,
            role        TEXT NOT NULL DEFAULT 'admin',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (agency_id, agent_id)
          );
          CREATE INDEX IF NOT EXISTS idx_agency_members_agent ON agency_members (agent_id);
          CREATE TABLE IF NOT EXISTS agency_domains (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agency_id          UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
            hostname           TEXT NOT NULL UNIQUE,
            verification_token TEXT NOT NULL,
            status             TEXT NOT NULL DEFAULT 'pending',
            is_primary         BOOLEAN NOT NULL DEFAULT FALSE,
            cf_hostname_id     TEXT,
            last_error         TEXT,
            verified_at        TIMESTAMPTZ,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS agency_id UUID;
          CREATE INDEX IF NOT EXISTS idx_tenants_agency ON tenants (agency_id);
        `);
      } finally {
        await client
          .query('SELECT pg_advisory_unlock(hashtext($1))', [
            'omnicore_agency_schema',
          ])
          .catch(() => {});
        client.release();
      }
    })().catch((err) => {
      schemaReady = null;
      logger.error({ err: err.message }, 'agency_schema_failed');
      throw err;
    });
  }
  return schemaReady;
}

/** Validates and normalises a branding patch. Throws 400 on bad input. */
function cleanBranding(input = {}) {
  const out = {};
  for (const k of BRANDING_KEYS) {
    if (!(k in input)) continue;
    let v = input[k];
    if (v === '' || v === undefined) v = null;
    if (
      (k === 'primaryColor' || k === 'accentColor') &&
      v !== null &&
      !HEX.test(v)
    ) {
      throw Object.assign(new Error(`${k} must be a hex colour like #0284c7`), {
        status: 400,
      });
    }
    if (
      (k === 'logoUrl' || k === 'faviconUrl' || k === 'supportUrl') &&
      v !== null &&
      !/^https:\/\/[^\s"'<>]+$/.test(v)
    ) {
      throw Object.assign(new Error(`${k} must be an https:// URL`), {
        status: 400,
      });
    }
    if (
      k === 'supportEmail' &&
      v !== null &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
    ) {
      throw Object.assign(new Error('supportEmail is not a valid email'), {
        status: 400,
      });
    }
    if (k === 'hidePoweredBy') v = Boolean(v);
    if (k === 'customCss' && v !== null) {
      v = String(v).slice(0, 20000);
      // CSS only: no markup, no imports of remote scripts, no legacy JS hooks.
      if (
        /<\/?\s*(script|style)|expression\s*\(|javascript:|@import/i.test(v)
      ) {
        throw Object.assign(
          new Error(
            'customCss may not contain <script>, <style>, @import, expression() or javascript:',
          ),
          { status: 400 },
        );
      }
    }
    if (typeof v === 'string' && k !== 'customCss') v = v.slice(0, 200);
    out[k] = v;
  }
  return out;
}

function mergeBranding(stored) {
  const b = { ...DEFAULT_BRANDING };
  for (const k of BRANDING_KEYS)
    if (stored?.[k] !== undefined && stored[k] !== null) b[k] = stored[k];
  return b;
}

// ── Host → agency resolution (cached) ────────────────────────────────────────
const hostCache = new Map();
const HOST_TTL = 60_000;

function normaliseHost(host) {
  return String(host || '')
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .trim();
}

function platformHost() {
  try {
    return new URL(
      process.env.PUBLIC_APP_URL ||
        process.env.RENDER_EXTERNAL_URL ||
        'http://localhost',
    ).hostname;
  } catch {
    return 'localhost';
  }
}

async function agencyForHost(host) {
  const h = normaliseHost(host);
  if (!h || h === platformHost()) return null;
  const hit = hostCache.get(h);
  if (hit && Date.now() - hit.at < HOST_TTL) return hit.agency;
  await ensureAgencySchema();
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.branding, a.status
       FROM agency_domains d JOIN agencies a ON a.id = d.agency_id
      WHERE d.hostname = $1 AND d.status = 'active' AND a.status = 'active'`,
    [h],
  );
  const agency = rows[0] || null;
  hostCache.set(h, { at: Date.now(), agency });
  return agency;
}

function clearHostCache() {
  hostCache.clear();
}

/** Public branding for a request host (login page, dashboard shell, widget). */
async function brandingForHost(host) {
  const agency = await agencyForHost(host);
  return agency
    ? { ...mergeBranding(agency.branding), agencyId: agency.id }
    : { ...DEFAULT_BRANDING, agencyId: null };
}

async function agencyForTenant(tenantId) {
  if (!tenantId) return null;
  await ensureAgencySchema();
  const { rows } = await pool.query(
    `SELECT a.* FROM agencies a
      WHERE a.status = 'active'
        AND (a.id = (SELECT agency_id FROM tenants WHERE id = $1) OR a.home_tenant_id = $1)
      LIMIT 1`,
    [tenantId],
  );
  return rows[0] || null;
}

async function primaryDomain(agencyId) {
  const { rows } = await pool.query(
    `SELECT hostname FROM agency_domains WHERE agency_id = $1 AND status = 'active'
      ORDER BY is_primary DESC, verified_at ASC LIMIT 1`,
    [agencyId],
  );
  return rows[0]?.hostname || null;
}

/** Branding + app URL for everything a workspace's users see (emails, links). */
async function brandingForTenant(tenantId) {
  const agency = await agencyForTenant(tenantId).catch(() => null);
  if (!agency)
    return { branding: { ...DEFAULT_BRANDING }, appUrl: null, agencyId: null };
  const host = await primaryDomain(agency.id);
  return {
    branding: mergeBranding(agency.branding),
    appUrl: host ? `https://${host}` : null,
    agencyId: agency.id,
  };
}

async function brandingForEmail(email) {
  if (!email) return null;
  try {
    await ensureAgencySchema();
    const { rows } = await pool.query(
      `SELECT tenant_id FROM agents WHERE lower(email) = lower($1) LIMIT 1`,
      [email],
    );
    if (!rows[0]) return null;
    const r = await brandingForTenant(rows[0].tenant_id);
    return r.agencyId ? r : null;
  } catch {
    return null;
  }
}

// ── Membership / permissions ─────────────────────────────────────────────────
async function membershipFor(agentId) {
  if (!agentId) return null;
  await ensureAgencySchema();
  const { rows } = await pool.query(
    `SELECT m.role, a.* FROM agency_members m JOIN agencies a ON a.id = m.agency_id
      WHERE m.agent_id = $1 AND a.status = 'active' LIMIT 1`,
    [agentId],
  );
  return rows[0] || null;
}

/** True when the agent administers an agency that owns `tenantId`. */
async function canAgencyAccessTenant(agentId, tenantId) {
  if (!agentId || !tenantId) return false;
  await ensureAgencySchema();
  const { rows } = await pool.query(
    `SELECT 1 FROM agency_members m
       JOIN agencies a ON a.id = m.agency_id AND a.status = 'active'
       JOIN tenants t ON t.agency_id = a.id
      WHERE m.agent_id = $1 AND t.id = $2 LIMIT 1`,
    [agentId, tenantId],
  );
  return rows.length > 0;
}

// ── Allowed browser origins (custom domains) ─────────────────────────────────
let originCache = { at: 0, set: new Set() };
async function isAgencyOrigin(origin) {
  if (!origin) return false;
  let host;
  try {
    host = normaliseHost(new URL(origin).hostname);
  } catch {
    return false;
  }
  if (Date.now() - originCache.at > HOST_TTL) {
    try {
      await ensureAgencySchema();
      const { rows } = await pool.query(
        `SELECT hostname FROM agency_domains WHERE status = 'active'`,
      );
      originCache = {
        at: Date.now(),
        set: new Set(rows.map((r) => r.hostname)),
      };
    } catch {
      originCache = { at: Date.now(), set: new Set() };
    }
  }
  return originCache.set.has(host);
}

// ── Custom domains ───────────────────────────────────────────────────────────
const HOSTNAME =
  /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function validateHostname(h) {
  const host = normaliseHost(h);
  if (!HOSTNAME.test(host))
    throw Object.assign(new Error('Enter a hostname like app.youragency.com'), {
      status: 400,
    });
  if (host === platformHost())
    throw Object.assign(new Error('That is the platform domain'), {
      status: 400,
    });
  return host;
}

function newVerificationToken() {
  return `omnicore-verify=${crypto.randomBytes(16).toString('hex')}`;
}

/** Instructions shown to the agency for a pending domain. */
function dnsInstructions(domain) {
  return [
    {
      type: 'CNAME',
      name: domain.hostname,
      value: platformHost(),
      purpose: 'Routes the domain to the platform',
    },
    {
      type: 'TXT',
      name: `_omnicore.${domain.hostname}`,
      value: domain.verification_token,
      purpose: 'Proves you own the domain',
    },
  ];
}

/**
 * Checks DNS for the TXT token and (optionally) registers the hostname with
 * Cloudflare for SaaS so TLS is issued automatically. Returns the updated row.
 */
async function verifyDomain(domainId, agencyId) {
  const { rows } = await pool.query(
    `SELECT * FROM agency_domains WHERE id = $1 AND agency_id = $2`,
    [domainId, agencyId],
  );
  const d = rows[0];
  if (!d) throw Object.assign(new Error('Domain not found'), { status: 404 });
  let records = [];
  try {
    records = (await dns.resolveTxt(`_omnicore.${d.hostname}`)).map((r) =>
      r.join(''),
    );
  } catch (err) {
    records = [];
    logger.info(
      { host: d.hostname, err: err.code },
      'domain_txt_lookup_failed',
    );
  }
  if (!records.includes(d.verification_token)) {
    await pool.query(
      `UPDATE agency_domains SET last_error = $2 WHERE id = $1`,
      [
        d.id,
        `TXT record _omnicore.${d.hostname} not found yet (DNS can take up to an hour).`,
      ],
    );
    throw Object.assign(
      new Error(
        `TXT record _omnicore.${d.hostname} not found yet. DNS can take up to an hour.`,
      ),
      { status: 409 },
    );
  }

  let cfId = d.cf_hostname_id;
  let lastError = null;
  if (
    process.env.CLOUDFLARE_API_TOKEN &&
    process.env.CLOUDFLARE_ZONE_ID &&
    !cfId
  ) {
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/custom_hostnames`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            hostname: d.hostname,
            ssl: { method: 'http', type: 'dv' },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (json.success) cfId = json.result?.id || null;
      else lastError = `Cloudflare: ${json.errors?.[0]?.message || res.status}`;
    } catch (err) {
      lastError = `Cloudflare: ${err.message}`;
    }
  }

  const { rows: up } = await pool.query(
    `UPDATE agency_domains SET status = 'active', verified_at = COALESCE(verified_at, NOW()),
       cf_hostname_id = COALESCE($2, cf_hostname_id), last_error = $3,
       is_primary = is_primary OR NOT EXISTS (SELECT 1 FROM agency_domains WHERE agency_id = $4 AND status = 'active' AND id <> $1)
     WHERE id = $1 RETURNING *`,
    [d.id, cfId, lastError, agencyId],
  );
  clearHostCache();
  originCache.at = 0;
  return up[0];
}

async function removeDomain(domainId, agencyId) {
  const { rows } = await pool.query(
    `DELETE FROM agency_domains WHERE id = $1 AND agency_id = $2 RETURNING *`,
    [domainId, agencyId],
  );
  const d = rows[0];
  if (
    d?.cf_hostname_id &&
    process.env.CLOUDFLARE_API_TOKEN &&
    process.env.CLOUDFLARE_ZONE_ID
  ) {
    fetch(
      `https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/custom_hostnames/${d.cf_hostname_id}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        },
      },
    ).catch(() => {});
  }
  clearHostCache();
  originCache.at = 0;
  return d;
}

// ── White-label text helpers ─────────────────────────────────────────────────
/** Replaces the platform name in user-facing text with the agency's app name. */
function rebrandText(text, branding) {
  if (!branding || !branding.appName || branding.appName === 'OmniCore')
    return text;
  return String(text ?? '')
    .replace(/Atelier OmniCore/g, branding.appName)
    .replace(/OmniCore/g, branding.appName);
}

/** Rewrites links pointing at the platform domain to the agency's domain. */
function rebrandLinks(html, appUrl) {
  if (!appUrl) return html;
  const platform = (process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '');
  if (!platform) return html;
  return String(html).split(platform).join(appUrl);
}

module.exports = {
  DEFAULT_BRANDING,
  ensureAgencySchema,
  cleanBranding,
  mergeBranding,
  brandingForHost,
  brandingForTenant,
  brandingForEmail,
  agencyForHost,
  agencyForTenant,
  membershipFor,
  canAgencyAccessTenant,
  isAgencyOrigin,
  validateHostname,
  newVerificationToken,
  dnsInstructions,
  verifyDomain,
  removeDomain,
  rebrandText,
  rebrandLinks,
  clearHostCache,
  platformHost,
};
