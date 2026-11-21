'use strict';

/**
 * voice/routes.js — AI Call Center inside OmniCore (mounted at /api/voice).
 *
 * Signed-in (OmniCore session, workspace override aware):
 *   GET    /                          overview: account, keys status, this workspace's deployment, options
 *   PUT    /keys                      BYOK Twilio / Vapi / OpenAI (checked live; account owners only)
 *   GET    /crm                       pipelines + calendars + location of this workspace's GoHighLevel account
 *   GET    /templates                 industry templates
 *   POST   /agents/preview            generated system prompts
 *   PUT    /deployment                create/update the draft (agent, pipeline, number prefs, outbound, follow-up, alerts)
 *   POST   /deployment/deploy         run / resume provisioning
 *   POST   /deployment/agents         push prompt / settings changes to live agents
 *   POST   /deployment/teardown       remove agents, release number
 *   POST   /deployment/test-call      outbound test call to a phone
 *   POST   /deployment/test-lead      speed-to-lead test
 *   GET    /deployments               all deployments of the account (agency overview)
 *   GET    /live/calls · /live/history · /live/stats · /live/calls/:id
 *   POST   /live/calls/:id/listen · /takeover · /resync · /:action (whisper|say|mute|unmute|end|transfer)
 *   GET    /live/voice-token          Twilio Voice SDK token for browser takeover
 *   GET    /leads · /reports/summary · /reports/calls.csv · /events
 *
 * Public (provider callbacks, verified):
 *   POST   /webhooks/vapi/:locationId            x-vapi-secret per deployment
 *   POST   /twilio/voice/takeover|takeover-done|outbound   X-Twilio-Signature
 *   POST   /hooks/lead/:locationId/:key          per-deployment secret key
 *   ALL    /cron/sweep                           CRON_SECRET (optional; an in-process timer also runs)
 *
 * Roles: any workspace user = viewer; admin/supervisor = manager (listen,
 * whisper, takeover); admin = configure; keys belong to the account (the
 * agency for agency clients, else the workspace) and are managed by agency
 * staff or the workspace admin respectively.
 */

const crypto = require('crypto');
const express = require('express');
const { pool } = require('../lib/db');
const {
  requireAuth,
  applyWorkspaceOverride,
  isSuperAdminAgent,
} = require('../middleware/auth');
const agencies = require('../lib/agencies');
const { getVoiceContext, appBase } = require('./context');
const { safeEqual, verifyTwilio, twilioAccessToken } = require('./security');
const { twiml, say, dialClient, dialNumber } = require('./integrations/twilio');
const {
  STEPS,
  AGENCY_STEPS,
  STEP_LABEL,
  OUTCOMES,
  normalizePipeline,
} = require('./services/provisioner');
const agentsLib = require('./services/agents');
const {
  normalizeOutbound,
  normalizeFollowUp,
  normalizeAlerts,
} = require('./services/automation');
const { TEMPLATES } = require('./services/templates');

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, message) =>
  Object.assign(new Error(message), { status });

// ── Identity mapping ─────────────────────────────────────────────────────────
async function accountFor(tenantId) {
  const agency = await agencies.agencyForTenant(tenantId).catch(() => null);
  if (agency)
    return { companyId: `ag_${agency.id}`, name: agency.name, agency };
  const { rows } = await pool.query(
    `SELECT company_name FROM tenants WHERE id = $1`,
    [tenantId],
  );
  return {
    companyId: `ws_${tenantId}`,
    name: rows[0]?.company_name || 'Workspace',
    agency: null,
  };
}

async function ensureAccountDoc(ctx, acct) {
  let doc = await ctx.store.get('agencies', acct.companyId);
  if (!doc) {
    doc = await ctx.store.put('agencies', {
      _id: acct.companyId,
      name: acct.name,
      installed: true,
      status: 'active',
      mode: 'company',
      keys: {},
      keyStatus: {},
      setup: {},
      createdAt: new Date().toISOString(),
    });
  }
  return doc;
}

async function locationFor(tenantId) {
  const { rows } = await pool.query(
    `SELECT location_id, location_name FROM ghl_connections WHERE tenant_id = $1 AND status = 'active' ORDER BY installed_at LIMIT 1`,
    [tenantId],
  );
  return rows[0] || null;
}

async function isAgencyStaffHome(req) {
  const m = await agencies.membershipFor(req.agent.id).catch(() => null);
  return Boolean(m && m.home_tenant_id === req.agent.tenantId);
}

/** Loads account + workspace context onto req.voice. */
const withVoice = wrap(async (req, res, next) => {
  const ctx = getVoiceContext();
  await ctx.store.ensureSchema();
  const acct = await accountFor(req.agent.tenantId);
  const account = await ensureAccountDoc(ctx, acct);
  if (account.status === 'suspended')
    throw httpError(403, 'Voice is suspended for this account.');
  const loc = await locationFor(req.agent.tenantId);
  const superAdmin = await isSuperAdminAgent(req.agent).catch(() => false);
  const agencyHome = acct.agency ? await isAgencyStaffHome(req) : false;
  req.voice = {
    ctx,
    account,
    acct,
    location: loc,
    // Keys belong to the account: agency staff (or super admin) for agencies, workspace admins otherwise.
    canManageKeys:
      superAdmin ||
      (acct.agency
        ? agencyHome || Boolean(req.agent.agencyOverride)
        : req.agent.role === 'admin'),
    agencyWide: agencyHome || superAdmin,
    role: req.agent.role,
  };
  next();
});

const manager = (req, res, next) =>
  ['admin', 'supervisor'].includes(req.agent.role) || req.voice.agencyWide
    ? next()
    : next(httpError(403, 'Requires admin or supervisor'));
const admin = (req, res, next) =>
  req.agent.role === 'admin' || req.voice.agencyWide
    ? next()
    : next(httpError(403, 'Requires admin'));

function scopeOf(req) {
  const { account, location, agencyWide } = req.voice;
  const requested = String(req.query.location || req.body?.location || '');
  if (agencyWide)
    return requested
      ? { companyId: account._id, locationId: requested }
      : { companyId: account._id };
  if (!location)
    throw httpError(
      409,
      'Connect this workspace to GoHighLevel first (Integrations → GoHighLevel).',
    );
  if (requested && requested !== location.location_id)
    throw httpError(403, 'You do not have access to that account');
  return { companyId: account._id, locationId: location.location_id };
}

function sessionUser(req) {
  return {
    uid: req.agent.id,
    name: req.agent.name,
    email: req.agent.email,
    companyId: req.voice.account._id,
  };
}

function voiceIdentity(req) {
  return `acc_${crypto.createHash('sha256').update(`${req.voice.account._id}:${req.agent.id}`).digest('hex').slice(0, 24)}`;
}

function publicDeployment(cfg, d) {
  if (!d) return null;
  return {
    locationId: d._id,
    tenantId: d.tenantId || null,
    name: d.name,
    status: d.status,
    lastError: d.lastError || '',
    phoneNumber: d.twilio?.phoneNumber || '',
    vapi: d.vapi
      ? {
          squadId: d.vapi.squadId || '',
          phoneNumberId: d.vapi.phoneNumberId || '',
        }
      : {},
    agent: d.agent,
    options: d.options,
    pipeline: d.pipeline || { pipelineId: '', stages: {} },
    outbound: d.outbound
      ? {
          ...d.outbound,
          key: undefined,
          webhookUrl: `${cfg.baseUrl}/hooks/lead/${encodeURIComponent(d._id)}/${d.outbound.key}`,
        }
      : null,
    followUp: d.followUp || null,
    alerts: d.alerts || null,
    steps: [...AGENCY_STEPS, ...STEPS].map((k) => ({
      key: k,
      label: STEP_LABEL[k],
      ...((d.steps || {})[k] || { status: 'pending' }),
    })),
    deployedAt: d.deployedAt || '',
    createdAt: d.createdAt,
  };
}

async function myDeployment(req) {
  if (!req.voice.location) return null;
  const d = await req.voice.ctx.store.get(
    'deployments',
    req.voice.location.location_id,
  );
  return d && d.companyId === req.voice.account._id ? d : null;
}

// ── Signed-in API ────────────────────────────────────────────────────────────
const router = express.Router();
router.use(requireAuth, applyWorkspaceOverride, withVoice);

router.get(
  '/',
  wrap(async (req, res) => {
    const { ctx, account, location, canManageKeys, agencyWide } = req.voice;
    const { rows } = await pool.query(
      `SELECT ai_feature_enabled FROM tenants WHERE id = $1`,
      [req.agent.tenantId],
    );
    res.json({
      account: {
        id: account._id,
        name: account.name,
        isAgency: Boolean(req.voice.acct.agency),
      },
      planAllowsVoice: rows[0]?.ai_feature_enabled !== false,
      canManageKeys,
      agencyWide,
      keys: ctx.agencySvc.publicKeys(account),
      setup: {
        takeoverNumber: account.setup?.takeoverNumber || '',
        browserCalling: Boolean(account.setup?.twimlAppSid),
        vapiCredential: Boolean(account.setup?.vapiCredentialId),
      },
      ghl: location
        ? { locationId: location.location_id, name: location.location_name }
        : null,
      deployment: publicDeployment(ctx.cfg, await myDeployment(req)),
      voices: agentsLib.VOICES,
      outcomes: OUTCOMES,
      languages: Object.entries(agentsLib.LANGUAGES).map(([id, l]) => ({
        id,
        label: l.label,
      })),
      defaults: {
        agent: agentsLib.DEFAULT_AGENT,
        outbound: normalizeOutbound({}),
        followUp: normalizeFollowUp({}),
        alerts: normalizeAlerts({}),
      },
      pollMs: ctx.cfg.livePollMs,
    });
  }),
);

router.put(
  '/keys',
  wrap(async (req, res) => {
    const { ctx, account, canManageKeys } = req.voice;
    if (!canManageKeys)
      throw httpError(
        403,
        req.voice.acct.agency
          ? 'Your agency manages the voice provider keys.'
          : 'Requires admin',
      );
    const body = req.body || {};
    const merged = ctx.agencySvc.encryptKeys(body, account.keys);
    const k = ctx.agencySvc.keys({ keys: merged });
    const status = { ...(account.keyStatus || {}) };
    const check = async (name, fn) => {
      try {
        status[name] = {
          ok: true,
          detail: (await fn()) || 'Connected',
          at: new Date().toISOString(),
        };
      } catch (e) {
        status[name] = {
          ok: false,
          detail: String(e.message).replace(/^\w+: /, ''),
          at: new Date().toISOString(),
        };
      }
    };
    const changed = (f) => typeof body[f] === 'string' && body[f].trim();
    if (
      (changed('twilioSid') || changed('twilioToken')) &&
      k.twilioSid &&
      k.twilioToken
    ) {
      await check('twilio', async () => {
        const acc = await ctx.twilio
          .client(k.twilioSid, k.twilioToken)
          .getAccount();
        return `${acc.friendly_name || 'Account'} (${acc.type}, ${acc.status})`;
      });
    }
    if (changed('vapiKey'))
      await check('vapi', async () => {
        await ctx.vapi.client(k.vapiKey).listAssistants(1);
        return 'Connected';
      });
    if (changed('openaiKey'))
      await check('openai', async () => {
        await ctx.openai.client(k.openaiKey).listModels();
        return 'Connected';
      });
    const save = { ...(account.keys || {}) };
    if (status.twilio?.ok && (changed('twilioSid') || changed('twilioToken'))) {
      save.twilioSid = merged.twilioSid;
      save.twilioToken = merged.twilioToken;
    }
    if (status.vapi?.ok && changed('vapiKey')) save.vapiKey = merged.vapiKey;
    if (status.openai?.ok && changed('openaiKey')) {
      save.openaiKey = merged.openaiKey;
      await ctx.store.patch('agencies', account._id, {
        'setup.vapiCredentialId': '',
      });
    }
    await ctx.store.patch('agencies', account._id, {
      keys: save,
      keyStatus: status,
    });
    await ctx.store.log(
      account._id,
      'keys.updated',
      Object.keys(status)
        .filter((n) => status[n].ok)
        .join(', '),
    );
    res.json({
      keys: ctx.agencySvc.publicKeys({
        ...account,
        keys: save,
        keyStatus: status,
      }),
    });
  }),
);

router.get(
  '/crm',
  admin,
  wrap(async (req, res) => {
    const { ctx, account, location } = req.voice;
    if (!location)
      throw httpError(
        409,
        'Connect this workspace to GoHighLevel first (Integrations → GoHighLevel).',
      );
    const id = location.location_id;
    // Make sure the deployment row (tenant link) exists so locationApi can resolve the connection.
    const existing = await ctx.store.get('deployments', id);
    if (!existing)
      await ctx.provisioner.createDeployment(account, {
        locationId: id,
        name: location.location_name || '',
      });
    await ctx.store.patch('deployments', id, { tenantId: req.agent.tenantId });
    const api = await ctx.agencySvc.locationApi(account, id);
    const [pipelines, calendars, loc] = await Promise.all([
      api.listPipelines(id).catch(() => []),
      api.listCalendars(id).catch(() => []),
      api.getLocation(id).catch(() => ({})),
    ]);
    res.json({
      location: {
        id,
        name: loc.name || '',
        timezone: loc.timezone || '',
        phone: loc.phone || '',
        website: loc.website || '',
      },
      pipelines: pipelines.map((p) => ({
        id: p.id,
        name: p.name,
        stages: (p.stages || []).map((s) => ({ id: s.id, name: s.name })),
      })),
      calendars: calendars.map((c) => ({ id: c.id, name: c.name })),
    });
  }),
);

router.get('/templates', (req, res) => res.json({ templates: TEMPLATES }));

router.post('/agents/preview', (req, res) => {
  const a = agentsLib.normalizeAgent(req.body?.agent || {});
  res.json({
    prompts: Object.fromEntries(
      agentsLib.ROLES.map((r) => [r, agentsLib.systemPrompt(r, a)]),
    ),
  });
});

router.put(
  '/deployment',
  admin,
  wrap(async (req, res) => {
    const { ctx, account, location } = req.voice;
    if (!location)
      throw httpError(
        409,
        'Connect this workspace to GoHighLevel first (Integrations → GoHighLevel).',
      );
    await ctx.provisioner.createDeployment(account, {
      ...(req.body || {}),
      locationId: location.location_id,
      name: req.body?.name || location.location_name || '',
    });
    const d = await ctx.store.patch('deployments', location.location_id, {
      tenantId: req.agent.tenantId,
    });
    res.json({ deployment: publicDeployment(ctx.cfg, d) });
  }),
);

router.post(
  '/deployment/deploy',
  admin,
  wrap(async (req, res) => {
    const { ctx, account } = req.voice;
    const d = await myDeployment(req);
    if (!d) throw httpError(404, 'Save the call center settings first');
    const { rows } = await pool.query(
      `SELECT ai_feature_enabled FROM tenants WHERE id = $1`,
      [req.agent.tenantId],
    );
    if (rows[0]?.ai_feature_enabled === false)
      throw httpError(
        402,
        'Your plan does not include AI features. Upgrade to deploy the AI call center.',
      );
    if (
      d.status === 'deploying' &&
      Date.parse(d.deployStartedAt || 0) > Date.now() - 90e3
    )
      throw httpError(409, 'A deployment is already running');
    try {
      const fresh = await ctx.store.get('agencies', account._id);
      const out = await ctx.provisioner.deploy(fresh, d._id, {
        browserCalling: req.body?.browserCalling !== false,
      });
      res.json({ deployment: publicDeployment(ctx.cfg, out) });
    } catch (e) {
      const after = await ctx.store.get('deployments', d._id);
      res.status(e.status && e.status < 500 ? e.status : 502).json({
        error: e.message,
        step: e.step,
        deployment: publicDeployment(ctx.cfg, after),
      });
    }
  }),
);

router.post(
  '/deployment/agents',
  admin,
  wrap(async (req, res) => {
    const { ctx, account } = req.voice;
    const d = await myDeployment(req);
    if (!d) throw httpError(404, 'Not deployed');
    const b = req.body || {};
    if (b.agent)
      await ctx.store.patch('deployments', d._id, {
        agent: agentsLib.normalizeAgent(b.agent, d.agent),
      });
    if (b.pipeline)
      await ctx.store.patch('deployments', d._id, {
        pipeline: normalizePipeline(b.pipeline),
      });
    if (b.outbound)
      await ctx.store.patch('deployments', d._id, {
        outbound: normalizeOutbound(b.outbound, d.outbound),
      });
    if (b.followUp)
      await ctx.store.patch('deployments', d._id, {
        followUp: normalizeFollowUp(b.followUp, d.followUp),
      });
    if (b.alerts)
      await ctx.store.patch('deployments', d._id, {
        alerts: normalizeAlerts(b.alerts, d.alerts),
      });
    if (d.status === 'live')
      await ctx.provisioner.updateAgents(
        await ctx.store.get('agencies', account._id),
        d._id,
      );
    res.json({
      deployment: publicDeployment(
        ctx.cfg,
        await ctx.store.get('deployments', d._id),
      ),
    });
  }),
);

router.post(
  '/deployment/teardown',
  admin,
  wrap(async (req, res) => {
    const { ctx, account } = req.voice;
    const d = await myDeployment(req);
    if (!d) throw httpError(404, 'Not deployed');
    res.json(
      await ctx.provisioner.teardown(
        await ctx.store.get('agencies', account._id),
        d._id,
        {
          releaseNumber: req.body?.releaseNumber !== false,
          closeSubaccount: Boolean(req.body?.closeSubaccount),
        },
      ),
    );
  }),
);

router.post(
  '/deployment/test-call',
  admin,
  wrap(async (req, res) => {
    const { ctx, account } = req.voice;
    const d = await myDeployment(req);
    if (!d || d.status !== 'live')
      throw httpError(400, 'Deploy the call center first');
    const number = String(req.body?.number || '').replace(/[^\d+]/g, '');
    if (!/^\+\d{8,15}$/.test(number))
      throw httpError(400, 'Use international format, e.g. +15551234567');
    const v = ctx.vapi.client(ctx.agencySvc.keys(account).vapiKey);
    const call = await v.createCall({
      phoneNumberId: d.vapi.phoneNumberId,
      squadId: d.vapi.squadId,
      customer: { number },
    });
    await ctx.store.log(account._id, 'call.test', number, {
      locationId: d._id,
    });
    res.json({ ok: true, callId: call.id });
  }),
);

router.post(
  '/deployment/test-lead',
  admin,
  wrap(async (req, res) => {
    const { ctx } = req.voice;
    const d = await myDeployment(req);
    if (!d || d.status !== 'live')
      throw httpError(400, 'Deploy the call center first');
    const r = await ctx.automation.receiveLead(d, {
      phone: req.body?.phone,
      first_name: req.body?.name || 'Test',
      customData: { interest: req.body?.interest || 'a quote' },
    });
    if (r.error) throw httpError(r.status, r.error);
    if (r.duplicate)
      throw httpError(
        409,
        'This number already had a lead in the last 24 hours',
      );
    if (r.callNow) await ctx.automation.placeCall(r.lead._id);
    const lead = await ctx.store.get('leads', r.lead._id);
    res.json({
      ok: true,
      status: lead.status,
      reason: lead.reason || '',
      callAt: lead.nextAt,
    });
  }),
);

router.get(
  '/deployments',
  wrap(async (req, res) => {
    const { ctx, account, agencyWide } = req.voice;
    const f = { companyId: account._id };
    if (!agencyWide) {
      if (!req.voice.location) return res.json({ deployments: [] });
      f._id = req.voice.location.location_id;
    }
    const deps = await ctx.store.find('deployments', f, {
      sort: { createdAt: -1 },
    });
    res.json({
      deployments: deps.map((d) => ({
        locationId: d._id,
        tenantId: d.tenantId,
        name: d.name,
        status: d.status,
        phoneNumber: d.twilio?.phoneNumber || '',
      })),
    });
  }),
);

// ── Command Deck ─────────────────────────────────────────────────────────────
const polls = new Map();
function polled(req, res, next) {
  const key = req.agent.id;
  const now = Date.now();
  const b = polls.get(key) || { start: now, n: 0 };
  if (now - b.start > 60e3) {
    b.start = now;
    b.n = 0;
  }
  b.n += 1;
  polls.set(key, b);
  return b.n > 600 ? res.status(429).json({ error: 'Slow down' }) : next();
}

router.get(
  '/live/calls',
  polled,
  wrap(async (req, res) =>
    res.json({
      calls: await req.voice.ctx.calls.active(scopeOf(req)),
      at: new Date().toISOString(),
    }),
  ),
);

router.get(
  '/live/history',
  wrap(async (req, res) =>
    res.json({
      calls: await req.voice.ctx.calls.recent(scopeOf(req), {
        before: req.query.before,
        limit: Number(req.query.limit) || 30,
      }),
    }),
  ),
);

router.get(
  '/live/stats',
  wrap(async (req, res) => {
    const scope = scopeOf(req);
    const since = new Date(Date.now() - 7 * 86400e3).toISOString();
    const f = { companyId: scope.companyId, createdAt: { $gte: since } };
    if (scope.locationId) f.locationId = scope.locationId;
    const docs = await req.voice.ctx.store.find('calls', f, { limit: 5000 });
    const graded = docs.filter((c) => c.grade);
    const outcomes = {};
    graded.forEach((c) => {
      outcomes[c.grade.outcome] = (outcomes[c.grade.outcome] || 0) + 1;
    });
    res.json({
      calls7d: docs.length,
      minutes7d: Math.round(
        docs.reduce((n, c) => n + (c.durationSec || 0), 0) / 60,
      ),
      avgScore: graded.length
        ? Math.round(
            graded.reduce((n, c) => n + c.grade.score, 0) / graded.length,
          )
        : null,
      booked7d: docs.filter(
        (c) => c.booked || c.grade?.outcome === 'appointment_booked',
      ).length,
      cost7d:
        Math.round(docs.reduce((n, c) => n + (c.cost || 0), 0) * 100) / 100,
      outcomes,
    });
  }),
);

router.get(
  '/live/calls/:id',
  polled,
  wrap(async (req, res) => {
    const d = await req.voice.ctx.calls.detail(
      scopeOf(req),
      req.params.id,
      req.query.after,
    );
    if (!d) throw httpError(404, 'Call not found');
    res.json(d);
  }),
);

router.post(
  '/live/calls/:id/listen',
  manager,
  wrap(async (req, res) => {
    const { ctx, account } = req.voice;
    const url = await ctx.calls.listenUrl(scopeOf(req), req.params.id);
    if (url === null) throw httpError(404, 'Call not found');
    if (!url) throw httpError(409, 'Live audio is not available for this call');
    await ctx.store.log(
      account._id,
      'call.listen',
      req.agent.name || req.agent.email,
      { callId: req.params.id },
    );
    res.json({ url });
  }),
);

router.post(
  '/live/calls/:id/takeover',
  manager,
  wrap(async (req, res) => {
    const { ctx, account } = req.voice;
    res.json(
      await ctx.calls.takeover(
        scopeOf(req),
        req.params.id,
        await ctx.store.get('agencies', account._id),
        sessionUser(req),
        voiceIdentity(req),
      ),
    );
  }),
);

router.post(
  '/live/calls/:id/resync',
  manager,
  wrap(async (req, res) => {
    const { ctx } = req.voice;
    const c = await ctx.calls.get(scopeOf(req), req.params.id);
    if (!c) throw httpError(404, 'Call not found');
    await ctx.store.patch('calls', c._id, {
      'sync.state': 'queued',
      'sync.attempts': 0,
      grade: req.body?.regrade ? null : c.grade,
    });
    res.json(await ctx.qa.processCall(c._id));
  }),
);

const CONTROL_ACTIONS = new Set([
  'whisper',
  'say',
  'mute',
  'unmute',
  'end',
  'transfer',
]);
router.post(
  '/live/calls/:id/:action',
  manager,
  wrap(async (req, res) => {
    if (!CONTROL_ACTIONS.has(req.params.action))
      throw httpError(404, 'Unknown action');
    res.json(
      await req.voice.ctx.calls.act(
        scopeOf(req),
        req.params.id,
        req.params.action,
        req.body || {},
        sessionUser(req),
      ),
    );
  }),
);

router.get(
  '/live/voice-token',
  manager,
  wrap(async (req, res) => {
    const { ctx, account } = req.voice;
    const st = account.setup || {};
    if (!st.apiKeySid || !st.twimlAppSid)
      return res.json({
        enabled: false,
        reason: 'Browser takeover is set up during the first deployment.',
      });
    const k = ctx.agencySvc.keys(account);
    const identity = voiceIdentity(req);
    const token = twilioAccessToken({
      accountSid: k.twilioSid,
      apiKeySid: st.apiKeySid,
      apiKeySecret: ctx.sec.decrypt(st.apiKeySecret),
      identity,
      twimlAppSid: st.twimlAppSid,
      ttl: 3600,
    });
    res.json({ enabled: true, token, identity, ttl: 3600 });
  }),
);

router.get(
  '/leads',
  manager,
  wrap(async (req, res) => {
    const s = scopeOf(req);
    const f = { companyId: s.companyId };
    if (s.locationId) f.locationId = s.locationId;
    const leads = await req.voice.ctx.store.find('leads', f, {
      sort: { createdAt: -1 },
      limit: 100,
    });
    res.json({
      leads: leads.map((l) => ({
        id: l._id,
        locationId: l.locationId,
        name: l.name,
        phone: l.phone,
        interest: l.interest,
        status: l.status,
        attempts: l.attempts,
        reason: l.reason || '',
        createdAt: l.createdAt,
        nextAt: l.nextAt,
        lastCallAt: l.lastCallAt || '',
      })),
    });
  }),
);

router.get(
  '/reports/summary',
  wrap(async (req, res) =>
    res.json(
      await req.voice.ctx.reports.summary(scopeOf(req), {
        days: req.query.days,
      }),
    ),
  ),
);

router.get(
  '/reports/calls.csv',
  wrap(async (req, res) => {
    const body = await req.voice.ctx.reports.csv(scopeOf(req), {
      days: req.query.days,
    });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set(
      'Content-Disposition',
      `attachment; filename="calls-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(body);
  }),
);

router.get(
  '/events',
  admin,
  wrap(async (req, res) =>
    res.json({
      events: await req.voice.ctx.store.events(
        { companyId: req.voice.account._id },
        100,
      ),
    }),
  ),
);

// ── Public provider callbacks ────────────────────────────────────────────────
const publicRouter = express.Router();

publicRouter.post(
  '/webhooks/vapi/:locationId',
  wrap(async (req, res) => {
    const ctx = getVoiceContext();
    const dep = await ctx.store.get('deployments', req.params.locationId);
    const secret = dep && ctx.sec.decrypt(dep.serverSecret);
    if (
      !dep ||
      !secret ||
      !safeEqual(req.headers['x-vapi-secret'] || '', secret)
    )
      return res.status(401).json({ error: 'bad secret' });
    const msg = req.body?.message || {};
    if (msg.type === 'tool-calls') {
      await ctx.calls.ingest(dep, msg).catch(() => null);
      return res.json(await ctx.tools.handle(dep, msg));
    }
    const r = await ctx.calls.ingest(dep, msg);
    res.json({ ok: true });
    if (r && r.ended) {
      void ctx.background(`qa ${r.callId}`, async () => {
        const c = await ctx.store.get('calls', r.callId);
        if (c && c.leadId) await ctx.automation.leadCallEnded(c);
        await ctx.qa.processCall(r.callId);
      });
    }
  }),
);

async function accountForTwilio(ctx, req, field) {
  const p = req.body || {};
  const found = await ctx.store.find(
    'agencies',
    {
      [`setup.${field}`]: field === 'takeoverNumber' ? p.To : p.ApplicationSid,
    },
    { limit: 1 },
  );
  const account = found[0];
  if (!account) return null;
  const k = ctx.agencySvc.keys(account);
  const url = appBase() + req.originalUrl;
  return verifyTwilio(k.twilioToken, url, p, req.headers['x-twilio-signature'])
    ? account
    : null;
}

publicRouter.post(
  '/twilio/voice/takeover',
  wrap(async (req, res) => {
    const ctx = getVoiceContext();
    res.type('text/xml');
    const account = await accountForTwilio(ctx, req, 'takeoverNumber');
    if (!account)
      return res
        .status(403)
        .send(twiml(`${say('This line is not configured.')}<Hangup/>`));
    const tk = await ctx.calls.claimTakeover(account._id, req.body.From || '');
    if (tk) {
      await ctx.store.log(account._id, 'takeover.bridged', tk.userName, {
        callId: tk.callId,
        locationId: tk.locationId,
      });
      return res.send(
        twiml(
          dialClient(tk.identity, {
            timeout: 30,
            action: `${ctx.cfg.baseUrl}/twilio/voice/takeover-done`,
          }),
        ),
      );
    }
    const dep = await ctx.store.find(
      'deployments',
      { companyId: account._id, status: 'live' },
      { limit: 1 },
    );
    const fallback = dep[0]?.agent?.transferNumber;
    if (fallback)
      return res.send(twiml(dialNumber(fallback, { callerId: req.body.To })));
    return res.send(
      twiml(
        `${say('Sorry, nobody is available right now. We will call you back shortly.')}<Hangup/>`,
      ),
    );
  }),
);

publicRouter.post(
  '/twilio/voice/takeover-done',
  wrap(async (req, res) => {
    const ctx = getVoiceContext();
    res.type('text/xml');
    const account = await accountForTwilio(ctx, req, 'takeoverNumber');
    if (!account || req.body.DialCallStatus === 'completed')
      return res.send(twiml('<Hangup/>'));
    return res.send(
      twiml(
        `${say('Sorry, our team member could not join. We will call you back shortly.')}<Hangup/>`,
      ),
    );
  }),
);

publicRouter.post(
  '/twilio/voice/outbound',
  wrap(async (req, res) => {
    const ctx = getVoiceContext();
    res.type('text/xml');
    const account = await accountForTwilio(ctx, req, 'twimlAppSid');
    if (!account || !/^client:acc_[a-f0-9]{24}$/.test(req.body.From || ''))
      return res.status(403).send(twiml(`${say('Not allowed.')}<Hangup/>`));
    const to = String(req.body.To || '').replace(/[^\d+]/g, '');
    if (!/^\+\d{8,15}$/.test(to))
      return res.send(twiml(`${say('That number is not valid.')}<Hangup/>`));
    await ctx.store.log(account._id, 'call.browser_outbound', to);
    return res.send(
      twiml(dialNumber(to, { callerId: account.setup.takeoverNumber })),
    );
  }),
);

const leadBuckets = new Map();
publicRouter.post(
  '/hooks/lead/:locationId/:key',
  wrap(async (req, res) => {
    const ctx = getVoiceContext();
    const b = leadBuckets.get(req.params.locationId) || {
      start: Date.now(),
      n: 0,
    };
    if (Date.now() - b.start > 60e3)
      Object.assign(b, { start: Date.now(), n: 0 });
    b.n += 1;
    leadBuckets.set(req.params.locationId, b);
    if (b.n > 600) return res.status(429).json({ error: 'Too many leads' });
    const dep = await ctx.store.get('deployments', req.params.locationId);
    const key = dep?.outbound?.key;
    if (!dep || !key || !safeEqual(req.params.key, key))
      return res.status(404).json({ error: 'Unknown webhook' });
    const account = await ctx.store.get('agencies', dep.companyId);
    if (!account || account.status !== 'active' || dep.status !== 'live')
      return res.status(409).json({ error: 'This call center is not live' });
    const r = await ctx.automation.receiveLead(dep, req.body);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.status(r.duplicate ? 200 : 202).json({
      ok: true,
      leadId: r.lead._id,
      status: r.duplicate ? 'duplicate' : r.lead.status,
      callAt: r.lead.nextAt,
    });
    if (r.callNow)
      void ctx.background(`lead ${r.lead._id}`, () =>
        ctx.automation.placeCall(r.lead._id),
      );
    return undefined;
  }),
);

publicRouter.all(
  '/cron/sweep',
  wrap(async (req, res) => {
    const ctx = getVoiceContext();
    const given =
      (req.headers.authorization || '').replace(/^Bearer /, '') ||
      req.headers['x-cron-secret'] ||
      '';
    if (!ctx.cfg.cronSecret || !safeEqual(String(given), ctx.cfg.cronSecret))
      return res.status(401).json({ error: 'unauthorized' });
    return res.json(await ctx.sweep('cron'));
  }),
);

module.exports = { router, publicRouter, accountFor, publicDeployment };
