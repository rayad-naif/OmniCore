'use strict';
/* Shadow QA + CRM sync, run after each call ends:
     1. Grade the call with the agency's OpenAI key (score, sentiment,
        outcome, summary, next steps, coaching).
     2. Find or create the GHL contact by caller number.
     3. Write the AI custom fields, a note with the summary, transcript and
        recording link, and outcome tags.
     4. Move the opportunity to the pipeline stage mapped to the outcome.
   Failures are stored on the call and retried by the sweep (max 5 tries). */
const { OUTCOMES } = require('./provisioner');

const MAX_ATTEMPTS = 5;
// Shown as the contact "Source" in the client's CRM: the agency's brand.
const contactSource = (agency) =>
  (
    (agency && agency.branding && agency.branding.name) ||
    'AI Phone Agent'
  ).slice(0, 60);

const GRADE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'score',
    'sentiment',
    'outcome',
    'summary',
    'nextSteps',
    'coaching',
    'callerName',
    'callerEmail',
    'flags',
  ],
  properties: {
    score: {
      type: 'integer',
      description: '0-100 quality of the AI agent on this call',
    },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    outcome: { type: 'string', enum: OUTCOMES },
    summary: {
      type: 'string',
      description: '2-4 sentence summary for the CRM',
    },
    nextSteps: { type: 'array', items: { type: 'string' } },
    coaching: {
      type: 'array',
      items: { type: 'string' },
      description: 'Specific prompt/behaviour fixes for the AI agent',
    },
    callerName: {
      type: 'string',
      description: 'Caller full name if stated, else empty',
    },
    callerEmail: {
      type: 'string',
      description: 'Caller email if stated, else empty',
    },
    flags: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'hallucination',
          'rude',
          'missed_booking',
          'escalation_needed',
          'compliance',
          'caller_frustrated',
          'none',
        ],
      },
    },
  },
};

const GRADER_SYSTEM = [
  'You are a strict QA analyst for an AI phone receptionist/sales/support team.',
  'Grade the AI agent (not the caller). 90+ = flawless, 70-89 = good with minor issues, 50-69 = noticeable problems, <50 = failed the caller.',
  'Penalize: invented facts or prices, ignoring the caller, long rambling answers, failing to book when the caller wanted to, failing to escalate when needed.',
  'Choose the single best outcome. Use "voicemail" for answering machines and "spam" for robocalls/sales pitches.',
  'Write the summary for a busy business owner reading the CRM.',
].join('\n');

function transcriptText(call) {
  if (call.fullTranscript) return call.fullTranscript.slice(-30000);
  return (call.transcript || [])
    .map(
      (l) =>
        (l.role === 'caller'
          ? 'Caller'
          : 'AI' + (l.agent ? ' (' + l.agent + ')' : '')) +
        ': ' +
        l.text,
    )
    .join('\n')
    .slice(-30000);
}

function noteBody(call, grade, dep) {
  const lines = [
    '📞 AI call ' +
      (call.direction || 'inbound') +
      ' - ' +
      (dep.name || '') +
      ' (' +
      new Date(call.createdAt).toLocaleString('en-US', {
        timeZone: (dep.agent && dep.agent.timezone) || 'UTC',
      }) +
      ')',
    grade
      ? 'Outcome: ' +
        grade.outcome.replace(/_/g, ' ') +
        ' | Sentiment: ' +
        grade.sentiment +
        ' | QA score: ' +
        grade.score +
        '/100'
      : '',
    '',
    'Summary: ' + ((grade && grade.summary) || call.summary || '(none)'),
    grade && grade.nextSteps.length
      ? '\nNext steps:\n- ' + grade.nextSteps.join('\n- ')
      : '',
    call.recordingUrl ? '\nRecording: ' + call.recordingUrl : '',
    '\nTranscript:\n' + transcriptText(call).slice(0, 12000),
  ];
  return lines
    .filter((l) => l !== '')
    .join('\n')
    .slice(0, 15000);
}

function createQaService(ctx) {
  const { store, agencySvc, openai } = ctx;

  async function grade(agency, call) {
    const k = agencySvc.keys(agency);
    if (!k.openaiKey) return null;
    const text = transcriptText(call);
    if (text.trim().length < 20) {
      return {
        score: 0,
        sentiment: 'neutral',
        outcome:
          call.endedReason && /voicemail/i.test(call.endedReason)
            ? 'voicemail'
            : 'other',
        summary: 'No conversation took place.',
        nextSteps: [],
        coaching: [],
        callerName: '',
        callerEmail: '',
        flags: ['none'],
      };
    }
    const g = await openai.client(k.openaiKey).json({
      system: GRADER_SYSTEM,
      user: 'Call transcript:\n' + text,
      schema: GRADE_SCHEMA,
      name: 'call_grade',
    });
    g.score = Math.max(0, Math.min(100, Math.round(g.score)));
    g.flags = (g.flags || []).filter((f) => f !== 'none');
    return g;
  }

  async function syncCrm(agency, dep, call, g) {
    const number = call.customer && call.customer.number;
    if (!number) return { skipped: 'no caller ID' };
    const api = await agencySvc.locationApi(agency, dep._id);
    const contactInput = {
      locationId: dep._id,
      phone: number,
      source: contactSource(agency),
    };
    if (g && g.callerName) {
      const [first, ...rest] = g.callerName.trim().split(/\s+/);
      contactInput.firstName = first;
      if (rest.length) contactInput.lastName = rest.join(' ');
    }
    if (g && g.callerEmail && /@/.test(g.callerEmail))
      contactInput.email = g.callerEmail;
    const fids = dep.fieldIds || {};
    const cf = [];
    const put = (key, value) => {
      if (fids[key] && value !== undefined && value !== '')
        cf.push({ id: fids[key], field_value: value });
    };
    if (g) {
      put('summary', g.summary);
      put('sentiment', g.sentiment);
      put('score', g.score);
      put('outcome', g.outcome.replace(/_/g, ' '));
      put('nextSteps', g.nextSteps.join('\n'));
    } else {
      put('summary', call.summary);
    }
    put('recording', call.recordingUrl);
    put('lastCallAt', call.endedAt || call.createdAt);
    if (cf.length) contactInput.customFields = cf;

    const contact = await api.upsertContact(contactInput);
    const contactId = contact && (contact.id || contact._id);
    if (!contactId) throw new Error('The CRM did not return a contact');
    await api.addNote(contactId, noteBody(call, g, dep));
    const tags = ['ai-call'];
    if (g) tags.push('ai-' + g.outcome.replace(/_/g, '-'));
    await api.addTags(contactId, tags).catch(() => {});

    let opportunityId = '';
    const p = dep.pipeline || {};
    const stageId = g && p.pipelineId && p.stages && p.stages[g.outcome];
    if (stageId) {
      const o = await api.upsertOpportunity({
        locationId: dep._id,
        contactId,
        pipelineId: p.pipelineId,
        pipelineStageId: stageId,
        name: ((g && g.callerName) || number) + ' - AI call',
        status: 'open',
      });
      opportunityId =
        (o && ((o.opportunity && o.opportunity.id) || o.id)) || '';
    }
    return { contactId, opportunityId, stageId: stageId || '' };
  }

  async function processCall(callId) {
    const call = await store.get('calls', callId);
    if (!call || call.status !== 'ended') return null;
    if (call.sync && call.sync.state === 'done') return call.sync;
    const attempts = ((call.sync && call.sync.attempts) || 0) + 1;
    await store.patch('calls', callId, {
      'sync.state': 'running',
      'sync.attempts': attempts,
      'sync.at': new Date().toISOString(),
    });
    try {
      const agency = await store.get('agencies', call.companyId);
      const dep = await store.get('deployments', call.locationId);
      if (!agency || !dep) throw new Error('Company or deployment missing');
      let g = call.grade || null;
      if (!g) {
        g = await grade(agency, call);
        if (g)
          await store.patch('calls', callId, { grade: g }, { inc: { seq: 1 } });
      }
      // Alerts from the grade (raised once, before the CRM work).
      if (g && !call.qaAlerted && ctx.automation) {
        for (const text of ctx.automation.qaAlerts(dep, g))
          await ctx.automation.raise(callId, 'qa', text);
        await store.patch('calls', callId, { qaAlerted: true });
      }
      const crm = await syncCrm(agency, dep, call, g);
      const fresh = await store.get('calls', callId);
      let sms = (call.sync && call.sync.sms) || '';
      if (!sms && ctx.automation) {
        try {
          sms = await ctx.automation.sendFollowUp(
            agency,
            dep,
            fresh,
            g,
            crm.contactId,
          );
        } catch (e) {
          sms = 'error: ' + e.message.slice(0, 120);
        }
      }
      const sync = {
        state: 'done',
        attempts,
        at: new Date().toISOString(),
        contactId: crm.contactId || '',
        opportunityId: crm.opportunityId || '',
        skipped: crm.skipped || '',
        sms,
      };
      await store.patch('calls', callId, { sync }, { inc: { seq: 1 } });
      await store.log(
        call.companyId,
        'call.synced',
        (g ? g.outcome + ' (' + g.score + ')' : 'synced') +
          (crm.skipped ? ' - ' + crm.skipped : ''),
        { locationId: call.locationId, callId },
      );
      return sync;
    } catch (e) {
      const state = attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
      await store.patch('calls', callId, {
        'sync.state': state,
        'sync.error': e.message.slice(0, 300),
      });
      await store.log(
        call.companyId,
        'call.sync_error',
        e.message.slice(0, 200),
        { locationId: call.locationId, callId },
      );
      return { state, error: e.message };
    }
  }

  // Calls waiting for QA/CRM sync, across every agency and sub-account.
  // A failed attempt waits 5 minutes before the next one, so the 5 tries are
  // spread out instead of burned in one sweep.
  async function retryQueued(limit) {
    const cutoff = Date.now() - 5 * 60e3;
    const ready = (c) =>
      !(c.sync && c.sync.at) || Date.parse(c.sync.at) < cutoff;
    const docs = (
      await store.find(
        'calls',
        { 'sync.state': 'queued', status: 'ended' },
        { limit: (limit || 25) * 4 },
      )
    )
      .filter(ready)
      .slice(0, limit || 25);
    // Also pick up runs that died mid-way (serverless timeouts).
    const stuck = await store.find(
      'calls',
      { 'sync.state': 'running' },
      { limit: 25 },
    );
    const all = docs.concat(stuck.filter(ready));
    for (const c of all) await processCall(c._id);
    return all.length;
  }

  return { grade, syncCrm, processCall, retryQueued, GRADE_SCHEMA };
}

module.exports = { createQaService, GRADE_SCHEMA, noteBody, contactSource };
