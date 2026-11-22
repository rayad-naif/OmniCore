'use strict';

/**
 * hrms/core/tenants.js
 * Postgres-side state of the HR module (everything that must be shared across
 * workspaces or looked up before a workspace is known):
 *
 *   tenants.hrms_feature_enabled   plan / super-admin switch per workspace
 *   hrms_directory                 email → workspaces, for the employee login page
 *   hrms_sso_codes                 one-time codes for OmniCore → HR single sign-on
 *   hrms_revoked_tokens            access tokens revoked at logout
 *   hrms_workspace_keys            per-workspace keys for the desktop activity
 *                                  agent and biometric (Hikvision) devices
 */

const crypto = require('node:crypto');
const { pool } = require('../../lib/db');
const logger = require('../../utils/logger');

let ready = null;
function ensureSchema() {
  if (!ready) {
    ready = pool
      .query(
        `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS hrms_feature_enabled BOOLEAN NOT NULL DEFAULT false;
         ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_timezone TEXT NOT NULL DEFAULT 'UTC';
         ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_feature_enabled BOOLEAN NOT NULL DEFAULT false;
         CREATE TABLE IF NOT EXISTS hrms_directory (
           email      TEXT NOT NULL,
           tenant_id  UUID NOT NULL,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           PRIMARY KEY (email, tenant_id)
         );
         CREATE TABLE IF NOT EXISTS hrms_sso_codes (
           code_hash  TEXT PRIMARY KEY,
           tenant_id  UUID NOT NULL,
           payload    JSONB NOT NULL,
           expires_at TIMESTAMPTZ NOT NULL
         );
         CREATE TABLE IF NOT EXISTS hrms_revoked_tokens (
           token_hash TEXT PRIMARY KEY,
           expires_at TIMESTAMPTZ NOT NULL
         );
         CREATE TABLE IF NOT EXISTS hrms_workspace_keys (
           tenant_id          UUID PRIMARY KEY,
           activity_key_hash  TEXT,
           activity_key_hint  TEXT,
           device_key_hash    TEXT,
           device_key_hint    TEXT,
           data_reset_at      TIMESTAMPTZ,
           created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
         );
         CREATE TABLE IF NOT EXISTS hrms_locks (
           key   TEXT PRIMARY KEY,
           until BIGINT NOT NULL
         );
         CREATE UNIQUE INDEX IF NOT EXISTS idx_hrms_keys_activity ON hrms_workspace_keys (activity_key_hash);
         CREATE UNIQUE INDEX IF NOT EXISTS idx_hrms_keys_device ON hrms_workspace_keys (device_key_hash);`,
      )
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const normEmail = (e) =>
  String(e || '')
    .trim()
    .toLowerCase();

// ─── Workspace info (cached briefly: checked on every HR request) ───────────
const infoCache = new Map();
const INFO_TTL_MS = 30_000;

async function workspaceInfo(tenantId) {
  const key = String(tenantId);
  const hit = infoCache.get(key);
  if (hit && hit.at > Date.now() - INFO_TTL_MS) return hit.value;
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, company_name, hrms_feature_enabled, ai_feature_enabled,
            COALESCE(NULLIF(default_timezone, ''), 'UTC') AS timezone
       FROM tenants WHERE id = $1`,
    [key],
  );
  const r = rows[0];
  const value = r
    ? {
        id: r.id,
        name: r.company_name || 'Workspace',
        enabled: Boolean(r.hrms_feature_enabled),
        aiEnabled: Boolean(r.ai_feature_enabled),
        timezone: validTimezone(r.timezone) ? r.timezone : 'UTC',
      }
    : null;
  infoCache.set(key, { at: Date.now(), value });
  return value;
}

function forgetWorkspace(tenantId) {
  infoCache.delete(String(tenantId));
}

function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function enabledWorkspaceIds() {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id FROM tenants WHERE hrms_feature_enabled = true ORDER BY created_at`,
  );
  return rows.map((r) => r.id);
}

// ─── Login directory ────────────────────────────────────────────────────────
async function recordUser(email, tenantId) {
  if (!email || !tenantId) return;
  await ensureSchema();
  await pool.query(
    `INSERT INTO hrms_directory (email, tenant_id) VALUES ($1, $2)
     ON CONFLICT (email, tenant_id) DO UPDATE SET updated_at = NOW()`,
    [normEmail(email), tenantId],
  );
}

async function removeUser(email, tenantId) {
  if (!email || !tenantId) return;
  await ensureSchema();
  await pool.query(
    `DELETE FROM hrms_directory WHERE email = $1 AND tenant_id = $2`,
    [normEmail(email), tenantId],
  );
}

/** Workspaces (with the HR module on) where this email has an HR account. */
async function tenantsForEmail(email) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT d.tenant_id AS id, t.company_name AS name
       FROM hrms_directory d JOIN tenants t ON t.id = d.tenant_id
      WHERE d.email = $1 AND t.hrms_feature_enabled = true
      ORDER BY d.updated_at DESC`,
    [normEmail(email)],
  );
  return rows;
}

// ─── Single sign-on codes ───────────────────────────────────────────────────
async function createSsoCode(tenantId, payload) {
  await ensureSchema();
  const code = crypto.randomBytes(24).toString('base64url');
  await pool.query(
    `INSERT INTO hrms_sso_codes (code_hash, tenant_id, payload, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '2 minutes')`,
    [sha256(code), tenantId, payload],
  );
  return code;
}

async function consumeSsoCode(code) {
  if (!code) return null;
  await ensureSchema();
  const { rows } = await pool.query(
    `DELETE FROM hrms_sso_codes WHERE code_hash = $1 RETURNING tenant_id, payload, expires_at`,
    [sha256(code)],
  );
  const r = rows[0];
  if (!r || new Date(r.expires_at) < new Date()) return null;
  return { tenantId: r.tenant_id, ...r.payload };
}

// ─── Revoked access tokens ──────────────────────────────────────────────────
async function revokeToken(token, expUnixSeconds) {
  if (!token) return;
  await ensureSchema();
  const expires = new Date(
    (Number(expUnixSeconds) || Date.now() / 1000 + 86_400) * 1000,
  );
  await pool.query(
    `INSERT INTO hrms_revoked_tokens (token_hash, expires_at) VALUES ($1, $2)
     ON CONFLICT (token_hash) DO NOTHING`,
    [sha256(token), expires],
  );
}

async function isTokenRevoked(token) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT 1 FROM hrms_revoked_tokens WHERE token_hash = $1 AND expires_at > NOW()`,
    [sha256(token)],
  );
  return rows.length > 0;
}

// ─── Device / agent keys ────────────────────────────────────────────────────
const KEY_KINDS = { activity: 'activity', device: 'device' };

async function keyStatus(tenantId) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT activity_key_hint, device_key_hint, updated_at FROM hrms_workspace_keys WHERE tenant_id = $1`,
    [tenantId],
  );
  const r = rows[0] || {};
  return {
    activityKey: r.activity_key_hint || null,
    deviceKey: r.device_key_hint || null,
    updatedAt: r.updated_at || null,
  };
}

/** Creates or replaces a key; the plain value is returned once. */
async function rotateKey(tenantId, kind) {
  if (!KEY_KINDS[kind]) throw new Error('Unknown key type');
  await ensureSchema();
  const prefix = kind === 'activity' ? 'hra' : 'hrd';
  const plain = `${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
  const hint = `${plain.slice(0, 8)}…${plain.slice(-4)}`;
  await pool.query(
    `INSERT INTO hrms_workspace_keys (tenant_id, ${kind}_key_hash, ${kind}_key_hint)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id) DO UPDATE
       SET ${kind}_key_hash = EXCLUDED.${kind}_key_hash,
           ${kind}_key_hint = EXCLUDED.${kind}_key_hint,
           updated_at = NOW()`,
    [tenantId, sha256(plain), hint],
  );
  return plain;
}

async function tenantForKey(kind, key) {
  if (!KEY_KINDS[kind] || !key) return null;
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT k.tenant_id FROM hrms_workspace_keys k
       JOIN tenants t ON t.id = k.tenant_id
      WHERE k.${kind}_key_hash = $1 AND t.hrms_feature_enabled = true`,
    [sha256(key)],
  );
  return rows[0]?.tenant_id || null;
}

/** Lease so only one API instance runs a scheduled job per window. */
async function claimLease(key, ttlMs) {
  await ensureSchema();
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO hrms_locks (key, until) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET until = EXCLUDED.until WHERE hrms_locks.until < $3
     RETURNING key`,
    [key, now + ttlMs, now],
  );
  return rows.length > 0;
}

async function purgeExpired() {
  await ensureSchema();
  await pool.query(`DELETE FROM hrms_sso_codes WHERE expires_at < NOW()`);
  await pool.query(`DELETE FROM hrms_revoked_tokens WHERE expires_at < NOW()`);
}

async function forgetWorkspaceData(tenantId) {
  await ensureSchema();
  await pool.query(`DELETE FROM hrms_directory WHERE tenant_id = $1`, [
    tenantId,
  ]);
  await pool.query(`DELETE FROM hrms_workspace_keys WHERE tenant_id = $1`, [
    tenantId,
  ]);
  forgetWorkspace(tenantId);
  logger.info({ tenantId }, 'hrms_workspace_data_forgotten');
}

module.exports = {
  ensureSchema,
  workspaceInfo,
  forgetWorkspace,
  enabledWorkspaceIds,
  recordUser,
  removeUser,
  tenantsForEmail,
  createSsoCode,
  consumeSsoCode,
  revokeToken,
  isTokenRevoked,
  keyStatus,
  rotateKey,
  tenantForKey,
  purgeExpired,
  claimLease,
  forgetWorkspaceData,
  validTimezone,
  normEmail,
};
