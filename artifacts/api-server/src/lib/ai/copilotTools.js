'use strict';

/**
 * copilotTools.js
 * Tools the in-app AI copilot can use. Every tool is executed through the
 * app's own REST API with the signed-in user's token (and workspace override),
 * so permissions, workspace isolation and the audit trail apply exactly as if
 * the user had clicked the button themselves.
 *
 * kind:
 *   read   runs immediately
 *   write  needs the user's explicit approval in the copilot panel
 *   ui     returned to the dashboard (navigation), no server call
 */

const SECTIONS = [
  'conversations',
  'tickets',
  'contacts',
  'canned_responses',
  'csat',
  'ai_training',
  'smtp',
  'brands',
  'team',
  'billing',
  'integrations',
  'settings',
  'audit',
  'agency',
  'voice',
  'hr',
];

const obj = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const str = (description, extra = {}) => ({
  type: 'string',
  description,
  ...extra,
});
const num = (description) => ({ type: 'integer', description });
const STATUS = [
  'open',
  'pending',
  'ai_handling',
  'closed',
  'resolved',
  'waiting_on_customer',
  'in_progress',
];
const EVENTS = [
  'conversation.created',
  'conversation.closed',
  'message.created',
  'ticket.created',
  'csat.submitted',
  'contact.created',
  'conversation.assigned',
];

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

const clip = (s, n = 400) =>
  typeof s === 'string' && s.length > n ? `${s.slice(0, n)}…` : s;

const TOOLS = [
  // ── Navigation ─────────────────────────────────────────────────────────────
  {
    name: 'open_section',
    kind: 'ui',
    description:
      'Open a section of the dashboard for the user (use when they ask where something is or to take them there).',
    parameters: obj({ section: str('Dashboard section', { enum: SECTIONS }) }, [
      'section',
    ]),
  },

  // ── Read ───────────────────────────────────────────────────────────────────
  {
    name: 'list_conversations',
    kind: 'read',
    description:
      'List recent conversations or tickets in this workspace, optionally filtered.',
    parameters: obj({
      status: str('Filter by status', { enum: STATUS }),
      is_ticket: { type: 'boolean', description: 'Only tickets' },
      search: str('Free-text search (name, email, message text)'),
      limit: num('Max results (1-25)'),
    }),
    request: (i) => ({
      path: `/conversations${qs({ status: i.status, is_ticket: i.is_ticket, search: i.search, limit: Math.min(i.limit || 10, 25) })}`,
    }),
    shape: (r) =>
      (r.conversations || r || []).slice(0, 25).map((c) => ({
        id: c.id,
        status: c.status,
        priority: c.priority,
        channel: c.channel,
        subject: c.subject,
        ticket_number: c.ticket_number,
        contact: c.visitor_name || c.display_name || c.visitor_email || c.email,
        assigned_to: c.assigned_agent_name || c.assigned_agent_id,
        last_message: clip(c.last_message || c.last_message_body, 160),
        updated_at: c.updated_at,
      })),
  },
  {
    name: 'get_conversation',
    kind: 'read',
    description:
      'Get one conversation with its latest messages (to summarise it or draft a reply).',
    parameters: obj({ conversation_id: str('Conversation id') }, [
      'conversation_id',
    ]),
    run: async (i, api) => {
      const conv = await api(
        'GET',
        `/conversations/${encodeURIComponent(i.conversation_id)}`,
      );
      const msgs = await api(
        'GET',
        `/conversations/${encodeURIComponent(i.conversation_id)}/messages`,
      );
      const list = Array.isArray(msgs) ? msgs : msgs.messages || [];
      return {
        conversation: {
          id: conv.id,
          status: conv.status,
          priority: conv.priority,
          channel: conv.channel,
          subject: conv.subject,
          contact: conv.visitor_name || conv.visitor_email,
          assigned_agent_id: conv.assigned_agent_id,
        },
        messages: list.slice(-20).map((m) => ({
          from: m.sender_type,
          internal_note: m.is_internal_note,
          body: clip(m.message_body, 600),
          at: m.created_at,
        })),
      };
    },
  },
  {
    name: 'search_contacts',
    kind: 'read',
    description: 'Search contacts (customers) by name or email.',
    parameters: obj({ search: str('Name or email to search for') }, ['search']),
    request: (i) => ({
      path: `/contacts${qs({ search: i.search, limit: 10 })}`,
    }),
    shape: (r) => (r.contacts || r.data || r || []).slice(0, 10),
  },
  {
    name: 'list_brands',
    kind: 'read',
    description:
      'List the brands in this workspace (each has its own chat widget and inbox address).',
    parameters: obj({}),
    request: (i, ctx) => ({ path: `/tenants/${ctx.tenantId}/brands` }),
    shape: (r) =>
      (Array.isArray(r) ? r : r.brands || []).map((b) => ({
        id: b.id,
        name: b.brand_name,
        inbound_email_prefix: b.inbound_email_prefix,
      })),
  },
  {
    name: 'list_team',
    kind: 'read',
    description: 'List the people in this workspace with their roles.',
    parameters: obj({}),
    request: () => ({ path: '/agents' }),
    shape: (r) =>
      (Array.isArray(r) ? r : r.agents || []).map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        role: a.role,
        active: a.is_active,
      })),
  },
  {
    name: 'get_plan_and_usage',
    kind: 'read',
    description:
      "Get the workspace's plan, subscription status and usage against limits.",
    parameters: obj({}),
    run: async (i, api) => ({
      subscription: await api('GET', '/billing/subscription').catch((e) => ({
        error: e.message,
      })),
      usage: await api('GET', '/billing/usage').catch((e) => ({
        error: e.message,
      })),
    }),
  },
  {
    name: 'call_center_stats',
    kind: 'read',
    description:
      'AI Call Center figures for the last 7 days (calls, minutes, bookings, QA score, cost) and live calls right now.',
    parameters: obj({}),
    run: async (i, api) => ({
      week: await api('GET', '/voice/live/stats').catch((e) => ({
        error: e.message,
      })),
      live_now: await api('GET', '/voice/live/calls')
        .then((r) => (r.calls || []).length)
        .catch(() => 0),
    }),
  },
  {
    name: 'list_canned_responses',
    kind: 'read',
    description: 'List saved replies (canned responses).',
    parameters: obj({}),
    request: () => ({ path: '/canned-responses' }),
    shape: (r) =>
      (Array.isArray(r) ? r : r.data || []).map((c) => ({
        id: c.id,
        name: c.name,
        shortcut: c.shortcut,
        body: clip(c.body, 200),
      })),
  },
  {
    name: 'list_knowledge_articles',
    kind: 'read',
    description: 'List knowledge-base articles the AI answers from.',
    parameters: obj({}),
    request: () => ({ path: '/ai/knowledge-base' }),
    shape: (r) =>
      (Array.isArray(r) ? r : r.articles || []).slice(0, 50).map((a) => ({
        id: a.id,
        title: a.title,
        brand_id: a.brand_id,
        active: a.is_active,
      })),
  },
  {
    name: 'list_integrations',
    kind: 'read',
    description: 'Show which integrations are available and connected.',
    parameters: obj({}),
    request: () => ({ path: '/integrations/catalog' }),
    shape: (r) =>
      (r.integrations || []).map((x) => ({
        id: x.id,
        name: x.name,
        connected: x.connected,
        available: x.available,
      })),
  },
  {
    name: 'recent_activity',
    kind: 'read',
    description:
      'Recent audit-log activity in this workspace (admins only): who changed what.',
    parameters: obj({ search: str('Optional text to filter by') }),
    request: (i) => ({ path: `/audit-logs${qs({ q: i.search, limit: 20 })}` }),
    shape: (r) =>
      (r.logs || []).map((l) => ({
        at: l.created_at,
        who: l.actor_email || l.actor_name || l.actor_type,
        action: l.action,
        outcome: l.outcome,
      })),
  },

  // ── Write (need approval) ──────────────────────────────────────────────────
  {
    name: 'reply_to_conversation',
    kind: 'write',
    description:
      'Send a reply to the customer in a conversation, or add an internal note.',
    parameters: obj(
      {
        conversation_id: str('Conversation id'),
        body: str('Message text'),
        internal_note: {
          type: 'boolean',
          description: 'true = internal note visible only to the team',
        },
      },
      ['conversation_id', 'body'],
    ),
    summary: (i) =>
      `${i.internal_note ? 'Add an internal note to' : 'Send this reply in'} conversation ${String(i.conversation_id).slice(0, 8)}: “${clip(i.body, 200)}”`,
    request: (i) => ({
      method: 'POST',
      path: `/conversations/${encodeURIComponent(i.conversation_id)}/messages`,
      body: { body: i.body, isInternalNote: Boolean(i.internal_note) },
    }),
    shape: (r) => ({ sent: true, message_id: r.id }),
  },
  {
    name: 'update_conversation',
    kind: 'write',
    description:
      'Change a conversation’s status, priority or assignee, or turn it into a ticket.',
    parameters: obj(
      {
        conversation_id: str('Conversation id'),
        status: str('New status', { enum: STATUS }),
        priority: str('New priority', {
          enum: ['low', 'normal', 'high', 'urgent'],
        }),
        assigned_agent_id: str('Agent id to assign (from list_team)'),
        is_ticket: {
          type: 'boolean',
          description: 'true to convert to a ticket',
        },
      },
      ['conversation_id'],
    ),
    summary: (i) =>
      `Update conversation ${String(i.conversation_id).slice(0, 8)}: ${[
        i.status && `status → ${i.status}`,
        i.priority && `priority → ${i.priority}`,
        i.assigned_agent_id && `assign → ${i.assigned_agent_id.slice(0, 8)}`,
        i.is_ticket && 'convert to ticket',
      ]
        .filter(Boolean)
        .join(', ')}`,
    request: (i) => {
      const body = {};
      for (const k of ['status', 'priority', 'assigned_agent_id', 'is_ticket'])
        if (i[k] !== undefined) body[k] = i[k];
      return {
        method: 'PATCH',
        path: `/conversations/${encodeURIComponent(i.conversation_id)}`,
        body,
      };
    },
    shape: () => ({ updated: true }),
  },
  {
    name: 'create_canned_response',
    kind: 'write',
    description: 'Create a saved reply that agents insert with a shortcut.',
    parameters: obj(
      {
        name: str('Name'),
        body: str('Reply text'),
        shortcut: str('Shortcut, e.g. /refund'),
      },
      ['name', 'body'],
    ),
    summary: (i) =>
      `Create saved reply “${i.name}”${i.shortcut ? ` (${i.shortcut})` : ''}`,
    request: (i) => ({
      method: 'POST',
      path: '/canned-responses',
      body: { name: i.name, body: i.body, shortcut: i.shortcut },
    }),
    shape: (r) => ({ created: true, id: r.id }),
  },
  {
    name: 'create_knowledge_article',
    kind: 'write',
    description:
      'Add a knowledge-base article so the AI can answer customers with it.',
    parameters: obj(
      {
        title: str('Title'),
        content: str('Article text'),
        brand_id: str('Brand id (optional, all brands if omitted)'),
      },
      ['title', 'content'],
    ),
    summary: (i) =>
      `Add knowledge article “${i.title}” (${String(i.content).length} characters)`,
    request: (i) => ({
      method: 'POST',
      path: '/ai/knowledge-base',
      body: {
        title: i.title,
        content: i.content,
        brand_id: i.brand_id || null,
      },
    }),
    shape: (r) => ({ created: true, id: r.id }),
  },
  {
    name: 'create_brand',
    kind: 'write',
    description: 'Create a new brand (its own chat widget and inbox).',
    parameters: obj({ name: str('Brand name') }, ['name']),
    summary: (i) => `Create brand “${i.name}”`,
    request: (i, ctx) => ({
      method: 'POST',
      path: `/tenants/${ctx.tenantId}/brands`,
      body: { brand_name: i.name },
    }),
    shape: (r) => ({ created: true, id: r.id || r.brand?.id }),
  },
  {
    name: 'invite_team_member',
    kind: 'write',
    description: 'Invite a person to this workspace by email.',
    parameters: obj(
      {
        name: str('Full name'),
        email: str('Email address'),
        role: str('Role', { enum: ['agent', 'supervisor', 'admin'] }),
      },
      ['name', 'email'],
    ),
    summary: (i) => `Invite ${i.name} <${i.email}> as ${i.role || 'agent'}`,
    request: (i) => ({
      method: 'POST',
      path: '/agents',
      body: { name: i.name, email: i.email, role: i.role || 'agent' },
    }),
    shape: (r) => ({ invited: true, id: r.id || r.agent?.id }),
  },
  {
    name: 'create_webhook',
    kind: 'write',
    description:
      'Add an outgoing webhook endpoint (for Zapier, Make, n8n or custom code).',
    parameters: obj(
      {
        url: str('https:// URL'),
        events: {
          type: 'array',
          items: { type: 'string', enum: ['*', ...EVENTS] },
          description: 'Events, or ["*"] for all',
        },
      },
      ['url'],
    ),
    summary: (i) =>
      `Add webhook ${i.url} for ${(i.events || ['*']).join(', ')}`,
    request: (i) => ({
      method: 'POST',
      path: '/integrations/webhooks',
      body: { url: i.url, events: i.events?.length ? i.events : ['*'] },
    }),
    // The signing secret is shown once in the Integrations screen, never in chat.
    shape: (r) => ({
      created: true,
      id: r.id,
      note: 'The signing secret is shown in Integrations → Webhooks.',
    }),
  },
  {
    name: 'connect_chat_notifications',
    kind: 'write',
    description:
      'Send support notifications to a Slack, Discord or Microsoft Teams channel via its incoming-webhook URL.',
    parameters: obj(
      {
        provider: str('Chat app', { enum: ['slack', 'discord', 'teams'] }),
        webhook_url: str('Incoming webhook URL from the chat app'),
        events: { type: 'array', items: { type: 'string', enum: EVENTS } },
      },
      ['provider', 'webhook_url'],
    ),
    summary: (i) =>
      `Connect ${i.provider} notifications${i.events?.length ? ` for ${i.events.join(', ')}` : ''}`,
    request: (i) => ({
      method: 'POST',
      path: '/integrations/connectors',
      body: {
        provider: i.provider,
        webhookUrl: i.webhook_url,
        events: i.events,
      },
    }),
    shape: (r) => ({ connected: true, id: r.id }),
  },
];

const BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/** Public tool definitions for providers. */
function definitions() {
  return TOOLS.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

/**
 * Builds an API caller bound to the user's credentials. Requests go to this
 * same process over loopback (trusted proxy), forwarding the user's IP.
 */
function makeApi(req) {
  const port = process.env.PORT || 5000;
  return async function api(method, path, body) {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {
        Authorization: req.headers.authorization,
        ...(req.headers['x-workspace-id']
          ? { 'X-Workspace-Id': req.headers['x-workspace-id'] }
          : {}),
        'X-Forwarded-For': req.ip || '',
        'X-OmniCore-Copilot': '1',
        'User-Agent': `OmniCore-Copilot (${String(req.headers['user-agent'] || '').slice(0, 120)})`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    if (!res.ok)
      throw Object.assign(new Error(json.error || `HTTP ${res.status}`), {
        status: res.status,
      });
    return json;
  };
}

/** Executes a read/write tool. Returns { content, isError }. */
async function execute(name, input, { req, tenantId }) {
  const tool = BY_NAME[name];
  if (!tool) return { content: `Unknown tool ${name}`, isError: true };
  if (tool.kind === 'ui') return { content: { opened: input.section } };
  const api = makeApi(req);
  try {
    if (tool.run)
      return { content: await tool.run(input || {}, api, { tenantId }) };
    const r = tool.request(input || {}, { tenantId });
    const result = await api(r.method || 'GET', r.path, r.body);
    return { content: tool.shape ? tool.shape(result) : result };
  } catch (err) {
    const msg =
      err.status === 403
        ? `Not allowed: ${err.message}. The user does not have permission for this.`
        : `Failed: ${err.message}`;
    return { content: msg, isError: true };
  }
}

module.exports = { TOOLS, BY_NAME, SECTIONS, definitions, execute, makeApi };
