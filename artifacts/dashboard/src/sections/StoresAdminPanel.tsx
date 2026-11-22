import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { AuthFetch } from './AuditLogSection';

interface Health {
  ok: boolean;
  error?: string;
  version?: string;
  docker?: string;
  tls_mode?: string;
  cache?: {
    woocommerce: boolean;
    storefront: boolean;
    omnicore_plugin: boolean;
  };
  stores?: {
    active: number;
    suspended: number;
    provisioning: number;
    failed: number;
  };
  disk?: { free_bytes: number; total_bytes: number };
}
interface Host {
  id: string;
  name: string;
  agent_url: string;
  base_domain: string;
  cname_target: string | null;
  public_ip: string | null;
  capacity: number;
  active: boolean;
  used?: number;
  last_seen_at: string | null;
  last_health: Health | null;
}
interface PlatformStore {
  id: string;
  kind: string;
  name: string;
  status: string;
  subdomain: string | null;
  custom_domain: string | null;
  site_url: string | null;
  company_name: string;
  host_name: string | null;
  created_at: string;
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none';
const gb = (n?: number) => (n ? `${(n / 1024 ** 3).toFixed(1)} GB` : '—');

export function StoresAdminPanel({ authFetch }: { authFetch: AuthFetch }) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [cloudflare, setCloudflare] = useState(false);
  const [stores, setStores] = useState<PlatformStore[]>([]);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: '',
    agent_url: '',
    secret: '',
    base_domain: '',
    cname_target: '',
    public_ip: '',
    capacity: '40',
  });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const api = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const res = await authFetch(`/api/super-admin/stores${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(body.error || `Request failed (${res.status})`);
      return body as T;
    },
    [authFetch],
  );
  const load = useCallback(() => {
    api<{ hosts: Host[]; cloudflare: boolean }>('/hosts')
      .then((r) => (setHosts(r.hosts), setCloudflare(r.cloudflare)))
      .catch((e) => setErr(e.message));
    api<{ stores: PlatformStore[] }>(`/all?q=${encodeURIComponent(q)}`)
      .then((r) => setStores(r.stores))
      .catch((e) => setErr(e.message));
  }, [api, q]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setErr('');
    try {
      await fn();
      setMsg(done);
      setTimeout(() => setMsg(''), 4000);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {err}
        </div>
      )}
      {msg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {msg}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-2 font-semibold text-slate-800">
              <Server size={16} /> Store servers
            </p>
            <p className="text-xs text-slate-500">
              Servers prepared with deploy-store-host.sh. New hosted stores go
              to the active server with the most free space. Custom domains:{' '}
              {cloudflare
                ? 'Cloudflare for SaaS'
                : 'direct DNS + Let’s Encrypt'}
              .
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white"
            onClick={() => setAdding(!adding)}
          >
            <Plus size={13} /> Add server
          </button>
        </div>
        {adding && (
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {(
              [
                ['name', 'Name', 'OCI Store 1'],
                ['agent_url', 'Agent URL', 'https://agent.stores.example.com'],
                ['secret', 'Agent secret (AGENT_SECRET)', ''],
                ['base_domain', 'Store domain', 'stores.example.com'],
                [
                  'cname_target',
                  'CNAME target for custom domains',
                  'edge.stores.example.com',
                ],
                ['public_ip', 'Public IP', '203.0.113.10'],
                ['capacity', 'Max stores', '40'],
              ] as const
            ).map(([k, label, ph]) => (
              <label key={k} className="block text-xs text-slate-600">
                {label}
                <input
                  className={inputCls}
                  type={k === 'secret' ? 'password' : 'text'}
                  placeholder={ph}
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </label>
            ))}
            <div className="flex items-end">
              <button
                type="button"
                className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white"
                onClick={() =>
                  run(async () => {
                    const r = await api<{ health: Health }>('/hosts', {
                      method: 'POST',
                      body: JSON.stringify({
                        ...form,
                        capacity: Number(form.capacity),
                      }),
                    });
                    if (!r.health.ok)
                      throw new Error(
                        `Saved, but the agent did not answer correctly: ${r.health.error || 'check the URL and secret'}`,
                      );
                    setAdding(false);
                  }, 'Store server added.')
                }
              >
                Save and test
              </button>
            </div>
          </div>
        )}
        <div className="mt-3 space-y-2">
          {!hosts.length && (
            <p className="text-sm text-slate-500">
              No store servers yet. Hosted stores are unavailable until you add
              one.
            </p>
          )}
          {hosts.map((h) => {
            const hl = h.last_health;
            return (
              <div
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    {hl?.ok ? (
                      <CheckCircle2 size={14} className="text-emerald-600" />
                    ) : (
                      <XCircle size={14} className="text-rose-600" />
                    )}
                    {h.name}{' '}
                    {!h.active && (
                      <span className="text-xs font-normal text-slate-400">
                        (inactive)
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    *.{h.base_domain} · {h.agent_url} · {h.used ?? 0}/
                    {h.capacity} stores
                  </p>
                  <p className="text-xs text-slate-500">
                    {hl?.ok
                      ? `Docker ${hl.docker} · agent ${hl.version} · disk free ${gb(hl.disk?.free_bytes)} · ${hl.cache?.woocommerce ? 'WooCommerce cached' : 'WooCommerce missing from cache'}`
                      : hl?.error || 'Not checked yet'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    onClick={() =>
                      run(
                        () =>
                          api(`/hosts/${h.id}/check`, {
                            method: 'POST',
                            body: '{}',
                          }),
                        'Checked.',
                      )
                    }
                  >
                    <RefreshCw size={12} className="inline" /> Check
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    onClick={() =>
                      run(
                        () =>
                          api(`/hosts/${h.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ active: !h.active }),
                          }),
                        h.active ? 'Server set inactive.' : 'Server active.',
                      )
                    }
                  >
                    {h.active ? 'Set inactive' : 'Set active'}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-600"
                    onClick={() =>
                      run(
                        () => api(`/hosts/${h.id}`, { method: 'DELETE' }),
                        'Server removed.',
                      )
                    }
                  >
                    <Trash2 size={12} className="inline" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-slate-800">All stores</p>
          <input
            className={`${inputCls} max-w-xs`}
            placeholder="Search store, domain or workspace"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Store</th>
                <th>Workspace</th>
                <th>Address</th>
                <th>Server</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="py-2 font-medium text-slate-800">
                    {s.name}{' '}
                    <span className="text-xs text-slate-400">{s.kind}</span>
                  </td>
                  <td className="text-slate-600">{s.company_name}</td>
                  <td className="text-xs text-slate-500">
                    {s.site_url || s.subdomain}
                  </td>
                  <td className="text-xs text-slate-500">
                    {s.host_name || '—'}
                  </td>
                  <td className="text-xs capitalize text-slate-600">
                    {s.status}
                  </td>
                  <td className="text-right">
                    {s.kind === 'hosted' && s.status === 'active' && (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs"
                        onClick={() =>
                          run(
                            () =>
                              api(`/${s.id}/suspend`, {
                                method: 'POST',
                                body: '{}',
                              }),
                            'Store paused.',
                          )
                        }
                      >
                        <Pause size={11} className="inline" /> Pause
                      </button>
                    )}
                    {s.kind === 'hosted' && s.status === 'suspended' && (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs"
                        onClick={() =>
                          run(
                            () =>
                              api(`/${s.id}/resume`, {
                                method: 'POST',
                                body: '{}',
                              }),
                            'Store resumed.',
                          )
                        }
                      >
                        <Play size={11} className="inline" /> Resume
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!stores.length && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    No stores yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
