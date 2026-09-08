import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { ensurePaddle } from '../lib/paddle';
import { checkoutMode } from '../lib/checkout';
import { fmtMoney } from '../lib/dashboardHelpers';
import type { BillingPlan, SubscriptionInfo } from '../lib/dashboardTypes';

export interface BillingApi {
  listBillingPlans: () => Promise<BillingPlan[]>;
  getSubscription: () => Promise<SubscriptionInfo>;
  createCheckout: (
    plan: string,
  ) => Promise<{ url: string; transactionId?: string; provider?: string }>;
  getBillingPortal: () => Promise<string>;
  createUpgradeRequest: (
    plan: string,
    companySize: string,
    notes: string,
  ) => Promise<void>;
}

export function BillingSection({ api }: { api: BillingApi }) {
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [sub, setSubInfo] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Enterprise "request upgrade" flow.
  const [reqOpen, setReqOpen] = useState(false);
  const [submitting, setSub] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ company_size: '', notes: '' });

  useEffect(() => {
    // Surface the post-checkout redirect result, then clean the URL.
    const params = new URLSearchParams(window.location.search);
    const co = params.get('checkout');
    if (co === 'success')
      setNotice('Payment successful — your subscription is being activated.');
    else if (co === 'cancelled')
      setNotice('Checkout cancelled. No changes were made.');
    if (co) {
      params.delete('checkout');
      const q = params.toString();
      window.history.replaceState(
        {},
        '',
        window.location.pathname + (q ? `?${q}` : ''),
      );
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([
        api.listBillingPlans(),
        api.getSubscription(),
      ]);
      setPlans(p);
      setSubInfo(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line
  useEffect(() => {
    load();
  }, [load]);

  const checkout = async (plan: string) => {
    setError(null);
    setBusy(plan);
    try {
      const result = await api.createCheckout(plan);
      const paddle =
        result.transactionId && result.provider === 'paddle'
          ? await ensurePaddle(sub?.customerId ?? null)
          : undefined;
      const mode = checkoutMode(result, Boolean(paddle));
      if (mode === 'paddle') {
        if (!paddle || !result.transactionId) {
          throw new Error('Paddle checkout could not be initialized.');
        }
        paddle.Checkout.open({
          transactionId: result.transactionId,
          settings: {
            successUrl: `${window.location.origin}/dashboard/`,
            displayMode: 'overlay',
            theme: 'light',
          },
        });
        setBusy(null);
      } else {
        if (!result.url)
          throw new Error(
            'Checkout provider did not return a hosted checkout URL.',
          );
        window.location.href = result.url;
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setError(null);
    setBusy('portal');
    try {
      const url = await api.getBillingPortal();
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const submitEnterprise = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSub(true);
    try {
      await api.createUpgradeRequest(
        'enterprise',
        form.company_size,
        form.notes,
      );
      setSubmitted(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSub(false);
    }
  };

  const currentPlan = (sub?.plan || 'free').toLowerCase();

  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-4xl">
        <h2 className="text-base font-semibold text-slate-900 mb-1">
          Billing & Plans
        </h2>
        <p className="text-xs text-slate-500 mb-6">
          Choose a plan or manage your subscription
        </p>

        {notice && (
          <div className="mb-4 p-3 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-700">
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
            {error}
          </div>
        )}

        {/* Current subscription summary */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
              Current Plan
            </p>
            <p className="text-lg font-semibold text-slate-900 capitalize">
              {currentPlan}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Status: <span className="capitalize">{sub?.status ?? '—'}</span>
              {sub?.currentPeriodEnd && (
                <>
                  {' '}
                  · Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                </>
              )}
            </p>
          </div>
          {sub?.customerId && (
            <button
              onClick={openPortal}
              disabled={busy === 'portal'}
              className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy === 'portal' ? (
                <>
                  <RefreshCw size={11} className="animate-spin" /> Opening…
                </>
              ) : (
                'Manage Billing'
              )}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-slate-400 py-8">
            <RefreshCw size={12} className="animate-spin" /> Loading plans…
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((p) => {
              const isCurrent = currentPlan === p.plan;
              return (
                <div
                  key={p.plan}
                  className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col"
                >
                  <h3 className="text-sm font-semibold text-slate-900">
                    {p.name}
                  </h3>
                  <p className="mt-2">
                    <span className="text-2xl font-bold text-slate-900">
                      {fmtMoney(p.amount, p.currency)}
                    </span>
                    <span className="text-xs text-slate-400">
                      /{p.interval}
                    </span>
                  </p>
                  {p.description && (
                    <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                      {p.description}
                    </p>
                  )}
                  {(p.features || p.limits) && (
                    <ul className="mt-3 space-y-1.5">
                      {p.features?.ai_feature_enabled && (
                        <li className="flex items-center gap-1.5 text-xs text-slate-600">
                          <CheckCircle2
                            size={12}
                            className="text-emerald-500 shrink-0"
                          />{' '}
                          AI auto-replies
                        </li>
                      )}
                      {p.features?.smtp_feature_enabled && (
                        <li className="flex items-center gap-1.5 text-xs text-slate-600">
                          <CheckCircle2
                            size={12}
                            className="text-emerald-500 shrink-0"
                          />{' '}
                          Custom SMTP / email
                        </li>
                      )}
                      {p.limits?.max_brands_allowed != null && (
                        <li className="flex items-center gap-1.5 text-xs text-slate-600">
                          <CheckCircle2
                            size={12}
                            className="text-emerald-500 shrink-0"
                          />{' '}
                          {p.limits.max_brands_allowed} brands
                        </li>
                      )}
                      {p.limits?.max_agents_allowed != null && (
                        <li className="flex items-center gap-1.5 text-xs text-slate-600">
                          <CheckCircle2
                            size={12}
                            className="text-emerald-500 shrink-0"
                          />{' '}
                          {p.limits.max_agents_allowed} agents
                        </li>
                      )}
                      {p.limits?.conversation_limit != null && (
                        <li className="flex items-center gap-1.5 text-xs text-slate-600">
                          <CheckCircle2
                            size={12}
                            className="text-emerald-500 shrink-0"
                          />{' '}
                          {p.limits.conversation_limit} conversations/mo
                        </li>
                      )}
                    </ul>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => checkout(p.plan)}
                    disabled={isCurrent || busy === p.plan}
                    className="mt-4 px-4 py-2 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    {isCurrent ? (
                      'Current Plan'
                    ) : busy === p.plan ? (
                      <>
                        <RefreshCw size={11} className="animate-spin" />{' '}
                        Redirecting…
                      </>
                    ) : (
                      `Upgrade to ${p.name}`
                    )}
                  </button>
                </div>
              );
            })}

            {/* Enterprise — manual request only */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
              <h3 className="text-sm font-semibold text-slate-900">
                Enterprise
              </h3>
              <p className="mt-2">
                <span className="text-2xl font-bold text-slate-900">
                  Custom
                </span>
              </p>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                Dedicated support, custom limits, SSO and SLA. Talk to our team.
              </p>
              <div className="flex-1" />
              <button
                onClick={() => {
                  setReqOpen(true);
                  setSubmitted(false);
                }}
                disabled={currentPlan === 'enterprise'}
                className="mt-4 px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                {currentPlan === 'enterprise'
                  ? 'Current Plan'
                  : 'Request Upgrade'}
              </button>
            </div>
          </div>
        )}

        {/* Enterprise request modal */}
        {reqOpen && (
          <div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
            onClick={() => setReqOpen(false)}
          >
            <div
              className="bg-white rounded-xl p-6 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              {submitted ? (
                <div className="text-center py-4">
                  <CheckCircle2
                    size={28}
                    className="text-emerald-500 mx-auto mb-3"
                  />
                  <p className="text-sm font-semibold text-emerald-800">
                    Request submitted!
                  </p>
                  <p className="text-xs text-emerald-600 mt-1">
                    Our team will contact you within 24 hours.
                  </p>
                  <button
                    onClick={() => setReqOpen(false)}
                    className="mt-4 px-4 py-2 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-200"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <>
                  <h3 className="text-sm font-semibold text-slate-900 mb-4">
                    Request Enterprise Plan
                  </h3>
                  <form onSubmit={submitEnterprise} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">
                        Company Size
                      </label>
                      <input
                        type="text"
                        value={form.company_size}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            company_size: e.target.value,
                          }))
                        }
                        placeholder="e.g. 50 employees"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">
                        Notes
                      </label>
                      <textarea
                        value={form.notes}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, notes: e.target.value }))
                        }
                        rows={3}
                        placeholder="Any specific requirements…"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 resize-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="px-4 py-2 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {submitting ? (
                          <>
                            <RefreshCw size={11} className="animate-spin" />{' '}
                            Submitting…
                          </>
                        ) : (
                          'Submit Request'
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setReqOpen(false)}
                        className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
