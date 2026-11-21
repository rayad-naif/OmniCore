import { afterEach, describe, expect, it, vi } from 'vitest';

const tools = require('./copilotTools.js');

const T = (name: string) => tools.BY_NAME[name];
const ctx = { tenantId: 'tenant-1' };

afterEach(() => vi.unstubAllGlobals());

describe('copilot tool requests hit the right API endpoints', () => {
  it('builds read requests with encoded, capped query strings', () => {
    expect(
      T('list_conversations').request(
        { status: 'open', search: 'a&b', limit: 99 },
        ctx,
      ),
    ).toEqual({
      path: '/conversations?status=open&search=a%26b&limit=25',
    });
    expect(T('list_conversations').request({}, ctx)).toEqual({
      path: '/conversations?limit=10',
    });
    expect(T('search_contacts').request({ search: 'ana' }, ctx)).toEqual({
      path: '/contacts?search=ana&limit=10',
    });
    expect(T('list_brands').request({}, ctx)).toEqual({
      path: '/tenants/tenant-1/brands',
    });
    expect(T('list_team').request({}, ctx)).toEqual({ path: '/agents' });
    expect(T('list_canned_responses').request({}, ctx)).toEqual({
      path: '/canned-responses',
    });
    expect(T('list_knowledge_articles').request({}, ctx)).toEqual({
      path: '/ai/knowledge-base',
    });
    expect(T('list_integrations').request({}, ctx)).toEqual({
      path: '/integrations/catalog',
    });
    expect(T('recent_activity').request({ search: 'login' }, ctx)).toEqual({
      path: '/audit-logs?q=login&limit=20',
    });
  });

  it('builds write requests with only the intended fields', () => {
    expect(
      T('reply_to_conversation').request({
        conversation_id: 'c/1',
        body: 'Hi',
        internal_note: true,
      }),
    ).toEqual({
      method: 'POST',
      path: '/conversations/c%2F1/messages',
      body: { body: 'Hi', isInternalNote: true },
    });
    expect(
      T('update_conversation').request({
        conversation_id: 'c1',
        status: 'closed',
        priority: undefined,
      }),
    ).toEqual({
      method: 'PATCH',
      path: '/conversations/c1',
      body: { status: 'closed' },
    });
    expect(
      T('create_canned_response').request({
        name: 'Hi',
        body: 'Hello',
        shortcut: '/hi',
      }).body,
    ).toEqual({ name: 'Hi', body: 'Hello', shortcut: '/hi' });
    expect(
      T('create_knowledge_article').request({ title: 'T', content: 'C' }).body,
    ).toEqual({ title: 'T', content: 'C', brand_id: null });
    expect(T('create_brand').request({ name: 'Acme' }, ctx)).toEqual({
      method: 'POST',
      path: '/tenants/tenant-1/brands',
      body: { brand_name: 'Acme' },
    });
    expect(
      T('invite_team_member').request({ name: 'A', email: 'a@x.co' }).body,
    ).toEqual({ name: 'A', email: 'a@x.co', role: 'agent' });
    expect(T('create_webhook').request({ url: 'https://x.co/h' }).body).toEqual(
      { url: 'https://x.co/h', events: ['*'] },
    );
    expect(
      T('connect_chat_notifications').request({
        provider: 'slack',
        webhook_url: 'https://hooks.slack.com/x',
      }).body,
    ).toEqual({
      provider: 'slack',
      webhookUrl: 'https://hooks.slack.com/x',
      events: undefined,
    });
  });
});

describe('copilot approval summaries describe exactly what will change', () => {
  it('summarises every write tool', () => {
    expect(
      T('reply_to_conversation').summary({
        conversation_id: 'abcdef123456',
        body: 'Thanks!',
      }),
    ).toBe('Send this reply in conversation abcdef12: “Thanks!”');
    expect(
      T('reply_to_conversation').summary({
        conversation_id: 'abcdef123456',
        body: 'x',
        internal_note: true,
      }),
    ).toMatch(/^Add an internal note/);
    expect(
      T('update_conversation').summary({
        conversation_id: 'abcdef123456',
        status: 'closed',
        priority: 'high',
        is_ticket: true,
      }),
    ).toBe(
      'Update conversation abcdef12: status → closed, priority → high, convert to ticket',
    );
    expect(
      T('create_canned_response').summary({ name: 'Refund', shortcut: '/r' }),
    ).toBe('Create saved reply “Refund” (/r)');
    expect(
      T('create_knowledge_article').summary({ title: 'FAQ', content: 'abc' }),
    ).toBe('Add knowledge article “FAQ” (3 characters)');
    expect(T('create_brand').summary({ name: 'Acme' })).toBe(
      'Create brand “Acme”',
    );
    expect(
      T('invite_team_member').summary({
        name: 'Ana',
        email: 'ana@x.co',
        role: 'admin',
      }),
    ).toBe('Invite Ana <ana@x.co> as admin');
    expect(
      T('create_webhook').summary({
        url: 'https://x.co',
        events: ['ticket.created'],
      }),
    ).toBe('Add webhook https://x.co for ticket.created');
    expect(T('connect_chat_notifications').summary({ provider: 'teams' })).toBe(
      'Connect teams notifications',
    );
  });
});

describe('copilot result shaping keeps answers small and safe', () => {
  it('shapes list results', () => {
    const conv = T('list_conversations').shape({
      conversations: [
        {
          id: 'c1',
          status: 'open',
          visitor_name: 'Ana',
          last_message: 'x'.repeat(300),
        },
      ],
    });
    expect(conv[0]).toMatchObject({ id: 'c1', status: 'open', contact: 'Ana' });
    expect(conv[0].last_message.length).toBeLessThanOrEqual(161);
    expect(
      T('list_brands').shape([
        { id: 'b', brand_name: 'Acme', widget_config_json: {} },
      ]),
    ).toEqual([{ id: 'b', name: 'Acme', inbound_email_prefix: undefined }]);
    expect(
      T('list_team').shape({
        agents: [
          {
            id: 'a',
            name: 'A',
            email: 'a@x',
            role: 'admin',
            is_active: true,
            password_hash: 'h',
          },
        ],
      }),
    ).toEqual([
      { id: 'a', name: 'A', email: 'a@x', role: 'admin', active: true },
    ]);
    expect(
      T('list_canned_responses').shape([
        { id: 'c', name: 'n', shortcut: '/s', body: 'b' },
      ]),
    ).toEqual([{ id: 'c', name: 'n', shortcut: '/s', body: 'b' }]);
    expect(
      T('list_knowledge_articles').shape([
        {
          id: 'k',
          title: 't',
          brand_id: null,
          is_active: true,
          content: 'long',
        },
      ]),
    ).toEqual([{ id: 'k', title: 't', brand_id: null, active: true }]);
    expect(
      T('list_integrations').shape({
        integrations: [
          {
            id: 'slack',
            name: 'Slack',
            connected: 1,
            available: true,
            description: 'd',
          },
        ],
      }),
    ).toEqual([{ id: 'slack', name: 'Slack', connected: 1, available: true }]);
    expect(
      T('recent_activity').shape({
        logs: [
          {
            created_at: 't',
            actor_email: 'a@x',
            action: 'auth.login',
            outcome: 'success',
            metadata: { body: {} },
          },
        ],
      }),
    ).toEqual([
      { at: 't', who: 'a@x', action: 'auth.login', outcome: 'success' },
    ]);
    expect(T('search_contacts').shape({ contacts: [{ id: 1 }] })).toEqual([
      { id: 1 },
    ]);
  });

  it('shapes write results without secrets', () => {
    expect(T('reply_to_conversation').shape({ id: 'm1' })).toEqual({
      sent: true,
      message_id: 'm1',
    });
    expect(T('update_conversation').shape({})).toEqual({ updated: true });
    expect(T('create_canned_response').shape({ id: 'c' })).toEqual({
      created: true,
      id: 'c',
    });
    expect(T('create_knowledge_article').shape({ id: 'k' })).toEqual({
      created: true,
      id: 'k',
    });
    expect(T('create_brand').shape({ brand: { id: 'b' } })).toEqual({
      created: true,
      id: 'b',
    });
    expect(T('invite_team_member').shape({ agent: { id: 'a' } })).toEqual({
      invited: true,
      id: 'a',
    });
    expect(
      T('connect_chat_notifications').shape({
        id: 'x',
        config_sealed: 'secret',
      }),
    ).toEqual({ connected: true, id: 'x' });
  });
});

describe('copilot tool execution through the API', () => {
  const req = {
    headers: {
      authorization: 'Bearer user-token',
      'x-workspace-id': 'ws-2',
      'user-agent': 'UA',
    },
    ip: '203.0.113.5',
  };

  it('calls the API with the user token, workspace and real IP', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: 'a',
              name: 'A',
              email: 'a@x',
              role: 'agent',
              is_active: true,
            },
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await tools.execute('list_team', {}, { req, tenantId: 'ws-2' });
    expect(out).toEqual({
      content: [
        { id: 'a', name: 'A', email: 'a@x', role: 'agent', active: true },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toMatch(/\/api\/agents$/);
    expect(init.headers.Authorization).toBe('Bearer user-token');
    expect(init.headers['X-Workspace-Id']).toBe('ws-2');
    expect(init.headers['X-Forwarded-For']).toBe('203.0.113.5');
    expect(init.headers['X-OmniCore-Copilot']).toBe('1');
  });

  it('runs multi-call tools and reports permission errors plainly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/messages')
          ? new Response(
              JSON.stringify([
                {
                  sender_type: 'visitor',
                  message_body: 'Help',
                  is_internal_note: false,
                  created_at: 't',
                },
              ]),
            )
          : new Response(
              JSON.stringify({ id: 'c1', status: 'open', visitor_name: 'Ana' }),
            ),
      ),
    );
    const conv = await tools.execute(
      'get_conversation',
      { conversation_id: 'c1' },
      { req, tenantId: 't' },
    );
    expect(conv.content.conversation).toMatchObject({
      id: 'c1',
      status: 'open',
      contact: 'Ana',
    });
    expect(conv.content.messages).toEqual([
      { from: 'visitor', internal_note: false, body: 'Help', at: 't' },
    ]);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'Forbidden — requires edit access to team',
            }),
            { status: 403 },
          ),
      ),
    );
    const denied = await tools.execute(
      'invite_team_member',
      { name: 'A', email: 'a@x.co' },
      { req, tenantId: 't' },
    );
    expect(denied.isError).toBe(true);
    expect(denied.content).toMatch(/^Not allowed: .*does not have permission/);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            url.includes('stats')
              ? JSON.stringify({ calls7d: 4 })
              : JSON.stringify({ calls: [{}, {}] }),
          ),
      ),
    );
    const stats = await tools.execute(
      'call_center_stats',
      {},
      { req, tenantId: 't' },
    );
    expect(stats.content).toEqual({ week: { calls7d: 4 }, live_now: 2 });

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.includes('subscription') ? { plan: 'growth' } : { agents: 2 },
            ),
          ),
      ),
    );
    expect(
      (await tools.execute('get_plan_and_usage', {}, { req, tenantId: 't' }))
        .content,
    ).toEqual({ subscription: { plan: 'growth' }, usage: { agents: 2 } });
  });

  it('handles navigation and unknown tools without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await tools.execute(
        'open_section',
        { section: 'billing' },
        { req, tenantId: 't' },
      ),
    ).toEqual({ content: { opened: 'billing' } });
    expect(
      (await tools.execute('nope', {}, { req, tenantId: 't' })).isError,
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      tools
        .definitions()
        .every(
          (d: { name: string; parameters: object }) => d.name && d.parameters,
        ),
    ).toBe(true);
  });
});
