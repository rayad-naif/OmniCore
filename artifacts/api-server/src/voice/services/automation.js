'use strict';
/* Revenue features on top of the call center:

   Speed-to-lead   A HighLevel workflow ("Custom Webhook" action) posts a new
                   lead to /hooks/lead/:locationId/:key and the Outbound agent
                   calls them back within seconds, inside calling hours, with
                   retries for no-answer / voicemail, a daily cap, 24h de-dupe
                   and Do-Not-Call respect.
   SMS follow-up   After each call, a text through the client's HighLevel
                   phone: booking confirmation, missed call, lead nurture,
                   ticket received.
   Live alerts     Keywords said by the caller, low QA scores, negative
                   sentiment and grader flags raise alerts in the Command Deck. */
const { randomToken } = require('../security');

const DEFAULT_KEYWORDS = [
  'manager',
  'human',
  'real person',
  'lawyer',
  'attorney',
  'sue',
  'cancel',
  'refund',
  'complaint',
  'emergency',
  'angry',
  'ridiculous',
  'scam',
  'bbb',
];
const NO_ANSWER =
  /did-not-answer|no-answer|busy|voicemail|failed|silence-timed-out|customer-did-not-give-microphone-permission/i;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const DEFAULT_FOLLOWUP = {
  enabled: false,
  booked:
    'Hi {first_name}, you are confirmed with {business} for {appointment_time}. Reply here if you need to change it.',
  missed:
    'Hi, this is {business}. Sorry we missed you! Reply here or call us back at {phone} and we will help right away.',
  lead: 'Thanks for calling {business}, {first_name}! Reply here with any questions or to pick a time that works for you.',
  ticket:
    'Hi {first_name}, {business} received your request. Our team will follow up shortly.',
};

/* ---------- settings ---------- */
function normalizeOutbound(input, base) {
  const o = Object.assign(
    {
      enabled: false,
      consent: false,
      key: '',
      maxAttempts: 2,
      retryMinutes: 30,
      dailyCap: 200,
      days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
      start: '08:00',
      end: '20:00',
    },
    base || {},
  );
  input = input || {};
  if (input.consent !== undefined) o.consent = !!input.consent;
  if (input.enabled !== undefined) o.enabled = !!input.enabled && o.consent;
  if (input.maxAttempts !== undefined)
    o.maxAttempts = Math.min(3, Math.max(1, Number(input.maxAttempts) || 1));
  if (input.retryMinutes !== undefined)
    o.retryMinutes = Math.min(
      1440,
      Math.max(10, Number(input.retryMinutes) || 30),
    );
  if (input.dailyCap !== undefined)
    o.dailyCap = Math.min(5000, Math.max(1, Number(input.dailyCap) || 200));
  if (Array.isArray(input.days))
    o.days = input.days.filter((d) => DAYS.includes(d));
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (input.start !== undefined && hhmm.test(input.start))
    o.start = input.start;
  if (input.end !== undefined && hhmm.test(input.end)) o.end = input.end;
  if (!o.key) o.key = randomToken(18);
  if (input.rotateKey) o.key = randomToken(18);
  return o;
}

function normalizeFollowUp(input, base) {
  const f = Object.assign({}, DEFAULT_FOLLOWUP, base || {});
  input = input || {};
  if (input.enabled !== undefined) f.enabled = !!input.enabled;
  ['booked', 'missed', 'lead', 'ticket'].forEach((k) => {
    if (input[k] !== undefined) f[k] = String(input[k]).slice(0, 480);
  });
  return f;
}

function normalizeAlerts(input, base) {
  const a = Object.assign(
    {
      enabled: true,
      keywords: DEFAULT_KEYWORDS.slice(),
      minScore: 60,
      negative: true,
    },
    base || {},
  );
  input = input || {};
  if (input.enabled !== undefined) a.enabled = !!input.enabled;
  if (input.keywords !== undefined) {
    const list = Array.isArray(input.keywords)
      ? input.keywords
      : String(input.keywords).split(/[,\n]/);
    a.keywords = list
      .map((k) => String(k).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 60)
      .map((k) => k.slice(0, 40));
  }
  if (input.minScore !== undefined)
    a.minScore = Math.min(100, Math.max(0, Number(input.minScore) || 0));
  if (input.negative !== undefined) a.negative = !!input.negative;
  return a;
}

/* ---------- calling-hours window (in the client's time zone) ---------- */
function localParts(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return {
    day: String(get('weekday')).slice(0, 3).toLowerCase(),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
function inWindow(o, tz, date) {
  let p;
  try {
    p = localParts(date || new Date(), tz || 'America/New_York');
  } catch {
    p = localParts(date || new Date(), 'America/New_York');
  }
  return (
    o.days.includes(p.day) &&
    p.minutes >= toMin(o.start) &&
    p.minutes < toMin(o.end)
  );
}
// Next moment the window is open (15-minute resolution, up to 8 days ahead).
function nextOpen(o, tz, from) {
  const t = new Date(Math.ceil((from || Date.now()) / (15 * 60e3)) * 15 * 60e3);
  for (let i = 0; i < 8 * 96; i++) {
    if (inWindow(o, tz, t)) return t.getTime();
    t.setTime(t.getTime() + 15 * 60e3);
  }
  return null;
}

function e164(raw) {
  const s = String(raw || '').trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+') && digits.length >= 8 && digits.length <= 15)
    return '+' + digits;
  if (digits.length === 10) return '+1' + digits; // US/CA local
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '';
}

function fill(tpl, vars) {
  return String(tpl || '')
    .replace(/\{(\w+)\}/g, (m, k) =>
      vars[k] !== undefined && vars[k] !== ''
        ? vars[k]
        : k === 'first_name'
          ? 'there'
          : '',
    )
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function createAutomation(ctx) {
  const { store, agencySvc, vapi } = ctx;
  const now = () => new Date().toISOString();

  /* ---------- speed-to-lead ---------- */
  async function receiveLead(dep, body) {
    const o = dep.outbound || {};
    if (!o.enabled)
      return {
        status: 409,
        error: 'Speed-to-lead is turned off for this client',
      };
    const b = body || {};
    const cd = b.customData || b.custom_data || {};
    const phone = e164(
      b.phone || b.phone_number || (b.contact && b.contact.phone) || cd.phone,
    );
    if (!phone)
      return { status: 400, error: 'No valid phone number in the webhook' };
    const name = String(
      b.first_name ||
        b.firstName ||
        b.full_name ||
        b.name ||
        (b.contact && b.contact.name) ||
        cd.name ||
        '',
    )
      .trim()
      .slice(0, 80);
    const interest = String(
      cd.interest || b.interest || b.message || b.source || 'your request',
    ).slice(0, 200);
    const contactId = String(
      b.contact_id || b.contactId || (b.contact && b.contact.id) || '',
    ).slice(0, 60);

    const dayAgo = new Date(Date.now() - 24 * 3600e3).toISOString();
    const recent = await store.find(
      'leads',
      { locationId: dep._id, phone, createdAt: { $gte: dayAgo } },
      { limit: 1 },
    );
    if (recent.length) return { status: 200, lead: recent[0], duplicate: true };

    const tz = (dep.agent && dep.agent.timezone) || 'America/New_York';
    const lead = {
      _id: 'lead_' + randomToken(10),
      companyId: dep.companyId,
      locationId: dep._id,
      phone,
      name,
      interest,
      contactId,
      createdAt: now(),
      status: 'queued',
      attempts: 0,
      callIds: [],
      nextAt: new Date(
        inWindow(o, tz) ? Date.now() : nextOpen(o, tz) || Date.now() + 86400e3,
      ).toISOString(),
    };
    await store.put('leads', lead);
    await store.log(
      dep.companyId,
      'lead.received',
      (name || phone) +
        (lead.nextAt > now() ? ' (queued until ' + lead.nextAt + ')' : ''),
      { locationId: dep._id, leadId: lead._id },
    );
    return {
      status: 202,
      lead,
      callNow: Date.parse(lead.nextAt) <= Date.now(),
    };
  }

  async function placeCall(leadId) {
    const lead = await store.get('leads', leadId);
    if (!lead || lead.status !== 'queued') return null;
    const dep = await store.get('deployments', lead.locationId);
    const agency = dep && (await store.get('agencies', dep.companyId));
    const finish = (status, reason) =>
      store.patch('leads', leadId, { status, reason, finishedAt: now() });
    if (
      !dep ||
      dep.status !== 'live' ||
      !agency ||
      agency.status === 'suspended' ||
      !(dep.outbound && dep.outbound.enabled)
    )
      return finish(
        'skipped',
        'Speed-to-lead is off or the client is not live',
      );
    const assistantId =
      dep.vapi && dep.vapi.assistantIds && dep.vapi.assistantIds.outbound;
    if (!assistantId)
      return finish(
        'skipped',
        'Redeploy this client to create the outbound agent',
      );

    const tz = (dep.agent && dep.agent.timezone) || 'America/New_York';
    if (!inWindow(dep.outbound, tz)) {
      return store.patch('leads', leadId, {
        nextAt: new Date(
          nextOpen(dep.outbound, tz) || Date.now() + 86400e3,
        ).toISOString(),
      });
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const calledToday = await store.find(
      'leads',
      { locationId: dep._id, lastCallAt: { $gte: today.toISOString() } },
      { limit: dep.outbound.dailyCap + 1 },
    );
    if (calledToday.length >= dep.outbound.dailyCap) {
      return store.patch('leads', leadId, {
        nextAt: new Date(
          nextOpen(dep.outbound, tz, today.getTime() + 86400e3) ||
            Date.now() + 86400e3,
        ).toISOString(),
        reason: 'Daily call cap reached',
      });
    }
    // Respect Do Not Call on the HighLevel contact.
    if (lead.contactId) {
      try {
        const api = await agencySvc.locationApi(agency, dep._id);
        const c = await api.getContact(lead.contactId);
        if (c && (c.dnd || (c.tags || []).includes('ai-do-not-call')))
          return finish('skipped', 'Contact is Do Not Disturb');
      } catch {
        /* lookup is best effort */
      }
    }

    // Claim the lead before calling so two sweeps never double-dial.
    const claimed = await store.patch(
      'leads',
      leadId,
      { status: 'calling', lastCallAt: now() },
      { inc: { attempts: 1 } },
    );
    try {
      const v = vapi.client(agencySvc.keys(agency).vapiKey);
      const call = await v.createCall({
        phoneNumberId: dep.vapi.phoneNumberId,
        assistantId,
        customer: { number: lead.phone, name: lead.name || undefined },
        assistantOverrides: {
          variableValues: {
            name: lead.name || 'there',
            interest: lead.interest || 'your request',
          },
        },
        metadata: { leadId, locationId: dep._id, companyId: dep.companyId },
      });
      await store.patch('leads', leadId, {}, { push: { callIds: call.id } });
      await store.log(
        dep.companyId,
        'lead.called',
        (lead.name || lead.phone) + ' (attempt ' + claimed.attempts + ')',
        { locationId: dep._id, callId: call.id, leadId },
      );
      return call;
    } catch (e) {
      const retry = claimed.attempts < dep.outbound.maxAttempts;
      await store.patch('leads', leadId, {
        status: retry ? 'queued' : 'failed',
        reason: e.message.slice(0, 200),
        nextAt: new Date(
          Date.now() + dep.outbound.retryMinutes * 60e3,
        ).toISOString(),
      });
      await store.log(
        dep.companyId,
        'lead.call_error',
        e.message.slice(0, 200),
        { locationId: dep._id },
      );
      return null;
    }
  }

  // Called when an outbound lead call ends: retry no-answers, else close.
  async function leadCallEnded(call) {
    if (!call.leadId) return;
    const lead = await store.get('leads', call.leadId);
    if (!lead || lead.status !== 'calling') return;
    const dep = await store.get('deployments', lead.locationId);
    const o = (dep && dep.outbound) || { maxAttempts: 1, retryMinutes: 30 };
    const unanswered =
      NO_ANSWER.test(call.endedReason || '') ||
      (call.transcript || []).filter((l) => l.role === 'caller').length === 0;
    if (unanswered && lead.attempts < o.maxAttempts) {
      const tz = (dep && dep.agent && dep.agent.timezone) || 'America/New_York';
      const at =
        nextOpen(o, tz, Date.now() + o.retryMinutes * 60e3) ||
        Date.now() + o.retryMinutes * 60e3;
      await store.patch('leads', lead._id, {
        status: 'queued',
        nextAt: new Date(at).toISOString(),
        reason: 'No answer, retrying',
      });
    } else {
      await store.patch('leads', lead._id, {
        status: unanswered ? 'unreached' : 'connected',
        finishedAt: now(),
        callId: call._id,
        reason: call.endedReason || '',
      });
      await store.log(
        lead.companyId,
        'lead.finished',
        (lead.name || lead.phone) +
          ': ' +
          (unanswered ? 'not reached' : 'connected'),
        { locationId: lead.locationId, leadId: lead._id, callId: call._id },
      );
    }
  }

  async function processDueLeads(limit) {
    const due = await store.find(
      'leads',
      { status: 'queued', nextAt: { $lte: now() } },
      { sort: { nextAt: 1 }, limit: limit || 25 },
    );
    for (const l of due) await placeCall(l._id);
    // A call that never reported back within an hour is closed.
    const stuck = await store.find(
      'leads',
      {
        status: 'calling',
        lastCallAt: { $lt: new Date(Date.now() - 3600e3).toISOString() },
      },
      { limit: 50 },
    );
    for (const l of stuck)
      await store.patch('leads', l._id, {
        status: 'unreached',
        reason: 'No call report received',
      });
    return due.length;
  }

  /* ---------- SMS follow-up ---------- */
  function pickTemplate(call, g) {
    const outcome = g && g.outcome;
    if (call.booked || outcome === 'appointment_booked') return 'booked';
    if (call.ticket || outcome === 'support_ticket') return 'ticket';
    if (outcome === 'spam') return null;
    const callerSpoke = (call.transcript || []).some(
      (l) => l.role === 'caller',
    );
    if (
      call.direction === 'inbound' &&
      (!callerSpoke || outcome === 'voicemail')
    )
      return 'missed';
    if (outcome === 'qualified_lead') return 'lead';
    return null;
  }

  async function sendFollowUp(agency, dep, call, g, contactId) {
    const f = dep.followUp;
    if (!f || !f.enabled || !contactId) return '';
    const key = pickTemplate(call, g);
    if (!key || !f[key]) return '';
    const tz = (dep.agent && dep.agent.timezone) || 'UTC';
    const message = fill(f[key], {
      first_name: ((g && g.callerName) || '').split(' ')[0],
      business: (dep.agent && dep.agent.businessName) || dep.name || '',
      phone: (dep.twilio && dep.twilio.phoneNumber) || '',
      appointment_time:
        call.booked && call.booked.at
          ? new Date(call.booked.at).toLocaleString('en-US', {
              timeZone: tz,
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : 'your appointment',
    });
    const api = await agencySvc.locationApi(agency, dep._id);
    await api.sendSms(contactId, message);
    await store.log(
      dep.companyId,
      'sms.sent',
      key + ' -> ' + ((call.customer && call.customer.number) || contactId),
      { locationId: dep._id, callId: call._id },
    );
    return key;
  }

  /* ---------- alerts ---------- */
  function keywordHit(dep, text) {
    const a = dep.alerts || normalizeAlerts({});
    if (!a.enabled) return null;
    const t =
      ' ' +
      String(text)
        .toLowerCase()
        .replace(/[^a-z0-9' ]+/g, ' ') +
      ' ';
    return a.keywords.find((k) => t.includes(' ' + k + ' ')) || null;
  }

  function qaAlerts(dep, g) {
    const a = dep.alerts || normalizeAlerts({});
    if (!a.enabled || !g) return [];
    const out = [];
    if (
      g.score < a.minScore &&
      g.outcome !== 'voicemail' &&
      g.outcome !== 'spam'
    )
      out.push('Low QA score: ' + g.score);
    if (a.negative && g.sentiment === 'negative') out.push('Unhappy caller');
    (g.flags || []).forEach((f) => out.push('Flag: ' + f.replace(/_/g, ' ')));
    return out;
  }

  async function raise(callId, kind, text) {
    const alert = {
      id: randomToken(6),
      kind,
      text: String(text).slice(0, 200),
      at: now(),
    };
    const c = await store.patch(
      'calls',
      callId,
      { alerted: true },
      { push: { alerts: { each: [alert], slice: -20 } }, inc: { seq: 1 } },
    );
    if (c)
      await store.log(c.companyId, 'call.alert', alert.text, {
        locationId: c.locationId,
        callId,
      });
    return alert;
  }

  return {
    receiveLead,
    placeCall,
    leadCallEnded,
    processDueLeads,
    sendFollowUp,
    pickTemplate,
    keywordHit,
    qaAlerts,
    raise,
  };
}

module.exports = {
  createAutomation,
  normalizeOutbound,
  normalizeFollowUp,
  normalizeAlerts,
  inWindow,
  nextOpen,
  e164,
  fill,
  DEFAULT_KEYWORDS,
  DEFAULT_FOLLOWUP,
};
