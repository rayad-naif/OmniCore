import { useCallback, useEffect, useState } from 'react';
import {
  Briefcase,
  Copy,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Monitor,
  RefreshCw,
  Users,
} from 'lucide-react';
import type { AuthFetch } from './AuditLogSection';

interface HrStatus {
  configured: boolean;
  enabled: boolean;
  timezone: string;
  appUrl: string;
  employees?: number | null;
  links?: {
    employeeLogin: string;
    jobApplications: string;
    biometricWebhook: string;
    activityAgent: string;
  };
  keys?: { activityKey: string | null; deviceKey: string | null };
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/**
 * HR (ported HRMS): opens the HR app with single sign-on and, for workspace
 * admins, shows the links and device keys employees and hardware need.
 */
export function HrSection({
  authFetch,
  role,
}: {
  authFetch: AuthFetch;
  role: string;
}) {
  const [status, setStatus] = useState<HrStatus | null>(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [newKey, setNewKey] = useState<{ kind: string; key: string } | null>(
    null,
  );
  const isAdmin = role === 'admin';

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await authFetch('/api/hrms/workspace');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load HR status');
      setStatus(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [authFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const openHr = async () => {
    setOpening(true);
    setError('');
    try {
      const res = await authFetch('/api/hrms/sso/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open HR');
      window.open(data.url, '_blank', 'noopener');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(false);
    }
  };

  const rotate = async (kind: 'activity' | 'device') => {
    if (
      !window.confirm(
        'Create a new key? Devices using the old key stop working until you update them.',
      )
    )
      return;
    const res = await authFetch(`/api/hrms/workspace/keys/${kind}/rotate`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Could not create the key');
      return;
    }
    setNewKey({ kind, key: data.key });
    void load();
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Briefcase size={20} className="text-sky-600" /> HR
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Employees, attendance and shifts, leave, payroll, recruitment and
              performance.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="text-slate-400 hover:text-slate-600"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {status && !status.configured && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            The HR module is not set up on this server yet. The platform
            administrator needs to add the HR database (
            <code>HRMS_MONGODB_URI</code>).
          </div>
        )}

        {status?.configured && !status.enabled && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="font-semibold text-slate-800">
              HR is not included in your plan
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Upgrade under Billing to a plan with the HR module, or ask your
              provider to turn it on.
            </p>
          </div>
        )}

        {status?.enabled && (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
                  <Users size={18} className="text-sky-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">
                    {status.employees ?? '—'}
                  </p>
                  <p className="text-xs text-slate-500">
                    active HR accounts · time zone {status.timezone}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void openHr()}
                disabled={opening}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
              >
                <ExternalLink size={14} /> {opening ? 'Opening…' : 'Open HR'}
              </button>
            </div>

            {isAdmin && status.links && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                <p className="font-semibold text-slate-800">
                  Links for employees and candidates
                </p>
                <CopyField
                  label="Employee sign-in"
                  value={status.links.employeeLogin}
                />
                <CopyField
                  label="Job applications (POST, used by your careers page)"
                  value={status.links.jobApplications}
                />
                <p className="text-xs text-slate-500">
                  Employees get their own HR account (added by an HR admin) and
                  sign in with email and password. Workspace admins open HR from
                  this page without a separate password.
                </p>
              </div>
            )}

            {isAdmin && status.links && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                <p className="font-semibold text-slate-800 flex items-center gap-2">
                  <KeyRound size={16} className="text-slate-500" /> Devices and
                  agents
                </p>
                {newKey && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                    <p className="text-sm text-emerald-800">
                      Copy this key now. It is not shown again.
                    </p>
                    <CopyField
                      label={
                        newKey.kind === 'activity'
                          ? 'Activity agent key'
                          : 'Device key'
                      }
                      value={newKey.key}
                    />
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                      <Monitor size={14} /> Desktop activity agent
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Sends the <code>x-api-key</code> header to{' '}
                      {status.links.activityAgent}
                    </p>
                    <p className="text-xs text-slate-600 mt-2">
                      Key: {status.keys?.activityKey || 'not created'}
                    </p>
                    <button
                      type="button"
                      onClick={() => void rotate('activity')}
                      className="mt-3 text-xs font-semibold text-sky-700 hover:underline"
                    >
                      {status.keys?.activityKey ? 'Replace key' : 'Create key'}
                    </button>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                      <Fingerprint size={14} /> Biometric devices (Hikvision)
                    </p>
                    <p className="text-xs text-slate-500 mt-1 break-all">
                      Event URL: {status.links.biometricWebhook}
                    </p>
                    <p className="text-xs text-slate-600 mt-2">
                      Key: {status.keys?.deviceKey || 'not created'}
                    </p>
                    <button
                      type="button"
                      onClick={() => void rotate('device')}
                      className="mt-3 text-xs font-semibold text-sky-700 hover:underline"
                    >
                      {status.keys?.deviceKey ? 'Replace key' : 'Create key'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
