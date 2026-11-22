import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  Gift,
  Link2,
  Mail,
  Package,
  Percent,
  Plus,
  Receipt,
  RefreshCw,
  Settings2,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { AuthFetch } from './AuditLogSection';

// ── Money helpers (amounts are integer minor units) ──────────────────────────
const ZERO_DECIMAL = [
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
];
const decimals = (c: string) =>
  ZERO_DECIMAL.includes(String(c).toLowerCase()) ? 0 : 2;
export const toMinor = (v: string | number, c: string) =>
  Math.round(Number(v || 0) * 10 ** decimals(c));
const toMajor = (m: number, c: string) =>
  (Number(m || 0) / 10 ** decimals(c)).toFixed(decimals(c));
export function fmtMoney(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: String(currency || 'usd').toUpperCase(),
    }).format(Number(minor || 0) / 10 ** decimals(currency));
  } catch {
    return `${toMajor(minor, currency)} ${String(currency).toUpperCase()}`;
  }
}

type Tab =
  | 'overview'
  | 'invoices'
  | 'estimates'
  | 'links'
  | 'products'
  | 'coupons'
  | 'gift_cards'
  | 'payments'
  | 'customers'
  | 'settings';

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  taxable: boolean;
  tax_rate: number;
  amount?: number;
}
interface Doc {
  id: string;
  kind: 'invoice' | 'estimate';
  number: string;
  status: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  title: string;
  currency: string;
  line_items: LineItem[];
  subtotal: number;
  tax_total: number;
  discount_total: number;
  coupon_code: string | null;
  total: number;
  amount_paid: number;
  balance: number;
  due_date: string | null;
  payment_terms: string;
  notes: string;
  allowed_methods: string[] | null;
  public_url: string;
  created_at: string;
  transactions?: Tx[];
}
interface Tx {
  id: string;
  provider: string;
  method: string;
  amount: number;
  currency: string;
  status: string;
  customer_name: string;
  customer_email: string;
  reference: string;
  invoice_number?: string;
  link_title?: string;
  created_at: string;
}
interface CatalogEntry {
  key: string;
  label: string;
  kind: 'online' | 'manual';
  methods: string;
  fields: {
    name: string;
    label: string;
    secret?: boolean;
    required?: boolean;
    options?: string[];
    multiline?: boolean;
  }[];
  webhook: boolean;
}
interface Connected {
  provider: string;
  environment: string;
  settings: Record<string, unknown>;
  connected_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-sky-100 text-sky-700',
  viewed: 'bg-indigo-100 text-indigo-700',
  partially_paid: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-700',
  paid: 'bg-emerald-100 text-emerald-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  void: 'bg-slate-200 text-slate-500',
  pending: 'bg-amber-100 text-amber-700',
  succeeded: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  refunded: 'bg-slate-200 text-slate-600',
};
const Badge = ({ s }: { s: string }) => (
  <span
    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[s] || STATUS_STYLE.draft}`}
  >
    {s.replace('_', ' ')}
  </span>
);
const input =
  'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200';
const btn =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold';
const primary = `${btn} bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50`;
const secondary = `${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const date = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString() : '—';

type Api = <T = any>(path: string, init?: RequestInit) => Promise<T>;

/** Invoicing & payments (ported InvoiceNow). */
export function PaymentsSection({
  authFetch,
  role,
}: {
  authFetch: AuthFetch;
  role: string;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isAdmin = role === 'admin';

  const api: Api = useCallback(
    async (path, init) => {
      const res = await authFetch(`/api/payments${path}`, {
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

  useEffect(() => {
    api<{ enabled: boolean }>('/status')
      .then((s) => setEnabled(s.enabled))
      .catch((e) => setError(e.message));
  }, [api]);

  const ctx = { api, onError: setError, onNotice: setNotice, isAdmin };
  const tabs: [Tab, string, React.ReactNode][] = [
    ['overview', 'Overview', <Receipt size={14} key="o" />],
    ['invoices', 'Invoices', <FileText size={14} key="i" />],
    ['estimates', 'Estimates', <FileText size={14} key="e" />],
    ['links', 'Payment links', <Link2 size={14} key="l" />],
    ['payments', 'Payments', <CreditCard size={14} key="p" />],
    ['customers', 'Customers', <Users size={14} key="c" />],
    ['products', 'Products', <Package size={14} key="pr" />],
    ['coupons', 'Coupons', <Percent size={14} key="co" />],
    ['gift_cards', 'Gift cards', <Gift size={14} key="g" />],
    ['settings', 'Settings', <Settings2 size={14} key="s" />],
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Receipt size={20} className="text-sky-600" /> Invoicing & payments
          </h1>
          <p className="text-sm text-slate-500">
            Invoices, estimates and payment links your customers pay online or
            offline.
          </p>
        </div>
        {enabled === false && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="font-semibold text-slate-800">
              Invoicing & payments is not included in your plan
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Upgrade under Billing to a plan with this module, or ask your
              provider to turn it on.
            </p>
          </div>
        )}
        {enabled && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {tabs.map(([key, label, icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === key ? 'bg-sky-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
            {error && (
              <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
                <button type="button" onClick={() => setError('')}>
                  <X size={14} />
                </button>
              </div>
            )}
            {notice && (
              <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {notice}
                <button type="button" onClick={() => setNotice('')}>
                  <X size={14} />
                </button>
              </div>
            )}
            {tab === 'overview' && <Overview {...ctx} />}
            {tab === 'invoices' && <Documents kind="invoice" {...ctx} />}
            {tab === 'estimates' && <Documents kind="estimate" {...ctx} />}
            {tab === 'links' && <Links {...ctx} />}
            {tab === 'payments' && <Payments {...ctx} />}
            {tab === 'customers' && <Customers {...ctx} />}
            {tab === 'products' && <Products {...ctx} />}
            {tab === 'coupons' && <Coupons {...ctx} />}
            {tab === 'gift_cards' && <GiftCards {...ctx} />}
            {tab === 'settings' && <SettingsTab {...ctx} />}
          </>
        )}
      </div>
    </div>
  );
}

interface Ctx {
  api: Api;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  isAdmin: boolean;
}

function useLoad<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  onError: (m: string) => void,
) {
  const [data, setData] = useState<T | null>(null);
  const reload = useCallback(() => {
    fn()
      .then(setData)
      .catch((e) => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return [data, reload] as const;
}

function Table({
  head,
  children,
  empty,
}: {
  head: string[];
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
          {empty && (
            <tr>
              <td
                colSpan={head.length}
                className="px-3 py-8 text-center text-slate-500"
              >
                Nothing here yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────
function Overview({ api, onError }: Ctx) {
  const [stats] = useLoad(
    () =>
      api<{
        collected_30d: number;
        outstanding: number;
        overdue: number;
        pending_confirmations: number;
        paid_30d: number;
        currency: string;
      }>('/stats'),
    [api],
    onError,
  );
  const [txs] = useLoad(
    () => api<Tx[]>('/transactions?limit=10'),
    [api],
    onError,
  );
  const cur = stats?.currency || 'usd';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [
            'Collected (30 days)',
            stats ? fmtMoney(stats.collected_30d, cur) : '…',
          ],
          ['Outstanding', stats ? fmtMoney(stats.outstanding, cur) : '…'],
          ['Overdue invoices', stats?.overdue ?? '…'],
          ['Payments to confirm', stats?.pending_confirmations ?? '…'],
        ].map(([l, v]) => (
          <div
            key={String(l)}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              {l}
            </p>
            <p className="mt-1 text-xl font-bold text-slate-900">{v}</p>
          </div>
        ))}
      </div>
      <h3 className="text-sm font-semibold text-slate-700">Latest payments</h3>
      <Table
        head={['Date', 'Customer', 'For', 'Method', 'Amount', 'Status']}
        empty={!txs?.length}
      >
        {(txs || []).map((t) => (
          <tr key={t.id} className="border-t border-slate-100">
            <td className="px-3 py-2">{date(t.created_at)}</td>
            <td className="px-3 py-2">
              {t.customer_name || t.customer_email || '—'}
            </td>
            <td className="px-3 py-2">
              {t.invoice_number || t.link_title || '—'}
            </td>
            <td className="px-3 py-2">{t.method.replace('_', ' ')}</td>
            <td className="px-3 py-2 font-medium">
              {fmtMoney(t.amount, t.currency)}
            </td>
            <td className="px-3 py-2">
              <Badge s={t.status} />
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ── Invoices & estimates ─────────────────────────────────────────────────────
function Documents({
  kind,
  api,
  onError,
  onNotice,
}: Ctx & { kind: 'invoice' | 'estimate' }) {
  const [q, setQ] = useState('');
  const [docs, reload] = useLoad(
    () => api<Doc[]>(`/invoices?kind=${kind}&q=${encodeURIComponent(q)}`),
    [api, kind, q],
    onError,
  );
  const [editing, setEditing] = useState<Doc | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  if (editing) {
    return (
      <DocEditor
        kind={kind}
        doc={editing === 'new' ? null : editing}
        api={api}
        onError={onError}
        onDone={(d) => {
          setEditing(null);
          reload();
          if (d) setOpen(d.id);
        }}
      />
    );
  }
  if (open) {
    return (
      <DocDetail
        id={open}
        api={api}
        onError={onError}
        onNotice={onNotice}
        onBack={() => {
          setOpen(null);
          reload();
        }}
        onEdit={(d) => setEditing(d)}
      />
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          className={input}
          placeholder={`Search ${kind}s by customer or number`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          className={primary}
          onClick={() => setEditing('new')}
        >
          <Plus size={14} /> New {kind}
        </button>
      </div>
      <Table
        head={[
          'Number',
          'Customer',
          'Issued',
          'Due',
          'Total',
          'Balance',
          'Status',
        ]}
        empty={!docs?.length}
      >
        {(docs || []).map((d) => (
          <tr
            key={d.id}
            className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
            onClick={() => setOpen(d.id)}
          >
            <td className="px-3 py-2 font-medium text-sky-700">{d.number}</td>
            <td className="px-3 py-2">{d.customer_name || d.customer_email}</td>
            <td className="px-3 py-2">{date(d.created_at)}</td>
            <td className="px-3 py-2">{date(d.due_date)}</td>
            <td className="px-3 py-2">{fmtMoney(d.total, d.currency)}</td>
            <td className="px-3 py-2">
              {kind === 'invoice' ? fmtMoney(d.balance, d.currency) : '—'}
            </td>
            <td className="px-3 py-2">
              <Badge s={d.status} />
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function DocEditor({
  kind,
  doc,
  api,
  onError,
  onDone,
}: {
  kind: 'invoice' | 'estimate';
  doc: Doc | null;
  api: Api;
  onError: (m: string) => void;
  onDone: (d: Doc | null) => void;
}) {
  const [settings] = useLoad(
    () =>
      api<{
        default_currency: string;
        default_tax_rate: string;
        payment_terms: string;
      }>('/settings'),
    [api],
    onError,
  );
  const [products] = useLoad(
    () =>
      api<
        {
          id: string;
          name: string;
          unit_price: number;
          taxable: boolean;
          tax_rate: string;
          currency: string;
          active: boolean;
        }[]
      >('/products'),
    [api],
    onError,
  );
  const [catalog] = useLoad(
    () =>
      api<{ catalog: CatalogEntry[]; connected: Connected[] }>('/providers'),
    [api],
    onError,
  );
  const currency = doc?.currency || settings?.default_currency || 'usd';
  const [f, setF] = useState({
    customer_name: doc?.customer_name || '',
    customer_email: doc?.customer_email || '',
    customer_phone: doc?.customer_phone || '',
    title: doc?.title || '',
    due_date: doc?.due_date ? String(doc.due_date).slice(0, 10) : '',
    payment_terms: doc?.payment_terms || '',
    notes: doc?.notes || '',
    coupon_code: doc?.coupon_code || '',
    discount:
      doc && !doc.coupon_code ? toMajor(doc.discount_total, currency) : '',
    allowed_methods: doc?.allowed_methods || ([] as string[]),
  });
  const [items, setItems] = useState(
    (
      doc?.line_items || [
        {
          description: '',
          quantity: 1,
          unit_price: 0,
          taxable: false,
          tax_rate: 0,
        },
      ]
    ).map((it) => ({
      ...it,
      price: toMajor(it.unit_price, currency),
    })),
  );
  const [saving, setSaving] = useState(false);
  const subtotal = items.reduce(
    (s, it) => s + Number(it.quantity || 0) * toMinor(it.price, currency),
    0,
  );
  const tax = items.reduce(
    (s, it) =>
      s +
      (it.taxable
        ? Math.round(
            (Number(it.quantity || 0) *
              toMinor(it.price, currency) *
              Number(it.tax_rate || 0)) /
              100,
          )
        : 0),
    0,
  );

  const setItem = (i: number, patch: Partial<(typeof items)[number]>) =>
    setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const save = async () => {
    setSaving(true);
    try {
      const body = {
        kind,
        ...f,
        currency,
        discount: f.coupon_code ? 0 : toMinor(f.discount, currency),
        allowed_methods: f.allowed_methods,
        line_items: items.map((it) => ({
          description: it.description,
          quantity: Number(it.quantity),
          unit_price: toMinor(it.price, currency),
          taxable: it.taxable,
          tax_rate: Number(it.tax_rate),
        })),
      };
      const saved = doc
        ? await api<Doc>(`/invoices/${doc.id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : await api<Doc>('/invoices', {
            method: 'POST',
            body: JSON.stringify(body),
          });
      onDone(saved);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">
          {doc ? `Edit ${doc.number}` : `New ${kind}`}
        </h3>
        <button
          type="button"
          className={secondary}
          onClick={() => onDone(null)}
        >
          Cancel
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs text-slate-600">
          Customer name
          <input
            className={input}
            value={f.customer_name}
            onChange={(e) => setF({ ...f, customer_name: e.target.value })}
          />
        </label>
        <label className="text-xs text-slate-600">
          Email
          <input
            className={input}
            type="email"
            value={f.customer_email}
            onChange={(e) => setF({ ...f, customer_email: e.target.value })}
          />
        </label>
        <label className="text-xs text-slate-600">
          Phone
          <input
            className={input}
            value={f.customer_phone}
            onChange={(e) => setF({ ...f, customer_phone: e.target.value })}
          />
        </label>
        <label className="text-xs text-slate-600 md:col-span-2">
          Title / job description
          <input
            className={input}
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
        </label>
        <label className="text-xs text-slate-600">
          {kind === 'estimate' ? 'Valid until' : 'Due date'}
          <input
            className={input}
            type="date"
            value={f.due_date}
            onChange={(e) => setF({ ...f, due_date: e.target.value })}
          />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Items ({currency.toUpperCase()})
          </p>
          {!!products?.length && (
            <select
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
              value=""
              onChange={(e) => {
                const p = products.find((x) => x.id === e.target.value);
                if (p)
                  setItems([
                    ...items.filter((it) => it.description),
                    {
                      description: p.name,
                      quantity: 1,
                      unit_price: p.unit_price,
                      price: toMajor(p.unit_price, currency),
                      taxable: p.taxable,
                      tax_rate: Number(p.tax_rate),
                    },
                  ]);
              }}
            >
              <option value="">+ Add from products</option>
              {products
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {fmtMoney(p.unit_price, p.currency)}
                  </option>
                ))}
            </select>
          )}
        </div>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-2">
            <input
              className={`${input} col-span-5`}
              placeholder="Description"
              value={it.description}
              onChange={(e) => setItem(i, { description: e.target.value })}
            />
            <input
              className={`${input} col-span-1`}
              type="number"
              min={0}
              step="any"
              value={it.quantity}
              onChange={(e) => setItem(i, { quantity: Number(e.target.value) })}
            />
            <input
              className={`${input} col-span-2`}
              type="number"
              min={0}
              step="any"
              placeholder="Price"
              value={it.price}
              onChange={(e) => setItem(i, { price: e.target.value })}
            />
            <label className="col-span-1 flex items-center gap-1 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={it.taxable}
                onChange={(e) =>
                  setItem(i, {
                    taxable: e.target.checked,
                    tax_rate:
                      e.target.checked && !it.tax_rate
                        ? Number(settings?.default_tax_rate || 0)
                        : it.tax_rate,
                  })
                }
              />
              Tax
            </label>
            <input
              className={`${input} col-span-1`}
              type="number"
              min={0}
              step="any"
              disabled={!it.taxable}
              value={it.tax_rate}
              onChange={(e) => setItem(i, { tax_rate: Number(e.target.value) })}
              title="Tax %"
            />
            <span className="col-span-1 text-right text-sm">
              {fmtMoney(
                Number(it.quantity || 0) * toMinor(it.price, currency),
                currency,
              )}
            </span>
            <button
              type="button"
              className="col-span-1 text-slate-400 hover:text-red-600"
              onClick={() => setItems(items.filter((_x, j) => j !== i))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className={secondary}
          onClick={() =>
            setItems([
              ...items,
              {
                description: '',
                quantity: 1,
                unit_price: 0,
                price: '',
                taxable: false,
                tax_rate: 0,
              },
            ])
          }
        >
          <Plus size={14} /> Add line
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs text-slate-600">
          Coupon code
          <input
            className={input}
            value={f.coupon_code}
            onChange={(e) =>
              setF({ ...f, coupon_code: e.target.value.toUpperCase() })
            }
          />
        </label>
        <label className="text-xs text-slate-600">
          Discount ({currency.toUpperCase()})
          <input
            className={input}
            type="number"
            min={0}
            step="any"
            disabled={!!f.coupon_code}
            value={f.discount}
            onChange={(e) => setF({ ...f, discount: e.target.value })}
          />
        </label>
        <label className="text-xs text-slate-600">
          Payment terms
          <input
            className={input}
            placeholder={settings?.payment_terms}
            value={f.payment_terms}
            onChange={(e) => setF({ ...f, payment_terms: e.target.value })}
          />
        </label>
        <label className="text-xs text-slate-600 md:col-span-3">
          Notes for the customer
          <textarea
            className={input}
            rows={2}
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        </label>
      </div>

      {kind === 'invoice' && !!catalog?.connected.length && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
            Payment methods (none ticked = all connected)
          </p>
          <div className="flex flex-wrap gap-3">
            {catalog.connected.map((c) => {
              const label =
                catalog.catalog.find((x) => x.key === c.provider)?.label ||
                c.provider;
              const on = f.allowed_methods.includes(c.provider);
              return (
                <label
                  key={c.provider}
                  className="flex items-center gap-1.5 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setF({
                        ...f,
                        allowed_methods: on
                          ? f.allowed_methods.filter((m) => m !== c.provider)
                          : [...f.allowed_methods, c.provider],
                      })
                    }
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-100 pt-3">
        <p className="text-sm text-slate-600">
          Subtotal {fmtMoney(subtotal, currency)} · Tax{' '}
          {fmtMoney(tax, currency)}
          {!f.coupon_code && f.discount
            ? ` · Discount ${fmtMoney(toMinor(f.discount, currency), currency)}`
            : ''}
          {f.coupon_code ? ' · coupon applied on save' : ''}
        </p>
        <button
          type="button"
          className={primary}
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function DocDetail({
  id,
  api,
  onError,
  onNotice,
  onBack,
  onEdit,
}: {
  id: string;
  api: Api;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  onBack: () => void;
  onEdit: (d: Doc) => void;
}) {
  const [doc, reload] = useLoad(
    () => api<Doc>(`/invoices/${id}`),
    [api, id],
    onError,
  );
  const [pay, setPay] = useState<{
    amount: string;
    method: string;
    reference: string;
  } | null>(null);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      onNotice(msg);
      reload();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  if (!doc) return <p className="text-sm text-slate-500">Loading…</p>;
  const isInvoice = doc.kind === 'invoice';
  return (
    <div className="space-y-4">
      <button type="button" className={secondary} onClick={onBack}>
        ← Back
      </button>
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-bold text-slate-900">
              {doc.number} <Badge s={doc.status} />
            </p>
            <p className="text-sm text-slate-600">
              {doc.customer_name}{' '}
              {doc.customer_email && `· ${doc.customer_email}`}
            </p>
            {doc.title && <p className="text-sm text-slate-500">{doc.title}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {doc.status !== 'void' && (
              <button
                type="button"
                className={secondary}
                onClick={() => onEdit(doc)}
              >
                Edit
              </button>
            )}
            {doc.status !== 'void' && (
              <button
                type="button"
                className={secondary}
                onClick={() =>
                  void run(
                    () => api(`/invoices/${doc.id}/send`, { method: 'POST' }),
                    `Sent to ${doc.customer_email}`,
                  )
                }
              >
                <Mail size={14} /> Email
              </button>
            )}
            <button
              type="button"
              className={secondary}
              onClick={() => {
                navigator.clipboard?.writeText(doc.public_url).catch(() => {});
                void run(
                  () =>
                    api(`/invoices/${doc.id}/mark-sent`, { method: 'POST' }),
                  'Link copied',
                );
              }}
            >
              <Copy size={14} /> Copy link
            </button>
            {doc.status !== 'draft' && (
              <a
                className={secondary}
                href={doc.public_url}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={14} /> Open
              </a>
            )}
            {isInvoice && doc.balance > 0 && doc.status !== 'void' && (
              <button
                type="button"
                className={primary}
                onClick={() =>
                  setPay({
                    amount: toMajor(doc.balance, doc.currency),
                    method: 'cash',
                    reference: '',
                  })
                }
              >
                Record payment
              </button>
            )}
            {!isInvoice && (
              <button
                type="button"
                className={primary}
                onClick={() =>
                  void run(
                    () =>
                      api(`/invoices/${doc.id}/convert`, { method: 'POST' }),
                    'Converted to an invoice (see Invoices)',
                  )
                }
              >
                Convert to invoice
              </button>
            )}
            {doc.status !== 'void' && doc.amount_paid === 0 && (
              <button
                type="button"
                className={`${btn} text-red-600 hover:bg-red-50`}
                onClick={() =>
                  window.confirm('Void this document?') &&
                  void run(
                    () => api(`/invoices/${doc.id}/void`, { method: 'POST' }),
                    'Voided',
                  )
                }
              >
                <Ban size={14} /> Void
              </button>
            )}
          </div>
        </div>

        {pay && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
            <label className="text-xs text-slate-600">
              Amount
              <input
                className={input}
                type="number"
                step="any"
                value={pay.amount}
                onChange={(e) => setPay({ ...pay, amount: e.target.value })}
              />
            </label>
            <label className="text-xs text-slate-600">
              Method
              <select
                className={input}
                value={pay.method}
                onChange={(e) => setPay({ ...pay, method: e.target.value })}
              >
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="card_terminal">Card terminal</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Reference
              <input
                className={input}
                value={pay.reference}
                onChange={(e) => setPay({ ...pay, reference: e.target.value })}
              />
            </label>
            <button
              type="button"
              className={primary}
              onClick={() =>
                void run(async () => {
                  await api(`/invoices/${doc.id}/payments`, {
                    method: 'POST',
                    body: JSON.stringify({
                      amount: toMinor(pay.amount, doc.currency),
                      method: pay.method,
                      reference: pay.reference,
                    }),
                  });
                  setPay(null);
                }, 'Payment recorded')
              }
            >
              Save
            </button>
            <button
              type="button"
              className={secondary}
              onClick={() => setPay(null)}
            >
              Cancel
            </button>
          </div>
        )}

        <Table head={['Item', 'Qty', 'Price', 'Amount']}>
          {doc.line_items.map((it, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-3 py-2">
                {it.description}
                {it.taxable ? (
                  <span className="ml-1 text-[11px] text-slate-400">
                    +{it.tax_rate}% tax
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2">{it.quantity}</td>
              <td className="px-3 py-2">
                {fmtMoney(it.unit_price, doc.currency)}
              </td>
              <td className="px-3 py-2">
                {fmtMoney(it.amount || 0, doc.currency)}
              </td>
            </tr>
          ))}
        </Table>
        <div className="ml-auto max-w-xs space-y-1 text-sm">
          {[
            ['Subtotal', doc.subtotal],
            ['Tax', doc.tax_total],
            ['Discount', -doc.discount_total],
            ['Total', doc.total],
            ...(isInvoice
              ? [
                  ['Paid', -doc.amount_paid],
                  ['Balance', doc.balance],
                ]
              : []),
          ].map(([l, v]) => (
            <div
              key={String(l)}
              className={`flex justify-between ${l === 'Total' || l === 'Balance' ? 'font-semibold text-slate-900' : 'text-slate-600'}`}
            >
              <span>{l}</span>
              <span>{fmtMoney(Number(v), doc.currency)}</span>
            </div>
          ))}
        </div>
      </div>
      {isInvoice && !!doc.transactions?.length && (
        <>
          <h3 className="text-sm font-semibold text-slate-700">Payments</h3>
          <Table head={['Date', 'Method', 'Reference', 'Amount', 'Status']}>
            {doc.transactions.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{date(t.created_at)}</td>
                <td className="px-3 py-2">{t.method.replace('_', ' ')}</td>
                <td className="px-3 py-2">{t.reference || '—'}</td>
                <td className="px-3 py-2">{fmtMoney(t.amount, t.currency)}</td>
                <td className="px-3 py-2">
                  <Badge s={t.status} />
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}

// ── Payment links ────────────────────────────────────────────────────────────
function Links({ api, onError, onNotice }: Ctx) {
  const [links, reload] = useLoad(
    () =>
      api<
        {
          id: string;
          title: string;
          amount: number | null;
          currency: string;
          active: boolean;
          public_url: string;
          payments_count: number;
          collected: number;
        }[]
      >('/links'),
    [api],
    onError,
  );
  const [settings] = useLoad(
    () => api<{ default_currency: string }>('/settings'),
    [api],
    onError,
  );
  const [f, setF] = useState({ title: '', description: '', amount: '' });
  const currency = settings?.default_currency || 'usd';
  const create = async () => {
    try {
      await api('/links', {
        method: 'POST',
        body: JSON.stringify({
          ...f,
          amount: f.amount ? toMinor(f.amount, currency) : null,
          currency,
        }),
      });
      setF({ title: '', description: '', amount: '' });
      reload();
      onNotice('Payment link created');
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-4">
        <input
          className={input}
          placeholder="Title (e.g. Deposit)"
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
        <input
          className={input}
          placeholder="Description (optional)"
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
        <input
          className={input}
          type="number"
          step="any"
          placeholder={`Amount ${currency.toUpperCase()} (blank = customer chooses)`}
          value={f.amount}
          onChange={(e) => setF({ ...f, amount: e.target.value })}
        />
        <button
          type="button"
          className={primary}
          disabled={!f.title}
          onClick={() => void create()}
        >
          <Plus size={14} /> Create link
        </button>
      </div>
      <Table
        head={['Title', 'Amount', 'Payments', 'Collected', 'Active', '']}
        empty={!links?.length}
      >
        {(links || []).map((l) => (
          <tr key={l.id} className="border-t border-slate-100">
            <td className="px-3 py-2 font-medium">{l.title}</td>
            <td className="px-3 py-2">
              {l.amount == null
                ? 'Customer chooses'
                : fmtMoney(l.amount, l.currency)}
            </td>
            <td className="px-3 py-2">{l.payments_count}</td>
            <td className="px-3 py-2">{fmtMoney(l.collected, l.currency)}</td>
            <td className="px-3 py-2">
              <input
                type="checkbox"
                checked={l.active}
                onChange={() =>
                  void api(`/links/${l.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ active: !l.active }),
                  })
                    .then(reload)
                    .catch((e) => onError(e.message))
                }
              />
            </td>
            <td className="px-3 py-2 text-right">
              <button
                type="button"
                className={secondary}
                onClick={() => {
                  navigator.clipboard?.writeText(l.public_url).catch(() => {});
                  onNotice('Link copied');
                }}
              >
                <Copy size={14} /> Copy
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ── Payments (transactions) ──────────────────────────────────────────────────
function Payments({ api, onError, onNotice, isAdmin }: Ctx) {
  const [status, setStatus] = useState('');
  const [txs, reload] = useLoad(
    () => api<Tx[]>(`/transactions${status ? `?status=${status}` : ''}`),
    [api, status],
    onError,
  );
  const act = (id: string, action: string, msg: string) =>
    api(`/transactions/${id}/${action}`, { method: 'POST' })
      .then(() => {
        onNotice(msg);
        reload();
      })
      .catch((e) => onError(e.message));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All payments</option>
          <option value="pending">Waiting for confirmation</option>
          <option value="succeeded">Received</option>
          <option value="refunded">Refunded</option>
          <option value="failed">Rejected</option>
        </select>
        <button type="button" className={secondary} onClick={reload}>
          <RefreshCw size={14} />
        </button>
      </div>
      <Table
        head={[
          'Date',
          'Customer',
          'For',
          'Method',
          'Reference',
          'Amount',
          'Status',
          '',
        ]}
        empty={!txs?.length}
      >
        {(txs || []).map((t) => (
          <tr key={t.id} className="border-t border-slate-100">
            <td className="px-3 py-2">{date(t.created_at)}</td>
            <td className="px-3 py-2">
              {t.customer_name || t.customer_email || '—'}
            </td>
            <td className="px-3 py-2">
              {t.invoice_number || t.link_title || '—'}
            </td>
            <td className="px-3 py-2">{t.method.replace('_', ' ')}</td>
            <td className="px-3 py-2">{t.reference || '—'}</td>
            <td className="px-3 py-2 font-medium">
              {fmtMoney(t.amount, t.currency)}
            </td>
            <td className="px-3 py-2">
              <Badge s={t.status} />
            </td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              {t.status === 'pending' && (
                <>
                  <button
                    type="button"
                    className="text-xs font-semibold text-emerald-700 hover:underline"
                    onClick={() =>
                      void act(t.id, 'confirm', 'Payment confirmed')
                    }
                  >
                    <Check size={12} className="inline" /> Confirm
                  </button>
                  <button
                    type="button"
                    className="ml-3 text-xs font-semibold text-red-600 hover:underline"
                    onClick={() => void act(t.id, 'reject', 'Payment rejected')}
                  >
                    Reject
                  </button>
                </>
              )}
              {t.status === 'succeeded' && isAdmin && (
                <button
                  type="button"
                  className="text-xs text-slate-500 hover:underline"
                  title="Refund the money in the processor's dashboard first"
                  onClick={() =>
                    window.confirm(
                      'Mark as refunded? Return the money in the processor first.',
                    ) && void act(t.id, 'refund', 'Marked refunded')
                  }
                >
                  Mark refunded
                </button>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ── Customers ────────────────────────────────────────────────────────────────
function Customers({ api, onError }: Ctx) {
  const [q, setQ] = useState('');
  const [rows] = useLoad(
    () =>
      api<
        {
          key: string;
          name: string;
          email: string;
          phone: string;
          invoices: number;
          paid: number;
          outstanding: number;
          currency: string;
          last_activity: string;
        }[]
      >(`/customers?q=${encodeURIComponent(q)}`),
    [api, q],
    onError,
  );
  return (
    <div className="space-y-3">
      <input
        className={input}
        placeholder="Search customers"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Table
        head={[
          'Customer',
          'Email',
          'Phone',
          'Invoices',
          'Paid',
          'Outstanding',
          'Last activity',
        ]}
        empty={!rows?.length}
      >
        {(rows || []).map((c) => (
          <tr key={c.key} className="border-t border-slate-100">
            <td className="px-3 py-2 font-medium">{c.name || '—'}</td>
            <td className="px-3 py-2">{c.email || '—'}</td>
            <td className="px-3 py-2">{c.phone || '—'}</td>
            <td className="px-3 py-2">{c.invoices}</td>
            <td className="px-3 py-2">{fmtMoney(c.paid, c.currency)}</td>
            <td className="px-3 py-2">{fmtMoney(c.outstanding, c.currency)}</td>
            <td className="px-3 py-2">{date(c.last_activity)}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ── Products ─────────────────────────────────────────────────────────────────
function Products({ api, onError, onNotice }: Ctx) {
  const [rows, reload] = useLoad(
    () =>
      api<
        {
          id: string;
          name: string;
          unit_price: number;
          currency: string;
          taxable: boolean;
          tax_rate: string;
          active: boolean;
          sku: string;
        }[]
      >('/products'),
    [api],
    onError,
  );
  const [settings] = useLoad(
    () =>
      api<{ default_currency: string; default_tax_rate: string }>('/settings'),
    [api],
    onError,
  );
  const currency = settings?.default_currency || 'usd';
  const [f, setF] = useState({
    name: '',
    price: '',
    taxable: false,
    tax_rate: '',
  });
  const create = () =>
    api('/products', {
      method: 'POST',
      body: JSON.stringify({
        name: f.name,
        unit_price: toMinor(f.price, currency),
        taxable: f.taxable,
        tax_rate: Number(f.tax_rate || settings?.default_tax_rate || 0),
        currency,
      }),
    })
      .then(() => {
        setF({ name: '', price: '', taxable: false, tax_rate: '' });
        reload();
        onNotice('Product added');
      })
      .catch((e) => onError(e.message));
  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-5">
        <input
          className={`${input} md:col-span-2`}
          placeholder="Product or service"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <input
          className={input}
          type="number"
          step="any"
          placeholder={`Price ${currency.toUpperCase()}`}
          value={f.price}
          onChange={(e) => setF({ ...f, price: e.target.value })}
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={f.taxable}
            onChange={(e) => setF({ ...f, taxable: e.target.checked })}
          />{' '}
          Taxable
          <input
            className={`${input} w-20`}
            type="number"
            step="any"
            placeholder="%"
            disabled={!f.taxable}
            value={f.tax_rate}
            onChange={(e) => setF({ ...f, tax_rate: e.target.value })}
          />
        </label>
        <button
          type="button"
          className={primary}
          disabled={!f.name}
          onClick={() => void create()}
        >
          <Plus size={14} /> Add
        </button>
      </div>
      <Table
        head={['Name', 'Price', 'Tax', 'Active', '']}
        empty={!rows?.length}
      >
        {(rows || []).map((p) => (
          <tr key={p.id} className="border-t border-slate-100">
            <td className="px-3 py-2 font-medium">{p.name}</td>
            <td className="px-3 py-2">{fmtMoney(p.unit_price, p.currency)}</td>
            <td className="px-3 py-2">
              {p.taxable ? `${Number(p.tax_rate)}%` : '—'}
            </td>
            <td className="px-3 py-2">
              <input
                type="checkbox"
                checked={p.active}
                onChange={() =>
                  void api(`/products/${p.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ active: !p.active }),
                  })
                    .then(reload)
                    .catch((e) => onError(e.message))
                }
              />
            </td>
            <td className="px-3 py-2 text-right">
              <button
                type="button"
                className="text-slate-400 hover:text-red-600"
                onClick={() =>
                  void api(`/products/${p.id}`, { method: 'DELETE' })
                    .then(reload)
                    .catch((e) => onError(e.message))
                }
              >
                <Trash2 size={14} />
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ── Coupons ──────────────────────────────────────────────────────────────────
function Coupons({ api, onError, onNotice }: Ctx) {
  const [rows, reload] = useLoad(
    () =>
      api<
        {
          id: string;
          code: string;
          kind: string;
          value: number;
          currency: string | null;
          redemptions: number;
          max_redemptions: number | null;
          expires_at: string | null;
          active: boolean;
        }[]
      >('/coupons'),
    [api],
    onError,
  );
  const [settings] = useLoad(
    () => api<{ default_currency: string }>('/settings'),
    [api],
    onError,
  );
  const [f, setF] = useState({
    code: '',
    kind: 'percent',
    value: '',
    max_redemptions: '',
    expires_at: '',
  });
  const create = () =>
    api('/coupons', {
      method: 'POST',
      body: JSON.stringify({
        ...f,
        currency: settings?.default_currency,
        max_redemptions: f.max_redemptions || null,
        expires_at: f.expires_at || null,
      }),
    })
      .then(() => {
        setF({
          code: '',
          kind: 'percent',
          value: '',
          max_redemptions: '',
          expires_at: '',
        });
        reload();
        onNotice('Coupon created');
      })
      .catch((e) => onError(e.message));
  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-6">
        <input
          className={input}
          placeholder="CODE"
          value={f.code}
          onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
        />
        <select
          className={input}
          value={f.kind}
          onChange={(e) => setF({ ...f, kind: e.target.value })}
        >
          <option value="percent">% off</option>
          <option value="fixed">Fixed amount</option>
        </select>
        <input
          className={input}
          type="number"
          step="any"
          placeholder={f.kind === 'percent' ? 'Percent' : 'Amount'}
          value={f.value}
          onChange={(e) => setF({ ...f, value: e.target.value })}
        />
        <input
          className={input}
          type="number"
          placeholder="Max uses (optional)"
          value={f.max_redemptions}
          onChange={(e) => setF({ ...f, max_redemptions: e.target.value })}
        />
        <input
          className={input}
          type="date"
          value={f.expires_at}
          onChange={(e) => setF({ ...f, expires_at: e.target.value })}
        />
        <button
          type="button"
          className={primary}
          disabled={!f.code || !f.value}
          onClick={() => void create()}
        >
          <Plus size={14} /> Create
        </button>
      </div>
      <Table
        head={['Code', 'Discount', 'Used', 'Expires', 'Active', '']}
        empty={!rows?.length}
      >
        {(rows || []).map((c) => (
          <tr key={c.id} className="border-t border-slate-100">
            <td className="px-3 py-2 font-mono font-medium">{c.code}</td>
            <td className="px-3 py-2">
              {c.kind === 'percent'
                ? `${c.value}%`
                : `${c.value} ${String(c.currency || '').toUpperCase()}`}
            </td>
            <td className="px-3 py-2">
              {c.redemptions}
              {c.max_redemptions ? ` / ${c.max_redemptions}` : ''}
            </td>
            <td className="px-3 py-2">{date(c.expires_at)}</td>
            <td className="px-3 py-2">
              <input
                type="checkbox"
                checked={c.active}
                onChange={() =>
                  void api(`/coupons/${c.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ active: !c.active }),
                  })
                    .then(reload)
                    .catch((e) => onError(e.message))
                }
              />
            </td>
            <td className="px-3 py-2 text-right">
              <button
                type="button"
                className="text-slate-400 hover:text-red-600"
                onClick={() =>
                  void api(`/coupons/${c.id}`, { method: 'DELETE' })
                    .then(reload)
                    .catch((e) => onError(e.message))
                }
              >
                <Trash2 size={14} />
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ── Gift cards ───────────────────────────────────────────────────────────────
function GiftCards({ api, onError, onNotice }: Ctx) {
  const [rows, reload] = useLoad(
    () =>
      api<
        {
          id: string;
          code: string;
          currency: string;
          initial_balance: number;
          balance: number;
          recipient_name: string;
          status: string;
          created_at: string;
        }[]
      >('/gift-cards'),
    [api],
    onError,
  );
  const [settings] = useLoad(
    () => api<{ default_currency: string }>('/settings'),
    [api],
    onError,
  );
  const currency = settings?.default_currency || 'usd';
  const [f, setF] = useState({
    amount: '',
    recipient_name: '',
    recipient_email: '',
  });
  const issue = () =>
    api<{ code: string }>('/gift-cards', {
      method: 'POST',
      body: JSON.stringify({
        ...f,
        amount: toMinor(f.amount, currency),
        currency,
      }),
    })
      .then((g) => {
        setF({ amount: '', recipient_name: '', recipient_email: '' });
        reload();
        onNotice(`Gift card ${g.code} issued`);
      })
      .catch((e) => onError(e.message));
  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-4">
        <input
          className={input}
          type="number"
          step="any"
          placeholder={`Amount ${currency.toUpperCase()}`}
          value={f.amount}
          onChange={(e) => setF({ ...f, amount: e.target.value })}
        />
        <input
          className={input}
          placeholder="Recipient name"
          value={f.recipient_name}
          onChange={(e) => setF({ ...f, recipient_name: e.target.value })}
        />
        <input
          className={input}
          type="email"
          placeholder="Recipient email"
          value={f.recipient_email}
          onChange={(e) => setF({ ...f, recipient_email: e.target.value })}
        />
        <button
          type="button"
          className={primary}
          disabled={!f.amount}
          onClick={() => void issue()}
        >
          <Gift size={14} /> Issue
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Customers enter the code on an invoice&apos;s pay page to pay with it.
      </p>
      <Table
        head={['Code', 'Recipient', 'Issued', 'Balance', 'Status', '']}
        empty={!rows?.length}
      >
        {(rows || []).map((g) => (
          <tr key={g.id} className="border-t border-slate-100">
            <td className="px-3 py-2 font-mono font-medium">{g.code}</td>
            <td className="px-3 py-2">{g.recipient_name || '—'}</td>
            <td className="px-3 py-2">
              {fmtMoney(g.initial_balance, g.currency)}
            </td>
            <td className="px-3 py-2">{fmtMoney(g.balance, g.currency)}</td>
            <td className="px-3 py-2">
              <Badge s={g.status === 'active' ? 'succeeded' : 'void'} />
            </td>
            <td className="px-3 py-2 text-right">
              {g.status === 'active' && (
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={() =>
                    window.confirm('Void this gift card?') &&
                    void api(`/gift-cards/${g.id}/void`, { method: 'POST' })
                      .then(reload)
                      .catch((e) => onError(e.message))
                  }
                >
                  Void
                </button>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ── Settings: business profile + processors ─────────────────────────────────
function SettingsTab({ api, onError, onNotice, isAdmin }: Ctx) {
  const [settings, reloadSettings] = useLoad(
    () => api<Record<string, string | number | boolean>>('/settings'),
    [api],
    onError,
  );
  const [prov, reloadProv] = useLoad(
    () =>
      api<{
        catalog: CatalogEntry[];
        connected: Connected[];
        webhook_urls: Record<string, string>;
      }>('/providers'),
    [api],
    onError,
  );
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [connecting, setConnecting] = useState<string | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (settings)
      setForm(
        Object.fromEntries(
          Object.entries(settings).map(([k, v]) => [
            k,
            typeof v === 'boolean' ? v : String(v ?? ''),
          ]),
        ),
      );
  }, [settings]);
  const connected = useMemo(
    () => new Map((prov?.connected || []).map((c) => [c.provider, c])),
    [prov],
  );

  const saveSettings = () =>
    api('/settings', { method: 'PATCH', body: JSON.stringify(form) })
      .then(() => {
        reloadSettings();
        onNotice('Settings saved');
      })
      .catch((e) => onError(e.message));
  const connect = async (key: string) => {
    setBusy(true);
    try {
      await api(`/providers/${key}`, {
        method: 'POST',
        body: JSON.stringify({ credentials: creds }),
      });
      setConnecting(null);
      setCreds({});
      reloadProv();
      onNotice('Connected');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const field = (name: string, label: string, type = 'text') => (
    <label className="text-xs text-slate-600">
      {label}
      <input
        className={input}
        type={type}
        disabled={!isAdmin}
        value={String(form[name] ?? '')}
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="font-semibold text-slate-900">
          Business details on invoices
        </h3>
        <div className="grid gap-3 md:grid-cols-3">
          {field('business_name', 'Business name')}
          {field('business_email', 'Email', 'email')}
          {field('business_phone', 'Phone')}
          {field('business_address', 'Address')}
          {field('logo_url', 'Logo URL (https://)')}
          {field('default_currency', 'Default currency (e.g. usd, eur, pkr)')}
          {field('default_tax_rate', 'Default tax rate %', 'number')}
          {field('invoice_prefix', 'Invoice number prefix')}
          {field('payment_terms', 'Default payment terms')}
          {field('email_subject', 'Email subject ({{number}}, {{business}})')}
          {field('email_message', 'Email message')}
          {field('footer_note', 'Footer note')}
          {field('review_url', 'Review link (Google, Facebook…)')}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              disabled={!isAdmin}
              checked={Boolean(form.review_request)}
              onChange={(e) =>
                setForm({ ...form, review_request: e.target.checked })
              }
            />
            Ask for a review in the payment receipt
          </label>
        </div>
        {isAdmin && (
          <button
            type="button"
            className={primary}
            onClick={() => void saveSettings()}
          >
            Save
          </button>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold text-slate-900">How customers can pay</h3>
        <p className="text-xs text-slate-500">
          Connect your own accounts: money goes straight to you. Keys are
          encrypted; webhooks are set up automatically where the processor
          allows it.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {(prov?.catalog || []).map((p) => {
            const c = connected.get(p.key);
            return (
              <div
                key={p.key}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-800">{p.label}</p>
                    <p className="text-xs text-slate-500">{p.methods}</p>
                  </div>
                  {c ? <Badge s="succeeded" /> : null}
                </div>
                {c && (
                  <p className="mt-2 text-xs text-slate-600">
                    Connected
                    {c.environment && c.environment !== 'live'
                      ? ` (${c.environment})`
                      : ''}
                    {c.settings?.account_name
                      ? ` · ${String(c.settings.account_name)}`
                      : ''}
                    {c.settings?.location_name
                      ? ` · ${String(c.settings.location_name)}`
                      : ''}
                  </p>
                )}
                {p.key === 'authorize_net' && c && !c.settings?.webhook && (
                  <p className="mt-1 text-[11px] text-amber-700 break-all">
                    Add this webhook in Authorize.net (Account → Webhooks) for
                    instant confirmation: {prov?.webhook_urls[p.key]}
                  </p>
                )}
                {isAdmin && connecting !== p.key && (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className={c ? secondary : primary}
                      onClick={() => {
                        setConnecting(p.key);
                        setCreds({});
                      }}
                    >
                      {c ? 'Update' : 'Connect'}
                    </button>
                    {c && (
                      <button
                        type="button"
                        className={`${btn} text-red-600 hover:bg-red-50`}
                        onClick={() =>
                          window.confirm(`Disconnect ${p.label}?`) &&
                          void api(`/providers/${p.key}`, { method: 'DELETE' })
                            .then(reloadProv)
                            .catch((e) => onError(e.message))
                        }
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                )}
                {connecting === p.key && (
                  <div className="mt-3 space-y-2">
                    {p.fields.map((fd) => (
                      <label
                        key={fd.name}
                        className="block text-xs text-slate-600"
                      >
                        {fd.label}
                        {fd.required ? ' *' : ''}
                        {fd.options ? (
                          <select
                            className={input}
                            value={creds[fd.name] || ''}
                            onChange={(e) =>
                              setCreds({ ...creds, [fd.name]: e.target.value })
                            }
                          >
                            <option value="">Choose…</option>
                            {fd.options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : fd.multiline ? (
                          <textarea
                            className={input}
                            rows={3}
                            value={creds[fd.name] || ''}
                            onChange={(e) =>
                              setCreds({ ...creds, [fd.name]: e.target.value })
                            }
                          />
                        ) : (
                          <input
                            className={input}
                            type={fd.secret ? 'password' : 'text'}
                            autoComplete="off"
                            value={creds[fd.name] || ''}
                            onChange={(e) =>
                              setCreds({ ...creds, [fd.name]: e.target.value })
                            }
                          />
                        )}
                      </label>
                    ))}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={primary}
                        disabled={busy}
                        onClick={() => void connect(p.key)}
                      >
                        {busy ? 'Checking…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className={secondary}
                        onClick={() => setConnecting(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
