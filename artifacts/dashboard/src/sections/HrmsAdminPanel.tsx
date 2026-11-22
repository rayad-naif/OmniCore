import { useCallback, useEffect, useState } from 'react';
import {
  Database,
  ExternalLink,
  HardDrive,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { AuthFetch } from './AuditLogSection';

interface Row {
  id: string;
  name: string;
  plan: string | null;
  enabled: boolean;
  directory_users: number;
  users: number | null;
  storage: {
    dataSize: number;
    storageSize: number;
    collections: number;
  } | null;
}
interface Overview {
  database: { configured: boolean; ok: boolean; error?: string };
  fileStorage: 'r2' | 'local-disk';
  workspaces: Row[];
}

const kb = (n?: number) =>
  n ? `${(n / 1024).toFixed(n > 1024 * 1024 ? 0 : 1)} KB` : '—';

/** Super Admin → HR: the HR module across all workspaces. */
export function HrmsAdminPanel({ authFetch }: { authFetch: AuthFetch }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    const res = await authFetch('/api/super-admin/hrms');
    const body = await res.json();
    if (!res.ok) setError(body.error || 'Could not load HR overview');
    else setData(body);
  }, [authFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (key: string, url: string, init: RequestInit) => {
    setBusy(key);
    setError('');
    setMessage('');
    try {
      const res = await authFetch(url, init);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Request failed');
      return body;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy('');
    }
  };

  const toggle = async (row: Row) => {
    const ok = await call(
      row.id,
      `/api/super-admin/hrms/workspaces/${row.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !row.enabled }),
      },
    );
    if (ok) void load();
  };

  const open = async (row: Row) => {
    const body = await call(
      row.id,
      `/api/super-admin/hrms/workspaces/${row.id}/open`,
      { method: 'POST' },
    );
    if (body?.url) window.open(body.url, '_blank', 'noopener');
  };

  const erase = async (row: Row) => {
    const confirm = window.prompt(
      `This permanently deletes ALL HR data of "${row.name}" (employees, attendance, payroll, files). Type the workspace name to confirm:`,
    );
    if (confirm === null) return;
    const body = await call(
      row.id,
      `/api/super-admin/hrms/workspaces/${row.id}/data`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      },
    );
    if (body) {
      setMessage(body.note || 'HR data deleted.');
      void load();
    }
  };

  const sweep = async () => {
    const body = await call('sweep', '/api/super-admin/hrms/sweep', {
      method: 'POST',
    });
    if (body)
      setMessage(
        `Attendance sweep: ${body.workspaces} workspaces, ${body.absentMarked} marked absent, ${body.onLeaveMarked} on leave.`,
      );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">HR module</h3>
          <p className="text-xs text-slate-500">
            Plans switch HR on with the &ldquo;HR module&rdquo; option (Billing
            → plans); you can also turn it on or off per workspace here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void sweep()}
            disabled={busy === 'sweep'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            <Play size={12} /> Run attendance sweep
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="text-slate-400 hover:text-slate-600"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {data && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center gap-3">
            <Database
              size={18}
              className={data.database.ok ? 'text-emerald-600' : 'text-red-500'}
            />
            <div className="text-sm">
              <p className="font-semibold text-slate-800">HR database</p>
              <p className="text-xs text-slate-500">
                {!data.database.configured
                  ? 'Not configured: set HRMS_MONGODB_URI'
                  : data.database.ok
                    ? 'Connected (one database per workspace)'
                    : `Unreachable: ${data.database.error || 'unknown error'}`}
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center gap-3">
            <HardDrive size={18} className="text-slate-500" />
            <div className="text-sm">
              <p className="font-semibold text-slate-800">HR files</p>
              <p className="text-xs text-slate-500">
                {data.fileStorage === 'r2'
                  ? 'Cloudflare R2'
                  : 'Server disk (set R2_* for durable storage)'}
              </p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Workspace</th>
              <th className="px-4 py-2">Plan</th>
              <th className="px-4 py-2">HR</th>
              <th className="px-4 py-2">Accounts</th>
              <th className="px-4 py-2">Data</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {(data?.workspaces || []).map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">
                  {row.name}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {row.plan || 'free'}
                </td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => void toggle(row)}
                    disabled={busy === row.id}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${row.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                  >
                    {row.enabled ? 'ON' : 'OFF'}
                  </button>
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {row.users ?? row.directory_users}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {kb(row.storage?.dataSize)}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => void open(row)}
                    disabled={!row.enabled || busy === row.id}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline disabled:opacity-40"
                  >
                    <ExternalLink size={12} /> Open
                  </button>
                  <button
                    type="button"
                    onClick={() => void erase(row)}
                    disabled={busy === row.id}
                    className="ml-3 inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline"
                  >
                    <Trash2 size={12} /> Delete data
                  </button>
                </td>
              </tr>
            ))}
            {data && data.workspaces.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  No workspace uses HR yet. Turn on &ldquo;HR module&rdquo; on a
                  plan, or per workspace under Tenants → limits.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
