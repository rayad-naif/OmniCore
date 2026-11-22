'use strict';

/**
 * audit.controller.js
 * Atelier OmniCore — Audit log API
 *
 * Workspace scope (admins of the caller's own workspace):
 *   GET /api/audit-logs                 paginated, filterable list
 *   GET /api/audit-logs/export          CSV export (same filters)
 *   GET /api/audit-logs/facets          distinct actions / categories for filter dropdowns
 *
 * Platform scope (super admins, all workspaces):
 *   GET /api/super-admin/audit-logs          (+ ?tenantId=)
 *   GET /api/super-admin/audit-logs/export
 *   GET /api/super-admin/audit-logs/facets
 *
 * Filters (query string): from, to (ISO dates), actor, actorType, action,
 * category, resourceType, resourceId, outcome, ip, q, page, limit (≤500).
 */

const express = require('express');
const { pool } = require('../lib/db');
const {
  requireAuth,
  requireRole,
  isSuperAdminAgent,
} = require('../middleware/auth');
const {
  listAuditLogs,
  exportAuditCsv,
  ensureAuditSchema,
} = require('../lib/audit');

const FILTER_KEYS = [
  'from',
  'to',
  'actor',
  'actorType',
  'action',
  'category',
  'resourceType',
  'resourceId',
  'outcome',
  'ip',
  'q',
  'page',
  'limit',
];

function pickFilters(query) {
  const out = {};
  for (const k of FILTER_KEYS) {
    if (typeof query[k] === 'string' && query[k].trim())
      out[k] = query[k].trim();
  }
  return out;
}

async function facets(scopeTenantId) {
  await ensureAuditSchema();
  const where = scopeTenantId ? 'WHERE tenant_id = $1' : '';
  const params = scopeTenantId ? [scopeTenantId] : [];
  const [actions, categories] = await Promise.all([
    pool.query(
      `SELECT action, COUNT(*)::int AS count FROM audit_logs ${where}
        GROUP BY action ORDER BY count DESC LIMIT 200`,
      params,
    ),
    pool.query(
      `SELECT category, COUNT(*)::int AS count FROM audit_logs ${where}
        GROUP BY category ORDER BY count DESC`,
      params,
    ),
  ]);
  return { actions: actions.rows, categories: categories.rows };
}

function sendCsv(res, csv, name) {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${name}-${stamp}.csv"`,
  );
  res.send(csv);
}

// ── Workspace scope ──────────────────────────────────────────────────────────
const workspaceRouter = express.Router();
workspaceRouter.use(requireAuth, requireRole('admin'));

workspaceRouter.get('/', async (req, res, next) => {
  try {
    res.json(
      await listAuditLogs(pickFilters(req.query), {
        tenantId: req.agent.tenantId,
      }),
    );
  } catch (err) {
    next(err);
  }
});

workspaceRouter.get('/facets', async (req, res, next) => {
  try {
    res.json(await facets(req.agent.tenantId));
  } catch (err) {
    next(err);
  }
});

workspaceRouter.get('/export', async (req, res, next) => {
  try {
    const csv = await exportAuditCsv(pickFilters(req.query), {
      tenantId: req.agent.tenantId,
    });
    sendCsv(res, csv, 'audit-log');
  } catch (err) {
    next(err);
  }
});

// ── Platform scope ───────────────────────────────────────────────────────────
const platformRouter = express.Router();
platformRouter.use(requireAuth, async (req, res, next) => {
  try {
    if (await isSuperAdminAgent(req.agent)) return next();
    return res.status(403).json({ error: 'Super admin access required' });
  } catch (err) {
    return next(err);
  }
});

platformRouter.get('/', async (req, res, next) => {
  try {
    const filters = pickFilters(req.query);
    if (typeof req.query.tenantId === 'string' && req.query.tenantId) {
      filters.tenantId = req.query.tenantId;
    }
    res.json(await listAuditLogs(filters));
  } catch (err) {
    next(err);
  }
});

platformRouter.get('/facets', async (req, res, next) => {
  try {
    const tid =
      typeof req.query.tenantId === 'string' ? req.query.tenantId : null;
    res.json(await facets(tid || null));
  } catch (err) {
    next(err);
  }
});

platformRouter.get('/export', async (req, res, next) => {
  try {
    const filters = pickFilters(req.query);
    if (typeof req.query.tenantId === 'string' && req.query.tenantId) {
      filters.tenantId = req.query.tenantId;
    }
    sendCsv(res, await exportAuditCsv(filters), 'platform-audit-log');
  } catch (err) {
    next(err);
  }
});

module.exports = { workspaceRouter, platformRouter };
