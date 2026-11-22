'use strict';

/**
 * agency.controller.js
 * Atelier OmniCore — Agency (reseller / white-label) API.
 *
 * Public
 *   GET  /api/branding                       branding for the request's Host (login page, dashboard shell)
 *
 * Agency members (mounted at /api/agency, requires agency membership)
 *   GET    /                                  agency, branding, domains, counts, my role
 *   PATCH  /                                  { name?, branding? }
 *   GET    /workspaces                        client workspaces
 *   POST   /workspaces                        { company_name, admin_name, admin_email, plan? } → invite sent
 *   PATCH  /workspaces/:id                    { account_status?, plan?, max_agents_allowed?, max_brands_allowed?, conversation_limit? }
 *   GET    /domains                           with DNS instructions
 *   POST   /domains                           { hostname }
 *   POST   /domains/:id/verify
 *   POST   /domains/:id/primary
 *   DELETE /domains/:id
 *   GET    /members                           agency staff
 *   POST   /members                           { email } — must be a user of the agency's home workspace
 *   DELETE /members/:agentId
 *   GET    /ai                                own AI provider (key masked)
 *   PUT    /ai                                { provider: gemini|openai|anthropic, model?, apiKey? }
 *   DELETE /ai                                fall back to the platform AI
 *
 * Super admin (mounted at /api/super-admin/agencies)
 *   GET    /                                  all agencies
 *   POST   /                                  { name, owner_email, home_tenant_id? } — makes a workspace an agency
 *   PATCH  /:id                               { status?, max_workspaces?, name? }
 */

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../lib/db');
const { requireAuth, isSuperAdminAgent } = require('../middleware/auth');
const agencies = require('../lib/agencies');
const { sealJson, openJson, mask } = require('../lib/secretBox');
const { publicAppUrl } = require('../lib/env');
const { sendAgentInviteEmail } = require('../services/email.service');

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const STATUSES = ['active', 'suspended'];
const AI_PROVIDERS = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-opus-5-5',
};

// ── Public branding ──────────────────────────────────────────────────────────
const publicRouter = express.Router();
publicRouter.get(
  '/branding',
  wrap(async (req, res) => {
    const host = String(
      req.query.host || req.headers['x-forwarded-host'] || req.hostname || '',
    );
    const b = await agencies.brandingForHost(host);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(b);
  }),
);

// Branding for the signed-in user's workspace (agency clients on the platform
// domain still see their agency's brand once signed in).
publicRouter.get(
  '/branding/me',
  requireAuth,
  wrap(async (req, res) => {
    const { branding, agencyId } = await agencies.brandingForTenant(
      req.agent.tenantId,
    );
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({ ...branding, agencyId });
  }),
);

// ── Agency members ───────────────────────────────────────────────────────────
const router = express.Router();
router.use(
  requireAuth,
  wrap(async (req, res, next) => {
    await agencies.ensureAgencySchema();
    const m = await agencies.membershipFor(req.agent.id);
    if (!m)
      return res
        .status(403)
        .json({ error: 'You are not a member of an agency' });
    req.agency = m;
    req.auditExtra = { agencyId: m.id };
    next();
  }),
);
const ownerOnly = (req, res, next) =>
  req.agency.role === 'owner' || req.agency.role === 'admin'
    ? next()
    : res.status(403).json({ error: 'Agency admin role required' });

router.get(
  '/',
  wrap(async (req, res) => {
    const a = req.agency;
    const [ws, dom] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS n FROM tenants WHERE agency_id = $1`,
        [a.id],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM agency_domains WHERE agency_id = $1 AND status = 'active'`,
        [a.id],
      ),
    ]);
    res.json({
      id: a.id,
      name: a.name,
      slug: a.slug,
      role: a.role,
      status: a.status,
      home_tenant_id: a.home_tenant_id,
      max_workspaces: a.max_workspaces,
      branding: agencies.mergeBranding(a.branding),
      workspaces: ws.rows[0].n,
      active_domains: dom.rows[0].n,
      platform_host: agencies.platformHost(),
    });
  }),
);

router.patch(
  '/',
  ownerOnly,
  wrap(async (req, res) => {
    const { name, branding } = req.body || {};
    const patch = branding ? agencies.cleanBranding(branding) : {};
    const { rows } = await pool.query(
      `UPDATE agencies SET name = COALESCE($2, name), branding = branding || $3::jsonb, updated_at = NOW()
        WHERE id = $1 RETURNING id, name, branding`,
      [
        req.agency.id,
        name ? String(name).slice(0, 120) : null,
        JSON.stringify(patch),
      ],
    );
    agencies.clearHostCache();
    res.json({
      ...rows[0],
      branding: agencies.mergeBranding(rows[0].branding),
    });
  }),
);

// Workspaces
router.get(
  '/workspaces',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT t.id, t.company_name, t.plan, t.account_status, t.subscription_status, t.max_agents_allowed,
              t.max_brands_allowed, t.conversation_limit, t.created_at,
              (SELECT COUNT(*)::int FROM agents a WHERE a.tenant_id = t.id) AS agents,
              (SELECT COUNT(*)::int FROM conversations c WHERE c.tenant_id = t.id
                 AND c.created_at > date_trunc('month', NOW())) AS conversations_this_month
         FROM tenants t WHERE t.agency_id = $1 ORDER BY t.created_at DESC`,
      [req.agency.id],
    );
    res.json(rows);
  }),
);

async function applyPlan(client, tenantId, plan) {
  const plansRepo = require('../lib/plansRepo');
  let row = null;
  try {
    row =
      (await plansRepo.getPlanBySlug(plan)) ||
      (await plansRepo.getPlanBySlug('free'));
  } catch {
    row = null;
  }
  if (!row) return;
  await client.query(
    `UPDATE tenants SET plan = $2, max_brands_allowed = $3, max_agents_allowed = $4, conversation_limit = $5,
       ai_feature_enabled = $6, smtp_feature_enabled = $7, hrms_feature_enabled = $8,
       payments_feature_enabled = $9, updated_at = NOW() WHERE id = $1`,
    [
      tenantId,
      row.slug || plan,
      row.limits?.max_brands_allowed ?? null,
      row.limits?.max_agents_allowed ?? null,
      row.limits?.conversation_limit ?? null,
      Boolean(row.features?.ai_feature_enabled),
      Boolean(row.features?.smtp_feature_enabled),
      Boolean(row.features?.hrms_feature_enabled),
      Boolean(row.features?.payments_feature_enabled),
    ],
  );
}

router.post(
  '/workspaces',
  ownerOnly,
  wrap(async (req, res) => {
    const {
      company_name,
      admin_name,
      admin_email,
      plan = 'starter',
    } = req.body || {};
    if (!company_name?.trim() || !admin_email?.trim()) {
      return res
        .status(400)
        .json({ error: 'company_name and admin_email are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin_email))
      return res.status(400).json({ error: 'admin_email is not valid' });
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tenants WHERE agency_id = $1`,
      [req.agency.id],
    );
    if (cnt[0].n >= req.agency.max_workspaces) {
      return res.status(403).json({
        error: `Your agency can have up to ${req.agency.max_workspaces} workspaces. Contact the platform to raise the limit.`,
      });
    }
    const email = admin_email.trim().toLowerCase();
    const { rows: exists } = await pool.query(
      `SELECT 1 FROM agents WHERE lower(email) = $1`,
      [email],
    );
    if (exists.length)
      return res
        .status(409)
        .json({ error: 'A user with that email already exists' });

    const client = await pool.connect();
    let tenant;
    let agentId;
    const rawToken = crypto.randomBytes(32).toString('hex');
    try {
      await client.query('BEGIN');
      ({
        rows: [tenant],
      } = await client.query(
        `INSERT INTO tenants (company_name, agency_id, subscription_status, account_status)
         VALUES ($1, $2, 'active', 'active') RETURNING id, company_name, created_at`,
        [company_name.trim().slice(0, 200), req.agency.id],
      ));
      await applyPlan(client, tenant.id, String(plan));
      const hash = await bcrypt.hash(
        crypto.randomBytes(16).toString('hex'),
        10,
      );
      ({
        rows: [{ id: agentId }],
      } = await client.query(
        `INSERT INTO agents (tenant_id, name, email, role, password_hash, is_active)
         VALUES ($1, $2, $3, 'admin', $4, true) RETURNING id`,
        [
          tenant.id,
          (admin_name || email.split('@')[0]).trim().slice(0, 120),
          email,
          hash,
        ],
      ));
      await client.query(
        `INSERT INTO brands (tenant_id, brand_name) VALUES ($1, $2)`,
        [tenant.id, company_name.trim().slice(0, 200)],
      );
      await client.query(
        `INSERT INTO password_reset_tokens (agent_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
        [agentId, rawToken],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    const { appUrl } = await agencies.brandingForTenant(tenant.id);
    const link = `${appUrl || publicAppUrl(req)}/dashboard/?reset_token=${rawToken}`;
    const emailSent = await sendAgentInviteEmail({
      to: email,
      name: admin_name,
      inviteLink: link,
      companyName: tenant.company_name,
    });
    res.status(201).json({
      ...tenant,
      admin_email: email,
      invite_sent: emailSent,
      ...(emailSent ? {} : { invite_link: link }),
    });
  }),
);

router.patch(
  '/workspaces/:id',
  ownerOnly,
  wrap(async (req, res) => {
    const {
      account_status,
      plan,
      max_agents_allowed,
      max_brands_allowed,
      conversation_limit,
    } = req.body || {};
    if (account_status && !STATUSES.includes(account_status))
      return res
        .status(400)
        .json({ error: 'account_status must be active or suspended' });
    const { rows: own } = await pool.query(
      `SELECT id FROM tenants WHERE id = $1 AND agency_id = $2`,
      [req.params.id, req.agency.id],
    );
    if (!own[0]) return res.status(404).json({ error: 'Workspace not found' });
    const client = await pool.connect();
    try {
      if (plan) await applyPlan(client, req.params.id, String(plan));
      const num = (v) =>
        v === undefined || v === null || v === ''
          ? null
          : Math.max(0, parseInt(v, 10));
      await client.query(
        `UPDATE tenants SET account_status = COALESCE($2, account_status),
           max_agents_allowed = COALESCE($3, max_agents_allowed),
           max_brands_allowed = COALESCE($4, max_brands_allowed),
           conversation_limit = COALESCE($5, conversation_limit), updated_at = NOW()
         WHERE id = $1`,
        [
          req.params.id,
          account_status || null,
          num(max_agents_allowed),
          num(max_brands_allowed),
          num(conversation_limit),
        ],
      );
    } finally {
      client.release();
    }
    const { rows } = await pool.query(
      `SELECT id, company_name, plan, account_status, max_agents_allowed, max_brands_allowed, conversation_limit FROM tenants WHERE id = $1`,
      [req.params.id],
    );
    res.json(rows[0]);
  }),
);

// Domains
router.get(
  '/domains',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM agency_domains WHERE agency_id = $1 ORDER BY created_at`,
      [req.agency.id],
    );
    res.json(rows.map((d) => ({ ...d, dns: agencies.dnsInstructions(d) })));
  }),
);

router.post(
  '/domains',
  ownerOnly,
  wrap(async (req, res) => {
    const hostname = agencies.validateHostname(req.body?.hostname);
    const { rows: taken } = await pool.query(
      `SELECT agency_id FROM agency_domains WHERE hostname = $1`,
      [hostname],
    );
    if (taken[0])
      return res
        .status(409)
        .json({ error: 'That domain is already registered' });
    const { rows } = await pool.query(
      `INSERT INTO agency_domains (agency_id, hostname, verification_token) VALUES ($1,$2,$3) RETURNING *`,
      [req.agency.id, hostname, agencies.newVerificationToken()],
    );
    res
      .status(201)
      .json({ ...rows[0], dns: agencies.dnsInstructions(rows[0]) });
  }),
);

router.post(
  '/domains/:id/verify',
  ownerOnly,
  wrap(async (req, res) => {
    const d = await agencies.verifyDomain(req.params.id, req.agency.id);
    res.json({ ...d, dns: agencies.dnsInstructions(d) });
  }),
);

router.post(
  '/domains/:id/primary',
  ownerOnly,
  wrap(async (req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE agency_domains SET is_primary = (id = $1) WHERE agency_id = $2 AND (id = $1 OR is_primary) AND
         EXISTS (SELECT 1 FROM agency_domains WHERE id = $1 AND agency_id = $2 AND status = 'active')`,
      [req.params.id, req.agency.id],
    );
    if (!rowCount)
      return res
        .status(400)
        .json({ error: 'Only an active domain can be primary' });
    res.json({ ok: true });
  }),
);

router.delete(
  '/domains/:id',
  ownerOnly,
  wrap(async (req, res) => {
    const d = await agencies.removeDomain(req.params.id, req.agency.id);
    if (!d) return res.status(404).json({ error: 'Domain not found' });
    res.status(204).end();
  }),
);

// Members
router.get(
  '/members',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT m.agent_id, m.role, a.name, a.email, m.created_at
         FROM agency_members m JOIN agents a ON a.id = m.agent_id WHERE m.agency_id = $1 ORDER BY m.created_at`,
      [req.agency.id],
    );
    res.json(rows);
  }),
);

router.post(
  '/members',
  ownerOnly,
  wrap(async (req, res) => {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const role = req.body?.role === 'owner' ? 'owner' : 'admin';
    const { rows } = await pool.query(
      `SELECT id FROM agents WHERE lower(email) = $1 AND tenant_id = $2`,
      [email, req.agency.home_tenant_id],
    );
    if (!rows[0])
      return res.status(400).json({
        error:
          'Invite this person to your own workspace (Team) first, then add them here.',
      });
    await pool.query(
      `INSERT INTO agency_members (agency_id, agent_id, role) VALUES ($1,$2,$3)
       ON CONFLICT (agency_id, agent_id) DO UPDATE SET role = EXCLUDED.role`,
      [req.agency.id, rows[0].id, role],
    );
    res.status(201).json({ agent_id: rows[0].id, role });
  }),
);

router.delete(
  '/members/:agentId',
  ownerOnly,
  wrap(async (req, res) => {
    if (req.params.agentId === req.agent.id)
      return res.status(400).json({ error: 'You cannot remove yourself' });
    const { rowCount } = await pool.query(
      `DELETE FROM agency_members WHERE agency_id = $1 AND agent_id = $2`,
      [req.agency.id, req.params.agentId],
    );
    if (!rowCount) return res.status(404).json({ error: 'Member not found' });
    res.status(204).end();
  }),
);

// AI provider (bring your own key)
router.get(
  '/ai',
  wrap(async (req, res) => {
    const cfg = req.agency.ai_config_sealed
      ? openJson(req.agency.ai_config_sealed)
      : null;
    res.json({
      providers: Object.entries(AI_PROVIDERS).map(([id, model]) => ({
        id,
        defaultModel: model,
      })),
      config: cfg
        ? {
            provider: cfg.provider,
            model: cfg.model,
            apiKey: mask(cfg.apiKey, 4),
          }
        : null,
    });
  }),
);

router.put(
  '/ai',
  ownerOnly,
  wrap(async (req, res) => {
    const { provider, model, apiKey } = req.body || {};
    if (!AI_PROVIDERS[provider])
      return res
        .status(400)
        .json({ error: 'provider must be gemini, openai or anthropic' });
    const current = req.agency.ai_config_sealed
      ? openJson(req.agency.ai_config_sealed)
      : {};
    const key =
      apiKey || (current.provider === provider ? current.apiKey : null);
    if (!key || String(key).length < 20)
      return res.status(400).json({ error: 'apiKey is required' });
    const cfg = {
      provider,
      model: (model || AI_PROVIDERS[provider]).slice(0, 80),
      apiKey: String(key).trim(),
    };
    const { testProvider } = require('../lib/ai/providers');
    const test = await testProvider(cfg);
    if (!test.ok)
      return res
        .status(400)
        .json({ error: `The ${provider} key did not work: ${test.error}` });
    await pool.query(
      `UPDATE agencies SET ai_config_sealed = $2, updated_at = NOW() WHERE id = $1`,
      [req.agency.id, sealJson(cfg)],
    );
    res.json({
      provider: cfg.provider,
      model: cfg.model,
      apiKey: mask(cfg.apiKey, 4),
    });
  }),
);

router.delete(
  '/ai',
  ownerOnly,
  wrap(async (req, res) => {
    await pool.query(
      `UPDATE agencies SET ai_config_sealed = NULL, updated_at = NOW() WHERE id = $1`,
      [req.agency.id],
    );
    res.status(204).end();
  }),
);

// ── Super admin: agencies ────────────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(
  requireAuth,
  wrap(async (req, res, next) => {
    if (!(await isSuperAdminAgent(req.agent)))
      return res.status(403).json({ error: 'Super admin access required' });
    await agencies.ensureAgencySchema();
    next();
  }),
);

adminRouter.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT a.id, a.name, a.slug, a.status, a.max_workspaces, a.home_tenant_id, a.created_at,
              (SELECT COUNT(*)::int FROM tenants t WHERE t.agency_id = a.id) AS workspaces,
              (SELECT string_agg(hostname, ', ') FROM agency_domains d WHERE d.agency_id = a.id AND d.status = 'active') AS domains,
              (SELECT string_agg(ag.email, ', ') FROM agency_members m JOIN agents ag ON ag.id = m.agent_id WHERE m.agency_id = a.id) AS members
         FROM agencies a ORDER BY a.created_at DESC`,
    );
    res.json(rows);
  }),
);

adminRouter.post(
  '/',
  wrap(async (req, res) => {
    const { name, owner_email, max_workspaces } = req.body || {};
    if (!name?.trim() || !owner_email?.trim())
      return res
        .status(400)
        .json({ error: 'name and owner_email are required' });
    const { rows: ag } = await pool.query(
      `SELECT id, tenant_id FROM agents WHERE lower(email) = lower($1)`,
      [owner_email.trim()],
    );
    if (!ag[0])
      return res.status(400).json({
        error:
          'The owner must already have an account (create their workspace first).',
      });
    const { rows: dup } = await pool.query(
      `SELECT id FROM agencies WHERE home_tenant_id = $1`,
      [ag[0].tenant_id],
    );
    if (dup[0])
      return res
        .status(409)
        .json({ error: "That user's workspace is already an agency" });
    const slug = `${name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)}-${crypto.randomBytes(2).toString('hex')}`;
    const { rows } = await pool.query(
      `INSERT INTO agencies (name, slug, home_tenant_id, max_workspaces, branding)
       VALUES ($1,$2,$3,$4, jsonb_build_object('appName', $1::text)) RETURNING *`,
      [
        name.trim().slice(0, 120),
        slug,
        ag[0].tenant_id,
        Number(max_workspaces) > 0 ? Number(max_workspaces) : 25,
      ],
    );
    await pool.query(
      `INSERT INTO agency_members (agency_id, agent_id, role) VALUES ($1,$2,'owner')`,
      [rows[0].id, ag[0].id],
    );
    res.status(201).json(rows[0]);
  }),
);

adminRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const { status, max_workspaces, name } = req.body || {};
    if (status && !STATUSES.includes(status))
      return res
        .status(400)
        .json({ error: 'status must be active or suspended' });
    const { rows } = await pool.query(
      `UPDATE agencies SET status = COALESCE($2, status), max_workspaces = COALESCE($3, max_workspaces),
         name = COALESCE($4, name), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [
        req.params.id,
        status || null,
        Number(max_workspaces) > 0 ? Number(max_workspaces) : null,
        name || null,
      ],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Agency not found' });
    agencies.clearHostCache();
    res.json(rows[0]);
  }),
);

module.exports = { router, publicRouter, adminRouter };
