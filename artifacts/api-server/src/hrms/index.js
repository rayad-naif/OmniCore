'use strict';

/**
 * hrms/index.js
 * The HR module (ported from GHL-HRMS) mounted inside OmniCore at /api/hrms.
 *
 *   /api/hrms/v1/...          the HRMS REST API (same paths as the original /api/v1)
 *   /api/hrms/files/:name     signed file downloads (avatars, documents, screenshots)
 *   /api/hrms/sso/start       OmniCore dashboard → HR single sign-on (OmniCore token)
 *   /api/hrms/workspace       HR status/keys for the workspace admin (OmniCore token)
 *   /api/super-admin/hrms     platform console (see admin.routes.js)
 *
 * Every /v1 request runs inside its workspace's context (core/context.js),
 * resolved from: the HR access token, the workspace's activity-agent key
 * (x-api-key), the workspace's device key (?key= on the biometric webhook), or
 * ?w=<workspace> for public job applications. Workspaces whose plan does not
 * include the HR module get 403.
 */

const express = require('express');
const mongoose = require('./core/mongoose');
const tenants = require('./core/tenants');
const tokens = require('./core/tokens');
const storage = require('./core/storage');
const { runAsTenant } = require('./core/context');
const { scopedIo, attach: attachSockets } = require('./core/io');
const { asyncHandler } = require('./utils/errorUtils');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');
const logger = require('./utils/logger');

// Register every schema up front so each workspace database can resolve
// populate() refs between models.
// (Static requires so the esbuild bundle includes them.)
require('./models/ActivityScreenshot.model');
require('./models/Activitylog.model');
require('./models/Advance.model');
require('./models/Attendance.model');
require('./models/AttributionOverride.model');
require('./models/CalendarEvent.model');
require('./models/Earning');
require('./models/Employee.model');
require('./models/Expense');
require('./models/Expensecategory');
require('./models/FinanceSetting');
require('./models/Fixedexpense');
require('./models/Laterequest.model');
require('./models/Leave.model');
require('./models/Loan.model');
require('./models/Notification.model');
require('./models/Payroll.model');
require('./models/Performance.model');
require('./models/PerformanceBonus.model');
require('./models/Permission.model');
require('./models/Person');
require('./models/Recruitment.model');
require('./models/Role.model');
require('./models/Salaryhold.model');
require('./models/ShiftAssignment.model');
require('./models/ShiftType.model');
require('./models/Shiftswaprequest.model');
require('./models/Station.model');
require('./models/UsdRate');
require('./models/User.model');
require('./models/WorkFromHomeRequest.model');
// department.routes.js defines the Department model inline.
require('./routes/department.routes');

const hrms = mongoose.__hrms;

// Keep the login directory in sync with HR accounts.
hrms.onRegister((name, schema) => {
  if (name !== 'User') return;
  const { currentTenantId } = require('./core/context');
  schema.post('save', (doc) => {
    const tid = currentTenantId();
    if (tid && doc?.email) tenants.recordUser(doc.email, tid).catch(() => {});
  });
  schema.post('insertMany', (docs) => {
    const tid = currentTenantId();
    for (const doc of docs || []) {
      if (tid && doc?.email) tenants.recordUser(doc.email, tid).catch(() => {});
    }
  });
  schema.post('findOneAndDelete', (doc) => {
    const tid = currentTenantId();
    if (tid && doc?.email) tenants.removeUser(doc.email, tid).catch(() => {});
  });
});

const ROUTES = [
  ['auth', require('./routes/auth.routes')],
  ['employees', require('./routes/employee.routes')],
  ['attendance', require('./routes/attendance.routes')],
  ['payroll', require('./routes/payroll.routes')],
  ['performance', require('./routes/performance.routes')],
  ['recruitment', require('./routes/recruitment.routes')],
  ['dashboard', require('./routes/dashboard.routes')],
  ['ai', require('./routes/ai.routes')],
  ['notifications', require('./routes/notification.routes')],
  ['reports', require('./routes/report.routes')],
  ['leaves', require('./routes/leave.routes')],
  ['departments', require('./routes/department.routes')],
  ['shift-types', require('./routes/shift-types.routes')],
  ['shift-assignments', require('./routes/shift-assignments.routes')],
  ['roles', require('./routes/role.routes')],
  ['permissions', require('./routes/permission.routes')],
  ['advances', require('./routes/advance.routes')],
  ['expenses', require('./routes/expense.routes')],
  ['earnings', require('./routes/earning.routes')],
  ['finance', require('./routes/finance.routes')],
  ['loans', require('./routes/loan.routes')],
  ['performance-bonuses', require('./routes/performance.bonus.routes')],
  ['expense-categories', require('./routes/Expensecategory.routes')],
  ['stations', require('./routes/Station.routes')],
  ['fixed-expenses', require('./routes/fixedexpense.routes')],
  ['shift-swap-requests', require('./routes/Shiftswaprequest.routes')],
  ['late-requests', require('./routes/late-request.routes')],
  ['work-from-home-requests', require('./routes/work-from-home.routes')],
  ['activity-logs', require('./routes/Activitylog.routes')],
  ['calendar-events', require('./routes/calendar-event.routes')],
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strips Mongo operators ($…) and dotted keys from request bodies. */
function sanitize(value, depth = 0) {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (Buffer.isBuffer(value) || value instanceof Date) return value;
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) delete value[key];
    else value[key] = sanitize(value[key], depth + 1);
  }
  return value;
}

/** Works out which workspace a /v1 request belongs to (or null). */
async function resolveTenant(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const tid = tokens.peekTenant(auth.slice(7));
    if (tid) return tid;
  }
  const p = req.path;
  if (p.startsWith('/v1/activity-logs/') && req.headers['x-api-key']) {
    const tid = await tenants.tenantForKey(
      'activity',
      String(req.headers['x-api-key']),
    );
    if (tid) req.hrmsAuthKind = 'activity';
    return tid;
  }
  if (p === '/v1/attendance/biometric-webhook') {
    const key = req.query.key || req.query.secret;
    const tid = key ? await tenants.tenantForKey('device', String(key)) : null;
    if (tid) req.hrmsAuthKind = 'device';
    return tid;
  }
  if (req.method === 'POST' && p === '/v1/recruitment/applications') {
    const w = String(req.query.w || '');
    if (UUID_RE.test(w)) {
      req.hrmsAuthKind = 'public';
      return w;
    }
  }
  return null;
}

function buildRouter() {
  const router = express.Router();

  // Workspace + platform administration (OmniCore tokens) — see admin.routes.js.
  const admin = require('./admin.routes');
  router.use('/', admin.workspaceRouter);

  router.get('/health', (_req, res) =>
    res.json({ success: true, configured: hrms.isConfigured() }),
  );
  router.get('/files/:name', asyncHandler(storage.serveFile));

  router.use('/v1', (req, res, next) => {
    if (!hrms.isConfigured()) {
      return res.status(503).json({
        success: false,
        code: 'hrms_not_configured',
        message:
          'The HR module is not set up on this server yet (HRMS_MONGODB_URI).',
      });
    }
    sanitize(req.body);
    return next();
  });

  router.use(
    asyncHandler(async (req, res, next) => {
      const tid = await resolveTenant(req);
      if (!tid) return next();
      const ws = await tenants.workspaceInfo(tid);
      if (!ws) {
        return res
          .status(401)
          .json({ success: false, message: 'Unknown workspace.' });
      }
      if (!ws.enabled) {
        return res.status(403).json({
          success: false,
          code: 'hrms_disabled',
          message: "The HR module is not included in this workspace's plan.",
        });
      }
      req.io = scopedIo(tid);
      req.hrmsWorkspace = ws;
      req.auditTenantId = tid;
      return runAsTenant(tid, () => next(), { timezone: ws.timezone });
    }),
  );

  for (const [mount, routes] of ROUTES) {
    router.use(`/v1/${mount}`, routes);
  }

  router.use(notFound);
  router.use(errorHandler);
  return router;
}

let routerInstance = null;
function hrmsRouter() {
  if (!routerInstance) routerInstance = buildRouter();
  return routerInstance;
}

let workersStarted = false;
function startHrmsWorkers({ io } = {}) {
  if (io) attachSockets(io);
  // The plan switch column must exist even when the HR database is not set up.
  tenants
    .ensureSchema()
    .catch((err) => logger.error(`HR schema failed: ${err.message}`));
  if (workersStarted || process.env.HRMS_WORKER === 'false') return;
  if (!hrms.isConfigured()) {
    logger.info('HR module: HRMS_MONGODB_URI not set — HR features stay off');
    return;
  }
  workersStarted = true;
  const { initAttendanceCron } = require('./services/jobs/attendanceCron');
  initAttendanceCron();
  logger.info('HR module workers started');
}

module.exports = { hrmsRouter, startHrmsWorkers, sanitize, resolveTenant };
