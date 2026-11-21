import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  Plug,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
} from 'lucide-react';
import type { AuthFetch } from './AuditLogSection';

interface CatalogItem {
  id: string;
  name: string;
  category: string;
  description: string;
  connected: number;
  available: boolean;
  via?: string[];
}
interface EventType {
  type: string;
  description: string;
}
interface WebhookRow {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  is_active: boolean;
  failure_streak: number;
  last_delivery_at: string | null;
  last_status: number | null;
}
interface Delivery {
  id: string;
  event_type: string;
  status: string;
  attempts: number;
  response_status: number | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}
interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  created_by_name: string | null;
}
interface Connector {
  id: string;
  provider: 'slack' | 'discord' | 'teams';
  name: string;
  webhookUrl: string;
  events: string[];
  is_active: boolean;
  last_error: string | null;
}
interface GhlConnection {
  id: string;
  location_id: string;
  location_name: string | null;
  brand_id: string | null;
  brand_name: string | null;
  settings: Record<string, boolean>;
  status: string;
  last_error: string | null;
  installed_at: string;
}

const btn =
  'h-8 px-3 text-xs rounded-lg font-medium inline-flex items-center gap-1.5 disabled:opacity-50';
const primary = `${btn} bg-sky-600 text-white hover:bg-sky-700`;
const ghost = `${btn} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50`;
const danger = `${btn} border border-red-200 bg-white text-red-600 hover:bg-red-50`;
const field =
  'w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white';
const card = 'bg-white border border-slate-200 rounded-xl p-5';

/** Reads the error message from a failed fetch, falling back to the status. */
async function errorOf(r: Response) {
  const d = await r.json().catch(() => ({}));
  return (d as { error?: string }).error || `HTTP ${r.status}`;
}

function SecretOnce({
  label,
  value,
  onDone,
}: {
  label: string;
  value: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 mb-4">
      <p className="text-xs font-semibold text-amber-800 mb-2">
        {label}: copy it now, it will not be shown again.
      </p>
      <div className="flex gap-2">
        <code className="flex-1 text-xs bg-white border border-amber-200 rounded-lg px-3 py-2 break-all">
          {value}
        </code>
        <button
          className={ghost}
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
          }}
        >
          <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
        </button>
        <button className={primary} onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

function EventPicker({
  events,
  value,
  onChange,
}: {
  events: EventType[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const all = value.includes('*');
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => onChange(e.target.checked ? ['*'] : [])}
        />{' '}
        All events
      </label>
      {!all && (
        <div className="grid sm:grid-cols-2 gap-1.5 pl-1">
          {events.map((ev) => (
            <label
              key={ev.type}
              className="flex items-start gap-2 text-xs text-slate-600"
              title={ev.description}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.includes(ev.type)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...value, ev.type]
                      : value.filter((x) => x !== ev.type),
                  )
                }
              />
              <span>
                <span className="font-mono text-slate-800">{ev.type}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Webhooks ────────────────────────────────────────────────────────────────
function WebhooksPanel({
  authFetch,
  events,
}: {
  authFetch: AuthFetch;
  events: EventType[];
}) {
  const [rows, setRows] = useState<WebhookRow[]>([]);
  const [form, setForm] = useState({
    url: '',
    description: '',
    events: ['*'] as string[],
  });
  const [secret, setSecret] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deliveries, setDeliveries] = useState<{
    id: string;
    rows: Delivery[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await authFetch('/api/integrations/webhooks');
    if (r.ok) setRows(await r.json());
  }, [authFetch]);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await authFetch('/api/integrations/webhooks', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: await errorOf(r) });
    setSecret((await r.json()).secret);
    setForm({ url: '', description: '', events: ['*'] });
    void load();
  }

  async function act(
    id: string,
    path: string,
    method = 'POST',
    body?: unknown,
  ) {
    setMsg(null);
    const r = await authFetch(`/api/integrations/webhooks/${id}${path}`, {
      method,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) return setMsg({ ok: false, text: await errorOf(r) });
    if (path === '/test') {
      const d = await r.json();
      setMsg({
        ok: d.ok,
        text: d.ok
          ? `Test delivered (HTTP ${d.status}, ${d.duration_ms} ms)`
          : `Test failed: ${d.error || `HTTP ${d.status}`}`,
      });
    } else if (path === '/rotate-secret') {
      setSecret((await r.json()).secret);
    }
    void load();
  }

  async function showDeliveries(id: string) {
    const r = await authFetch(`/api/integrations/webhooks/${id}/deliveries`);
    if (r.ok) setDeliveries({ id, rows: await r.json() });
  }

  return (
    <div className="space-y-4">
      {secret && (
        <SecretOnce
          label="Signing secret"
          value={secret}
          onDone={() => setSecret(null)}
        />
      )}
      {msg && (
        <div
          className={`p-3 rounded-lg text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
        >
          {msg.text}
        </div>
      )}
      <form onSubmit={create} className={`${card} space-y-3`}>
        <h3 className="text-sm font-semibold text-slate-900">Add endpoint</h3>
        <input
          className={field}
          placeholder="https://example.com/omnicore-webhook"
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          required
          aria-label="Endpoint URL"
        />
        <input
          className={field}
          placeholder="Description (optional)"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          aria-label="Description"
        />
        <EventPicker
          events={events}
          value={form.events}
          onChange={(v) => setForm({ ...form, events: v })}
        />
        <button className={primary} disabled={busy || !form.events.length}>
          <Webhook size={12} /> Add webhook
        </button>
        <p className="text-[11px] text-slate-500">
          Requests are signed:{' '}
          <code>
            OmniCore-Signature: t=&lt;unix&gt;,v1=&lt;HMAC-SHA256(secret,
            "t.body")&gt;
          </code>
          . Failed deliveries retry for about 21 hours.
        </p>
      </form>
      {rows.map((w) => (
        <div key={w.id} className={card}>
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="min-w-0">
              <p className="text-sm font-mono text-slate-800 truncate">
                {w.url}
              </p>
              <p className="text-[11px] text-slate-500">
                {w.description ? `${w.description} · ` : ''}
                {w.events.includes('*') ? 'All events' : w.events.join(', ')}
                {w.last_delivery_at
                  ? ` · last delivery ${new Date(w.last_delivery_at).toLocaleString()} (${w.last_status ?? 'error'})`
                  : ''}
                {w.failure_streak > 0
                  ? ` · ${w.failure_streak} consecutive failures`
                  : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button className={ghost} onClick={() => void act(w.id, '/test')}>
                <Send size={12} /> Test
              </button>
              <button
                className={ghost}
                onClick={() => void showDeliveries(w.id)}
              >
                Deliveries
              </button>
              <button
                className={ghost}
                onClick={() =>
                  void act(w.id, '', 'PATCH', { is_active: !w.is_active })
                }
              >
                {w.is_active ? 'Disable' : 'Enable'}
              </button>
              <button
                className={ghost}
                onClick={() => void act(w.id, '/rotate-secret')}
              >
                Rotate secret
              </button>
              <button
                className={danger}
                onClick={() =>
                  confirm('Delete this webhook?') &&
                  void act(w.id, '', 'DELETE')
                }
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          {deliveries?.id === w.id && (
            <div className="mt-3 border-t border-slate-100 pt-3 overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-slate-400 text-left">
                  <tr>
                    <th className="py-1">Time</th>
                    <th>Event</th>
                    <th>Status</th>
                    <th>HTTP</th>
                    <th>Attempts</th>
                    <th>Error</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {deliveries.rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-3 text-slate-400">
                        No deliveries yet.
                      </td>
                    </tr>
                  )}
                  {deliveries.rows.map((d) => (
                    <tr key={d.id} className="border-t border-slate-50">
                      <td className="py-1 pr-2 whitespace-nowrap">
                        {new Date(d.created_at).toLocaleString()}
                      </td>
                      <td className="pr-2 font-mono">{d.event_type}</td>
                      <td
                        className={`pr-2 font-semibold ${d.status === 'delivered' ? 'text-emerald-600' : d.status === 'failed' ? 'text-red-600' : 'text-amber-600'}`}
                      >
                        {d.status}
                      </td>
                      <td className="pr-2">{d.response_status ?? '—'}</td>
                      <td className="pr-2">{d.attempts}</td>
                      <td className="pr-2 text-red-600 max-w-[200px] truncate">
                        {d.error || ''}
                      </td>
                      <td>
                        {d.status !== 'pending' && (
                          <button
                            className="text-sky-600 hover:underline"
                            onClick={async () => {
                              await authFetch(
                                `/api/integrations/deliveries/${d.id}/retry`,
                                { method: 'POST' },
                              );
                              void showDeliveries(w.id);
                            }}
                          >
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── API keys ────────────────────────────────────────────────────────────────
function ApiKeysPanel({ authFetch }: { authFetch: AuthFetch }) {
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [form, setForm] = useState({
    name: '',
    write: false,
    expires_in_days: '',
  });
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await authFetch('/api/integrations/api-keys');
    if (r.ok) setRows(await r.json());
  }, [authFetch]);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const r = await authFetch('/api/integrations/api-keys', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name,
        scopes: form.write ? ['read', 'write'] : ['read'],
        expires_in_days: form.expires_in_days
          ? Number(form.expires_in_days)
          : undefined,
      }),
    });
    if (!r.ok) return setErr(await errorOf(r));
    setKey((await r.json()).key);
    setForm({ name: '', write: false, expires_in_days: '' });
    void load();
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <div className="space-y-4">
      {key && (
        <SecretOnce label="API key" value={key} onDone={() => setKey(null)} />
      )}
      {err && (
        <div className="p-3 rounded-lg text-xs bg-red-50 text-red-600">
          {err}
        </div>
      )}
      <form onSubmit={create} className={`${card} space-y-3`}>
        <h3 className="text-sm font-semibold text-slate-900">Create API key</h3>
        <input
          className={field}
          placeholder="Key name, e.g. Zapier"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          aria-label="Key name"
        />
        <div className="flex flex-wrap gap-4 items-center text-xs text-slate-600">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.write}
              onChange={(e) => setForm({ ...form, write: e.target.checked })}
            />{' '}
            Allow write (reply, update, create tickets)
          </label>
          <label className="flex items-center gap-2">
            Expires after
            <input
              type="number"
              min={1}
              className="w-20 h-8 px-2 border border-slate-200 rounded-lg"
              value={form.expires_in_days}
              onChange={(e) =>
                setForm({ ...form, expires_in_days: e.target.value })
              }
              placeholder="never"
              aria-label="Expiry in days"
            />{' '}
            days
          </label>
        </div>
        <button className={primary}>
          <KeyRound size={12} /> Create key
        </button>
        <p className="text-[11px] text-slate-500">
          Base URL <code>{origin}/api/v1</code> · send{' '}
          <code>Authorization: Bearer ock_…</code>. Endpoints: /me, /brands,
          /agents, /conversations, /conversations/:id/messages, /tickets,
          /contacts.
        </p>
      </form>
      <div className={card}>
        <table className="w-full text-xs">
          <thead className="text-slate-400 text-left">
            <tr>
              <th className="py-1">Name</th>
              <th>Key</th>
              <th>Scopes</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-slate-400">
                  No API keys yet.
                </td>
              </tr>
            )}
            {rows.map((k) => (
              <tr key={k.id} className="border-t border-slate-100">
                <td className="py-2 pr-2">
                  {k.name}
                  <div className="text-[10px] text-slate-400">
                    by {k.created_by_name || '—'}
                  </div>
                </td>
                <td className="pr-2 font-mono">{k.prefix}…</td>
                <td className="pr-2">{k.scopes.join(', ')}</td>
                <td className="pr-2">
                  {k.last_used_at
                    ? new Date(k.last_used_at).toLocaleString()
                    : 'never'}
                </td>
                <td className="pr-2">
                  {k.revoked_at ? (
                    <span className="text-red-600">revoked</span>
                  ) : k.expires_at && new Date(k.expires_at) < new Date() ? (
                    <span className="text-amber-600">expired</span>
                  ) : (
                    <span className="text-emerald-600">active</span>
                  )}
                </td>
                <td className="text-right">
                  {!k.revoked_at && (
                    <button
                      className={danger}
                      onClick={async () => {
                        if (
                          !confirm(
                            `Revoke "${k.name}"? Apps using it will stop working.`,
                          )
                        )
                          return;
                        await authFetch(`/api/integrations/api-keys/${k.id}`, {
                          method: 'DELETE',
                        });
                        void load();
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Slack / Discord / Teams ─────────────────────────────────────────────────
const CHAT_HELP: Record<string, string> = {
  slack:
    'Slack → Apps → Incoming Webhooks → Add to a channel, then paste the https://hooks.slack.com/services/… URL.',
  discord:
    'Discord → Channel settings → Integrations → Webhooks → New webhook → Copy webhook URL.',
  teams:
    'Teams → channel ••• → Workflows → "Post to a channel when a webhook request is received" (or an Incoming Webhook connector), then paste the URL.',
};

function ConnectorPanel({
  authFetch,
  provider,
  events,
}: {
  authFetch: AuthFetch;
  provider: 'slack' | 'discord' | 'teams';
  events: EventType[];
}) {
  const [rows, setRows] = useState<Connector[]>([]);
  const [form, setForm] = useState({
    name: '',
    webhookUrl: '',
    events: [
      'conversation.created',
      'ticket.created',
      'csat.submitted',
    ] as string[],
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await authFetch('/api/integrations/connectors');
    if (r.ok)
      setRows(
        ((await r.json()) as Connector[]).filter(
          (c) => c.provider === provider,
        ),
      );
  }, [authFetch, provider]);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await authFetch('/api/integrations/connectors', {
      method: 'POST',
      body: JSON.stringify({ ...form, provider }),
    });
    if (!r.ok) return setMsg({ ok: false, text: await errorOf(r) });
    setForm({ ...form, name: '', webhookUrl: '' });
    void load();
  }

  return (
    <div className="space-y-4">
      {msg && (
        <div
          className={`p-3 rounded-lg text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
        >
          {msg.text}
        </div>
      )}
      <form onSubmit={create} className={`${card} space-y-3`}>
        <h3 className="text-sm font-semibold text-slate-900">Add channel</h3>
        <p className="text-[11px] text-slate-500">{CHAT_HELP[provider]}</p>
        <input
          className={field}
          placeholder="Channel name, e.g. #support"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          aria-label="Channel name"
        />
        <input
          className={field}
          placeholder="Incoming webhook URL"
          value={form.webhookUrl}
          onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
          required
          aria-label="Incoming webhook URL"
        />
        <EventPicker
          events={events}
          value={form.events}
          onChange={(v) => setForm({ ...form, events: v })}
        />
        <button className={primary} disabled={!form.events.length}>
          <Plug size={12} /> Connect
        </button>
      </form>
      {rows.map((c) => (
        <div
          key={c.id}
          className={`${card} flex flex-wrap items-center justify-between gap-2`}
        >
          <div>
            <p className="text-sm font-medium text-slate-800">
              {c.name}{' '}
              <span className="text-[11px] font-mono text-slate-400">
                {c.webhookUrl}
              </span>
            </p>
            <p className="text-[11px] text-slate-500">
              {c.events.includes('*') ? 'All events' : c.events.join(', ')}
              {c.last_error ? ` · last error: ${c.last_error}` : ''}
            </p>
          </div>
          <div className="flex gap-1.5">
            <button
              className={ghost}
              onClick={async () => {
                const r = await authFetch(
                  `/api/integrations/connectors/${c.id}/test`,
                  { method: 'POST' },
                );
                const d = await r.json().catch(() => ({}));
                setMsg({
                  ok: Boolean(d.ok),
                  text: d.ok
                    ? 'Test message sent.'
                    : `Test failed: ${d.error || `HTTP ${d.status}`}`,
                });
              }}
            >
              <Send size={12} /> Test
            </button>
            <button
              className={ghost}
              onClick={async () => {
                await authFetch(`/api/integrations/connectors/${c.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ is_active: !c.is_active }),
                });
                void load();
              }}
            >
              {c.is_active ? 'Pause' : 'Resume'}
            </button>
            <button
              className={danger}
              onClick={async () => {
                if (!confirm('Remove this channel?')) return;
                await authFetch(`/api/integrations/connectors/${c.id}`, {
                  method: 'DELETE',
                });
                void load();
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── GoHighLevel ─────────────────────────────────────────────────────────────
const GHL_TOGGLES: [string, string][] = [
  ['syncContacts', 'Sync contacts both ways'],
  ['syncConversations', 'Tag HighLevel contacts with tickets and CSAT'],
  ['postTranscripts', 'Add a transcript note when a conversation closes'],
  [
    'inboundMessages',
    'Bring HighLevel SMS, email, WhatsApp and social messages into the OmniCore inbox and reply from here',
  ],
];

function GhlPanel({
  authFetch,
  tenantId,
}: {
  authFetch: AuthFetch;
  tenantId: string;
}) {
  const [state, setState] = useState<{
    configured: boolean;
    redirectUri: string;
    webhookUrl: string;
    connections: GhlConnection[];
  } | null>(null);
  const [brands, setBrands] = useState<{ id: string; brand_name: string }[]>(
    [],
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await authFetch('/api/integrations/ghl');
    if (r.ok) setState(await r.json());
  }, [authFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!tenantId) return;
    authFetch(`/api/tenants/${tenantId}/brands`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setBrands(Array.isArray(d) ? d : d.brands || []))
      .catch(() => {});
  }, [authFetch, tenantId]);

  async function connect() {
    setMsg(null);
    const r = await authFetch('/api/integrations/ghl/connect');
    if (!r.ok) return setMsg({ ok: false, text: await errorOf(r) });
    window.location.href = (await r.json()).url;
  }

  async function patch(id: string, body: unknown) {
    const r = await authFetch(`/api/integrations/ghl/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    if (!r.ok) setMsg({ ok: false, text: await errorOf(r) });
    void load();
  }

  if (!state) return <p className="text-xs text-slate-400">Loading…</p>;
  return (
    <div className="space-y-4">
      {msg && (
        <div
          className={`p-3 rounded-lg text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
        >
          {msg.text}
        </div>
      )}
      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-900 mb-1">
          Connect a HighLevel sub-account
        </h3>
        {state.configured ? (
          <>
            <p className="text-xs text-slate-500 mb-3">
              You will choose the HighLevel location to connect, then return
              here.
            </p>
            <button className={primary} onClick={() => void connect()}>
              <Link2 size={12} /> Connect GoHighLevel
            </button>
          </>
        ) : (
          <p className="text-xs text-amber-700">
            The platform administrator has not configured the GoHighLevel app
            yet (GHL_CLIENT_ID / GHL_CLIENT_SECRET).
          </p>
        )}
      </div>
      {state.connections.map((c) => (
        <div key={c.id} className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <p className="text-sm font-medium text-slate-800">
                {c.location_name || c.location_id}
              </p>
              <p className="text-[11px] text-slate-500">
                Location {c.location_id} · {c.status} · connected{' '}
                {new Date(c.installed_at).toLocaleDateString()}
                {c.last_error ? (
                  <span className="text-red-600"> · {c.last_error}</span>
                ) : null}
              </p>
            </div>
            <button
              className={danger}
              onClick={async () => {
                if (!confirm('Disconnect this HighLevel location?')) return;
                await authFetch(`/api/integrations/ghl/${c.id}`, {
                  method: 'DELETE',
                });
                void load();
              }}
            >
              Disconnect
            </button>
          </div>
          <label className="block text-xs text-slate-600 mb-3">
            Brand for HighLevel conversations
            <select
              className={`${field} mt-1`}
              value={c.brand_id || ''}
              onChange={(e) => void patch(c.id, { brand_id: e.target.value })}
            >
              <option value="" disabled>
                Choose a brand
              </option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.brand_name}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-1.5">
            {GHL_TOGGLES.map(([k, label]) => (
              <label
                key={k}
                className="flex items-start gap-2 text-xs text-slate-700"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={Boolean(c.settings?.[k])}
                  onChange={(e) =>
                    void patch(c.id, { settings: { [k]: e.target.checked } })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Catalog + router ────────────────────────────────────────────────────────
const PANEL_FOR: Record<string, string> = {
  zapier: 'webhooks',
  make: 'webhooks',
  n8n: 'webhooks',
};

export function IntegrationsSection({
  authFetch,
  tenantId,
}: {
  authFetch: AuthFetch;
  tenantId: string;
}) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [events, setEvents] = useState<EventType[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, e] = await Promise.all([
      authFetch('/api/integrations/catalog'),
      authFetch('/api/integrations/events'),
    ]);
    if (c.ok) setCatalog((await c.json()).integrations);
    if (e.ok) setEvents((await e.json()).events);
    setLoading(false);
  }, [authFetch]);

  useEffect(() => {
    void load();
  }, [load, open]);

  // Return from the HighLevel install flow.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('integration') !== 'ghl') return;
    const claim = q.get('claim');
    const clean = () =>
      window.history.replaceState({}, '', window.location.pathname);
    if (claim) {
      authFetch('/api/integrations/ghl/claim', {
        method: 'POST',
        body: JSON.stringify({ token: claim }),
      })
        .then(async (r) =>
          setNotice(
            r.ok
              ? {
                  ok: true,
                  text: 'HighLevel location linked to this workspace.',
                }
              : { ok: false, text: await errorOf(r) },
          ),
        )
        .finally(() => {
          clean();
          setOpen('gohighlevel');
        });
    } else {
      const ok = q.get('status') === 'connected';
      setNotice({
        ok,
        text: ok
          ? 'GoHighLevel connected.'
          : `GoHighLevel connection failed: ${q.get('message') || 'unknown error'}`,
      });
      clean();
      setOpen('gohighlevel');
    }
  }, [authFetch]);

  const item = catalog.find((c) => c.id === open);
  const panel = open ? PANEL_FOR[open] || open : null;

  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-5xl mx-auto">
        {notice && (
          <div
            className={`p-3 rounded-lg text-xs mb-4 ${notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
          >
            {notice.text}
          </div>
        )}
        {!open ? (
          <>
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Plug size={16} className="text-sky-600" /> Integrations
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Connect OmniCore to your CRM, team chat, automation tools and
                  your own code.
                </p>
              </div>
              <button className={ghost} onClick={() => void load()}>
                <RefreshCw
                  size={12}
                  className={loading ? 'animate-spin' : ''}
                />{' '}
                Refresh
              </button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {catalog.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setOpen(c.id)}
                  className={`${card} text-left hover:border-sky-300 hover:shadow-sm transition`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {c.name}
                    </span>
                    {c.connected > 0 ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
                        <CheckCircle2 size={10} />{' '}
                        {c.via ? 'Ready' : `${c.connected} active`}
                      </span>
                    ) : !c.available ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        Not configured
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                    {c.category}
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {c.description}
                  </p>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <button className={`${ghost} mb-4`} onClick={() => setOpen(null)}>
              <ArrowLeft size={12} /> All integrations
            </button>
            <h2 className="text-base font-semibold text-slate-900 mb-1">
              {item?.name}
            </h2>
            <p className="text-xs text-slate-500 mb-4">{item?.description}</p>
            {item?.via && (
              <p className="text-xs text-slate-600 mb-4 p-3 rounded-lg bg-sky-50 border border-sky-100">
                {item.name} connects through OmniCore webhooks (triggers) and
                the REST API (actions). Add a webhook below with the URL{' '}
                {item.name} gives you, and create an API key under REST API for
                actions.
              </p>
            )}
            {panel === 'webhooks' && (
              <WebhooksPanel authFetch={authFetch} events={events} />
            )}
            {panel === 'api' && <ApiKeysPanel authFetch={authFetch} />}
            {(panel === 'slack' ||
              panel === 'discord' ||
              panel === 'teams') && (
              <ConnectorPanel
                authFetch={authFetch}
                provider={panel}
                events={events}
              />
            )}
            {panel === 'gohighlevel' && (
              <GhlPanel authFetch={authFetch} tenantId={tenantId} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
