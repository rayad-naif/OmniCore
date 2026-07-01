import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * Billing.jsx
 * Atelier OmniCore — Billing & Subscription page
 *
 * Displays:
 *  - Current plan badge (free | starter | pro | enterprise)
 *  - Subscription status (active | past_due | cancelled | trialing)
 *  - Key usage meters: seats, conversations/mo, KB articles, AI credits
 *  - Plan comparison table
 *  - Upgrade CTA → POST /api/checkout → redirects to Lemon Squeezy checkout
 *  - Customer portal link → POST /api/billing/portal
 *  - Grace-period banner when status is past_due
 *  - Cancellation confirmation when status is cancelled
 */

const API_URL = import.meta.env.VITE_API_URL || '/api';

// ─── Plan definitions ─────────────────────────────────────────────────────────
const PLANS = [
  {
    id:          'starter',
    variantId:   import.meta.env.VITE_LS_STARTER_VARIANT_ID || '',
    name:        'Starter',
    price:       29,
    interval:    'month',
    color:       'blue',
    description: 'Perfect for small support teams getting started.',
    features: [
      '3 agent seats',
      '1,000 conversations / month',
      '100 knowledge base articles',
      '500 AI credits / month',
      'Email + web chat channels',
      'Standard SLA (48 h)',
    ],
    limits: { seats: 3, conversations: 1_000, articles: 100, aiCredits: 500 },
  },
  {
    id:          'pro',
    variantId:   import.meta.env.VITE_LS_PRO_VARIANT_ID || '',
    name:        'Pro',
    price:       99,
    interval:    'month',
    color:       'violet',
    badge:       'Most Popular',
    description: 'For growing teams with higher volume and advanced AI needs.',
    features: [
      '15 agent seats',
      '10,000 conversations / month',
      'Unlimited knowledge base articles',
      '5,000 AI credits / month',
      'All channels + API access',
      'Priority SLA (4 h)',
      'Custom AI system prompt',
      'CORS multi-domain',
    ],
    limits: { seats: 15, conversations: 10_000, articles: Infinity, aiCredits: 5_000 },
  },
  {
    id:          'enterprise',
    variantId:   '',
    name:        'Enterprise',
    price:       null,
    interval:    'month',
    color:       'slate',
    description: 'Dedicated infrastructure, SSO, and SLA guarantees.',
    features: [
      'Unlimited seats',
      'Unlimited conversations',
      'Unlimited everything',
      'Dedicated vector DB',
      'Custom AI model fine-tuning',
      'SSO / SAML',
      '99.99% SLA',
      'Dedicated CSM',
    ],
    limits: { seats: Infinity, conversations: Infinity, articles: Infinity, aiCredits: Infinity },
  },
];

const PLAN_COLORS = {
  blue:   { ring: 'ring-blue-500',   bg: 'bg-blue-600',   light: 'bg-blue-50',   text: 'text-blue-700',   badge: 'bg-blue-100 text-blue-700'   },
  violet: { ring: 'ring-violet-500', bg: 'bg-violet-600', light: 'bg-violet-50', text: 'text-violet-700', badge: 'bg-violet-100 text-violet-700' },
  slate:  { ring: 'ring-slate-400',  bg: 'bg-slate-700',  light: 'bg-slate-50',  text: 'text-slate-700',  badge: 'bg-slate-100 text-slate-600'  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function pct(used, limit) {
  if (!limit || limit === Infinity) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function fmtNum(n) {
  if (n === Infinity || n == null) return '∞';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'k';
  return String(n);
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({ size = 'sm', color = 'violet' }) {
  const sz = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  const cl = color === 'white' ? 'text-white' : 'text-violet-600';
  return (
    <svg className={`animate-spin ${sz} ${cl}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
  );
}

// ─── Status pill ──────────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const map = {
    active:    { label: 'Active',    cls: 'bg-emerald-100 text-emerald-700' },
    trialing:  { label: 'Trial',     cls: 'bg-blue-100 text-blue-700'       },
    past_due:  { label: 'Past Due',  cls: 'bg-red-100 text-red-700'         },
    cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-600'     },
    paused:    { label: 'Paused',    cls: 'bg-amber-100 text-amber-700'     },
    free:      { label: 'Free',      cls: 'bg-slate-100 text-slate-500'     },
  };
  const s = map[status] || map.free;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        status === 'active' || status === 'trialing' ? 'bg-emerald-500 animate-pulse' :
        status === 'past_due' ? 'bg-red-500 animate-pulse' : 'bg-slate-400'
      }`} />
      {s.label}
    </span>
  );
}

// ─── Usage meter ──────────────────────────────────────────────────────────────
function UsageMeter({ label, used, limit, icon }) {
  const p   = pct(used, limit);
  const bar = p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-amber-500' : 'bg-violet-500';
  const unlimited = limit === Infinity || limit == null;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
          <span>{icon}</span>{label}
        </div>
        <span className="text-xs text-slate-500">
          {fmtNum(used)} / {unlimited ? '∞' : fmtNum(limit)}
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        {unlimited ? (
          <div className="h-full bg-violet-200 rounded-full w-full" />
        ) : (
          <div className={`h-full rounded-full transition-all duration-500 ${bar}`}
            style={{ width: `${p}%` }} />
        )}
      </div>
      {!unlimited && p >= 90 && (
        <p className="mt-1 text-[10px] text-red-600 font-medium">
          {p >= 100 ? 'Limit reached — upgrade to continue' : `${100 - p}% remaining`}
        </p>
      )}
    </div>
  );
}

// ─── Plan card ────────────────────────────────────────────────────────────────
function PlanCard({ plan, isCurrent, onUpgrade, upgrading }) {
  const c = PLAN_COLORS[plan.color];
  return (
    <div className={`relative flex flex-col rounded-2xl border-2 bg-white transition-all
      ${isCurrent ? `${c.ring} ring-2 ring-offset-2` : 'border-slate-200 hover:border-slate-300'}`}>

      {/* Popular badge */}
      {plan.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className={`px-3 py-1 rounded-full text-[11px] font-bold ${c.badge} shadow-sm`}>
            {plan.badge}
          </span>
        </div>
      )}

      <div className="px-5 pt-6 pb-4 border-b border-slate-100">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold text-slate-900">{plan.name}</h3>
          {isCurrent && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.badge}`}>
              Current
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-3">{plan.description}</p>
        <div className="flex items-end gap-1">
          {plan.price != null ? (
            <>
              <span className="text-3xl font-extrabold text-slate-900">${plan.price}</span>
              <span className="text-sm text-slate-400 mb-1">/{plan.interval}</span>
            </>
          ) : (
            <span className="text-xl font-bold text-slate-700">Custom pricing</span>
          )}
        </div>
      </div>

      <ul className="flex-1 px-5 py-4 space-y-2">
        {plan.features.map(f => (
          <li key={f} className="flex items-start gap-2 text-xs text-slate-700">
            <svg viewBox="0 0 24 24" fill="currentColor" className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${c.text}`}>
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
            </svg>
            {f}
          </li>
        ))}
      </ul>

      <div className="px-5 pb-5">
        {isCurrent ? (
          <div className={`w-full py-2 rounded-xl text-xs font-semibold text-center ${c.light} ${c.text}`}>
            Your current plan
          </div>
        ) : plan.price == null ? (
          <a href="mailto:sales@atelier-omnicore.com"
            className="flex items-center justify-center w-full py-2 rounded-xl text-xs font-semibold
                       border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors">
            Contact Sales
          </a>
        ) : (
          <button
            onClick={() => onUpgrade(plan)}
            disabled={upgrading === plan.id}
            className={`flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-semibold
              text-white transition-all shadow-sm
              ${upgrading === plan.id ? 'opacity-70 cursor-wait' : 'hover:opacity-90 active:scale-[.98]'}
              ${c.bg}`}
          >
            {upgrading === plan.id && <Spinner size="sm" color="white" />}
            {upgrading === plan.id ? 'Redirecting…' : `Upgrade to ${plan.name}`}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Billing() {
  const { agent, authFetch } = useAuth();

  const [subscription, setSubscription]   = useState(null);
  const [usage,        setUsage]          = useState(null);
  const [loading,      setLoading]        = useState(true);
  const [upgrading,    setUpgrading]      = useState(null);   // plan.id being upgraded
  const [portalLoading, setPortalLoading] = useState(false);
  const [error,        setError]          = useState('');

  // ── Load subscription + usage ───────────────────────────────────────────────
  useEffect(() => {
    if (!agent) return;
    setLoading(true);
    Promise.all([
      authFetch(`${API_URL}/billing/subscription`).then(r => r.json()),
      authFetch(`${API_URL}/billing/usage`).then(r => r.json()),
    ])
      .then(([sub, use]) => { setSubscription(sub); setUsage(use); })
      .catch(err => {
        console.error('[Billing] load', err);
        // Fall back to free plan display rather than error page
        setSubscription({ plan: 'free', status: 'free' });
        setUsage({ seats: 1, conversations: 0, articles: 0, aiCredits: 0 });
      })
      .finally(() => setLoading(false));
  }, [agent, authFetch]);

  // ── Upgrade / subscribe → Paddle or Stripe hosted checkout ─────────────────
  const handleUpgrade = useCallback(async (plan) => {
    setUpgrading(plan.id);
    setError('');
    try {
      const res  = await authFetch(`${API_URL}/checkout`, {
        method: 'POST',
        body:   JSON.stringify({ plan: plan.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const url = data.url || data.checkoutUrl;
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      setError(err.message || 'Could not start checkout. Please try again.');
    } finally {
      setUpgrading(null);
    }
  }, [authFetch]);

  // ── Customer portal ─────────────────────────────────────────────────────────
  const handlePortal = useCallback(async () => {
    setPortalLoading(true);
    try {
      const res  = await authFetch(`${API_URL}/billing/portal`, { method: 'POST' });
      const data = await res.json();
      if (data.portalUrl) window.open(data.portalUrl, '_blank', 'noopener');
    } catch (err) {
      setError(err.message || 'Could not open billing portal.');
    } finally {
      setPortalLoading(false);
    }
  }, [authFetch]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const currentPlan = PLANS.find(p => p.id === subscription?.plan) || null;
  const planLimits  = currentPlan?.limits || { seats: 1, conversations: 50, articles: 10, aiCredits: 0 };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Page header */}
        <div>
          <h1 className="text-xl font-bold text-slate-900">Billing & Subscription</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage your plan, usage, and payment details.</p>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0 mt-0.5 text-red-500">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            <span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* ── Past due grace-period banner ──────────────────────────────────── */}
        {subscription?.status === 'past_due' && (
          <div className="flex items-start gap-4 px-5 py-4 rounded-2xl bg-red-50 border border-red-300">
            <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-red-600">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-red-800">Payment past due</p>
              <p className="text-xs text-red-700 mt-1">
                Your last payment failed. Update your payment method within{' '}
                <strong>
                  {subscription.gracePeriodEndsAt
                    ? `${Math.max(0, Math.ceil((new Date(subscription.gracePeriodEndsAt) - new Date()) / 86_400_000))} days`
                    : '7 days'}
                </strong>{' '}
                to keep your subscription active. After the grace period, your brand widget will be automatically disabled.
              </p>
            </div>
            <button onClick={handlePortal} disabled={portalLoading}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors">
              {portalLoading ? <Spinner size="sm" color="white" /> : null}
              Update Card
            </button>
          </div>
        )}

        {/* ── Cancelled banner ──────────────────────────────────────────────── */}
        {subscription?.status === 'cancelled' && (
          <div className="flex items-start gap-4 px-5 py-4 rounded-2xl bg-slate-50 border border-slate-300">
            <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-slate-500">
                <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/>
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-800">Subscription cancelled</p>
              <p className="text-xs text-slate-600 mt-1">
                Your plan is cancelled and will expire on{' '}
                <strong>{fmtDate(subscription.currentPeriodEnd)}</strong>.
                You can re-subscribe at any time before then.
              </p>
            </div>
          </div>
        )}

        {/* ── Trialing banner ───────────────────────────────────────────────── */}
        {subscription?.status === 'trialing' && (
          <div className="flex items-start gap-4 px-5 py-4 rounded-2xl bg-blue-50 border border-blue-200">
            <span className="text-2xl shrink-0">🎉</span>
            <div>
              <p className="text-sm font-bold text-blue-900">You're on a free trial</p>
              <p className="text-xs text-blue-700 mt-1">
                Trial ends on <strong>{fmtDate(subscription.trialEndsAt)}</strong>. Add a payment method to keep your plan active after the trial.
              </p>
            </div>
          </div>
        )}

        {/* ── Current plan summary card ─────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Current Plan</p>
              <div className="flex items-center gap-3">
                <span className="text-xl font-extrabold text-slate-900">
                  {currentPlan?.name || 'Free'}
                </span>
                <StatusPill status={subscription?.status || 'free'} />
                {subscription?.status === 'active' && subscription?.currentPeriodEnd && (
                  <span className="text-xs text-slate-400">
                    Renews {fmtDate(subscription.currentPeriodEnd)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {subscription?.customerId && (
                <button onClick={handlePortal} disabled={portalLoading}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 bg-white
                             text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                  {portalLoading ? <Spinner size="sm" /> : (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-slate-400">
                      <path d="M20 4H4c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/>
                    </svg>
                  )}
                  Manage Billing
                </button>
              )}
            </div>
          </div>

          {/* Usage meters */}
          <div className="px-6 py-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
              This Month's Usage
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <UsageMeter label="Agent Seats"            icon="👥" used={usage?.seats        || 0} limit={planLimits.seats}         />
              <UsageMeter label="Conversations"          icon="💬" used={usage?.conversations || 0} limit={planLimits.conversations}  />
              <UsageMeter label="Knowledge Base Articles" icon="📚" used={usage?.articles     || 0} limit={planLimits.articles}       />
              <UsageMeter label="AI Credits Used"        icon="🤖" used={usage?.aiCredits     || 0} limit={planLimits.aiCredits}      />
            </div>
          </div>
        </div>

        {/* ── Plan comparison ───────────────────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-bold text-slate-900 mb-4">Available Plans</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
            {PLANS.map(plan => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isCurrent={subscription?.plan === plan.id}
                onUpgrade={handleUpgrade}
                upgrading={upgrading}
              />
            ))}
          </div>
        </div>

        {/* ── Invoice history placeholder ───────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">Invoice History</h3>
            <p className="text-xs text-slate-500 mt-0.5">Download past invoices from your billing portal.</p>
          </div>
          <div className="flex items-center justify-between px-6 py-5">
            <p className="text-sm text-slate-500">
              View and download all invoices in the Lemon Squeezy customer portal.
            </p>
            <button onClick={handlePortal} disabled={portalLoading || !subscription?.customerId}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 bg-white
                         text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors">
              {portalLoading ? <Spinner size="sm" /> : '↗'} Open Portal
            </button>
          </div>
        </div>

        {/* ── FAQ ──────────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">Frequently Asked Questions</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {[
              { q: 'Can I cancel at any time?',          a: 'Yes. Cancellations take effect at the end of your current billing period.' },
              { q: 'What happens if I exceed my limits?', a: 'You will receive an in-app warning at 90% usage. AI responses pause at 100%. Upgrade instantly to restore service.' },
              { q: 'Are unused AI credits rolled over?',  a: 'No. Credits reset at the start of each billing month.' },
              { q: 'Do you offer annual billing?',        a: 'Yes — annual plans save 20%. Contact sales@atelier-omnicore.com for an annual invoice.' },
            ].map(({ q, a }) => (
              <details key={q} className="group px-6 py-4 cursor-pointer">
                <summary className="flex items-center justify-between text-sm font-medium text-slate-800 list-none">
                  {q}
                  <svg viewBox="0 0 24 24" fill="currentColor"
                    className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180">
                    <path d="M7 10l5 5 5-5z"/>
                  </svg>
                </summary>
                <p className="mt-2 text-sm text-slate-500 leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
