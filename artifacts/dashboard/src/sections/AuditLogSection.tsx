import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
  ScrollText,
  Search,
} from 'lucide-react';

export type AuthFetch = (url: string, opts?: RequestInit) => Promise<Response>;

export interface AuditLog {
  id: string;
  created_at: string;
  tenant_id: string | null;
  tenant_name?: string | null;
  actor_type: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  on_behalf_of: boolean;
  action: string;
  category: string | null;
  resource_type: string | null;
  resource_id: string | null;
  outcome: 'success' | 'failure' | 'denied' | string;
  method: string | null;
  path: string | null;
  status_code: number | null;
  duration_ms: number | null;
  ip: string | null;
  user_agent: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
}

interface Filters {
  q: string;
  category: string;
  outcome: string;
  actorType: string;
  from: string;
  to: string;
  tenantId: string;
}

const EMPTY: Filters = {
  q: '',
  category: '',
  outcome: '',
  actorType: '',
  from: '',
  to: '',
  tenantId: '',
};

const OUTCOME_STYLE: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failure: 'bg-red-50 text-red-700 border-red-200',
  denied: 'bg-amber-50 text-amber-700 border-amber-200',
};

/** Builds the query string for the audit API from UI filters. */
export function buildAuditQuery(
  filters: Filters,
  page: number,
  limit = 50,
): string {
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  if (filters.category) p.set('category', filters.category);
  if (filters.outcome) p.set('outcome', filters.outcome);
  if (filters.actorType) p.set('actorType', filters.actorType);
  if (filters.tenantId) p.set('tenantId', filters.tenantId);
  // Date inputs are local calendar days; send inclusive day bounds.
  if (filters.from)
    p.set('from', new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to)
    p.set('to', new Date(`${filters.to}T23:59:59.999`).toISOString());
  p.set('page', String(page));
  p.set('limit', String(limit));
  return p.toString();
}

function actorLabel(log: AuditLog): string {
  if (log.actor_name && log.actor_email)
    return `${log.actor_name} <${log.actor_email}>`;
  return log.actor_email || log.actor_name || log.actor_type;
}

export function AuditLogSection({
  authFetch,
  scope,
  tenants = [],
}: {
  authFetch: AuthFetch;
  scope: 'workspace' | 'platform';
  tenants?: { id: string; company_name: string }[];
}) {
  const base =
    scope === 'platform' ? '/api/super-admin/audit-logs' : '/api/audit-logs';
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [draftQ, setDraftQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    logs: AuditLog[];
    total: number;
    limit: number;
  }>({
    logs: [],
    total: 0,
    limit: 50,
  });
  const [categories, setCategories] = useState<
    { category: string; count: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await authFetch(`${base}?${buildAuditQuery(filters, page)}`);
      if (!r.ok)
        throw new Error(
          (await r.json().catch(() => ({}))).error || `HTTP ${r.status}`,
        );
      setData(await r.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [authFetch, base, filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const qs = filters.tenantId
      ? `?tenantId=${encodeURIComponent(filters.tenantId)}`
      : '';
    authFetch(`${base}/facets${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d) =>
          d &&
          setCategories(
            d.categories.filter((c: { category: string }) => c.category),
          ),
      )
      .catch(() => {});
  }, [authFetch, base, filters.tenantId]);

  const set = (patch: Partial<Filters>) => {
    setPage(1);
    setFilters((f) => ({ ...f, ...patch }));
  };

  async function exportCsv() {
    setExporting(true);
    try {
      const r = await authFetch(
        `${base}/export?${buildAuditQuery(filters, 1)}`,
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  const input =
    'h-8 px-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-700';

  return (
    <div
      className={
        scope === 'platform' ? '' : 'flex-1 overflow-auto p-6 bg-slate-50'
      }
    >
      <div className="max-w-6xl mx-auto">
        {scope === 'workspace' && (
          <div className="mb-5">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <ScrollText size={16} className="text-sky-600" /> Audit Log
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Every change, sign-in and export in this workspace: who did it,
              when, from where, and what changed.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              set({ q: draftQ.trim() });
            }}
          >
            <Search
              size={13}
              className="absolute left-2 top-2.5 text-slate-400"
            />
            <input
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              placeholder="Search action, user, path, details…"
              className={`${input} pl-7 w-64`}
              aria-label="Search audit log"
            />
          </form>
          {scope === 'platform' && (
            <select
              className={input}
              value={filters.tenantId}
              onChange={(e) => set({ tenantId: e.target.value })}
              aria-label="Workspace"
            >
              <option value="">All workspaces</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.company_name}
                </option>
              ))}
            </select>
          )}
          <select
            className={input}
            value={filters.category}
            onChange={(e) => set({ category: e.target.value })}
            aria-label="Category"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.category} value={c.category}>
                {c.category} ({c.count})
              </option>
            ))}
          </select>
          <select
            className={input}
            value={filters.outcome}
            onChange={(e) => set({ outcome: e.target.value })}
            aria-label="Outcome"
          >
            <option value="">Any outcome</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="denied">Denied</option>
          </select>
          <select
            className={input}
            value={filters.actorType}
            onChange={(e) => set({ actorType: e.target.value })}
            aria-label="Actor type"
          >
            <option value="">Any actor</option>
            <option value="agent">Team member</option>
            <option value="super_admin">Super admin</option>
            <option value="api_key">API key</option>
            <option value="visitor">Widget visitor</option>
            <option value="webhook">Webhook</option>
            <option value="system">System</option>
          </select>
          <input
            type="date"
            className={input}
            value={filters.from}
            onChange={(e) => set({ from: e.target.value })}
            aria-label="From date"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            className={input}
            value={filters.to}
            onChange={(e) => set({ to: e.target.value })}
            aria-label="To date"
          />
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => void load()}
              className="h-8 px-3 text-xs rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />{' '}
              Refresh
            </button>
            <button
              onClick={() => void exportCsv()}
              disabled={exporting}
              className="h-8 px-3 text-xs rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Download size={12} /> {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg text-xs mb-4 bg-red-50 border border-red-200 text-red-600">
            {error}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 text-left">
                <tr>
                  <th className="w-6" />
                  <th className="px-3 py-2 font-medium">Time</th>
                  {scope === 'platform' && (
                    <th className="px-3 py-2 font-medium">Workspace</th>
                  )}
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Resource</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {!loading && data.logs.length === 0 && (
                  <tr>
                    <td
                      colSpan={scope === 'platform' ? 8 : 7}
                      className="px-3 py-10 text-center text-slate-400"
                    >
                      No audit events match these filters.
                    </td>
                  </tr>
                )}
                {data.logs.map((log) => {
                  const open = expanded === log.id;
                  return (
                    <Fragment key={log.id}>
                      <tr
                        className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                        onClick={() => setExpanded(open ? null : log.id)}
                      >
                        <td className="pl-3 text-slate-400">
                          {open ? (
                            <ChevronDown size={12} />
                          ) : (
                            <ChevronRight size={12} />
                          )}
                        </td>
                        <td
                          className="px-3 py-2 whitespace-nowrap text-slate-600"
                          title={log.created_at}
                        >
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        {scope === 'platform' && (
                          <td className="px-3 py-2 text-slate-600 max-w-[140px] truncate">
                            {log.tenant_name || '—'}
                          </td>
                        )}
                        <td
                          className="px-3 py-2 text-slate-700 max-w-[200px] truncate"
                          title={actorLabel(log)}
                        >
                          {actorLabel(log)}
                          {log.on_behalf_of && (
                            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">
                              as workspace
                            </span>
                          )}
                        </td>
                        <td
                          className="px-3 py-2 font-mono text-slate-800 max-w-[240px] truncate"
                          title={log.action}
                        >
                          {log.action}
                        </td>
                        <td className="px-3 py-2 text-slate-500 max-w-[180px] truncate">
                          {log.resource_type}
                          {log.resource_id
                            ? ` · ${log.resource_id.slice(0, 8)}`
                            : ''}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${OUTCOME_STYLE[log.outcome] || 'bg-slate-50 text-slate-600 border-slate-200'}`}
                          >
                            {log.outcome}
                            {log.status_code ? ` · ${log.status_code}` : ''}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-500">
                          {log.ip || '—'}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50/60">
                          <td />
                          <td
                            colSpan={scope === 'platform' ? 7 : 6}
                            className="px-3 py-3"
                          >
                            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[11px]">
                              {log.summary && (
                                <>
                                  <dt className="text-slate-400">Summary</dt>
                                  <dd className="text-slate-700">
                                    {log.summary}
                                  </dd>
                                </>
                              )}
                              <dt className="text-slate-400">Request</dt>
                              <dd className="font-mono text-slate-700">
                                {log.method} {log.path}{' '}
                                {log.duration_ms !== null
                                  ? `(${log.duration_ms} ms)`
                                  : ''}
                              </dd>
                              <dt className="text-slate-400">Actor type</dt>
                              <dd className="text-slate-700">
                                {log.actor_type}
                                {log.actor_id ? ` · ${log.actor_id}` : ''}
                              </dd>
                              <dt className="text-slate-400">Resource ID</dt>
                              <dd className="font-mono text-slate-700">
                                {log.resource_id || '—'}
                              </dd>
                              <dt className="text-slate-400">User agent</dt>
                              <dd className="text-slate-600 break-all">
                                {log.user_agent || '—'}
                              </dd>
                              <dt className="text-slate-400">Details</dt>
                              <dd>
                                <pre className="bg-white border border-slate-200 rounded-lg p-2 overflow-auto max-h-64 text-[11px] text-slate-700">
                                  {JSON.stringify(log.metadata, null, 2)}
                                </pre>
                              </dd>
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 text-xs text-slate-500">
            <span>{data.total.toLocaleString()} events</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
              >
                Previous
              </button>
              <span>
                Page {page} of {pages}
              </span>
              <button
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
                className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
