import { Router, type IRouter } from 'express';
import healthRouter from './health';

/**
 * CJS controller/router imports.
 * esbuild handles CJS↔ESM interop at bundle time via the banner's
 * globalThis.require shim.  TypeScript's require() is available because
 * "types": ["node"] is set in tsconfig.json.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const authRouter: IRouter = require('../controllers/auth.controller');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const signupRouter: IRouter = require('../controllers/signup.controller');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tenantRouter: IRouter = require('../controllers/tenant.controller');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const conversationsRouter: IRouter = require('../controllers/conversations.controller');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const aiRouter: IRouter = require('../routes/ai.router');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const billingRouter: IRouter = require('../routes/billing.router');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const widgetRouter: IRouter = require('../controllers/widget.controller');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const agentsRouter: IRouter = require('../controllers/agents.controller');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const superAdminRouter: IRouter = require('../controllers/super-admin.controller');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const contactsRouter: IRouter = require('../controllers/contacts.controller');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cannedResponsesRouter: IRouter = require('../controllers/canned-responses.controller');

// Email webhook — exposes `router` and `setIo` to allow socket injection
// eslint-disable-next-line @typescript-eslint/no-require-imports
const emailWebhook: {
  router: IRouter;
  setIo: (io: unknown) => void;
} = require('../controllers/email.webhook.controller');

const auditRoutes: {
  workspaceRouter: IRouter;
  platformRouter: IRouter;
} = require('../controllers/audit.controller');

const integrations: {
  router: IRouter;
  publicRouter: IRouter;
} = require('../controllers/integrations.controller');

const publicApiRouter: IRouter = require('./publicApi');

const agencyRoutes: {
  router: IRouter;
  publicRouter: IRouter;
  adminRouter: IRouter;
} = require('../controllers/agency.controller');

const copilotRouter: IRouter = require('../controllers/copilot.controller');

const router: IRouter = Router();

// ── Health (unauthenticated) ──────────────────────────────────────────────────
router.use(healthRouter);

// ── Auth (no token required) ─────────────────────────────────────────────────
router.use('/auth', authRouter);

// ── Signup (unauthenticated, public) ─────────────────────────────────────────
router.use('/auth/signup', signupRouter);

// ── Widget — unauthenticated, CORS * (embedded on customer sites) ─────────────
router.use('/widget', widgetRouter);

// ── Core domain routes (requireAuth enforced inside each sub-router) ──────────
router.use('/tenants', tenantRouter);
router.use('/conversations', conversationsRouter);
router.use('/ai', aiRouter);
router.use('/agents', agentsRouter);
// Integrations: public OAuth callback first (no session), then the authenticated API.
router.use('/integrations', integrations.publicRouter);
router.use('/integrations', integrations.router);

// Public REST API v1 (workspace API keys)
router.use('/v1', publicApiRouter);

// White-label branding (public), agency console, AI copilot
router.use('/', agencyRoutes.publicRouter);
router.use('/agency', agencyRoutes.router);
router.use('/copilot', copilotRouter);

router.use('/audit-logs', auditRoutes.workspaceRouter);
// Must precede the general super-admin router so its guard handles these paths.
router.use('/super-admin/audit-logs', auditRoutes.platformRouter);
router.use('/super-admin/agencies', agencyRoutes.adminRouter);
router.use('/super-admin', superAdminRouter);
router.use('/contacts', contactsRouter);
router.use('/canned-responses', cannedResponsesRouter);

// ── Billing + checkout + LS webhook (mounted at /api level) ──────────────────
// billing.router.js handles: /checkout, /billing/*, /webhooks/lemonsqueezy
router.use('/', billingRouter);

// ── Inbound email webhook ─────────────────────────────────────────────────────
router.use('/webhooks', emailWebhook.router);

export { emailWebhook };
export default router;
