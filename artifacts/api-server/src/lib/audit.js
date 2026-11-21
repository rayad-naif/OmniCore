'use strict';

/**
 * audit.js
 * Atelier OmniCore — platform-wide audit trail.
 *
 * Two ways entries are written:
 *   1. auditMiddleware — mounted once in app.ts. Every mutating API request
 *      (POST/PUT/PATCH/DELETE) and every data export is recorded after the
 *      response finishes, with actor, workspace, route, status, IP, user agent,
 *      duration and a redacted copy of the request body.
 *   2. recordAudit(event) — explicit entries for things that are not plain
 *      REST calls: login success/failure, token refresh, billing webhooks,
 *      GoHighLevel/installs, integration deliveries, system jobs.
 *
 * Writes are fire-and-forget: an audit failure is logged but never breaks the
 * request that triggered it.
 *
 * Environment:
 *   AUDIT_LOG_ENABLED         'false' disables writing (default enabled)
 *   AUDIT_LOG_RETENTION_DAYS  rows older than this are purged daily (default 365, 0 = keep forever)
 */

const { pool } = require('./db');
const logger = require('../utils/logger');

// Lazy to avoid a require cycle (auth → db) at module load.
function isSuperAdminAgent(agent) {
  return require('../middleware/auth').isSuperAdminAgent(agent);
}

const REDACT_KEYS =
  /pass(word)?|secret|token|api[_-]?key|authorization|cookie|signature|private|credential|card|cvv|smtp_pass|refresh/i;
const MAX_STRING = 500;
const MAX_DEPTH = 4;

// Routes whose traffic is too high-volume or already recorded explicitly.
const SKIP_PATHS = [
  /^\/api\/healthz/,
  /^\/api\/socket\.io/,
  /^\/api\/widget\/(session|message|messages|conversations\/[^/]+\/read)$/,
  /^\/api\/paddle\/webhook/,
  /^\/api\/stripe\/webhook/,
  /^\/api\/integrations\/ghl\/webhook/,
  /^\/api\/auth\/(login|refresh)$/,
];

// Read-only routes that still matter for compliance (bulk data leaving the app).
const AUDITED_READS = [
  /\/export$/,
  /^\/api\/contacts\/export/,
  /^\/api\/audit-logs\/export/,
  /^\/api\/super-admin\/audit-logs\/export/,
];

let schemaReady = null;

function ensureAuditSchema() {
  if (!schemaReady) {
    schemaReady = pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id              BIGSERIAL PRIMARY KEY,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id       UUID,
        actor_type      TEXT NOT NULL DEFAULT 'agent',
        actor_id        TEXT,
        actor_email     TEXT,
        actor_name      TEXT,
        on_behalf_of    BOOLEAN NOT NULL DEFAULT FALSE,
        action          TEXT NOT NULL,
        category        TEXT,
        resource_type   TEXT,
        resource_id     TEXT,
        outcome         TEXT NOT NULL DEFAULT 'success',
        method          TEXT,
        path            TEXT,
        status_code     INTEGER,
        duration_ms     INTEGER,
        ip              TEXT,
        user_agent      TEXT,
        request_id      TEXT,
        summary         TEXT,
        metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs (tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_time        ON audit_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_action      ON audit_logs (action);
      CREATE INDEX IF NOT EXISTS idx_audit_actor       ON audit_logs (actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_resource    ON audit_logs (resource_type, resource_id);
    `,
      )
      .catch((err) => {
        schemaReady = null; // retry on next write
        logger.warn({ err: err.message }, 'audit_schema_failed');
      });
  }
  return schemaReady;
}

function enabled() {
  return (process.env.AUDIT_LOG_ENABLED || 'true').toLowerCase() !== 'false';
}

/** Deep-copies a value with secrets replaced and long strings/arrays trimmed. */
function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…[${value.length} chars]`
      : value;
  }
  if (typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return `[binary ${value.length} bytes]`;
  if (depth >= MAX_DEPTH) return '[nested]';
  if (Array.isArray(value)) {
    const out = value.slice(0, 20).map((v) => redact(v, depth + 1));
    if (value.length > 20) out.push(`…[${value.length - 20} more]`);
    return out;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (REDACT_KEYS.test(k)) out[k] = '[redacted]';
    else if (/^(data|file|base64)$/i.test(k) && typeof v === 'string')
      out[k] = `[file ${v.length} chars]`;
    else out[k] = redact(v, depth + 1);
  }
  return out;
}

function clientIp(req) {
  // With `trust proxy` configured (see app.ts), req.ip is the real client IP
  // behind nginx / Cloudflare / Render. CF-Connecting-IP is only a fallback.
  return (
    req.ip ||
    req.headers['cf-connecting-ip'] ||
    req.socket?.remoteAddress ||
    null
  );
}

const VERBS = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
  GET: 'export',
};

/**
 * Turns "/api/conversations/:id/messages" + POST into
 * { action: "conversations.messages.create", resourceType: "conversation" }.
 */
function describeRoute(method, template) {
  const parts = template
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean)
    // Unmatched routes (rejected before routing) carry raw ids: normalise them.
    .map((p) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        p,
      ) ||
      /^\d+$/.test(p) ||
      /^[A-Za-z0-9_-]{20,}$/.test(p)
        ? ':id'
        : p,
    );
  const named = parts.filter((p) => !p.startsWith(':'));
  const head =
    named[0] === 'v1' || named[0] === 'super-admin' ? named[1] : named[0];
  const resourceType = (head || 'api').replace(/-/g, '_').replace(/s$/, '');
  const verb = VERBS[method] || method.toLowerCase();
  const last = named[named.length - 1];
  const action =
    last &&
    /^(export|bulk-export|test|sync|refresh|purge|provision)$/.test(last)
      ? named.join('.').replace(/-/g, '_')
      : [...named, verb].join('.').replace(/-/g, '_');
  return { action, resourceType };
}

async function insert(entry) {
  await ensureAuditSchema();
  await pool.query(
    `INSERT INTO audit_logs
       (tenant_id, actor_type, actor_id, actor_email, actor_name, on_behalf_of,
        action, category, resource_type, resource_id, outcome, method, path,
        status_code, duration_ms, ip, user_agent, request_id, summary, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      entry.tenantId || null,
      entry.actorType || 'system',
      entry.actorId ? String(entry.actorId) : null,
      entry.actorEmail || null,
      entry.actorName || null,
      Boolean(entry.onBehalfOf),
      entry.action,
      entry.category || entry.action.split('.')[0],
      entry.resourceType || null,
      entry.resourceId ? String(entry.resourceId) : null,
      entry.outcome || 'success',
      entry.method || null,
      entry.path || null,
      entry.statusCode ?? null,
      entry.durationMs ?? null,
      entry.ip || null,
      entry.userAgent ? String(entry.userAgent).slice(0, 300) : null,
      entry.requestId ? String(entry.requestId) : null,
      entry.summary || null,
      JSON.stringify(redact(entry.metadata || {})),
    ],
  );
}

/**
 * Records one explicit audit event. Never throws.
 * @param {object} e  { action, tenantId, actorType, actorId, actorEmail, actorName,
 *                      resourceType, resourceId, outcome, summary, metadata, req }
 */
function recordAudit(e) {
  if (!enabled() || !e?.action) return Promise.resolve();
  const req = e.req;
  const entry = {
    ...e,
    ip: e.ip || (req ? clientIp(req) : null),
    userAgent: e.userAgent || req?.headers?.['user-agent'],
    requestId: e.requestId || req?.id,
    method: e.method || req?.method,
    path: e.path || req?.originalUrl?.split('?')[0],
  };
  if (req?.agent && !entry.actorId) {
    entry.actorType = entry.actorType || 'agent';
    entry.actorId = req.agent.id;
    entry.actorEmail = req.agent.email;
    entry.actorName = req.agent.name;
    entry.tenantId = entry.tenantId || req.agent.tenantId;
  }
  return insert(entry).catch((err) =>
    logger.warn({ err: err.message, action: e.action }, 'audit_write_failed'),
  );
}

/** Express middleware: records mutating requests and exports after they finish. */
function auditMiddleware(req, res, next) {
  if (!enabled()) return next();
  const path = req.originalUrl.split('?')[0];
  if (!path.startsWith('/api/')) return next();
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const isAuditedRead =
    req.method === 'GET' && AUDITED_READS.some((re) => re.test(path));
  if ((!isWrite && !isAuditedRead) || SKIP_PATHS.some((re) => re.test(path)))
    return next();

  const started = process.hrtime.bigint();
  // Capture the body now: some handlers mutate req.body.
  const bodySnapshot = isWrite ? redact(req.body || {}) : undefined;

  res.on('finish', async () => {
    const template = `${req.baseUrl || ''}${req.route?.path || ''}` || path;
    const { action, resourceType } = describeRoute(
      req.method,
      req.route ? template : path,
    );
    const params = req.params || {};
    const resourceId =
      params.id ||
      params.brandId ||
      params.visitorId ||
      params.msgId ||
      params.tenantId ||
      Object.values(params)[0] ||
      null;
    const status = res.statusCode;
    const agent = req.agent;
    const apiKey = req.apiKey;
    let superAdmin = Boolean(agent?.workspaceOverride);
    if (agent && !superAdmin && path.startsWith('/api/super-admin')) {
      superAdmin = await isSuperAdminAgent(agent).catch(() => false);
    }

    insert({
      tenantId:
        agent?.tenantId || apiKey?.tenantId || req.auditTenantId || null,
      actorType: agent
        ? superAdmin
          ? 'super_admin'
          : 'agent'
        : apiKey
          ? 'api_key'
          : path.startsWith('/api/widget')
            ? 'visitor'
            : 'anonymous',
      actorId: agent?.id || apiKey?.id || null,
      actorEmail: agent?.email || null,
      actorName: agent?.name || apiKey?.name || null,
      onBehalfOf: Boolean(agent?.workspaceOverride),
      action,
      resourceType,
      resourceId,
      outcome:
        status >= 400
          ? status === 401 || status === 403
            ? 'denied'
            : 'failure'
          : 'success',
      method: req.method,
      path,
      statusCode: status,
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
      requestId: req.id,
      metadata: {
        ...(bodySnapshot && Object.keys(bodySnapshot).length
          ? { body: bodySnapshot }
          : {}),
        ...(Object.keys(params).length ? { params } : {}),
        ...(req.auditExtra || {}),
      },
    }).catch((err) =>
      logger.warn({ err: err.message, path }, 'audit_write_failed'),
    );
  });
  next();
}

const FILTERS = {
  tenantId: (v, p) => `tenant_id = $${p}`,
  actor: (v, p) =>
    `(actor_email ILIKE $${p} OR actor_name ILIKE $${p} OR actor_id = $${p})`,
  action: (v, p) => `action ILIKE $${p}`,
  category: (v, p) => `category = $${p}`,
  resourceType: (v, p) => `resource_type = $${p}`,
  resourceId: (v, p) => `resource_id = $${p}`,
  outcome: (v, p) => `outcome = $${p}`,
  actorType: (v, p) => `actor_type = $${p}`,
  ip: (v, p) => `ip = $${p}`,
  from: (v, p) => `created_at >= $${p}`,
  to: (v, p) => `created_at <= $${p}`,
  q: (v, p) =>
    `(action ILIKE $${p} OR path ILIKE $${p} OR summary ILIKE $${p} OR actor_email ILIKE $${p} OR metadata::text ILIKE $${p})`,
};
const LIKE = new Set(['actor', 'action', 'q']);

/** Builds a filtered query over audit_logs. `scope.tenantId` is always enforced when set. */
function buildQuery(filters = {}, scope = {}) {
  const where = [];
  const params = [];
  const all = { ...filters };
  if (scope.tenantId) all.tenantId = scope.tenantId;
  for (const [key, fn] of Object.entries(FILTERS)) {
    const v = all[key];
    if (v === undefined || v === null || v === '') continue;
    params.push(LIKE.has(key) ? `%${v}%` : v);
    where.push(fn(v, params.length));
  }
  return {
    where: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

async function listAuditLogs(filters = {}, scope = {}) {
  await ensureAuditSchema();
  const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 50, 1), 500);
  const page = Math.max(parseInt(filters.page, 10) || 1, 1);
  const { where, params } = buildQuery(filters, scope);
  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT a.*, t.company_name AS tenant_name
         FROM (SELECT * FROM audit_logs ${where}
                ORDER BY created_at DESC, id DESC
                LIMIT ${limit} OFFSET ${(page - 1) * limit}) a
         LEFT JOIN tenants t ON t.id = a.tenant_id
        ORDER BY a.created_at DESC, a.id DESC`,
      params,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM audit_logs ${where}`,
      params,
    ),
  ]);
  return { logs: rows, total: countRows[0].total, page, limit };
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportAuditCsv(filters = {}, scope = {}, maxRows = 50000) {
  await ensureAuditSchema();
  const { where, params } = buildQuery(filters, scope);
  const { rows } = await pool.query(
    `SELECT created_at, tenant_id, actor_type, actor_email, actor_name, on_behalf_of,
            action, category, resource_type, resource_id, outcome, method, path,
            status_code, duration_ms, ip, user_agent, summary, metadata
       FROM audit_logs ${where}
      ORDER BY created_at DESC LIMIT ${maxRows}`,
    params,
  );
  const cols = rows.length
    ? Object.keys(rows[0])
    : ['created_at', 'action', 'actor_email', 'outcome'];
  return [
    cols.join(','),
    ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')),
  ].join('\n');
}

async function purgeExpired() {
  const days = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '365', 10);
  if (!days || days <= 0) return 0;
  await ensureAuditSchema();
  const { rowCount } = await pool.query(
    `DELETE FROM audit_logs WHERE created_at < NOW() - ($1 || ' days')::interval`,
    [String(days)],
  );
  if (rowCount) logger.info({ rowCount, days }, 'audit_logs_purged');
  return rowCount;
}

function startRetentionJob() {
  const run = () =>
    purgeExpired().catch((err) =>
      logger.warn({ err: err.message }, 'audit_purge_failed'),
    );
  setTimeout(run, 60_000).unref?.();
  setInterval(run, 24 * 60 * 60 * 1000).unref?.();
}

module.exports = {
  ensureAuditSchema,
  auditMiddleware,
  recordAudit,
  listAuditLogs,
  exportAuditCsv,
  purgeExpired,
  startRetentionJob,
  redact,
  describeRoute,
  buildQuery,
};
