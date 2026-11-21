'use strict';
/* Vapi "tool-calls" for the Sales and Support agents. Results are short,
   speakable strings: the agent reads them, so no JSON blobs or URLs. */

function parseArgs(a) {
  if (!a) return {};
  if (typeof a === 'string') {
    try {
      return JSON.parse(a);
    } catch {
      return {};
    }
  }
  return a;
}

function fmtSlot(iso, tz) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const { contactSource } = require('./qa');

function createToolService(ctx) {
  const { store, agencySvc } = ctx;

  const handlers = {
    async check_availability(args, env) {
      const a = env.dep.agent || {};
      if (!a.calendarId)
        return "No booking calendar is connected. Collect the caller's preferred times and tell them the office will confirm.";
      const days = Math.min(14, Math.max(1, Number(args.days) || 5));
      let start = args.from_date
        ? Date.parse(args.from_date + 'T00:00:00Z')
        : Date.now();
      if (!Number.isFinite(start) || start < Date.now()) start = Date.now();
      const r = await env.api.freeSlots(
        a.calendarId,
        start,
        start + days * 86400e3,
        a.timezone,
      );
      const slots = [];
      Object.keys(r || {})
        .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
        .sort()
        .forEach((day) => {
          (r[day].slots || []).forEach((s) => slots.push(s));
        });
      if (!slots.length)
        return 'There are no open times in the next ' + days + ' days.';
      // Offer a spread: first few slots of up to 3 different days.
      const picked = [];
      const perDay = {};
      for (const s of slots) {
        const day = s.slice(0, 10);
        perDay[day] = (perDay[day] || 0) + 1;
        if (perDay[day] <= 2 && Object.keys(perDay).length <= 3) picked.push(s);
        if (picked.length >= 6) break;
      }
      return (
        'Open times (use the exact ISO value when booking): ' +
        picked.map((s) => fmtSlot(s, a.timezone) + ' [' + s + ']').join('; ')
      );
    },

    async book_appointment(args, env) {
      const a = env.dep.agent || {};
      if (!a.calendarId)
        return 'Booking is not available. Tell the caller the office will call to confirm the time.';
      if (!args.start_time || !Number.isFinite(Date.parse(args.start_time)))
        return 'That time is not valid. Run check_availability and use one of the exact times.';
      const phone = (env.call.customer && env.call.customer.number) || '';
      const [first, ...rest] = String(args.name || '')
        .trim()
        .split(/\s+/);
      const contact = await env.api.upsertContact(
        Object.assign(
          {
            locationId: env.dep._id,
            phone,
            firstName: first || undefined,
            lastName: rest.join(' ') || undefined,
            source: env.source,
          },
          args.email && /@/.test(args.email) ? { email: args.email } : {},
          args.address ? { address1: String(args.address).slice(0, 200) } : {},
        ),
      );
      const contactId = contact && (contact.id || contact._id);
      const start = new Date(args.start_time);
      const end = new Date(
        start.getTime() + (a.appointmentMinutes || 60) * 60e3,
      );
      await env.api.bookAppointment({
        calendarId: a.calendarId,
        locationId: env.dep._id,
        contactId,
        startTime: args.start_time,
        endTime: end.toISOString(),
        title: (args.name || 'New customer') + ' - booked by AI',
        appointmentStatus: 'confirmed',
        address: args.address || undefined,
        notes: args.notes || undefined,
        toNotify: true,
      });
      await store.patch(
        'calls',
        env.call._id,
        { booked: { at: args.start_time, contactId } },
        { inc: { seq: 1 } },
      );
      return (
        'Booked for ' +
        fmtSlot(args.start_time, a.timezone) +
        '. Confirm this with the caller.'
      );
    },

    async lookup_customer(args, env) {
      const phone = String(
        args.phone || (env.call.customer && env.call.customer.number) || '',
      ).trim();
      if (!phone)
        return 'No phone number to look up. Ask for the name and address on the account.';
      const r = await env.api.raw('GET', '/contacts/search/duplicate', null, {
        locationId: env.dep._id,
        number: phone,
      });
      const c = r && r.contact;
      if (!c)
        return 'No customer record found for that number. Ask for the name and address on the account.';
      const name =
        [c.firstName, c.lastName].filter(Boolean).join(' ') ||
        c.contactName ||
        'unknown name';
      return (
        'Found customer ' +
        name +
        (c.address1 ? ', address ' + c.address1 : '') +
        (c.tags && c.tags.length
          ? '. Tags: ' + c.tags.slice(0, 5).join(', ')
          : '') +
        '.'
      );
    },

    async mark_do_not_call(args, env) {
      const phone = (env.call.customer && env.call.customer.number) || '';
      const contact = await env.api.upsertContact({
        locationId: env.dep._id,
        phone,
        source: env.source,
      });
      const contactId = contact && (contact.id || contact._id);
      await env.api.setDnd(contactId).catch(() => {});
      await env.api.addTags(contactId, ['ai-do-not-call']).catch(() => {});
      await store.log(env.dep.companyId, 'lead.do_not_call', phone, {
        locationId: env.dep._id,
      });
      return 'Done. Confirm they will not be called again, thank them, and end the call.';
    },

    async create_support_ticket(args, env) {
      const phone = (env.call.customer && env.call.customer.number) || '';
      const contact = await env.api.upsertContact({
        locationId: env.dep._id,
        phone,
        source: env.source,
      });
      const contactId = contact && (contact.id || contact._id);
      const urgency = ['low', 'normal', 'high', 'emergency'].includes(
        args.urgency,
      )
        ? args.urgency
        : 'normal';
      await env.api.addNote(
        contactId,
        '🎫 Support ticket from AI call (' +
          urgency +
          ')\n' +
          String(args.issue || '').slice(0, 3000),
      );
      await env.api
        .addTags(contactId, ['ai-support-ticket', 'urgency-' + urgency])
        .catch(() => {});
      await store.patch(
        'calls',
        env.call._id,
        { ticket: { urgency, issue: String(args.issue || '').slice(0, 500) } },
        { inc: { seq: 1 } },
      );
      return (
        'Ticket created with ' +
        urgency +
        ' priority. Tell the caller the team will follow up' +
        (urgency === 'emergency' ? ' right away.' : ' within one business day.')
      );
    },
  };

  // Returns Vapi's expected { results: [{ toolCallId, result }] }.
  async function handle(dep, msg) {
    const list = msg.toolCallList || msg.toolWithToolCallList || [];
    const agency = await store.get('agencies', dep.companyId);
    const call = (msg.call &&
      msg.call.id &&
      (await store.get('calls', msg.call.id))) || {
      _id: msg.call && msg.call.id,
      customer: (msg.call && msg.call.customer) || {},
    };
    let api = null;
    const results = [];
    for (const item of list) {
      const tc = item.toolCall || item;
      const fn = tc.function || {};
      const name = fn.name || tc.name;
      const id = tc.id;
      const h = handlers[name];
      let result;
      try {
        if (!h) result = 'Unknown tool ' + name;
        else {
          if (!api) api = await agencySvc.locationApi(agency, dep._id);
          result = await h(parseArgs(fn.arguments || tc.arguments), {
            dep,
            call,
            api,
            source: contactSource(agency),
          });
        }
      } catch (e) {
        result =
          'That did not work (' +
          e.message.slice(0, 120) +
          '). Apologize and offer a callback from the team.';
        await store.log(
          dep.companyId,
          'tool.error',
          name + ': ' + e.message.slice(0, 200),
          { locationId: dep._id },
        );
      }
      results.push({ toolCallId: id, name, result });
    }
    return { results };
  }

  return { handle, handlers };
}

module.exports = { createToolService };
