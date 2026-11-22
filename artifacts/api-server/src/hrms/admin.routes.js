'use strict';

/**
 * hrms/admin.routes.js
 * OmniCore-side management of the HR module (OmniCore dashboard tokens).
 *
 * workspaceRouter (mounted inside /api/hrms):
 *   POST /sso/start                    one-time sign-in link into the HR app
 *   GET  /workspace                    HR status, links and key hints (admins)
 *   POST /workspace/keys/:kind/rotate  new activity-agent / device key (admins)
 *
 * superAdminRouter (mounted at /api/super-admin/hrms):
 *   GET    /                           server status + every workspace's HR usage
 *   PATCH  /workspaces/:id             { enabled } turn HR on/off for one workspace
 *   POST   /workspaces/:id/open        support sign-in into that workspace's HR app
 *   DELETE /workspaces/:id/data        { confirm: <workspace name> } erase HR data
 *   POST   /sweep                      run the attendance sweep now
 */

const express = require('express');
const {
  requireAuth,
  applyWorkspaceOverride,
  isSuperAdminAgent,
} = require('../middleware/auth');
const { pool } = require('../lib/db');
const { recordAudit } = require('../lib/audit');
const tenants = require('./core/tenants');
const mongoose = require('./core/mongoose');
const storage = require('./core/storage');
const { runAsTenant } = require('./core/context');
const { hrmsAppUrl } = require('./core/config');

const hrms = mongoose.__hrms;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function publicUrl(pathname) {
  const base = String(process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '');
  return `${base}${pathname}`;
}

async function countUsers(tenantId) {
  const User = require('./models/User.model');
  return runAsTenant(tenantId, () =>
    User.countDocuments({ deletedAt: null, isActive: true }),
  );
}

/** Sign-in code for an OmniCore user into a workspace's HR app. */
async function startSso(agent, tenantId, { support = false } = {}) {
  let provisionRole = null;
  if (support) provisionRole = 'admin';
  else if (agent.agencyOverride) provisionRole = 'admin';
  else if (agent.role === 'admin') provisionRole = 'super_admin';
  const code = await tenants.createSsoCode(tenantId, {
    email: agent.email,
    name: agent.name || null,
    omnicoreUserId: agent.id,
    provisionRole,
    support,
  });
  return `/hrms/sso?code=${encodeURIComponent(code)}`;
}

// ─── Workspace (OmniCore admins and members) ─────────────────────────────────
const workspaceRouter = express.Router();

workspaceRouter.post(
  '/sso/start',
  requireAuth,
  applyWorkspaceOverride,
  wrap(async (req, res) => {
    if (!hrms.isConfigured()) {
      return res.status(503).json({
        error: 'The HR module is not set up on this server yet (HRMS_MONGODB_URI).',
      });
    }
    const tenantId = req.agent.tenantId;
    const ws = await tenants.workspaceInfo(tenantId);
    if (!ws?.enabled) {
      return res.status(403).json({
        error: "The HR module is not included in this workspace's plan.",
        code: 'hrms_disabled',
      });
    }
    const support =
      Boolean(req.agent.workspaceOverride) && !req.agent.agencyOverride;
    const url = await startSso(req.agent, tenantId, { support });
    return res.json({ url });
  }),
);

workspaceRouter.get(
  '/workspace',
  requireAuth,
  applyWorkspaceOverride,
  wrap(async (req, res) => {
    const tenantId = req.agent.tenantId;
    const ws = await tenants.workspaceInfo(tenantId);
    const configured = hrms.isConfigured();
    const isAdmin = req.agent.role === 'admin' || req.agent.workspaceOverride;
    const result = {
      configured,
      enabled: Boolean(ws?.enabled),
      timezone: ws?.timezone || 'UTC',
      appUrl: hrmsAppUrl(),
    };
    if (configured && ws?.enabled) {
      result.employees = await countUsers(tenantId).catch(() => null);
    }
    if (isAdmin && ws?.enabled) {
      const keys = await tenants.keyStatus(tenantId);
      result.links = {
        employeeLogin: `${hrmsAppUrl()}/login?w=${tenantId}`,
        jobApplications: publicUrl(`/api/hrms/v1/recruitment/applications?w=${tenantId}`),
        biometricWebhook: publicUrl('/api/hrms/v1/attendance/biometric-webhook?key=<device key>'),
        activityAgent: publicUrl('/api/hrms/v1/activity-logs/ingest'),
      };
      result.keys = keys;
    }
    return res.json(result);
  }),
);

workspaceRouter.post(
  '/workspace/keys/:kind/rotate',
  requireAuth,
  applyWorkspaceOverride,
  wrap(async (req, res) => {
    if (!(req.agent.role === 'admin' || req.agent.workspaceOverride)) {
      return res.status(403).json({ error: 'Only workspace admins can manage HR keys.' });
    }
    const kind = req.params.kind;
    if (!['activity', 'device'].includes(kind)) {
      return res.status(400).json({ error: 'kind must be activity or device' });
    }
    const ws = await tenants.workspaceInfo(req.agent.tenantId);
    if (!ws?.enabled) {
      return res.status(403).json({ error: "The HR module is not included in this workspace's plan." });
    }
    const key = await tenants.rotateKey(req.agent.tenantId, kind);
    return res.json({ kind, key, note: 'Copy this key now: it is not shown again.' });
  }),
);

// ─── Platform super admin ────────────────────────────────────────────────────
const superAdminRouter = express.Router();
superAdminRouter.use(
  requireAuth,
  wrap(async (req, res, next) => {
    if (await isSuperAdminAgent(req.agent)) return next();
    return res.status(403).json({ error: 'Forbidden — super admin only' });
  }),
);

superAdminRouter.get(
  '/',
  wrap(async (_req, res) => {
    await tenants.ensureSchema();
    const configured = hrms.isConfigured();
    let database = { configured, ok: false };
    if (configured) {
      try {
        await hrms.ping();
        database = { configured, ok: true };
      } catch (err) {
        database = { configured, ok: false, error: err.message };
      }
    }
    const { rows } = await pool.query(
      `SELECT t.id, t.company_name AS name, t.plan, t.hrms_feature_enabled AS enabled,
              (SELECT COUNT(*)::int FROM hrms_directory d WHERE d.tenant_id = t.id) AS directory_users
         FROM tenants t
        WHERE t.hrms_feature_enabled = true
           OR EXISTS (SELECT 1 FROM hrms_directory d WHERE d.tenant_id = t.id)
        ORDER BY t.company_name
        LIMIT 500`,
    );
    const workspaces = [];
    for (const r of rows) {
      const item = { ...r, users: null, storage: null };
      if (database.ok) {
        item.users = await countUsers(r.id).catch(() => null);
        item.storage = await hrms.tenantDatabaseStats(r.id).catch(() => null);
      }
      workspaces.push(item);
    }
    return res.json({
      database,
      fileStorage: storage.useR2() ? 'r2' : 'local-disk',
      workspaces,
    });
  }),
);

superAdminRouter.patch(
  '/workspaces/:id',
  wrap(async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid workspace id' });
    await tenants.ensureSchema();
    const enabled = Boolean(req.body?.enabled);
    const { rowCount } = await pool.query(
      `UPDATE tenants SET hrms_feature_enabled = $2, updated_at = NOW() WHERE id = $1`,
      [id, enabled],
    );
    if (!rowCount) return res.status(404).json({ error: 'Workspace not found' });
    tenants.forgetWorkspace(id);
    return res.json({ id, enabled });
  }),
);

superAdminRouter.post(
  '/workspaces/:id/open',
  wrap(async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid workspace id' });
    if (!hrms.isConfigured()) {
      return res.status(503).json({ error: 'HRMS_MONGODB_URI is not set' });
    }
    const ws = await tenants.workspaceInfo(id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (!ws.enabled) {
      return res.status(409).json({ error: 'Turn the HR module on for this workspace first.' });
    }
    const url = await startSso(req.agent, id, { support: true });
    recordAudit({
      tenantId: id,
      actorType: 'super_admin',
      actorId: req.agent.id,
      actorEmail: req.agent.email,
      actorName: req.agent.name,
      onBehalfOf: true,
      action: 'hrms.support_sign_in',
      resourceType: 'hrms',
      resourceId: id,
      outcome: 'success',
      method: req.method,
      path: req.originalUrl,
      statusCode: 200,
    });
    return res.json({ url });
  }),
);

superAdminRouter.delete(
  '/workspaces/:id/data',
  wrap(async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid workspace id' });
    const { rows } = await pool.query(
      `SELECT company_name FROM tenants WHERE id = $1`,
      [id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Workspace not found' });
    if (String(req.body?.confirm || '') !== rows[0].company_name) {
      return res.status(400).json({
        error: 'Type the workspace name exactly to confirm deleting its HR data.',
      });
    }
    if (hrms.isConfigured()) await hrms.dropTenantDatabase(id);
    const filesRemoved = await storage.removeWorkspace(id);
    await tenants.forgetWorkspaceData(id);
    return res.json({
      id,
      deleted: true,
      filesRemoved,
      note: filesRemoved
        ? undefined
        : `Files in R2 under hrms/${id}/ were not deleted automatically.`,
    });
  }),
);

superAdminRouter.post(
  '/sweep',
  wrap(async (_req, res) => {
    if (!hrms.isConfigured()) {
      return res.status(503).json({ error: 'HRMS_MONGODB_URI is not set' });
    }
    const { sweepAllWorkspaces } = require('./services/jobs/attendanceCron');
    return res.json(await sweepAllWorkspaces());
  }),
);

module.exports = { workspaceRouter, superAdminRouter, startSso };
