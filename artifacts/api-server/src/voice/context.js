'use strict';

/**
 * voice/context.js
 * Wires the ported AI Call Center services onto OmniCore:
 *   store      PostgreSQL document store (voice/store.js)
 *   sec        OmniCore's AES-256-GCM secret box
 *   agencySvc  OmniCore identity: a voice *account* is an OmniCore agency, or a
 *              direct-customer workspace; each deployment is one workspace,
 *              keyed by its connected GoHighLevel location id. CRM calls use
 *              OmniCore's GoHighLevel connections (auto-refreshed tokens).
 *   twilio / vapi / openai / ghl API clients (unchanged upstream modules)
 *
 * Provider callbacks (Vapi server URL, Twilio TwiML) use
 *   cfg.baseUrl = PUBLIC_APP_URL + '/api/voice'
 */

const { pool } = require('../lib/db');
const logger = require('../utils/logger');
const { seal, open } = require('../lib/secretBox');
const { createPgStore } = require('./store');
const { mask } = require('./security');
const { createTwilio } = require('./integrations/twilio');
const { createVapi } = require('./integrations/vapi');
const { createGhl } = require('./integrations/ghl');
const { createOpenAI } = require('./integrations/openai');
const { createProvisioner } = require('./services/provisioner');
const { createCallService } = require('./services/calls');
const { createQaService } = require('./services/qa');
const { createToolService } = require('./services/tools');
const { createAutomation } = require('./services/automation');
const { createReports } = require('./services/reports');

const KEY_FIELDS = ['twilioSid', 'twilioToken', 'vapiKey', 'openaiKey'];
const SECRET_FIELDS = { twilioToken: 1, vapiKey: 1, openaiKey: 1 };

function appBase() {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://localhost:${process.env.PORT || 5000}`
  ).replace(/\/+$/, '');
}

function loadConfig() {
  const baseUrl = `${appBase()}/api/voice`;
  return {
    baseUrl,
    baseHost: new URL(baseUrl).host,
    livePollMs: Math.max(800, Number(process.env.VOICE_LIVE_POLL_MS || 1500)),
    sweepIntervalSec: Math.max(
      15,
      Number(process.env.VOICE_SWEEP_INTERVAL_SEC || 60),
    ),
    cronSecret: process.env.CRON_SECRET || '',
    ghl: {
      apiBase: 'https://services.leadconnectorhq.com',
      apiVersion: '2021-07-28',
      authUrl: 'https://marketplace.gohighlevel.com/oauth/chooselocation',
      clientId: process.env.GHL_CLIENT_ID || '',
      clientSecret: process.env.GHL_CLIENT_SECRET || '',
      scopes: '',
    },
    twilio: {
      apiBase: (
        process.env.TWILIO_API_BASE || 'https://api.twilio.com'
      ).replace(/\/+$/, ''),
    },
    vapi: {
      apiBase: (process.env.VAPI_API_BASE || 'https://api.vapi.ai').replace(
        /\/+$/,
        '',
      ),
    },
    openai: {
      apiBase: (
        process.env.OPENAI_API_BASE || 'https://api.openai.com/v1'
      ).replace(/\/+$/, ''),
      graderModel: process.env.VOICE_GRADER_MODEL || 'gpt-4o-mini',
      agentModel: process.env.VOICE_AGENT_MODEL || 'gpt-4o',
    },
  };
}

function createAgencyAdapter(ctx) {
  const { store, ghl } = ctx;

  function keys(account) {
    const k = (account && account.keys) || {};
    return {
      twilioSid: k.twilioSid || '',
      twilioToken: ctx.sec.decrypt(k.twilioToken),
      vapiKey: ctx.sec.decrypt(k.vapiKey),
      openaiKey: ctx.sec.decrypt(k.openaiKey),
    };
  }

  function publicKeys(account) {
    const k = keys(account);
    const out = {};
    for (const f of KEY_FIELDS)
      out[f] = {
        set: Boolean(k[f]),
        hint: SECRET_FIELDS[f] ? mask(k[f]) : k[f],
      };
    out.status = (account && account.keyStatus) || {};
    return out;
  }

  function encryptKeys(input, existing) {
    const out = { ...(existing || {}) };
    for (const f of KEY_FIELDS) {
      if (typeof input[f] !== 'string') continue;
      const v = input[f].trim();
      if (!v) continue;
      out[f] = SECRET_FIELDS[f] ? ctx.sec.encrypt(v) : v;
    }
    return out;
  }

  /** CRM API for one deployment, through OmniCore's GoHighLevel connection. */
  async function locationApi(account, locationId) {
    const dep = await store.get('deployments', locationId);
    const tenantId = dep?.tenantId;
    const { rows } = await pool.query(
      `SELECT g.id FROM ghl_connections g
        WHERE g.location_id = $1 AND g.status = 'active'
          ${tenantId ? 'AND g.tenant_id = $2' : ''}
        LIMIT 1`,
      tenantId ? [locationId, tenantId] : [locationId],
    );
    if (!rows[0]) {
      throw Object.assign(
        new Error(
          'Connect this workspace to GoHighLevel first (Integrations → GoHighLevel).',
        ),
        {
          status: 409,
          provider: 'CRM',
        },
      );
    }
    const { accessToken } = require('../lib/integrations/ghl');
    return ghl.api(await accessToken(rows[0].id));
  }

  async function requireActive(companyId) {
    const a = await store.get('agencies', companyId);
    if (!a)
      throw Object.assign(new Error('Voice is not set up for this account.'), {
        status: 403,
      });
    if (a.status === 'suspended')
      throw Object.assign(new Error('Voice is suspended for this account.'), {
        status: 403,
      });
    return a;
  }

  return {
    keys,
    publicKeys,
    encryptKeys,
    locationApi,
    requireActive,
    edition: () => 'standard',
    agencyApi: async () => {
      throw Object.assign(new Error('Not available in OmniCore'), {
        status: 400,
      });
    },
  };
}

let ctxSingleton = null;

function getVoiceContext() {
  if (ctxSingleton) return ctxSingleton;
  const cfg = loadConfig();
  const ctx = { cfg };
  ctx.store = createPgStore();
  ctx.sec = {
    encrypt: (plain) => (plain ? seal(plain) : ''),
    decrypt: (blob) => {
      if (!blob) return '';
      try {
        return open(blob) || '';
      } catch {
        return '';
      }
    },
  };
  ctx.twilio = createTwilio(cfg);
  ctx.vapi = createVapi(cfg);
  ctx.ghl = createGhl(cfg);
  ctx.openai = createOpenAI(cfg);
  ctx.agencySvc = createAgencyAdapter(ctx);
  ctx.provisioner = createProvisioner(ctx);
  ctx.calls = createCallService(ctx);
  ctx.qa = createQaService(ctx);
  ctx.tools = createToolService(ctx);
  ctx.automation = createAutomation(ctx);
  ctx.reports = createReports(ctx);
  ctx.background = (label, fn) =>
    Promise.resolve()
      .then(fn)
      .catch((err) =>
        logger.warn({ err: err.message, label }, 'voice_background_failed'),
      );

  // Mirror voice activity into OmniCore's audit log as well.
  const rawLog = ctx.store.log.bind(ctx.store);
  ctx.store.log = async (companyId, type, detail, extra) => {
    await rawLog(companyId, type, detail, extra);
    const { recordAudit } = require('../lib/audit');
    let locationId = extra?.locationId;
    if (!locationId && extra?.callId) {
      locationId = (
        await ctx.store.get('calls', extra.callId).catch(() => null)
      )?.locationId;
    }
    const dep = locationId
      ? await ctx.store.get('deployments', locationId).catch(() => null)
      : null;
    void recordAudit({
      action: `voice.${type}`,
      category: 'voice',
      actorType: 'system',
      tenantId: dep?.tenantId || null,
      resourceType: extra?.callId ? 'call' : 'voice',
      resourceId: extra?.callId || extra?.locationId || null,
      summary: String(detail || '').slice(0, 300),
      metadata: { companyId, ...(extra || {}) },
    });
  };

  /** Places queued speed-to-lead calls, retries CRM syncs, closes stale calls. */
  ctx.sweep = async (source) => {
    const deadline = Date.now() + 40e3;
    const stale = await ctx.calls.sweepStale();
    let leads = 0;
    let synced = 0;
    let n;
    do {
      n = await ctx.automation.processDueLeads(25);
      leads += n;
    } while (n === 25 && Date.now() < deadline);
    do {
      n = await ctx.qa.retryQueued(25);
      synced += n;
    } while (n >= 25 && Date.now() < deadline);
    const result = { stale, synced, leads };
    await ctx.store.put('meta', {
      _id: 'sweep',
      lastAt: new Date().toISOString(),
      source: source || 'timer',
      result,
    });
    return result;
  };

  ctxSingleton = ctx;
  return ctx;
}

let started = false;
/** Background sweep (with a cross-instance lease) and retention purge. */
function startVoiceWorkers() {
  if (started || process.env.VOICE_WORKER === 'false') return;
  started = true;
  const ctx = getVoiceContext();
  const every = ctx.cfg.sweepIntervalSec * 1000;
  setInterval(async () => {
    try {
      if (await ctx.store.claim('sweep', every)) await ctx.sweep('timer');
    } catch (err) {
      logger.warn({ err: err.message }, 'voice_sweep_failed');
    }
  }, every).unref?.();
  setInterval(
    () => ctx.store.purge().catch(() => {}),
    6 * 60 * 60 * 1000,
  ).unref?.();
}

module.exports = { getVoiceContext, startVoiceWorkers, appBase, KEY_FIELDS };
