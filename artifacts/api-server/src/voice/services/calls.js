'use strict';
/* Live call state from Vapi server messages, plus the human controls of the
   Command Deck (whisper, say, mute, end, takeover).

   Audio never touches this server: "Listen" streams straight from Vapi's
   per-call listenUrl to the browser, and "Takeover" bridges the caller to the
   supervisor's browser through Twilio (Voice JS SDK). This server only stores
   text state and forwards small control requests. */
const { randomToken } = require('../security');

const MAX_LINES = 600;
const ACTIVE = ['queued', 'ringing', 'in-progress', 'forwarding'];

function createCallService(ctx) {
  const { store, sec, vapi, cfg } = ctx; // ctx.automation is attached later
  const now = () => new Date().toISOString();

  function baseDoc(dep, call) {
    const c = call || {};
    return {
      _id: c.id,
      companyId: dep.companyId,
      locationId: dep._id,
      createdAt: c.createdAt || now(),
      status: c.status || 'in-progress',
      direction:
        c.type === 'outboundPhoneCall'
          ? 'outbound'
          : c.type === 'webCall'
            ? 'web'
            : 'inbound',
      customer: {
        number: (c.customer && c.customer.number) || '',
        name: (c.customer && c.customer.name) || '',
      },
      phoneNumber: (dep.twilio && dep.twilio.phoneNumber) || '',
      agent: c.type === 'outboundPhoneCall' ? 'Outbound' : 'Receptionist',
      leadId:
        (c.metadata && c.metadata.leadId) ||
        (c.assistantOverrides &&
          c.assistantOverrides.metadata &&
          c.assistantOverrides.metadata.leadId) ||
        undefined,
      alerts: [],
      transcript: [],
      seq: 0,
      sync: { state: 'pending' },
    };
  }

  function agentLabel(msg) {
    const n = (msg.assistant && msg.assistant.name) || '';
    const m = n.match(/ - (Receptionist|Sales|Support|Outbound)$/);
    return m ? m[1] : n || null;
  }

  // Make sure the call document exists and carries the monitor URLs.
  async function ensureCall(dep, msg) {
    const call = msg.call || {};
    if (!call.id) return null;
    let doc = await store.get('calls', call.id);
    if (!doc) {
      doc = baseDoc(dep, call);
      await store.put('calls', doc);
      await store.log(
        dep.companyId,
        'call.start',
        (doc.customer.number || 'Unknown caller') +
          ' -> ' +
          (dep.name || dep._id),
        { locationId: dep._id, callId: call.id },
      );
    }
    const set = {};
    const mon = call.monitor || {};
    if (mon.listenUrl && !doc.monitor) {
      set.monitor = {
        listenUrl: sec.encrypt(mon.listenUrl),
        controlUrl: sec.encrypt(mon.controlUrl || ''),
      };
    }
    const label = agentLabel(msg);
    if (label && label !== doc.agent) set.agent = label;
    if (Object.keys(set).length) doc = await store.patch('calls', call.id, set);
    return doc;
  }

  async function addLine(callId, line) {
    return store.patch(
      'calls',
      callId,
      { partial: null },
      {
        push: { transcript: { each: [line], slice: -MAX_LINES } },
        inc: { seq: 1 },
      },
    );
  }

  /* ---------- Vapi server messages ---------- */
  async function ingest(dep, msg) {
    const type = msg.type;
    const doc = await ensureCall(dep, msg);
    if (!doc) return null;
    const id = doc._id;

    switch (type) {
      case 'status-update': {
        const set = { status: msg.status || doc.status };
        if (msg.status === 'in-progress' && !doc.answeredAt)
          set.answeredAt = now();
        if (msg.status === 'ended') {
          set.endedAt = doc.endedAt || now();
          set.endedReason = msg.endedReason || doc.endedReason || '';
        }
        await store.patch('calls', id, set, { inc: { seq: 1 } });
        break;
      }
      case 'transcript': {
        const text = String(msg.transcript || '').trim();
        if (!text) break;
        const role = msg.role === 'user' ? 'caller' : 'agent';
        if (msg.transcriptType === 'partial') {
          await store.patch(
            'calls',
            id,
            { partial: { role, text: text.slice(0, 500), agent: doc.agent } },
            { inc: { seq: 1 } },
          );
        } else {
          await addLine(id, {
            role,
            text: text.slice(0, 2000),
            agent: role === 'agent' ? doc.agent : undefined,
            at: now(),
          });
          // Live alert when the caller says a watched keyword (once per keyword per call).
          const hit =
            role === 'caller' &&
            ctx.automation &&
            ctx.automation.keywordHit(dep, text);
          if (
            hit &&
            !(doc.alerts || []).some(
              (a) => a.kind === 'keyword' && a.text.startsWith('"' + hit + '"'),
            )
          ) {
            await ctx.automation.raise(id, 'keyword', '"' + hit + '": ' + text);
          }
        }
        break;
      }
      case 'conversation-update':
        // Used only as a fallback when "transcript" messages are not subscribed.
        if (!doc.transcript.length && Array.isArray(msg.conversation)) {
          const lines = msg.conversation
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({
              role: m.role === 'user' ? 'caller' : 'agent',
              text: String(m.content || '').slice(0, 2000),
              at: now(),
            }));
          if (lines.length)
            await store.patch(
              'calls',
              id,
              { transcript: lines.slice(-MAX_LINES) },
              { inc: { seq: 1 } },
            );
        }
        break;
      case 'hang':
        await store.patch(
          'calls',
          id,
          { warning: 'The agent went quiet (no response) at ' + now() },
          { inc: { seq: 1 } },
        );
        break;
      case 'end-of-call-report': {
        const art = msg.artifact || {};
        const set = {
          status: 'ended',
          endedAt: msg.endedAt || doc.endedAt || now(),
          startedAt: msg.startedAt || doc.startedAt || doc.createdAt,
          endedReason: msg.endedReason || doc.endedReason || '',
          recordingUrl:
            msg.recordingUrl ||
            art.recordingUrl ||
            (art.recording &&
              art.recording.mono &&
              art.recording.mono.combinedUrl) ||
            '',
          summary: (msg.analysis && msg.analysis.summary) || msg.summary || '',
          cost: typeof msg.cost === 'number' ? msg.cost : undefined,
          durationSec:
            typeof msg.durationSeconds === 'number'
              ? Math.round(msg.durationSeconds)
              : undefined,
          fullTranscript: String(art.transcript || msg.transcript || '').slice(
            0,
            100000,
          ),
          partial: null,
          'sync.state': 'queued',
        };
        // Prefer the final, complete message list over the live lines.
        const msgs = art.messages || msg.messages;
        if (Array.isArray(msgs) && msgs.length) {
          const lines = msgs
            .filter(
              (m) =>
                m.role === 'user' || m.role === 'bot' || m.role === 'assistant',
            )
            .map((m) => ({
              role: m.role === 'user' ? 'caller' : 'agent',
              text: String(m.message || m.content || '').slice(0, 2000),
              at: m.time ? new Date(m.time).toISOString() : undefined,
            }));
          if (lines.length) set.transcript = lines.slice(-MAX_LINES);
        }
        Object.keys(set).forEach((k) => set[k] === undefined && delete set[k]);
        await store.patch('calls', id, set, { inc: { seq: 1 } });
        await store.log(
          dep.companyId,
          'call.end',
          (doc.customer.number || 'Unknown caller') +
            ' (' +
            (set.endedReason || 'ended') +
            ')',
          { locationId: dep._id, callId: id },
        );
        return { ended: true, callId: id };
      }
      default:
        break;
    }
    return { callId: id };
  }

  /* ---------- reads for the Command Deck (already scoped by the caller) ---------- */
  function scopeFilter(scope) {
    const f = { companyId: scope.companyId };
    if (scope.locationId) f.locationId = scope.locationId;
    else if (scope.locationIds) f.locationId = { $in: scope.locationIds };
    return f;
  }

  function summarize(c) {
    return {
      id: c._id,
      locationId: c.locationId,
      status: c.status,
      direction: c.direction,
      customer: c.customer,
      agent: c.agent,
      createdAt: c.createdAt,
      answeredAt: c.answeredAt,
      endedAt: c.endedAt,
      durationSec: c.durationSec,
      seq: c.seq || 0,
      lastLine: (c.transcript || []).slice(-1)[0] || null,
      takeover: c.takeover
        ? { state: c.takeover.state, by: c.takeover.byName }
        : null,
      muted: !!c.muted,
      grade: c.grade
        ? {
            score: c.grade.score,
            sentiment: c.grade.sentiment,
            outcome: c.grade.outcome,
          }
        : null,
      warning: c.warning || '',
      alerts: (c.alerts || []).slice(-5),
      leadId: c.leadId || null,
    };
  }

  async function active(scope) {
    const f = Object.assign(scopeFilter(scope), { status: { $in: ACTIVE } });
    const docs = await store.find('calls', f, {
      sort: { createdAt: -1 },
      limit: 100,
    });
    // Calls Vapi never closed (missed webhook) drop off the grid after 2 hours.
    const cutoff = Date.now() - 2 * 3600e3;
    return docs
      .filter((c) => Date.parse(c.updatedAt || c.createdAt) > cutoff)
      .map(summarize);
  }

  async function recent(scope, opts) {
    opts = opts || {};
    const f = scopeFilter(scope);
    if (opts.before) f.createdAt = { $lt: opts.before };
    const docs = await store.find('calls', f, {
      sort: { createdAt: -1 },
      limit: Math.min(100, opts.limit || 30),
    });
    return docs.map(summarize);
  }

  async function get(scope, id) {
    const c = await store.get('calls', id);
    if (!c || c.companyId !== scope.companyId) return null;
    if (scope.locationId && c.locationId !== scope.locationId) return null;
    if (scope.locationIds && !scope.locationIds.includes(c.locationId))
      return null;
    return c;
  }

  // Transcript lines after `after` (index), for cheap polling.
  async function detail(scope, id, after) {
    const c = await get(scope, id);
    if (!c) return null;
    const lines = c.transcript || [];
    const from = Math.max(0, Math.min(Number(after) || 0, lines.length));
    return Object.assign(summarize(c), {
      lines: lines.slice(from),
      total: lines.length,
      partial: c.partial || null,
      whispers: (c.whispers || []).slice(-20),
      summary: c.summary || '',
      recordingUrl: c.recordingUrl || '',
      grade: c.grade || null,
      sync: c.sync || null,
      endedReason: c.endedReason || '',
      canListen:
        !!(c.monitor && c.monitor.listenUrl) && ACTIVE.includes(c.status),
    });
  }

  function controlUrl(c) {
    const url = c.monitor && sec.decrypt(c.monitor.controlUrl);
    if (!url)
      throw Object.assign(
        new Error(
          'Live control is not available for this call (it may have ended).',
        ),
        { status: 409 },
      );
    return url;
  }

  async function listenUrl(scope, id) {
    const c = await get(scope, id);
    if (!c) return null;
    if (!ACTIVE.includes(c.status))
      throw Object.assign(new Error('This call has ended'), { status: 409 });
    return (c.monitor && sec.decrypt(c.monitor.listenUrl)) || '';
  }

  async function act(scope, id, action, payload, user) {
    const c = await get(scope, id);
    if (!c) throw Object.assign(new Error('Call not found'), { status: 404 });
    if (!ACTIVE.includes(c.status))
      throw Object.assign(new Error('This call has ended'), { status: 409 });
    const url = controlUrl(c);
    const who = user.name || user.email || 'Supervisor';
    const text = String((payload && payload.text) || '')
      .trim()
      .slice(0, 600);

    if (action === 'whisper' || action === 'say') {
      if (!text)
        throw Object.assign(new Error('Type a message first'), { status: 400 });
      await (action === 'whisper'
        ? vapi.controls.whisper(url, text)
        : vapi.controls.say(url, text));
      await store.patch(
        'calls',
        id,
        {},
        {
          push: {
            whispers: {
              each: [{ kind: action, text, by: who, at: now() }],
              slice: -50,
            },
          },
          inc: { seq: 1 },
        },
      );
    } else if (action === 'mute' || action === 'unmute') {
      await vapi.controls[action](url);
      await store.patch(
        'calls',
        id,
        { muted: action === 'mute' },
        { inc: { seq: 1 } },
      );
    } else if (action === 'end') {
      await vapi.controls.end(url);
    } else if (action === 'transfer') {
      const number = String((payload && payload.number) || '').replace(
        /[^\d+]/g,
        '',
      );
      if (!/^\+\d{8,15}$/.test(number))
        throw Object.assign(
          new Error(
            'Enter the number in international format, e.g. +15551234567',
          ),
          { status: 400 },
        );
      await vapi.controls.transfer(url, number);
      await store.patch(
        'calls',
        id,
        {
          takeover: {
            state: 'transferred',
            byName: who,
            to: number,
            at: now(),
          },
        },
        { inc: { seq: 1 } },
      );
    } else {
      throw Object.assign(new Error('Unknown action'), { status: 400 });
    }
    await store.log(
      c.companyId,
      'call.' + action,
      who + (text ? ': ' + text.slice(0, 80) : ''),
      { locationId: c.locationId, callId: id },
    );
    return { ok: true };
  }

  /* ---------- Takeover: Vapi transfers the caller to the agency's takeover
     line; Twilio asks /twilio/voice/takeover what to do, and we ring the
     supervisor's browser (Voice SDK identity) that claimed the takeover. ---------- */
  async function takeover(scope, id, agency, user, identity) {
    const c = await get(scope, id);
    if (!c) throw Object.assign(new Error('Call not found'), { status: 404 });
    if (!ACTIVE.includes(c.status))
      throw Object.assign(new Error('This call has ended'), { status: 409 });
    const line = agency.setup && agency.setup.takeoverNumber;
    if (!line)
      throw Object.assign(
        new Error(
          'Browser takeover is not set up. Run a deployment (it creates the takeover line) or use "Transfer to phone".',
        ),
        { status: 409 },
      );
    const url = controlUrl(c);
    const tk = {
      _id: randomToken(12),
      companyId: c.companyId,
      locationId: c.locationId,
      callId: id,
      identity,
      userName: user.name || user.email || 'Supervisor',
      customerNumber: c.customer.number || '',
      createdAt: now(),
      expiresAt: new Date(Date.now() + 120e3).toISOString(),
      state: 'pending',
    };
    await store.put('takeovers', tk);
    // Stop the AI talking over the handoff, then transfer.
    await vapi.controls.mute(url).catch(() => {});
    await vapi.controls.transfer(
      url,
      line,
      'One moment, I am connecting you with a member of our team.',
    );
    await store.patch(
      'calls',
      id,
      {
        takeover: {
          state: 'connecting',
          byName: tk.userName,
          identity,
          at: now(),
        },
        muted: true,
      },
      { inc: { seq: 1 } },
    );
    await store.log(c.companyId, 'call.takeover', tk.userName, {
      locationId: c.locationId,
      callId: id,
    });
    return { ok: true, takeoverId: tk._id };
  }

  // Called by Twilio when the transferred call reaches the takeover line.
  async function claimTakeover(agencyId, fromNumber) {
    const pending = await store.find(
      'takeovers',
      { companyId: agencyId, state: 'pending' },
      { sort: { createdAt: -1 }, limit: 20 },
    );
    const live = pending.filter((t) => Date.parse(t.expiresAt) > Date.now());
    // Prefer the takeover whose caller matches this caller ID, else the newest.
    const tk =
      live.find((t) => t.customerNumber && t.customerNumber === fromNumber) ||
      live[0];
    if (!tk) return null;
    await store.patch('takeovers', tk._id, { state: 'claimed' });
    await store.patch(
      'calls',
      tk.callId,
      { 'takeover.state': 'live' },
      { inc: { seq: 1 } },
    );
    return tk;
  }

  // Close stuck calls Vapi never reported as ended.
  async function sweepStale() {
    const docs = await store.find(
      'calls',
      { status: { $in: ACTIVE } },
      { limit: 500 },
    );
    const cutoff = Date.now() - 3 * 3600e3;
    let n = 0;
    for (const c of docs) {
      if (Date.parse(c.updatedAt || c.createdAt) < cutoff) {
        await store.patch('calls', c._id, {
          status: 'ended',
          endedReason: 'stale',
          'sync.state': 'queued',
        });
        n++;
      }
    }
    return n;
  }

  return {
    ingest,
    active,
    recent,
    get,
    detail,
    listenUrl,
    act,
    takeover,
    claimTakeover,
    sweepStale,
    ACTIVE,
    pollMs: cfg.livePollMs,
  };
}

module.exports = { createCallService, ACTIVE };
