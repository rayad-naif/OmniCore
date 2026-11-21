'use strict';
/* The "Deploy Call Center to Client X" engine.

   Agency setup (once, reused by every client):
     vapi_credential   store the agency's OpenAI key in Vapi so the LLM bills to them
     browser_calling   Twilio API key + TwiML app + a "takeover line" number

   Client deployment (per GHL location):
     twilio_subaccount  isolated Twilio subaccount for the client
     twilio_number      buy a local number (preferred area code)
     vapi_assistants    Receptionist, Sales and Support assistants
     vapi_squad         Squad with handoff routes between them
     vapi_number        import the number into Vapi, answered by the squad
     ghl_fields         AI custom fields on the client's sub-account
     ghl_pipeline       outcome -> pipeline stage mapping (validated)
     portal             client command deck URL

   Every step is idempotent: resources already created are reused, so a failed
   deploy can be resumed and "Redeploy" just updates the agents. */
const { randomToken } = require('../security');
const agents = require('./agents');
const {
  normalizeOutbound,
  normalizeFollowUp,
  normalizeAlerts,
} = require('./automation');

const AGENCY_STEPS = ['vapi_credential', 'browser_calling'];
const STEPS = [
  'twilio_subaccount',
  'twilio_number',
  'vapi_assistants',
  'vapi_squad',
  'vapi_number',
  'ghl_fields',
  'ghl_pipeline',
  'portal',
];
const STEP_LABEL = {
  vapi_credential: 'Connect OpenAI key to Vapi',
  browser_calling: 'Browser takeover line',
  twilio_subaccount: 'Twilio account',
  twilio_number: 'Phone number',
  vapi_assistants: 'AI agents (Receptionist, Sales, Support, Outbound)',
  vapi_squad: 'AI switchboard (Squad routing)',
  vapi_number: 'Connect number to the switchboard',
  ghl_fields: 'CRM custom fields',
  ghl_pipeline: 'Pipeline stage mapping',
  portal: 'Client command deck',
};

const CUSTOM_FIELDS = [
  { key: 'summary', name: 'AI Call Summary', dataType: 'LARGE_TEXT' },
  { key: 'sentiment', name: 'AI Sentiment', dataType: 'TEXT' },
  { key: 'score', name: 'AI Call Score', dataType: 'NUMERICAL' },
  { key: 'outcome', name: 'AI Call Outcome', dataType: 'TEXT' },
  { key: 'nextSteps', name: 'AI Next Steps', dataType: 'LARGE_TEXT' },
  { key: 'recording', name: 'Last AI Call Recording', dataType: 'TEXT' },
  { key: 'lastCallAt', name: 'Last AI Call', dataType: 'TEXT' },
];

const OUTCOMES = [
  'appointment_booked',
  'qualified_lead',
  'support_resolved',
  'support_ticket',
  'not_interested',
  'spam',
  'voicemail',
  'other',
];

function createProvisioner(ctx) {
  const { cfg, store, sec, agencySvc, twilio, vapi } = ctx;

  const now = () => new Date().toISOString();
  const serverUrl = (locationId) =>
    cfg.baseUrl + '/webhooks/vapi/' + encodeURIComponent(locationId);

  async function setStep(depId, step, status, detail) {
    return store.patch('deployments', depId, {
      ['steps.' + step]: { status, detail: detail || '', at: now() },
    });
  }

  async function runStep(depId, step, fn) {
    await setStep(depId, step, 'running');
    try {
      const detail = await fn();
      await setStep(depId, step, 'done', detail);
      return detail;
    } catch (e) {
      await setStep(depId, step, 'failed', e.message);
      e.step = step;
      throw e;
    }
  }

  /* ---------- agency setup ---------- */
  async function ensureAgencySetup(agency, opts) {
    opts = opts || {};
    const k = agencySvc.keys(agency);
    const setup = Object.assign({}, agency.setup || {});
    const v = vapi.client(k.vapiKey);

    if (!setup.vapiCredentialId && k.openaiKey) {
      try {
        const cred = await v.createCredential({
          provider: 'openai',
          apiKey: k.openaiKey,
          name: 'AI Call Center (BYOK)',
        });
        setup.vapiCredentialId = cred.id;
      } catch (e) {
        // An existing OpenAI credential in Vapi is fine: Vapi uses it automatically.
        if (!/exist|duplicate|already/i.test(e.message)) throw e;
        setup.vapiCredentialId = 'existing';
      }
    }

    if (!setup.twimlAppSid && opts.browserCalling !== false) {
      const t = twilio.client(k.twilioSid, k.twilioToken);
      const key = await t.createApiKey('AI Call Center - Command Deck');
      const app = await t.createTwimlApp(
        'AI Call Center - Command Deck',
        cfg.baseUrl + '/twilio/voice/outbound',
      );
      setup.apiKeySid = key.sid;
      setup.apiKeySecret = sec.encrypt(key.secret);
      setup.twimlAppSid = app.sid;
    }
    if (!setup.takeoverNumber && opts.browserCalling !== false) {
      const t = twilio.client(k.twilioSid, k.twilioToken);
      const found = await t.searchLocalNumber(null, {
        country: opts.country || 'US',
        areaCode: opts.areaCode,
      });
      if (!found.length)
        throw new Error(
          'No Twilio number available for the takeover line' +
            (opts.areaCode ? ' in area code ' + opts.areaCode : ''),
        );
      const num = await t.buyNumber(null, found[0].phone_number, {
        FriendlyName: 'AI Call Center - Takeover line',
        VoiceUrl: cfg.baseUrl + '/twilio/voice/takeover',
        VoiceMethod: 'POST',
      });
      setup.takeoverNumber = num.phone_number;
      setup.takeoverNumberSid = num.sid;
    }
    await store.patch('agencies', agency._id, { setup });
    agency.setup = setup;
    return setup;
  }

  /* ---------- client deployment ---------- */
  async function createDeployment(agency, input) {
    const locationId = String(input.locationId || '').trim();
    if (!/^[A-Za-z0-9]{8,40}$/.test(locationId))
      throw Object.assign(new Error('Pick an account'), { status: 400 });
    const existing = await store.get('deployments', locationId);
    if (agency.mode === 'account' && locationId !== agency.locationId)
      throw Object.assign(
        new Error('This workspace can only set up its own account'),
        { status: 403 },
      );
    if (existing && existing.companyId !== agency._id)
      throw Object.assign(
        new Error('That account belongs to another company'),
        { status: 403 },
      );
    const dep = existing || {
      _id: locationId,
      companyId: agency._id,
      createdAt: now(),
      status: 'draft',
      steps: {},
      portalKey: randomToken(12),
      serverSecret: sec.encrypt(randomToken(24)),
    };
    dep.name = String(input.name || dep.name || '').slice(0, 120);
    dep.agent = agents.normalizeAgent(
      input.agent || {},
      dep.agent || { businessName: dep.name },
    );
    dep.options = Object.assign(
      { country: 'US', areaCode: '', useSubaccount: true },
      dep.options || {},
      pick(input.options || {}, ['country', 'areaCode', 'useSubaccount']),
    );
    dep.options.country = /^[A-Z]{2}$/.test(dep.options.country)
      ? dep.options.country
      : 'US';
    dep.options.areaCode = String(dep.options.areaCode || '')
      .replace(/\D/g, '')
      .slice(0, 3);
    if (input.pipeline) dep.pipeline = normalizePipeline(input.pipeline);
    dep.outbound = normalizeOutbound(input.outbound, dep.outbound);
    dep.followUp = normalizeFollowUp(input.followUp, dep.followUp);
    dep.alerts = normalizeAlerts(input.alerts, dep.alerts);
    await store.put('deployments', dep);
    return dep;
  }

  async function deploy(agency, locationId, opts) {
    opts = opts || {};
    let dep = await store.get('deployments', locationId);
    if (!dep || dep.companyId !== agency._id)
      throw Object.assign(new Error('Deployment not found'), { status: 404 });
    const k = agencySvc.keys(agency);
    if (!k.twilioSid || !k.twilioToken || !k.vapiKey || !k.openaiKey)
      throw Object.assign(
        new Error('Add your Twilio, Vapi and OpenAI keys first'),
        { status: 400 },
      );

    await store.patch('deployments', locationId, {
      status: 'deploying',
      lastError: '',
      deployStartedAt: now(),
    });
    await store.log(agency._id, 'deploy.start', dep.name || locationId, {
      locationId,
    });
    const tw = twilio.client(k.twilioSid, k.twilioToken);
    const v = vapi.client(k.vapiKey);
    const secret = sec.decrypt(dep.serverSecret);

    try {
      await runStep(locationId, 'vapi_credential', async () => {
        await ensureAgencySetup(agency, { browserCalling: false });
        return 'OpenAI key linked';
      });
      if (opts.browserCalling !== false) {
        await runStep(locationId, 'browser_calling', async () => {
          const s = await ensureAgencySetup(agency, {
            country: dep.options.country,
            areaCode: dep.options.areaCode,
          });
          return 'Takeover line ' + s.takeoverNumber;
        });
      }

      // 1. Telecom
      let tw2 = dep.twilio || {};
      await runStep(locationId, 'twilio_subaccount', async () => {
        if (!dep.options.useSubaccount) {
          tw2.accountSid = k.twilioSid;
          tw2.authToken = '';
          return 'Using the main Twilio account';
        }
        if (tw2.accountSid && tw2.accountSid !== k.twilioSid)
          return 'Reusing ' + tw2.accountSid;
        const sub = await tw.createSubaccount(
          (dep.agent.businessName || dep.name || locationId) +
            ' (AI Call Center)',
        );
        tw2 = { accountSid: sub.sid, authToken: sec.encrypt(sub.auth_token) };
        await store.patch('deployments', locationId, { twilio: tw2 });
        return 'Created ' + sub.sid;
      });
      const subSid = tw2.accountSid || k.twilioSid;
      const subToken = tw2.authToken
        ? sec.decrypt(tw2.authToken)
        : k.twilioToken;

      await runStep(locationId, 'twilio_number', async () => {
        if (tw2.phoneNumber) return 'Reusing ' + tw2.phoneNumber;
        let found = await tw.searchLocalNumber(subSid, {
          country: dep.options.country,
          areaCode: dep.options.areaCode,
        });
        if (!found.length && dep.options.areaCode)
          found = await tw.searchLocalNumber(subSid, {
            country: dep.options.country,
          });
        if (!found.length)
          throw new Error(
            'No local numbers available in ' + dep.options.country,
          );
        const num = await tw.buyNumber(subSid, found[0].phone_number, {
          FriendlyName: (dep.agent.businessName || 'Client') + ' AI line',
        });
        tw2 = Object.assign({}, tw2, {
          phoneNumber: num.phone_number,
          numberSid: num.sid,
        });
        await store.patch('deployments', locationId, { twilio: tw2 });
        return num.phone_number;
      });

      // 2. Agents
      const vp = Object.assign({ assistantIds: {} }, dep.vapi || {});
      const aOpts = {
        serverUrl: serverUrl(locationId),
        serverSecret: secret,
        model: cfg.openai.agentModel,
        locationId,
        companyId: agency._id,
      };
      await runStep(locationId, 'vapi_assistants', async () => {
        dep = await store.get('deployments', locationId);
        const out = [];
        for (const role of agents.ALL_ROLES) {
          const body = agents.buildAssistant(role, dep.agent, aOpts);
          if (vp.assistantIds[role]) {
            try {
              await v.updateAssistant(vp.assistantIds[role], body);
              out.push('updated ' + role);
              continue;
            } catch (e) {
              if (e.status !== 404) throw e;
            }
          }
          const created = await v.createAssistant(body);
          vp.assistantIds[role] = created.id;
          out.push('created ' + role);
          await store.patch('deployments', locationId, { vapi: vp });
        }
        return out.join(', ');
      });

      await runStep(locationId, 'vapi_squad', async () => {
        const body = agents.buildSquad(dep.agent, vp.assistantIds);
        if (vp.squadId) {
          try {
            await v.updateSquad(vp.squadId, body);
            return 'Updated';
          } catch (e) {
            if (e.status !== 404) throw e;
          }
        }
        const sq = await v.createSquad(body);
        vp.squadId = sq.id;
        await store.patch('deployments', locationId, { vapi: vp });
        return 'Created';
      });

      await runStep(locationId, 'vapi_number', async () => {
        const p = {
          squadId: vp.squadId,
          name: ((dep.agent.businessName || 'Client') + ' line').slice(0, 40),
          server: { url: serverUrl(locationId), secret },
        };
        if (vp.phoneNumberId) {
          try {
            await v.updatePhoneNumber(vp.phoneNumberId, p);
            return 'Updated';
          } catch (e) {
            if (e.status !== 404) throw e;
          }
        }
        const pn = await v.importTwilioNumber(
          Object.assign(
            {
              number: tw2.phoneNumber,
              twilioAccountSid: subSid,
              twilioAuthToken: subToken,
            },
            p,
          ),
        );
        vp.phoneNumberId = pn.id;
        await store.patch('deployments', locationId, { vapi: vp });
        return tw2.phoneNumber + ' answered by the switchboard';
      });

      // 3. CRM
      const api = await agencySvc.locationApi(agency, locationId);
      await runStep(locationId, 'ghl_fields', async () => {
        const have = await api.listCustomFields(locationId);
        const ids = Object.assign({}, dep.fieldIds || {});
        let created = 0;
        for (const f of CUSTOM_FIELDS) {
          const match = have.find(
            (h) => (h.name || '').toLowerCase() === f.name.toLowerCase(),
          );
          if (match) {
            ids[f.key] = match.id;
            continue;
          }
          const c = await api.createCustomField(locationId, {
            name: f.name,
            dataType: f.dataType,
            model: 'contact',
          });
          ids[f.key] = c.id;
          created++;
        }
        await store.patch('deployments', locationId, { fieldIds: ids });
        return (
          created +
          ' created, ' +
          (CUSTOM_FIELDS.length - created) +
          ' already there'
        );
      });

      await runStep(locationId, 'ghl_pipeline', async () => {
        const fresh = await store.get('deployments', locationId);
        const p = fresh.pipeline || {};
        if (!p.pipelineId)
          return 'Skipped: no pipeline chosen (calls still sync as notes and fields)';
        const pipes = await api.listPipelines(locationId);
        const pipe = pipes.find((x) => x.id === p.pipelineId);
        if (!pipe)
          throw new Error(
            'The chosen pipeline no longer exists in this account',
          );
        const stageIds = new Set((pipe.stages || []).map((s) => s.id));
        const bad = Object.values(p.stages || {}).filter(
          (id) => id && !stageIds.has(id),
        );
        if (bad.length)
          throw new Error('Some mapped stages are not in "' + pipe.name + '"');
        return 'Outcomes mapped into "' + pipe.name + '"';
      });

      await runStep(locationId, 'portal', async () => 'Ready');

      dep = await store.patch('deployments', locationId, {
        status: 'live',
        deployedAt: now(),
        lastError: '',
      });
      await store.log(
        agency._id,
        'deploy.done',
        (dep.name || locationId) + ' live on ' + (tw2.phoneNumber || ''),
        { locationId },
      );
      return dep;
    } catch (e) {
      await store.patch('deployments', locationId, {
        status: 'failed',
        lastError: (e.step ? STEP_LABEL[e.step] + ': ' : '') + e.message,
      });
      await store.log(
        agency._id,
        'deploy.failed',
        (e.step || '') + ': ' + e.message,
        { locationId },
      );
      throw e;
    }
  }

  // Push edited agent settings to Vapi without touching telecom/CRM.
  async function updateAgents(agency, locationId) {
    const dep = await store.get('deployments', locationId);
    if (!dep || !dep.vapi || !dep.vapi.squadId)
      throw Object.assign(new Error('Deploy this client first'), {
        status: 400,
      });
    const k = agencySvc.keys(agency);
    const v = vapi.client(k.vapiKey);
    const aOpts = {
      serverUrl: serverUrl(locationId),
      serverSecret: sec.decrypt(dep.serverSecret),
      model: cfg.openai.agentModel,
      locationId,
      companyId: agency._id,
    };
    const ids = Object.assign({}, dep.vapi.assistantIds);
    for (const role of agents.ALL_ROLES) {
      const body = agents.buildAssistant(role, dep.agent, aOpts);
      if (ids[role]) await v.updateAssistant(ids[role], body);
      else ids[role] = (await v.createAssistant(body)).id; // e.g. outbound agent added after the first deploy
    }
    if (ids.outbound !== dep.vapi.assistantIds.outbound)
      await store.patch('deployments', locationId, {
        'vapi.assistantIds': ids,
      });
    await v.updateSquad(
      dep.vapi.squadId,
      agents.buildSquad(dep.agent, dep.vapi.assistantIds),
    );
    await store.log(agency._id, 'agents.updated', dep.name || locationId, {
      locationId,
    });
  }

  // Remove everything this app created for a client (number, agents, subaccount).
  async function teardown(agency, locationId, opts) {
    opts = opts || {};
    const dep = await store.get('deployments', locationId);
    if (!dep || dep.companyId !== agency._id)
      throw Object.assign(new Error('Deployment not found'), { status: 404 });
    const k = agencySvc.keys(agency);
    const v = vapi.client(k.vapiKey);
    const tw = twilio.client(k.twilioSid, k.twilioToken);
    const errors = [];
    const attempt = async (label, fn) => {
      try {
        await fn();
      } catch (e) {
        if (e.status !== 404) errors.push(label + ': ' + e.message);
      }
    };
    const vp = dep.vapi || {};
    if (vp.phoneNumberId)
      await attempt('Vapi number', () => v.deletePhoneNumber(vp.phoneNumberId));
    if (vp.squadId)
      await attempt('Vapi squad', () => v.deleteSquad(vp.squadId));
    for (const id of Object.values(vp.assistantIds || {}))
      await attempt('Vapi assistant', () => v.deleteAssistant(id));
    const t = dep.twilio || {};
    if (opts.releaseNumber !== false && t.numberSid)
      await attempt('Twilio number', () =>
        tw.releaseNumber(t.accountSid || k.twilioSid, t.numberSid),
      );
    if (opts.closeSubaccount && t.accountSid && t.accountSid !== k.twilioSid)
      await attempt('Twilio account', () =>
        tw.setSubaccountStatus(t.accountSid, 'closed'),
      );
    // Keep the subaccount (and the number, if not released) so a redeploy reuses them.
    let twilioLeft = {};
    if (opts.releaseNumber === false) twilioLeft = t;
    else if (!opts.closeSubaccount && t.accountSid)
      twilioLeft = { accountSid: t.accountSid, authToken: t.authToken };
    await store.patch('deployments', locationId, {
      status: 'removed',
      vapi: {},
      steps: {},
      twilio: twilioLeft,
    });
    await store.log(
      agency._id,
      'deploy.removed',
      (dep.name || locationId) + (errors.length ? ' (with errors)' : ''),
      { locationId },
    );
    return { errors };
  }

  return {
    ensureAgencySetup,
    createDeployment,
    deploy,
    updateAgents,
    teardown,
  };
}

function pick(o, keys) {
  const r = {};
  keys.forEach((k) => {
    if (o[k] !== undefined) r[k] = o[k];
  });
  return r;
}

function normalizePipeline(p) {
  const out = {
    pipelineId: String(p.pipelineId || '').slice(0, 60),
    stages: {},
  };
  OUTCOMES.forEach((o) => {
    if (p.stages && p.stages[o])
      out.stages[o] = String(p.stages[o]).slice(0, 60);
  });
  return out;
}

module.exports = {
  createProvisioner,
  STEPS,
  AGENCY_STEPS,
  STEP_LABEL,
  CUSTOM_FIELDS,
  OUTCOMES,
  normalizePipeline,
};
