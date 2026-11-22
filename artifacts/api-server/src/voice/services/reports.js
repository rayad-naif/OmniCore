'use strict';
/* ROI report and CSV export: what the AI call center did for a client. */

function dayKey(iso, tz) {
  try {
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
  } catch {
    return String(iso).slice(0, 10);
  }
}
function hourOf(iso, tz) {
  try {
    return (
      Number(
        new Date(iso).toLocaleString('en-US', {
          timeZone: tz,
          hour: '2-digit',
          hourCycle: 'h23',
        }),
      ) % 24
    );
  } catch {
    return new Date(iso).getUTCHours();
  }
}

function createReports(ctx) {
  const { store } = ctx;

  async function summary(scope, opts) {
    const days = Math.min(365, Math.max(1, Number(opts.days) || 30));
    const since = new Date(Date.now() - days * 86400e3).toISOString();
    const f = { companyId: scope.companyId, createdAt: { $gte: since } };
    const lf = { companyId: scope.companyId, createdAt: { $gte: since } };
    if (scope.locationId) {
      f.locationId = scope.locationId;
      lf.locationId = scope.locationId;
    } else if (scope.locationIds) {
      f.locationId = { $in: scope.locationIds };
      lf.locationId = { $in: scope.locationIds };
    }

    const deps = scope.locationId
      ? [await store.get('deployments', scope.locationId)].filter(Boolean)
      : await store.find(
          'deployments',
          Object.assign(
            { companyId: scope.companyId },
            scope.locationIds ? { _id: { $in: scope.locationIds } } : {},
          ),
        );
    const depById = new Map(deps.map((d) => [d._id, d]));
    const tz =
      deps.length === 1
        ? (deps[0].agent && deps[0].agent.timezone) || 'UTC'
        : 'UTC';

    const calls = await store.find('calls', f, { limit: 20000 });
    const leads = await store.find('leads', lf, { limit: 20000 });

    const daily = {};
    for (let i = days - 1; i >= 0; i--)
      daily[dayKey(new Date(Date.now() - i * 86400e3).toISOString(), tz)] = {
        calls: 0,
        booked: 0,
        missed: 0,
      };
    const outcomes = {};
    const agents = {};
    const hours = new Array(24).fill(0);
    let minutes = 0,
      cost = 0,
      scoreSum = 0,
      graded = 0,
      booked = 0,
      tickets = 0,
      answered = 0,
      revenue = 0,
      alerts = 0,
      afterHours = 0;

    calls.forEach((c) => {
      const k = dayKey(c.createdAt, tz);
      const isBooked = !!(
        c.booked ||
        (c.grade && c.grade.outcome === 'appointment_booked')
      );
      const spoke = (c.transcript || []).some((l) => l.role === 'caller');
      if (daily[k]) {
        daily[k].calls++;
        if (isBooked) daily[k].booked++;
        if (!spoke && c.direction === 'inbound') daily[k].missed++;
      }
      if (spoke) answered++;
      hours[hourOf(c.createdAt, tz)]++;
      minutes += (c.durationSec || 0) / 60;
      cost += c.cost || 0;
      if (c.grade) {
        graded++;
        scoreSum += c.grade.score;
        outcomes[c.grade.outcome] = (outcomes[c.grade.outcome] || 0) + 1;
      }
      if (isBooked) {
        booked++;
        const d = depById.get(c.locationId);
        revenue += (d && d.agent && d.agent.avgJobValue) || 0;
      }
      if (c.ticket || (c.grade && c.grade.outcome === 'support_ticket'))
        tickets++;
      if (c.agent) agents[c.agent] = (agents[c.agent] || 0) + 1;
      if ((c.alerts || []).length) alerts++;
      const h = hourOf(c.createdAt, tz);
      if (h < 8 || h >= 18) afterHours++;
    });

    const leadStats = {
      received: leads.length,
      connected: leads.filter((l) => l.status === 'connected').length,
      unreached: leads.filter(
        (l) => l.status === 'unreached' || l.status === 'failed',
      ).length,
      pending: leads.filter(
        (l) => l.status === 'queued' || l.status === 'calling',
      ).length,
    };
    const avgSpeedSec = (() => {
      const t = leads
        .filter((l) => l.lastCallAt && l.attempts >= 1)
        .map((l) => (Date.parse(l.lastCallAt) - Date.parse(l.createdAt)) / 1000)
        .filter((x) => x >= 0 && x < 3600);
      return t.length
        ? Math.round(t.reduce((a, b) => a + b, 0) / t.length)
        : null;
    })();

    return {
      days,
      timezone: tz,
      clients: deps.map((d) => ({ locationId: d._id, name: d.name })),
      totals: {
        calls: calls.length,
        answered,
        booked,
        tickets,
        afterHours,
        alerts,
        minutes: Math.round(minutes),
        cost: Math.round(cost * 100) / 100,
        avgScore: graded ? Math.round(scoreSum / graded) : null,
        bookingRate: answered ? Math.round((booked / answered) * 100) : 0,
        estRevenue: Math.round(revenue),
        roi: cost > 0 && revenue > 0 ? Math.round(revenue / cost) : null,
        // A receptionist handles roughly 12 calls an hour including follow-up.
        staffHoursSaved: Math.round(minutes / 60 + calls.length / 12),
      },
      daily: Object.entries(daily).map(([date, v]) =>
        Object.assign({ date }, v),
      ),
      outcomes,
      agents,
      hours,
      leads: Object.assign(leadStats, { avgSpeedSec }),
    };
  }

  async function csv(scope, opts) {
    const days = Math.min(365, Math.max(1, Number(opts.days) || 30));
    const f = {
      companyId: scope.companyId,
      createdAt: { $gte: new Date(Date.now() - days * 86400e3).toISOString() },
    };
    if (scope.locationId) f.locationId = scope.locationId;
    else if (scope.locationIds) f.locationId = { $in: scope.locationIds };
    const calls = await store.find('calls', f, {
      sort: { createdAt: -1 },
      limit: 20000,
    });
    const deps = new Map(
      (await store.find('deployments', { companyId: scope.companyId })).map(
        (d) => [d._id, d.name],
      ),
    );
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralize spreadsheet formulas
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const head = [
      'date',
      'client',
      'direction',
      'caller',
      'duration_sec',
      'last_agent',
      'outcome',
      'qa_score',
      'sentiment',
      'booked_for',
      'summary',
      'recording_url',
      'ended_reason',
      'call_id',
    ];
    const rows = calls.map((c) =>
      [
        c.createdAt,
        deps.get(c.locationId) || c.locationId,
        c.direction,
        c.customer && c.customer.number,
        c.durationSec,
        c.agent,
        c.grade && c.grade.outcome,
        c.grade && c.grade.score,
        c.grade && c.grade.sentiment,
        c.booked && c.booked.at,
        (c.grade && c.grade.summary) || c.summary,
        c.recordingUrl,
        c.endedReason,
        c._id,
      ]
        .map(cell)
        .join(','),
    );
    return [head.join(',')].concat(rows).join('\r\n') + '\r\n';
  }

  return { summary, csv };
}

module.exports = { createReports };
