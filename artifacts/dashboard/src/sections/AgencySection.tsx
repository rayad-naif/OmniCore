import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Copy,
  Globe,
  KeyRound,
  Palette,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import type { AuthFetch } from './AuditLogSection';
import { applyBranding, getBranding, type Branding } from '../lib/branding';

interface Agency {
  id: string;
  name: string;
  role: string;
  max_workspaces: number;
  workspaces: number;
  active_domains: number;
  platform_host: string;
  branding: Branding;
}
interface Workspace {
  id: string;
  company_name: string;
  plan: string | null;
  account_status: string;
  max_agents_allowed: number | null;
  max_brands_allowed: number | null;
  conversation_limit: number | null;
  agents: number;
  conversations_this_month: number;
  created_at: string;
}
interface Domain {
  id: string;
  hostname: string;
  status: string;
  is_primary: boolean;
  last_error: string | null;
  verified_at: string | null;
  dns: { type: string; name: string; value: string; purpose: string }[];
}

const btn =
  'h-8 px-3 text-xs rounded-lg font-medium inline-flex items-center gap-1.5 disabled:opacity-50';
const primary = `${btn} bg-sky-600 text-white hover:bg-sky-700`;
const ghost = `${btn} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50`;
const danger = `${btn} border border-red-200 bg-white text-red-600 hover:bg-red-50`;
const field =
  'w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white';
const card = 'bg-white border border-slate-200 rounded-xl p-5';
type Msg = { ok: boolean; text: string } | null;

async function errorOf(r: Response) {
  const d = await r.json().catch(() => ({}));
  return (d as { error?: string }).error || `HTTP ${r.status}`;
}

function Banner({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div
      className={`p-3 rounded-lg text-xs mb-4 ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
    >
      {msg.text}
    </div>
  );
}

// ── Workspaces ──────────────────────────────────────────────────────────────
function Workspaces({
  authFetch,
  onOpen,
}: {
  authFetch: AuthFetch;
  onOpen: (id: string, name: string) => void;
}) {
  const [rows, setRows] = useState<Workspace[]>([]);
  const [form, setForm] = useState({
    company_name: '',
    admin_name: '',
    admin_email: '',
    plan: 'starter',
  });
  const [msg, setMsg] = useState<Msg>(null);
  const load = useCallback(async () => {
    const r = await authFetch('/api/agency/workspaces');
    if (r.ok) setRows(await r.json());
  }, [authFetch]);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await authFetch('/api/agency/workspaces', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    if (!r.ok) return setMsg({ ok: false, text: await errorOf(r) });
    const d = await r.json();
    setMsg({
      ok: true,
      text: d.invite_sent
        ? `Workspace created. Invitation sent to ${d.admin_email}.`
        : `Workspace created. Email is not configured, so send this setup link to ${d.admin_email}: ${d.invite_link}`,
    });
    setForm({
      company_name: '',
      admin_name: '',
      admin_email: '',
      plan: 'starter',
    });
    void load();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await authFetch(`/api/agency/workspaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    setMsg(
      r.ok
        ? { ok: true, text: 'Saved.' }
        : { ok: false, text: await errorOf(r) },
    );
    void load();
  }

  return (
    <div className="space-y-4">
      <Banner msg={msg} />
      <form onSubmit={create} className={`${card} grid sm:grid-cols-2 gap-3`}>
        <h3 className="sm:col-span-2 text-sm font-semibold text-slate-900">
          New client workspace
        </h3>
        <input
          className={field}
          placeholder="Client company name"
          value={form.company_name}
          onChange={(e) => setForm({ ...form, company_name: e.target.value })}
          required
          aria-label="Company name"
        />
        <select
          className={field}
          value={form.plan}
          onChange={(e) => setForm({ ...form, plan: e.target.value })}
          aria-label="Plan"
        >
          <option value="free">Free</option>
          <option value="starter">Starter</option>
          <option value="growth">Growth</option>
        </select>
        <input
          className={field}
          placeholder="Client admin name"
          value={form.admin_name}
          onChange={(e) => setForm({ ...form, admin_name: e.target.value })}
          aria-label="Admin name"
        />
        <input
          className={field}
          type="email"
          placeholder="Client admin email"
          value={form.admin_email}
          onChange={(e) => setForm({ ...form, admin_email: e.target.value })}
          required
          aria-label="Admin email"
        />
        <div className="sm:col-span-2">
          <button className={primary}>
            <Plus size={12} /> Create and invite
          </button>
        </div>
      </form>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-xs">
          <thead className="text-slate-400 text-left">
            <tr>
              <th className="py-1">Workspace</th>
              <th>Plan</th>
              <th>Users</th>
              <th>Chats this month</th>
              <th>Limits (agents / brands / chats)</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-slate-400">
                  No client workspaces yet.
                </td>
              </tr>
            )}
            {rows.map((w) => (
              <tr key={w.id} className="border-t border-slate-100">
                <td className="py-2 pr-2 font-medium text-slate-800">
                  {w.company_name}
                </td>
                <td className="pr-2">
                  <select
                    className="h-7 px-1 border border-slate-200 rounded"
                    value={w.plan || 'free'}
                    onChange={(e) => void patch(w.id, { plan: e.target.value })}
                    aria-label="Plan"
                  >
                    <option value="free">free</option>
                    <option value="starter">starter</option>
                    <option value="growth">growth</option>
                  </select>
                </td>
                <td className="pr-2">{w.agents}</td>
                <td className="pr-2">{w.conversations_this_month}</td>
                <td className="pr-2">
                  {w.max_agents_allowed ?? '∞'} / {w.max_brands_allowed ?? '∞'}{' '}
                  / {w.conversation_limit ?? '∞'}
                </td>
                <td className="pr-2">
                  <button
                    className={
                      w.account_status === 'active'
                        ? 'text-emerald-600'
                        : 'text-red-600'
                    }
                    onClick={() =>
                      void patch(w.id, {
                        account_status:
                          w.account_status === 'active'
                            ? 'suspended'
                            : 'active',
                      })
                    }
                    title="Click to toggle"
                  >
                    {w.account_status}
                  </button>
                </td>
                <td className="text-right">
                  <button
                    className={ghost}
                    onClick={() => onOpen(w.id, w.company_name)}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Branding ────────────────────────────────────────────────────────────────
function BrandingForm({
  authFetch,
  agency,
  onSaved,
}: {
  authFetch: AuthFetch;
  agency: Agency;
  onSaved: () => void;
}) {
  const [b, setB] = useState<Branding>(agency.branding);
  const [name, setName] = useState(agency.name);
  const [msg, setMsg] = useState<Msg>(null);
  const set = (k: keyof Branding, v: unknown) => setB({ ...b, [k]: v });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await authFetch('/api/agency', {
      method: 'PATCH',
      body: JSON.stringify({ name, branding: b }),
    });
    if (!r.ok) return setMsg({ ok: false, text: await errorOf(r) });
    setMsg({
      ok: true,
      text: 'Branding saved. It appears on your domains, in emails and in the chat widget.',
    });
    onSaved();
  }

  const text = (k: keyof Branding, label: string, ph = '') => (
    <label className="block text-xs text-slate-600">
      {label}
      <input
        className={`${field} mt-1`}
        value={(b[k] as string) || ''}
        placeholder={ph}
        onChange={(e) => set(k, e.target.value)}
      />
    </label>
  );

  return (
    <form onSubmit={save} className="grid lg:grid-cols-[1fr_280px] gap-4">
      <div className={`${card} space-y-3`}>
        <Banner msg={msg} />
        <label className="block text-xs text-slate-600">
          Agency name
          <input
            className={`${field} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {text('appName', 'App name shown to your clients', 'e.g. Acme Support')}
        {text(
          'logoUrl',
          'Logo URL (https, square works best)',
          'https://…/logo.png',
        )}
        {text('faviconUrl', 'Favicon URL (https)', 'https://…/favicon.png')}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-slate-600">
            Primary colour
            <div className="flex gap-2 mt-1">
              <input
                type="color"
                value={b.primaryColor}
                onChange={(e) => set('primaryColor', e.target.value)}
                className="h-9 w-12 rounded border border-slate-200"
              />
              <input
                className={field}
                value={b.primaryColor}
                onChange={(e) => set('primaryColor', e.target.value)}
              />
            </div>
          </label>
          <label className="block text-xs text-slate-600">
            Accent colour
            <div className="flex gap-2 mt-1">
              <input
                type="color"
                value={b.accentColor}
                onChange={(e) => set('accentColor', e.target.value)}
                className="h-9 w-12 rounded border border-slate-200"
              />
              <input
                className={field}
                value={b.accentColor}
                onChange={(e) => set('accentColor', e.target.value)}
              />
            </div>
          </label>
        </div>
        {text('loginSubtitle', 'Login page subtitle', 'Customer support')}
        {text('emailFromName', 'Email sender name', 'Acme Support')}
        {text('supportEmail', 'Support email shown to clients')}
        {text('supportUrl', 'Help / support URL (https)')}
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={b.hidePoweredBy}
            onChange={(e) => set('hidePoweredBy', e.target.checked)}
          />{' '}
          Hide “Powered by” in the chat widget
        </label>
        <div className="text-xs text-slate-600">
          <p className="mb-1">
            Custom menu links (your own tools, shown in every client's sidebar)
          </p>
          {(b.customLinks || []).map((l, i) => (
            <div key={i} className="flex gap-2 mb-1.5">
              <input
                className={field}
                placeholder="Label"
                value={l.label}
                onChange={(e) =>
                  set(
                    'customLinks',
                    (b.customLinks || []).map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  )
                }
                aria-label="Link label"
              />
              <input
                className={field}
                placeholder="https://…"
                value={l.url}
                onChange={(e) =>
                  set(
                    'customLinks',
                    (b.customLinks || []).map((x, j) =>
                      j === i ? { ...x, url: e.target.value } : x,
                    ),
                  )
                }
                aria-label="Link URL"
              />
              <select
                className="h-9 px-2 text-xs border border-slate-200 rounded-lg"
                value={l.openIn}
                onChange={(e) =>
                  set(
                    'customLinks',
                    (b.customLinks || []).map((x, j) =>
                      j === i
                        ? { ...x, openIn: e.target.value as 'embed' | 'tab' }
                        : x,
                    ),
                  )
                }
                aria-label="Open in"
              >
                <option value="embed">Inside the app</option>
                <option value="tab">New tab</option>
              </select>
              <button
                type="button"
                className={danger}
                onClick={() =>
                  set(
                    'customLinks',
                    (b.customLinks || []).filter((_, j) => j !== i),
                  )
                }
                aria-label="Remove link"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {(b.customLinks || []).length < 10 && (
            <button
              type="button"
              className={ghost}
              onClick={() =>
                set('customLinks', [
                  ...(b.customLinks || []),
                  { label: '', url: '', openIn: 'embed' },
                ])
              }
            >
              <Plus size={12} /> Add link
            </button>
          )}
        </div>{' '}
        <label className="block text-xs text-slate-600">
          Custom CSS (applied to your dashboard; no scripts)
          <textarea
            className="w-full mt-1 h-32 p-2 text-xs font-mono border border-slate-200 rounded-lg"
            value={b.customCss || ''}
            onChange={(e) => set('customCss', e.target.value)}
            placeholder=".bg-slate-900 { background: #111827 }"
          />
        </label>
        <div className="flex gap-2">
          <button className={primary}>
            <Palette size={12} /> Save branding
          </button>
          <button
            type="button"
            className={ghost}
            onClick={() => applyBranding({ ...getBranding(), ...b })}
          >
            Preview here
          </button>
        </div>
      </div>
      <div className={`${card} h-fit`}>
        <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-2">
          Preview
        </p>
        <div className="rounded-lg overflow-hidden border border-slate-200">
          <div
            className="p-3 flex items-center gap-2"
            style={{ background: '#0f172a' }}
          >
            {b.logoUrl ? (
              <img
                src={b.logoUrl}
                alt=""
                className="w-7 h-7 rounded object-contain bg-white"
              />
            ) : (
              <div
                className="w-7 h-7 rounded"
                style={{ background: b.primaryColor }}
              />
            )}
            <span className="text-white text-sm font-semibold">
              {b.appName || 'Your app'}
            </span>
          </div>
          <div className="p-3 space-y-2 bg-white">
            <div
              className="h-8 rounded text-white text-xs flex items-center justify-center"
              style={{ background: b.primaryColor }}
            >
              Primary button
            </div>
            <div
              className="h-2 rounded"
              style={{ background: b.accentColor }}
            />
            {!b.hidePoweredBy && (
              <p className="text-[10px] text-center text-slate-400">
                Powered by {b.appName || 'Your app'}
              </p>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

// ── Domains ─────────────────────────────────────────────────────────────────
function Domains({
  authFetch,
  platformHost,
}: {
  authFetch: AuthFetch;
  platformHost: string;
}) {
  const [rows, setRows] = useState<Domain[]>([]);
  const [host, setHost] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await authFetch('/api/agency/domains');
    if (r.ok) setRows(await r.json());
  }, [authFetch]);
  useEffect(() => {
    void load();
  }, [load]);

  async function call(path: string, method = 'POST', body?: unknown) {
    setMsg(null);
    const r = await authFetch(`/api/agency/domains${path}`, {
      method,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) setMsg({ ok: false, text: await errorOf(r) });
    void load();
    return r.ok;
  }

  return (
    <div className="space-y-4">
      <Banner msg={msg} />
      <form
        className={`${card} flex flex-wrap gap-2 items-end`}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await call('', 'POST', { hostname: host })) setHost('');
        }}
      >
        <label className="flex-1 min-w-[220px] text-xs text-slate-600">
          Custom domain for your clients
          <input
            className={`${field} mt-1`}
            placeholder="app.youragency.com"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            required
          />
        </label>
        <button className={primary}>
          <Globe size={12} /> Add domain
        </button>
        <p className="w-full text-[11px] text-slate-500">
          Your clients will sign in at this address and see only your brand. It
          points to <code>{platformHost}</code>.
        </p>
      </form>
      {rows.map((d) => (
        <div key={d.id} className={card}>
          <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {d.hostname}{' '}
                {d.is_primary && (
                  <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">
                    primary
                  </span>
                )}
              </p>
              <p
                className={`text-[11px] ${d.status === 'active' ? 'text-emerald-600' : 'text-amber-600'}`}
              >
                {d.status === 'active' ? (
                  <>
                    <CheckCircle2 size={11} className="inline" /> Active
                  </>
                ) : (
                  'Waiting for DNS'
                )}
                {d.last_error ? (
                  <span className="text-slate-500"> · {d.last_error}</span>
                ) : null}
              </p>
            </div>
            <div className="flex gap-1.5">
              {d.status !== 'active' && (
                <button
                  className={primary}
                  disabled={busy === d.id}
                  onClick={async () => {
                    setBusy(d.id);
                    await call(`/${d.id}/verify`);
                    setBusy(null);
                  }}
                >
                  <RefreshCw
                    size={12}
                    className={busy === d.id ? 'animate-spin' : ''}
                  />{' '}
                  Verify
                </button>
              )}
              {d.status === 'active' && !d.is_primary && (
                <button
                  className={ghost}
                  onClick={() => void call(`/${d.id}/primary`)}
                >
                  Make primary
                </button>
              )}
              <button
                className={danger}
                onClick={() =>
                  confirm(`Remove ${d.hostname}?`) &&
                  void call(`/${d.id}`, 'DELETE')
                }
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          <table className="w-full text-[11px]">
            <thead className="text-slate-400 text-left">
              <tr>
                <th className="py-1">Type</th>
                <th>Name</th>
                <th>Value</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {d.dns.map((r) => (
                <tr key={r.type} className="border-t border-slate-100">
                  <td className="py-1.5 pr-2 font-mono">{r.type}</td>
                  <td className="pr-2 font-mono break-all">{r.name}</td>
                  <td className="pr-2 font-mono break-all">
                    {r.value}{' '}
                    <button
                      className="text-sky-600"
                      onClick={() =>
                        void navigator.clipboard?.writeText(r.value)
                      }
                      title="Copy"
                    >
                      <Copy size={10} className="inline" />
                    </button>
                  </td>
                  <td className="text-slate-500">{r.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ── AI provider ─────────────────────────────────────────────────────────────
function AiSettings({ authFetch }: { authFetch: AuthFetch }) {
  const [state, setState] = useState<{
    providers: { id: string; defaultModel: string }[];
    config: { provider: string; model: string; apiKey: string } | null;
  } | null>(null);
  const [form, setForm] = useState({
    provider: 'gemini',
    model: '',
    apiKey: '',
  });
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const r = await authFetch('/api/agency/ai');
    if (r.ok) {
      const d = await r.json();
      setState(d);
      if (d.config)
        setForm({
          provider: d.config.provider,
          model: d.config.model,
          apiKey: '',
        });
    }
  }, [authFetch]);
  useEffect(() => {
    void load();
  }, [load]);
  const def =
    state?.providers.find((p) => p.id === form.provider)?.defaultModel || '';

  return (
    <form
      className={`${card} space-y-3 max-w-xl`}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setMsg(null);
        const r = await authFetch('/api/agency/ai', {
          method: 'PUT',
          body: JSON.stringify({ ...form, model: form.model || def }),
        });
        setSaving(false);
        setMsg(
          r.ok
            ? {
                ok: true,
                text: 'Key verified and saved. The assistant in all your client workspaces now uses it.',
              }
            : { ok: false, text: await errorOf(r) },
        );
        void load();
      }}
    >
      <Banner msg={msg} />
      <p className="text-xs text-slate-600">
        By default the built-in AI assistant uses the platform's Gemini. Add
        your own key to use your preferred provider and pay for usage yourself.
        {state?.config ? (
          <>
            {' '}
            Currently: <strong>{state.config.provider}</strong> ·{' '}
            {state.config.model} · key {state.config.apiKey}
          </>
        ) : (
          ' Currently: platform default.'
        )}
      </p>
      <label className="block text-xs text-slate-600">
        Provider
        <select
          className={`${field} mt-1`}
          value={form.provider}
          onChange={(e) =>
            setForm({ ...form, provider: e.target.value, model: '' })
          }
        >
          <option value="gemini">Google Gemini</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic Claude</option>
        </select>
      </label>
      <label className="block text-xs text-slate-600">
        Model
        <input
          className={`${field} mt-1`}
          value={form.model}
          placeholder={def}
          onChange={(e) => setForm({ ...form, model: e.target.value })}
        />
      </label>
      <label className="block text-xs text-slate-600">
        API key
        <input
          className={`${field} mt-1`}
          type="password"
          value={form.apiKey}
          placeholder={
            state?.config ? 'Leave blank to keep the current key' : ''
          }
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          autoComplete="off"
        />
      </label>
      <div className="flex gap-2">
        <button className={primary} disabled={saving}>
          <KeyRound size={12} /> {saving ? 'Checking…' : 'Verify and save'}
        </button>
        {state?.config && (
          <button
            type="button"
            className={danger}
            onClick={async () => {
              await authFetch('/api/agency/ai', { method: 'DELETE' });
              setMsg({ ok: true, text: 'Back to the platform AI.' });
              void load();
            }}
          >
            Use platform AI
          </button>
        )}
      </div>
    </form>
  );
}

// ── Team ────────────────────────────────────────────────────────────────────
function Team({ authFetch }: { authFetch: AuthFetch }) {
  const [rows, setRows] = useState<
    { agent_id: string; name: string; email: string; role: string }[]
  >([]);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const load = useCallback(async () => {
    const r = await authFetch('/api/agency/members');
    if (r.ok) setRows(await r.json());
  }, [authFetch]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="space-y-4 max-w-2xl">
      <Banner msg={msg} />
      <form
        className={`${card} flex gap-2 items-end`}
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await authFetch('/api/agency/members', {
            method: 'POST',
            body: JSON.stringify({ email }),
          });
          setMsg(
            r.ok
              ? { ok: true, text: 'Added to the agency team.' }
              : { ok: false, text: await errorOf(r) },
          );
          if (r.ok) setEmail('');
          void load();
        }}
      >
        <label className="flex-1 text-xs text-slate-600">
          Add someone from your own workspace's Team
          <input
            className={`${field} mt-1`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@youragency.com"
            required
          />
        </label>
        <button className={primary}>
          <Users size={12} /> Add
        </button>
      </form>
      <div className={card}>
        {rows.map((m) => (
          <div
            key={m.agent_id}
            className="flex items-center justify-between py-2 border-b last:border-0 border-slate-100 text-xs"
          >
            <span>
              <strong className="text-slate-800">{m.name}</strong>{' '}
              <span className="text-slate-500">{m.email}</span> · {m.role}
            </span>
            <button
              className={danger}
              onClick={async () => {
                await authFetch(`/api/agency/members/${m.agent_id}`, {
                  method: 'DELETE',
                });
                void load();
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────
const TABS = [
  ['workspaces', 'Client workspaces'],
  ['branding', 'Branding'],
  ['domains', 'Domains'],
  ['ai', 'AI provider'],
  ['team', 'Agency team'],
] as const;

export function AgencySection({
  authFetch,
  onOpenWorkspace,
}: {
  authFetch: AuthFetch;
  onOpenWorkspace: (id: string, name: string) => void;
}) {
  const [agency, setAgency] = useState<Agency | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('workspaces');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await authFetch('/api/agency');
    if (r.ok) setAgency(await r.json());
    else setError(await errorOf(r));
  }, [authFetch]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-6xl mx-auto">
        <div className="mb-5">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Building2 size={16} className="text-sky-600" /> Agency
            {agency ? ` · ${agency.name}` : ''}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {agency
              ? `${agency.workspaces} of ${agency.max_workspaces} client workspaces · ${agency.active_domains} active domain(s)`
              : 'Resell the platform under your own brand.'}
          </p>
        </div>
        {error && (
          <div className="p-3 rounded-lg text-xs mb-4 bg-red-50 text-red-600">
            {error}
          </div>
        )}
        {agency && (
          <>
            <div className="flex flex-wrap gap-2 mb-5">
              {TABS.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg ${tab === k ? 'bg-sky-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === 'workspaces' && (
              <Workspaces authFetch={authFetch} onOpen={onOpenWorkspace} />
            )}
            {tab === 'branding' && (
              <BrandingForm
                authFetch={authFetch}
                agency={agency}
                onSaved={() => void load()}
              />
            )}
            {tab === 'domains' && (
              <Domains
                authFetch={authFetch}
                platformHost={agency.platform_host}
              />
            )}
            {tab === 'ai' && <AiSettings authFetch={authFetch} />}
            {tab === 'team' && <Team authFetch={authFetch} />}
          </>
        )}
      </div>
    </div>
  );
}
