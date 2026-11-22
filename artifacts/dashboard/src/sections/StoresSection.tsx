import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe,
  LogIn,
  Palette,
  Pause,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Settings2,
  ShoppingBag,
  Sparkles,
  Store,
  Trash2,
  Wallet,
} from 'lucide-react';
import type { AuthFetch } from './AuditLogSection';
import { fmtMoney } from './PaymentsSection';

type Api = <T = unknown>(path: string, init?: RequestInit) => Promise<T>;

interface Template {
  key: string;
  name: string;
  description: string;
  colors: string[];
}
interface DnsRecord {
  type: string;
  name: string;
  value: string;
  purpose: string;
}
interface StoreJob {
  id: string;
  kind: string;
  status: string;
  error: string | null;
  log: { at: string; msg: string }[];
  created_at: string;
}
interface StoreRow {
  id: string;
  kind: 'hosted' | 'connected';
  name: string;
  status: string;
  template: string | null;
  brand_color: string | null;
  business_description: string;
  subdomain: string | null;
  custom_domain: string | null;
  domain_status: string | null;
  domain_detail: {
    mode?: string;
    records?: DnsRecord[];
    errors?: string[];
    error?: string;
  } | null;
  site_url: string | null;
  currency: string | null;
  checkout_enabled: boolean;
  plugin_connected: boolean;
  stats: {
    orders?: number;
    orders_30d?: number;
    revenue_30d?: number;
    products?: number;
    customers?: number;
    open_orders?: number;
  };
  last_sync_at: string | null;
  sync_error: string | null;
  error: string | null;
  jobs?: StoreJob[];
  created_at: string;
}
interface Order {
  id: string;
  store_name: string;
  number: string;
  status: string;
  currency: string;
  total: number;
  customer_name: string;
  customer_email: string;
  items_count: number;
  payment_method_title: string | null;
  created_remote: string | null;
}
interface Overview {
  stores: StoreRow[];
  limits: { max_stores: number; used: number };
  templates: Template[];
  platform: {
    hosting_available: boolean;
    base_domains: string[];
    cloudflare: boolean;
  };
  payments_enabled: boolean;
  ai_enabled: boolean;
}

const STATUS: Record<string, [string, string]> = {
  active: ['Live', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
  provisioning: ['Setting up', 'bg-sky-50 text-sky-700 border-sky-200'],
  suspended: ['Paused', 'bg-amber-50 text-amber-700 border-amber-200'],
  failed: ['Setup failed', 'bg-rose-50 text-rose-700 border-rose-200'],
  deleting: ['Deleting', 'bg-slate-100 text-slate-600 border-slate-200'],
  error: ['Error', 'bg-rose-50 text-rose-700 border-rose-200'],
};
const ORDER_STATUS: Record<string, string> = {
  processing: 'bg-sky-50 text-sky-700',
  completed: 'bg-emerald-50 text-emerald-700',
  'on-hold': 'bg-amber-50 text-amber-700',
  pending: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-slate-100 text-slate-500',
  refunded: 'bg-violet-50 text-violet-700',
  failed: 'bg-rose-50 text-rose-700',
};
const CURRENCIES = [
  'usd',
  'eur',
  'gbp',
  'cad',
  'aud',
  'pkr',
  'inr',
  'aed',
  'sar',
  'ngn',
  'bdt',
  'egp',
  'try',
  'zar',
  'myr',
  'php',
  'jpy',
];
const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100';
const btn =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-sky-600 text-white hover:bg-sky-700`;
const btnGhost = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

function Pill({ status }: { status: string }) {
  const [label, cls] = STATUS[status] || [
    status,
    'bg-slate-100 text-slate-600 border-slate-200',
  ];
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

export function StoresSection({
  authFetch,
  role,
}: {
  authFetch: AuthFetch;
  role: string;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [view, setView] = useState<
    'list' | 'new' | 'connect' | 'orders' | string
  >('list');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isAdmin = role === 'admin';

  const api: Api = useCallback(
    async (path, init) => {
      const res = await authFetch(`/api/stores${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(body.error || `Request failed (${res.status})`);
      return body;
    },
    [authFetch],
  );

  const load = useCallback(() => {
    api<Overview>('')
      .then(setData)
      .catch((e) => setError(e.message));
  }, [api]);

  useEffect(() => {
    api<{ enabled: boolean }>('/status')
      .then((s) => {
        setEnabled(s.enabled);
        if (s.enabled) load();
      })
      .catch((e) => setError(e.message));
  }, [api, load]);

  // Refresh while a store is being set up or deleted.
  const busy = data?.stores.some((s) =>
    ['provisioning', 'deleting'].includes(s.status),
  );
  useEffect(() => {
    if (!busy || view !== 'list') return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [busy, view, load]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 5000);
  };
  const ctx = {
    api,
    isAdmin,
    onError: setError,
    onNotice: flash,
    reload: load,
  };
  const selected = data?.stores.find((s) => s.id === view);
  const full = data ? data.limits.used >= data.limits.max_stores : true;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <Store size={20} className="text-sky-600" /> Online stores
            </h1>
            <p className="text-sm text-slate-500">
              WooCommerce stores we build and host for you, or your existing
              store connected. Orders and customers flow into OmniCore.
            </p>
          </div>
          {enabled && data && view === 'list' && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btnGhost}
                onClick={() => setView('orders')}
              >
                <ShoppingBag size={15} /> All orders
              </button>
              {isAdmin && (
                <>
                  <button
                    type="button"
                    className={btnGhost}
                    disabled={full}
                    onClick={() => setView('connect')}
                  >
                    <Plug size={15} /> Connect existing store
                  </button>
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={full || !data.platform.hosting_available}
                    title={
                      !data.platform.hosting_available
                        ? 'Store hosting is not available yet'
                        : full
                          ? 'Plan limit reached'
                          : ''
                    }
                    onClick={() => setView('new')}
                  >
                    <Plus size={15} /> New store
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
            <span>{error}</span>
            <button
              type="button"
              className="text-rose-500"
              onClick={() => setError('')}
            >
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        {enabled === false && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="font-semibold text-slate-800">
              Online stores are not included in your plan
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Upgrade under Billing to a plan with online stores, or ask your
              provider to turn them on.
            </p>
          </div>
        )}

        {enabled && data && view === 'list' && (
          <StoreList data={data} onOpen={setView} ctx={ctx} />
        )}
        {enabled && data && view === 'new' && (
          <NewStore
            data={data}
            ctx={ctx}
            onDone={(id) => (load(), setView(id || 'list'))}
            onCancel={() => setView('list')}
          />
        )}
        {enabled && data && view === 'connect' && (
          <ConnectStore
            ctx={ctx}
            onDone={(id) => (load(), setView(id || 'list'))}
            onCancel={() => setView('list')}
          />
        )}
        {enabled && data && view === 'orders' && (
          <OrdersView api={api} path="/orders" onBack={() => setView('list')} />
        )}
        {enabled && data && selected && (
          <StoreDetail
            key={selected.id}
            storeId={selected.id}
            templates={data.templates}
            paymentsEnabled={data.payments_enabled}
            aiEnabled={data.ai_enabled}
            ctx={ctx}
            onBack={() => (load(), setView('list'))}
          />
        )}
      </div>
    </div>
  );
}

type Ctx = {
  api: Api;
  isAdmin: boolean;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  reload: () => void;
};

// ── List ─────────────────────────────────────────────────────────────────────
function StoreList({
  data,
  onOpen,
  ctx,
}: {
  data: Overview;
  onOpen: (id: string) => void;
  ctx: Ctx;
}) {
  const openAdmin = async (s: StoreRow) => {
    try {
      const r = await ctx.api<{ url: string }>(`/${s.id}/sso`, {
        method: 'POST',
        body: '{}',
      });
      window.open(r.url, '_blank', 'noopener');
    } catch (e) {
      ctx.onError((e as Error).message);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {data.limits.used} of {data.limits.max_stores} store
        {data.limits.max_stores === 1 ? '' : 's'} on your plan
        {!data.platform.hosting_available &&
          ' · Hosted stores are not available on this platform yet; you can connect an existing store.'}
      </p>
      {!data.stores.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Store size={32} className="mx-auto text-slate-300" />
          <p className="mt-3 font-semibold text-slate-800">No stores yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Launch a ready-to-sell WooCommerce store in about a minute: pick a
            design, describe your shop, and we write the pages and starter
            products for you.
          </p>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {data.stores.map((s) => (
          <div
            key={s.id}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold text-slate-900">
                    {s.name}
                  </p>
                  <Pill status={s.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {s.kind === 'hosted' ? 'Hosted by us' : 'Connected store'} ·{' '}
                  {s.site_url || s.subdomain || '—'}
                </p>
              </div>
              {s.template && (
                <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] capitalize text-slate-600">
                  {s.template}
                </span>
              )}
            </div>
            {s.status === 'provisioning' && (
              <div className="mt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-500" />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Installing WordPress and WooCommerce, writing your pages and
                  products…
                </p>
              </div>
            )}
            {s.status === 'failed' && (
              <p className="mt-2 text-xs text-rose-600">{s.error}</p>
            )}
            {['active', 'suspended'].includes(s.status) && (
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat
                  label="Orders (30 days)"
                  value={String(s.stats.orders_30d ?? 0)}
                />
                <Stat
                  label="Revenue (30 days)"
                  value={fmtMoney(
                    s.stats.revenue_30d ?? 0,
                    s.currency || 'usd',
                  )}
                />
                <Stat
                  label="Products"
                  value={
                    s.stats.products === undefined
                      ? '—'
                      : String(s.stats.products)
                  }
                />
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={btnGhost}
                onClick={() => onOpen(s.id)}
              >
                <Settings2 size={14} /> Manage
              </button>
              {s.site_url && s.status === 'active' && (
                <a
                  className={btnGhost}
                  href={s.site_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} /> Visit
                </a>
              )}
              {ctx.isAdmin && s.site_url && s.status === 'active' && (
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => openAdmin(s)}
                >
                  <LogIn size={14} /> Store admin
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2">
      <p className="text-sm font-bold text-slate-900">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </p>
    </div>
  );
}

// ── New hosted store ─────────────────────────────────────────────────────────
function slugify(v: string) {
  return v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function NewStore({
  data,
  ctx,
  onDone,
  onCancel,
}: {
  data: Overview;
  ctx: Ctx;
  onDone: (id?: string) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    name: '',
    slug: '',
    template: data.templates[0]?.key || 'minimal',
    brand_color: '',
    useBrand: false,
    currency: 'usd',
    country: '',
    city: '',
    email: '',
    phone: '',
    description: '',
    use_ai: data.ai_enabled,
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [avail, setAvail] = useState<{
    available: boolean;
    subdomain?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const slug = slugTouched ? f.slug : slugify(f.name);
  const base = data.platform.base_domains[0] || 'stores';

  useEffect(() => {
    if (slug.length < 3) return setAvail(null);
    const t = setTimeout(() => {
      ctx
        .api<{ available: boolean; subdomain?: string }>(
          `/slug?slug=${encodeURIComponent(slug)}`,
        )
        .then(setAvail)
        .catch(() => setAvail(null));
    }, 350);
    return () => clearTimeout(t);
  }, [slug, ctx]);

  const submit = async () => {
    setSaving(true);
    try {
      const s = await ctx.api<StoreRow>('/hosted', {
        method: 'POST',
        body: JSON.stringify({
          name: f.name,
          slug,
          template: f.template,
          brand_color: f.useBrand ? f.brand_color : '',
          currency: f.currency,
          country: f.country,
          city: f.city,
          email: f.email,
          phone: f.phone,
          description: f.description,
          use_ai: f.use_ai,
        }),
      });
      ctx.onNotice(
        `Setting up ${s.name}. It is usually live within a couple of minutes.`,
      );
      onDone(s.id);
    } catch (e) {
      ctx.onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <button
        type="button"
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        onClick={onCancel}
      >
        <ArrowLeft size={14} /> Back
      </button>
      <h2 className="text-lg font-semibold text-slate-900">
        Launch a new store
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Store name</span>
          <input
            className={inputCls}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="Bloom & Petal"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Web address</span>
          <div className="flex items-center rounded-lg border border-slate-300 focus-within:border-sky-500">
            <input
              className="min-w-0 flex-1 rounded-l-lg px-3 py-2 text-sm focus:outline-none"
              value={slug}
              onChange={(e) => (
                setSlugTouched(true),
                setF({ ...f, slug: slugify(e.target.value) })
              )}
              placeholder="bloom"
            />
            <span className="whitespace-nowrap rounded-r-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
              .{base}
            </span>
          </div>
          {avail && (
            <span
              className={`text-xs ${avail.available ? 'text-emerald-600' : 'text-rose-600'}`}
            >
              {avail.available ? 'Available' : 'Already taken'} · you can add
              your own domain later
            </span>
          )}
        </label>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Design</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.templates.map((t) => (
            <button
              type="button"
              key={t.key}
              onClick={() => setF({ ...f, template: t.key })}
              className={`rounded-xl border p-3 text-left transition ${f.template === t.key ? 'border-sky-500 ring-2 ring-sky-100' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <div className="mb-2 flex h-10 overflow-hidden rounded-md">
                {t.colors.map((c, i) => (
                  <span
                    key={i}
                    className="flex-1"
                    style={{
                      background:
                        f.useBrand && f.brand_color && i === 1
                          ? f.brand_color
                          : c,
                    }}
                  />
                ))}
              </div>
              <p className="text-sm font-semibold text-slate-800">{t.name}</p>
              <p className="text-xs text-slate-500">{t.description}</p>
            </button>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={f.useBrand}
            onChange={(e) =>
              setF({
                ...f,
                useBrand: e.target.checked,
                brand_color: f.brand_color || '#0ea5e9',
              })
            }
          />
          Use my brand colour
          {f.useBrand && (
            <input
              type="color"
              value={f.brand_color || '#0ea5e9'}
              onChange={(e) => setF({ ...f, brand_color: e.target.value })}
            />
          )}
        </label>
      </div>

      <label className="block text-sm">
        <span className="font-medium text-slate-700">
          What do you sell, and to whom?
        </span>
        <textarea
          className={`${inputCls} h-24`}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="Fresh flowers and plants, delivered the same day across Lahore for birthdays, weddings and every day."
        />
      </label>
      {data.ai_enabled && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={f.use_ai}
            onChange={(e) => setF({ ...f, use_ai: e.target.checked })}
          />
          <Sparkles size={14} className="text-violet-500" /> Write my homepage,
          pages and starter products with AI
        </label>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Currency</span>
          <select
            className={inputCls}
            value={f.currency}
            onChange={(e) => setF({ ...f, currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Country code</span>
          <input
            className={inputCls}
            value={f.country}
            onChange={(e) =>
              setF({ ...f, country: e.target.value.toUpperCase().slice(0, 6) })
            }
            placeholder="US"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">City</span>
          <input
            className={inputCls}
            value={f.city}
            onChange={(e) => setF({ ...f, city: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Store email</span>
          <input
            className={inputCls}
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            placeholder="orders@…"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={
            saving ||
            f.name.trim().length < 2 ||
            slug.length < 3 ||
            avail?.available === false
          }
          onClick={submit}
        >
          {saving ? (
            <RefreshCw size={15} className="animate-spin" />
          ) : (
            <Store size={15} />
          )}{' '}
          Launch store
        </button>
        <button type="button" className={btnGhost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Connect existing store ───────────────────────────────────────────────────
function ConnectStore({
  ctx,
  onDone,
  onCancel,
}: {
  ctx: Ctx;
  onDone: (id?: string) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    name: '',
    site_url: '',
    consumer_key: '',
    consumer_secret: '',
  });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      const s = await ctx.api<StoreRow>('/connect', {
        method: 'POST',
        body: JSON.stringify(f),
      });
      ctx.onNotice(`${s.name} is connected. Importing orders now.`);
      onDone(s.id);
    } catch (e) {
      ctx.onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <button
        type="button"
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        onClick={onCancel}
      >
        <ArrowLeft size={14} /> Back
      </button>
      <h2 className="text-lg font-semibold text-slate-900">
        Connect your WooCommerce store
      </h2>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>
          In your WordPress admin open WooCommerce → Settings → Advanced → REST
          API and click “Add key”.
        </li>
        <li>
          Give it a description (e.g. OmniCore), choose your user and set
          Permissions to Read/Write.
        </li>
        <li>Copy the Consumer key and Consumer secret below.</li>
      </ol>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Store name</span>
          <input
            className={inputCls}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Store address</span>
          <input
            className={inputCls}
            value={f.site_url}
            onChange={(e) => setF({ ...f, site_url: e.target.value })}
            placeholder="https://shop.example.com"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Consumer key</span>
          <input
            className={inputCls}
            value={f.consumer_key}
            onChange={(e) =>
              setF({ ...f, consumer_key: e.target.value.trim() })
            }
            placeholder="ck_…"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Consumer secret</span>
          <input
            className={inputCls}
            type="password"
            autoComplete="off"
            value={f.consumer_secret}
            onChange={(e) =>
              setF({ ...f, consumer_secret: e.target.value.trim() })
            }
            placeholder="cs_…"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={
            saving || !f.site_url || !f.consumer_key || !f.consumer_secret
          }
          onClick={submit}
        >
          {saving ? (
            <RefreshCw size={15} className="animate-spin" />
          ) : (
            <Plug size={15} />
          )}{' '}
          Connect
        </button>
        <button type="button" className={btnGhost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Orders ───────────────────────────────────────────────────────────────────
function OrdersView({
  api,
  path,
  onBack,
}: {
  api: Api;
  path: string;
  onBack?: () => void;
}) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const fetchOrders = () =>
      api<{ orders: Order[] }>(`${path}?limit=50`)
        .then((r) => setOrders(r.orders))
        .catch((e) => setErr(e.message));
    fetchOrders();
    const t = setInterval(fetchOrders, 15000);
    return () => clearInterval(t);
  }, [api, path]);
  return (
    <div className="space-y-3">
      {onBack && (
        <button
          type="button"
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          onClick={onBack}
        >
          <ArrowLeft size={14} /> Back
        </button>
      )}
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Order</th>
              {!onBack ? null : <th className="px-3 py-2">Store</th>}
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Items</th>
              <th className="px-3 py-2">Payment</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {orders?.map((o) => (
              <tr key={o.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">
                  #{o.number}
                </td>
                {!onBack ? null : (
                  <td className="px-3 py-2 text-slate-600">{o.store_name}</td>
                )}
                <td className="px-3 py-2">
                  <p className="text-slate-800">{o.customer_name || '—'}</p>
                  <p className="text-xs text-slate-500">{o.customer_email}</p>
                </td>
                <td className="px-3 py-2 text-slate-600">{o.items_count}</td>
                <td className="px-3 py-2 text-slate-600">
                  {o.payment_method_title || '—'}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${ORDER_STATUS[o.status] || 'bg-slate-100 text-slate-600'}`}
                  >
                    {o.status.replace('-', ' ')}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-medium text-slate-900">
                  {fmtMoney(o.total, o.currency)}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {o.created_remote
                    ? new Date(o.created_remote).toLocaleString()
                    : '—'}
                </td>
              </tr>
            ))}
            {orders && !orders.length && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Store detail ─────────────────────────────────────────────────────────────
type DetailTab =
  | 'overview'
  | 'orders'
  | 'design'
  | 'domain'
  | 'payments'
  | 'settings';

function StoreDetail({
  storeId,
  templates,
  paymentsEnabled,
  aiEnabled,
  ctx,
  onBack,
}: {
  storeId: string;
  templates: Template[];
  paymentsEnabled: boolean;
  aiEnabled: boolean;
  ctx: Ctx;
  onBack: () => void;
}) {
  const [s, setS] = useState<StoreRow | null>(null);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    ctx
      .api<StoreRow>(`/${storeId}`)
      .then(setS)
      .catch((e) => ctx.onError(e.message));
  }, [ctx, storeId]);
  useEffect(load, [load]);
  const working =
    s &&
    (['provisioning', 'deleting'].includes(s.status) ||
      s.jobs?.some(
        (j) =>
          ['queued', 'running'].includes(j.status) && j.kind !== 'domain_check',
      ));
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [working, load]);

  const act = async (
    label: string,
    path: string,
    init: RequestInit,
    done?: string,
  ) => {
    setBusy(label);
    try {
      const r = await ctx.api<StoreRow>(path, init);
      if (r && (r as StoreRow).id)
        setS((cur) => ({ ...(cur as StoreRow), ...(r as StoreRow) }));
      if (done) ctx.onNotice(done);
      load();
      return r;
    } catch (e) {
      ctx.onError((e as Error).message);
      return null;
    } finally {
      setBusy('');
    }
  };

  if (!s) return <p className="text-sm text-slate-500">Loading…</p>;
  const hosted = s.kind === 'hosted';
  const live = s.status === 'active';
  const tabs: [DetailTab, string, React.ReactNode][] = [
    ['overview', 'Overview', <Store size={14} key="o" />],
    ['orders', 'Orders', <ShoppingBag size={14} key="r" />],
    ...(hosted
      ? ([
          ['design', 'Design', <Palette size={14} key="d" />],
          ['domain', 'Domain', <Globe size={14} key="g" />],
        ] as [DetailTab, string, React.ReactNode][])
      : []),
    ['payments', 'Payments', <Wallet size={14} key="p" />],
    ['settings', 'Settings', <Settings2 size={14} key="s" />],
  ];

  return (
    <div className="space-y-4">
      <button
        type="button"
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        onClick={onBack}
      >
        <ArrowLeft size={14} /> All stores
      </button>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{s.name}</h2>
            <Pill status={s.status} />
          </div>
          <p className="text-sm text-slate-500">{s.site_url || s.subdomain}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.site_url && live && (
            <a
              className={btnGhost}
              href={s.site_url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} /> Visit store
            </a>
          )}
          {ctx.isAdmin && s.site_url && live && (
            <button
              type="button"
              className={btnPrimary}
              onClick={async () => {
                const r = await ctx
                  .api<{
                    url: string;
                  }>(`/${s.id}/sso`, { method: 'POST', body: '{}' })
                  .catch((e) => (ctx.onError(e.message), null));
                if (r) window.open(r.url, '_blank', 'noopener');
              }}
            >
              <LogIn size={14} /> Open store admin
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${tab === key ? 'bg-sky-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewTab s={s} ctx={ctx} busy={busy} act={act} />
      )}
      {tab === 'orders' && (
        <OrdersView api={ctx.api} path={`/${s.id}/orders`} />
      )}
      {tab === 'design' && hosted && (
        <DesignTab
          s={s}
          templates={templates}
          aiEnabled={aiEnabled}
          busy={busy}
          act={act}
          isAdmin={ctx.isAdmin}
        />
      )}
      {tab === 'domain' && hosted && (
        <DomainTab s={s} busy={busy} act={act} isAdmin={ctx.isAdmin} />
      )}
      {tab === 'payments' && (
        <PaymentsTab
          s={s}
          ctx={ctx}
          paymentsEnabled={paymentsEnabled}
          busy={busy}
          act={act}
        />
      )}
      {tab === 'settings' && (
        <SettingsTab s={s} ctx={ctx} busy={busy} act={act} onDeleted={onBack} />
      )}
    </div>
  );
}

type Act = (
  label: string,
  path: string,
  init: RequestInit,
  done?: string,
) => Promise<unknown>;

function OverviewTab({
  s,
  ctx,
  busy,
  act,
}: {
  s: StoreRow;
  ctx: Ctx;
  busy: string;
  act: Act;
}) {
  const job = s.jobs?.find((j) =>
    ['provision', 'redesign', 'delete'].includes(j.kind),
  );
  return (
    <div className="space-y-4">
      {['active', 'suspended'].includes(s.status) && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat
            label="Orders (30 days)"
            value={String(s.stats.orders_30d ?? 0)}
          />
          <Stat
            label="Revenue (30 days)"
            value={fmtMoney(s.stats.revenue_30d ?? 0, s.currency || 'usd')}
          />
          <Stat label="Open orders" value={String(s.stats.open_orders ?? 0)} />
          <Stat label="Customers" value={String(s.stats.customers ?? 0)} />
          <Stat
            label="Products"
            value={
              s.stats.products === undefined ? '—' : String(s.stats.products)
            }
          />
        </div>
      )}
      {s.status === 'failed' && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={16} /> Setup did not finish
          </p>
          <p className="mt-1">{s.error}</p>
          {ctx.isAdmin && (
            <button
              type="button"
              className={`${btnGhost} mt-3`}
              disabled={!!busy}
              onClick={() =>
                act(
                  'retry',
                  `/${s.id}/retry`,
                  { method: 'POST', body: '{}' },
                  'Trying again.',
                )
              }
            >
              <RefreshCw size={14} /> Try again
            </button>
          )}
        </div>
      )}
      {job && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">
            Latest activity · <span className="capitalize">{job.kind}</span>{' '}
            <span className="text-slate-400">({job.status})</span>
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {(job.log || []).map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-slate-400">
                  {new Date(l.at).toLocaleTimeString()}
                </span>
                <span>{l.msg}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <span>
          Last sync:{' '}
          {s.last_sync_at
            ? new Date(s.last_sync_at).toLocaleString()
            : 'not yet'}
        </span>
        {s.sync_error && <span className="text-rose-600">{s.sync_error}</span>}
        <button
          type="button"
          className={btnGhost}
          disabled={!!busy || !s.last_sync_at}
          onClick={() =>
            act(
              'sync',
              `/${s.id}/sync`,
              { method: 'POST', body: '{}' },
              'Syncing orders.',
            )
          }
        >
          <RefreshCw size={14} /> Sync now
        </button>
      </div>
    </div>
  );
}

function DesignTab({
  s,
  templates,
  aiEnabled,
  busy,
  act,
  isAdmin,
}: {
  s: StoreRow;
  templates: Template[];
  aiEnabled: boolean;
  busy: string;
  act: Act;
  isAdmin: boolean;
}) {
  const [template, setTemplate] = useState(s.template || 'minimal');
  const [brand, setBrand] = useState(s.brand_color || '');
  const [description, setDescription] = useState(s.business_description || '');
  const [rewrite, setRewrite] = useState(false);
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <button
            key={t.key}
            type="button"
            disabled={!isAdmin}
            onClick={() => setTemplate(t.key)}
            className={`rounded-xl border p-3 text-left ${template === t.key ? 'border-sky-500 ring-2 ring-sky-100' : 'border-slate-200 hover:border-slate-300'}`}
          >
            <div className="mb-2 flex h-8 overflow-hidden rounded-md">
              {t.colors.map((c, i) => (
                <span
                  key={i}
                  className="flex-1"
                  style={{ background: brand && i === 1 ? brand : c }}
                />
              ))}
            </div>
            <p className="text-sm font-semibold text-slate-800">{t.name}</p>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={!!brand}
          disabled={!isAdmin}
          onChange={(e) => setBrand(e.target.checked ? '#0ea5e9' : '')}
        />{' '}
        Use my brand colour
        {brand && (
          <input
            type="color"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
        )}
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">About your shop</span>
        <textarea
          className={`${inputCls} h-20`}
          value={description}
          disabled={!isAdmin}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={rewrite}
          disabled={!isAdmin}
          onChange={(e) => setRewrite(e.target.checked)}
        />
        Also rewrite the homepage and pages{aiEnabled ? ' with AI' : ''} (your
        products are kept)
      </label>
      {isAdmin && (
        <button
          type="button"
          className={btnPrimary}
          disabled={!!busy || s.status !== 'active'}
          onClick={() =>
            act(
              'design',
              `/${s.id}/redesign`,
              {
                method: 'POST',
                body: JSON.stringify({
                  template,
                  brand_color: brand,
                  description,
                  rewrite_content: rewrite,
                }),
              },
              'Updating the design. Refresh your store in a minute.',
            )
          }
        >
          <Palette size={15} /> Apply design
        </button>
      )}
    </div>
  );
}

function DomainTab({
  s,
  busy,
  act,
  isAdmin,
}: {
  s: StoreRow;
  busy: string;
  act: Act;
  isAdmin: boolean;
}) {
  const [domain, setDomain] = useState('');
  const records = s.domain_detail?.records || [];
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-600">
        Your store is always available at <strong>{s.subdomain}</strong>. Add
        your own domain and it becomes the main address once its DNS points to
        us; SSL is set up automatically.
      </p>
      {!s.custom_domain && isAdmin && (
        <div className="flex flex-wrap gap-2">
          <input
            className={`${inputCls} max-w-sm`}
            value={domain}
            onChange={(e) => setDomain(e.target.value.trim())}
            placeholder="shop.yourbrand.com"
          />
          <button
            type="button"
            className={btnPrimary}
            disabled={!!busy || !domain}
            onClick={() =>
              act('domain', `/${s.id}/domain`, {
                method: 'POST',
                body: JSON.stringify({ domain }),
              })
            }
          >
            <Globe size={15} /> Add domain
          </button>
        </div>
      )}
      {s.custom_domain && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800">
              {s.custom_domain}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.domain_status === 'active' ? 'bg-emerald-50 text-emerald-700' : s.domain_status === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}
            >
              {s.domain_status === 'active'
                ? 'Connected'
                : s.domain_status === 'error'
                  ? 'Not connected'
                  : 'Waiting for DNS'}
            </span>
          </div>
          {s.domain_status !== 'active' && (
            <>
              <p className="text-sm text-slate-600">
                Add these records at your domain provider. We check
                automatically every few minutes.
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Value</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono text-xs">
                          {r.type}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {r.name}
                        </td>
                        <td className="break-all px-3 py-2 font-mono text-xs">
                          {r.value}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="text-slate-400 hover:text-slate-700"
                            onClick={() => copy(r.value)}
                          >
                            <Copy size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(s.domain_detail?.error || s.domain_detail?.errors?.length) && (
                <p className="text-sm text-rose-600">
                  {s.domain_detail?.error || s.domain_detail?.errors?.join(' ')}
                </p>
              )}
            </>
          )}
          {isAdmin && (
            <div className="flex gap-2">
              {s.domain_status !== 'active' && (
                <button
                  type="button"
                  className={btnGhost}
                  disabled={!!busy}
                  onClick={() =>
                    act(
                      'check',
                      `/${s.id}/domain/check`,
                      { method: 'POST', body: '{}' },
                      'Checking DNS now.',
                    )
                  }
                >
                  <RefreshCw size={14} /> Check now
                </button>
              )}
              <button
                type="button"
                className={btnGhost}
                disabled={!!busy}
                onClick={() =>
                  act(
                    'rm-domain',
                    `/${s.id}/domain`,
                    { method: 'DELETE' },
                    'Domain removed.',
                  )
                }
              >
                <Trash2 size={14} /> Remove domain
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentsTab({
  s,
  ctx,
  paymentsEnabled,
  busy,
  act,
}: {
  s: StoreRow;
  ctx: Ctx;
  paymentsEnabled: boolean;
  busy: string;
  act: Act;
}) {
  const [key, setKey] = useState('');
  const hosted = s.kind === 'hosted';
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div>
        <p className="font-semibold text-slate-800">OmniCore checkout</p>
        <p className="text-sm text-slate-600">
          Customers choose “Pay online” at checkout and pay on your OmniCore
          payment page with the methods you connected under Invoices &amp;
          Payments (card processors, PayPal, bank transfer, cash on delivery,
          Payoneer). The order updates by itself when the payment arrives. You
          can also install any WooCommerce payment plugin in your store admin;
          both work side by side.
        </p>
      </div>
      {!paymentsEnabled && (
        <p className="text-sm text-amber-700">
          Invoicing &amp; payments is not part of your plan, so the OmniCore
          checkout is unavailable.
        </p>
      )}
      {paymentsEnabled && ctx.isAdmin && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={s.checkout_enabled}
            disabled={!!busy}
            onChange={(e) =>
              act(
                'checkout',
                `/${s.id}`,
                {
                  method: 'PATCH',
                  body: JSON.stringify({ checkout_enabled: e.target.checked }),
                },
                'Saved.',
              )
            }
          />
          Offer OmniCore checkout in this store
        </label>
      )}
      {!hosted && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          <p className="font-medium text-slate-800">
            Install the OmniCore plugin in your store{' '}
            {s.plugin_connected && (
              <Check size={14} className="inline text-emerald-600" />
            )}
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Download the plugin and upload it under Plugins → Add New → Upload
              Plugin, then activate it.
            </li>
            <li>Open WooCommerce → OmniCore and paste the connection key.</li>
            <li>Turn on “OmniCore” under WooCommerce → Settings → Payments.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <a className={btnGhost} href="/api/stores/plugin.zip">
              <Download size={14} /> Download plugin
            </a>
            {ctx.isAdmin && (
              <button
                type="button"
                className={btnGhost}
                onClick={async () => {
                  const r = await ctx
                    .api<{ key: string }>(`/${s.id}/connection-key`)
                    .catch((e) => (ctx.onError(e.message), null));
                  if (r) {
                    setKey(r.key);
                    copy(r.key);
                    ctx.onNotice('Connection key copied.');
                  }
                }}
              >
                <Copy size={14} /> Copy connection key
              </button>
            )}
          </div>
          {key && (
            <p className="break-all rounded bg-white p-2 font-mono text-[11px] text-slate-500">
              {key}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SettingsTab({
  s,
  ctx,
  busy,
  act,
  onDeleted,
}: {
  s: StoreRow;
  ctx: Ctx;
  busy: string;
  act: Act;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(s.name);
  const [confirm, setConfirm] = useState('');
  const [admin, setAdmin] = useState<{ user: string; password: string } | null>(
    null,
  );
  const hosted = s.kind === 'hosted';
  if (!ctx.isAdmin)
    return (
      <p className="text-sm text-slate-500">
        Only workspace admins can change store settings.
      </p>
    );
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-5">
        <p className="font-semibold text-slate-800">Store name</p>
        <div className="flex gap-2">
          <input
            className={`${inputCls} max-w-sm`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className={btnGhost}
            disabled={!!busy || name === s.name}
            onClick={() =>
              act(
                'name',
                `/${s.id}`,
                { method: 'PATCH', body: JSON.stringify({ name }) },
                'Saved.',
              )
            }
          >
            Save
          </button>
        </div>
        <p className="text-xs text-slate-500">
          This is the name in OmniCore. Change the title customers see in your
          store admin under Settings → General.
        </p>
      </div>
      {hosted && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-5">
          <p className="font-semibold text-slate-800">Store administrator</p>
          <p className="text-sm text-slate-600">
            “Open store admin” signs you in without a password. Keep this login
            for emergencies.
          </p>
          {admin ? (
            <p className="font-mono text-sm text-slate-700">
              {admin.user} · {admin.password}
            </p>
          ) : (
            <button
              type="button"
              className={btnGhost}
              onClick={async () =>
                setAdmin(
                  await ctx
                    .api<{
                      user: string;
                      password: string;
                    }>(`/${s.id}/admin-password`)
                    .catch((e) => (ctx.onError(e.message), null)),
                )
              }
            >
              Show login
            </button>
          )}
        </div>
      )}
      {hosted && ['active', 'suspended'].includes(s.status) && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-5">
          <p className="font-semibold text-slate-800">
            {s.status === 'suspended' ? 'Store is paused' : 'Pause store'}
          </p>
          <p className="text-sm text-slate-600">
            While paused, visitors see a “temporarily unavailable” page. Nothing
            is deleted.
          </p>
          {s.status === 'suspended' ? (
            <button
              type="button"
              className={btnGhost}
              disabled={!!busy}
              onClick={() =>
                act(
                  'resume',
                  `/${s.id}/resume`,
                  { method: 'POST', body: '{}' },
                  'Store is live again.',
                )
              }
            >
              <Play size={14} /> Resume
            </button>
          ) : (
            <button
              type="button"
              className={btnGhost}
              disabled={!!busy}
              onClick={() =>
                act(
                  'suspend',
                  `/${s.id}/suspend`,
                  { method: 'POST', body: '{}' },
                  'Store paused.',
                )
              }
            >
              <Pause size={14} /> Pause
            </button>
          )}
        </div>
      )}
      <div className="space-y-2 rounded-xl border border-rose-200 bg-white p-5">
        <p className="font-semibold text-rose-700">
          {hosted ? 'Delete store' : 'Disconnect store'}
        </p>
        <p className="text-sm text-slate-600">
          {hosted
            ? 'The website, its products and orders are removed from the store server (a final backup is kept for the platform team). Orders already synced stay in OmniCore.'
            : 'OmniCore stops syncing and removes its webhooks from your store. Your store itself is not changed.'}
        </p>
        <div className="flex gap-2">
          <input
            className={`${inputCls} max-w-[12rem]`}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type DELETE"
          />
          <button
            type="button"
            className={`${btn} bg-rose-600 text-white hover:bg-rose-700`}
            disabled={!!busy || confirm !== 'DELETE'}
            onClick={async () => {
              const r = await act(
                'delete',
                `/${s.id}`,
                { method: 'DELETE', body: JSON.stringify({ confirm }) },
                hosted ? 'Deleting the store.' : 'Store disconnected.',
              );
              if (r) onDeleted();
            }}
          >
            <Trash2 size={14} /> {hosted ? 'Delete' : 'Disconnect'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const _internal = { slugify };
