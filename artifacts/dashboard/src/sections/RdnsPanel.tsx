import { useCallback, useEffect, useState } from 'react';
import {
  Download,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type { AuthFetch } from './AuditLogSection';

type Tab = 'watchlist' | 'domains' | 'forms' | 'lookup' | 'sources' | 'logs';

interface Cursor {
  source_key: string;
  status: string;
  page_number: number;
  records_found_total: number;
  next_allowed_at: string;
  last_error: string | null;
}
interface Target {
  id: number;
  record_type: 'A' | 'CNAME';
  value: string;
  enabled: boolean;
  notes: string;
  rescan_interval_hours: number;
  crawl_forms: boolean;
  domain_count: number;
  cursors: Cursor[];
}
interface Source {
  key: string;
  label: string;
  kind: 'free' | 'paid';
  applies_to: string;
  paginated: boolean;
  enabled: boolean;
  requests_per_hour: number;
  has_key: boolean;
  api_key: string;
}
interface Stats {
  targets_total: number;
  targets_enabled: number;
  domains_total: number;
  domains_24h: number;
  forms_total: number;
  crawl_jobs_pending: number;
  sources_active: number;
  errors_24h: number;
}

const BASE = '/api/super-admin/rdns';
const badge: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  active: 'bg-sky-100 text-sky-700',
  exhausted: 'bg-emerald-100 text-emerald-700',
  rate_limited: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
};
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');
const input =
  'rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200';

/** Super Admin → Reverse DNS: continuous discovery of domains pointing at watched targets. */
export function RdnsPanel({ authFetch }: { authFetch: AuthFetch }) {
  const [tab, setTab] = useState<Tab>('watchlist');
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await authFetch(`${BASE}${path}`, {
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

  const loadStats = useCallback(() => {
    api('/stats')
      .then(setStats)
      .catch((e) => setError(e.message));
  }, [api]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const download = async (path: string, filename: string) => {
    const res = await authFetch(`${BASE}${path}`);
    if (!res.ok) return setError('Export failed');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tabs: [Tab, string][] = [
    ['watchlist', 'Watchlist'],
    ['domains', 'Domains found'],
    ['forms', 'Forms found'],
    ['lookup', 'Quick search'],
    ['sources', 'Sources & API keys'],
    ['logs', 'Activity log'],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Reverse DNS
          </h3>
          <p className="text-xs text-slate-500 max-w-2xl">
            Finds domains that point (A record) or CNAME to watched targets,
            using public passive-DNS sources at a pace each source allows,
            around the clock. A polite crawler records which pages of those
            domains have a form (field names only — never contents or personal
            data).
          </p>
        </div>
        <button
          type="button"
          onClick={loadStats}
          className="text-slate-400 hover:text-slate-600"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [
              'Targets watched',
              `${stats.targets_enabled}/${stats.targets_total}`,
            ],
            [
              'Domains found',
              `${stats.domains_total} (+${stats.domains_24h} today)`,
            ],
            ['Forms found', `${stats.forms_total}`],
            [
              'Crawl queue · errors (24h)',
              `${stats.crawl_jobs_pending} · ${stats.errors_24h}`,
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${tab === key ? 'bg-sky-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          onClick={() => setError('')}
        >
          {error}
        </div>
      )}

      {tab === 'watchlist' && (
        <Watchlist api={api} onError={setError} onChange={loadStats} />
      )}
      {tab === 'domains' && <Domains api={api} download={download} />}
      {tab === 'forms' && <Forms api={api} download={download} />}
      {tab === 'lookup' && <Lookup api={api} onError={setError} />}
      {tab === 'sources' && <Sources api={api} onError={setError} />}
      {tab === 'logs' && <Logs api={api} />}
    </div>
  );
}

type Api = (path: string, init?: RequestInit) => Promise<any>;

function Watchlist({
  api,
  onError,
  onChange,
}: {
  api: Api;
  onError: (m: string) => void;
  onChange: () => void;
}) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [form, setForm] = useState({
    record_type: 'CNAME',
    value: '',
    rescan_interval_hours: 24,
    crawl_forms: true,
    notes: '',
  });

  const load = useCallback(() => {
    api('/targets')
      .then(setTargets)
      .catch((e) => onError(e.message));
  }, [api, onError]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const add = async () => {
    try {
      await api('/targets', { method: 'POST', body: JSON.stringify(form) });
      setForm((f) => ({ ...f, value: '', notes: '' }));
      load();
      onChange();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const act = async (path: string, init: RequestInit) => {
    try {
      await api(path, init);
      load();
      onChange();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <select
          className={input}
          value={form.record_type}
          onChange={(e) => setForm({ ...form, record_type: e.target.value })}
        >
          <option value="CNAME">CNAME target</option>
          <option value="A">A record (IP)</option>
        </select>
        <input
          className={`${input} flex-1 min-w-[220px]`}
          placeholder={
            form.record_type === 'CNAME'
              ? 'e.g. whitelabel.example.com'
              : 'e.g. 203.0.113.7'
          }
          value={form.value}
          onChange={(e) => setForm({ ...form, value: e.target.value })}
        />
        <label className="text-xs text-slate-600">
          Rescan every
          <input
            type="number"
            min={1}
            className={`${input} ml-1 w-16`}
            value={form.rescan_interval_hours}
            onChange={(e) =>
              setForm({
                ...form,
                rescan_interval_hours: Number(e.target.value),
              })
            }
          />{' '}
          h
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={form.crawl_forms}
            onChange={(e) =>
              setForm({ ...form, crawl_forms: e.target.checked })
            }
          />
          Find forms
        </label>
        <button
          type="button"
          onClick={() => void add()}
          className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700"
        >
          <Plus size={14} /> Watch
        </button>
      </div>

      {targets.map((t) => (
        <div
          key={t.id}
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-900">
                <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                  {t.record_type}
                </span>
                {t.value}
              </p>
              <p className="text-xs text-slate-500">
                {t.domain_count} domains · rescan every{' '}
                {t.rescan_interval_hours}h · forms crawl{' '}
                {t.crawl_forms ? 'on' : 'off'}
                {t.enabled ? '' : ' · paused'}
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                title="Walk every source again now"
                onClick={() =>
                  void act(`/targets/${t.id}/rescan`, { method: 'POST' })
                }
                className="text-slate-500 hover:text-slate-800"
              >
                <RotateCcw size={14} />
              </button>
              <button
                type="button"
                title={t.enabled ? 'Pause' : 'Resume'}
                onClick={() =>
                  void act(`/targets/${t.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ enabled: !t.enabled }),
                  })
                }
                className="text-slate-500 hover:text-slate-800"
              >
                {t.enabled ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                type="button"
                title="Remove"
                onClick={() =>
                  window.confirm(
                    `Remove ${t.value} and its ${t.domain_count} discovered domains?`,
                  ) && void act(`/targets/${t.id}`, { method: 'DELETE' })
                }
                className="text-red-500 hover:text-red-700"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {t.cursors.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {t.cursors.map((c) => (
                <span
                  key={c.source_key}
                  title={`${c.records_found_total} records · next ${fmt(c.next_allowed_at)}${c.last_error ? ` · ${c.last_error}` : ''}`}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge[c.status] || badge.pending}`}
                >
                  {c.source_key}: {c.status.replace('_', ' ')}
                  {c.page_number ? ` p${c.page_number}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      {targets.length === 0 && (
        <p className="text-sm text-slate-500">
          Nothing watched yet. Add a CNAME target or an IP above.
        </p>
      )}
    </div>
  );
}

function Domains({
  api,
  download,
}: {
  api: Api;
  download: (p: string, f: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [pageNo, setPage] = useState(1);
  const [data, setData] = useState<{
    items: {
      id: number;
      domain: string;
      record_type: string;
      target_value: string;
      sources: string[];
      first_seen_at: string;
    }[];
    total: number;
  }>({ items: [], total: 0 });
  useEffect(() => {
    api(`/domains?page=${pageNo}&page_size=100&q=${encodeURIComponent(q)}`)
      .then(setData)
      .catch(() => {});
  }, [api, q, pageNo]);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-2.5 top-2.5 text-slate-400"
          />
          <input
            className={`${input} w-full pl-8`}
            placeholder="Search domains"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <button
          type="button"
          onClick={() =>
            void download(
              `/domains/export.csv?q=${encodeURIComponent(q)}`,
              'discovered_domains.csv',
            )
          }
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
        >
          <Download size={12} /> CSV
        </button>
      </div>
      <Table
        head={['Domain', 'Type', 'Target', 'Sources', 'First seen']}
        rows={data.items.map((d) => [
          d.domain,
          d.record_type,
          d.target_value,
          d.sources.join(', '),
          fmt(d.first_seen_at),
        ])}
      />
      <Pager page={pageNo} total={data.total} size={100} onPage={setPage} />
    </div>
  );
}

function Forms({
  api,
  download,
}: {
  api: Api;
  download: (p: string, f: string) => Promise<void>;
}) {
  const [purpose, setPurpose] = useState('');
  const [pageNo, setPage] = useState(1);
  const [data, setData] = useState<{
    items: {
      id: number;
      domain: string;
      page_url: string;
      method: string;
      guessed_purpose: string;
      field_names: string[];
    }[];
    total: number;
  }>({ items: [], total: 0 });
  useEffect(() => {
    api(
      `/forms?page=${pageNo}&page_size=100${purpose ? `&purpose=${purpose}` : ''}`,
    )
      .then(setData)
      .catch(() => {});
  }, [api, purpose, pageNo]);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          className={input}
          value={purpose}
          onChange={(e) => {
            setPurpose(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All purposes</option>
          {[
            'contact',
            'careers',
            'newsletter',
            'login',
            'search',
            'unknown',
          ].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() =>
            void download(
              `/forms/export.csv${purpose ? `?purpose=${purpose}` : ''}`,
              'form_findings.csv',
            )
          }
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
        >
          <Download size={12} /> CSV
        </button>
      </div>
      <Table
        head={['Domain', 'Page', 'Purpose', 'Method', 'Field names']}
        rows={data.items.map((f) => [
          f.domain,
          f.page_url,
          f.guessed_purpose,
          f.method,
          (f.field_names || []).join(', '),
        ])}
      />
      <Pager page={pageNo} total={data.total} size={100} onPage={setPage} />
    </div>
  );
}

function Lookup({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [type, setType] = useState('CNAME');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{
    count: number;
    results: { domain: string; sources: string[] }[];
    sources: { source: string; results: number; status: string }[];
  } | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      setRes(
        await api('/lookup', {
          method: 'POST',
          body: JSON.stringify({ type, value }),
        }),
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <select
          className={input}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="CNAME">CNAME</option>
          <option value="A">A (IP)</option>
        </select>
        <input
          className={`${input} flex-1`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Target to search once (not saved)"
        />
        <button
          type="button"
          disabled={busy || !value}
          onClick={() => void run()}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Paginated sources stop after 3 pages here; add the target to the
        watchlist for a complete walk.
      </p>
      {res && (
        <>
          <p className="text-sm text-slate-700">
            {res.count} domains ·{' '}
            {res.sources
              .map(
                (s) =>
                  `${s.source}: ${s.status === 'ok' ? s.results : s.status}`,
              )
              .join(' · ')}
          </p>
          <Table
            head={['Domain', 'Sources']}
            rows={res.results.map((r) => [r.domain, r.sources.join(', ')])}
          />
        </>
      )}
    </div>
  );
}

function Sources({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    api('/sources')
      .then(setSources)
      .catch((e) => onError(e.message));
  }, [api, onError]);
  useEffect(() => {
    load();
  }, [load]);
  const save = async (key: string, patch: Record<string, unknown>) => {
    try {
      await api(`/sources/${key}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      load();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Records</th>
            <th className="px-3 py-2">On</th>
            <th className="px-3 py-2">Requests / hour</th>
            <th className="px-3 py-2">API key</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.key} className="border-t border-slate-100">
              <td className="px-3 py-2">
                <p className="font-medium text-slate-800">{s.label}</p>
                <p className="text-[11px] text-slate-500">
                  {s.kind}
                  {s.paginated ? ' · paginated' : ''}
                </p>
              </td>
              <td className="px-3 py-2 text-slate-600">{s.applies_to}</td>
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) =>
                    void save(s.key, { enabled: e.target.checked })
                  }
                />
              </td>
              <td className="px-3 py-2">
                <input
                  type="number"
                  min={1}
                  defaultValue={s.requests_per_hour}
                  onBlur={(e) =>
                    Number(e.target.value) !== s.requests_per_hour &&
                    void save(s.key, {
                      requests_per_hour: Number(e.target.value),
                    })
                  }
                  className={`${input} w-20`}
                />
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <input
                    type="password"
                    className={`${input} w-44`}
                    placeholder={
                      s.has_key
                        ? s.api_key
                        : s.kind === 'paid'
                          ? 'required'
                          : 'optional'
                    }
                    value={keys[s.key] || ''}
                    onChange={(e) =>
                      setKeys({ ...keys, [s.key]: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    disabled={!keys[s.key]}
                    onClick={() =>
                      void save(s.key, { api_key: keys[s.key] }).then(() =>
                        setKeys({ ...keys, [s.key]: '' }),
                      )
                    }
                    className="text-xs font-semibold text-sky-700 disabled:opacity-40"
                  >
                    Save
                  </button>
                  {s.has_key && (
                    <button
                      type="button"
                      onClick={() => void save(s.key, { api_key: '' })}
                      className="text-xs text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-slate-500">
        Keys are encrypted at rest. The tool paces itself under each
        source&apos;s limits and backs off on 429s; it never rotates IPs or
        disguises its traffic.
      </p>
    </div>
  );
}

function Logs({ api }: { api: Api }) {
  const [level, setLevel] = useState('');
  const [logs, setLogs] = useState<
    {
      id: number;
      ts: string;
      level: string;
      component: string;
      message: string;
    }[]
  >([]);
  useEffect(() => {
    const load = () =>
      api(`/logs?limit=300${level ? `&level=${level}` : ''}`)
        .then(setLogs)
        .catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [api, level]);
  return (
    <div className="space-y-2">
      <select
        className={input}
        value={level}
        onChange={(e) => setLevel(e.target.value)}
      >
        <option value="">All levels</option>
        <option value="info">Info</option>
        <option value="warning">Warnings</option>
        <option value="error">Errors</option>
      </select>
      <div className="max-h-[480px] overflow-y-auto rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-200">
        {logs.map((l) => (
          <div
            key={l.id}
            className={
              l.level === 'error'
                ? 'text-red-300'
                : l.level === 'warning'
                  ? 'text-amber-200'
                  : ''
            }
          >
            {new Date(l.ts).toLocaleTimeString()} [{l.component}] {l.message}
          </div>
        ))}
        {logs.length === 0 && (
          <div className="text-slate-500">No activity yet.</div>
        )}
      </div>
    </div>
  );
}

function Table({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((c, j) => (
                <td
                  key={j}
                  className="max-w-[360px] truncate px-3 py-1.5 text-slate-700"
                  title={String(c)}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={head.length}
                className="px-3 py-6 text-center text-slate-500"
              >
                Nothing yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Pager({
  page,
  total,
  size,
  onPage,
}: {
  page: number;
  total: number;
  size: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="flex items-center justify-between text-xs text-slate-500">
      <span>{total} total</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="disabled:opacity-40"
        >
          Previous
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
