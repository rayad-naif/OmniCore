import { useState, useEffect, useCallback } from 'react';

const GRACE_DISMISS_KEY = 'omnicore_grace_dismissed_until';
const API_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * TrialGateway
 * Renders an overlay when a tenant's trial has ended.
 *
 * - Grace period (trial ended, ≤7 days): semi-transparent popup, dismissible
 *   for 24 h. Shows a countdown and CTA to the Billing tab.
 * - Hard lock (grace expired / cancelled / paused): full-screen opaque
 *   overlay, cannot be dismissed. All dashboard interactions are blocked.
 *
 * Super-admins are exempt so they can always access any workspace.
 */
export default function TrialGateway({ authFetch, agent, onNavigate, onCheckout }) {
  const [lockState, setLockState]       = useState(null);
  const [graceDaysLeft, setGraceDays]   = useState(7);
  const [plan, setPlan]                 = useState(null);
  const [dismissed, setDismissed]       = useState(false);
  const [goingToBilling, setGoingTo]    = useState(false);

  useEffect(() => {
    if (!authFetch) return;
    authFetch(`${API_URL}/billing/subscription`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setLockState(d.lockState || null);
        setGraceDays(typeof d.graceDaysLeft === 'number' ? d.graceDaysLeft : 7);
        setPlan(d.plan);
      })
      .catch(() => {});
  }, [authFetch]);

  useEffect(() => {
    try {
      const until = localStorage.getItem(GRACE_DISMISS_KEY);
      if (until && new Date(until) > new Date()) setDismissed(true);
    } catch {}
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(
        GRACE_DISMISS_KEY,
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      );
    } catch {}
    setDismissed(true);
  }, []);

  const goToBilling = useCallback(() => {
    setGoingTo(true);
    if (lockState === 'locked' && onCheckout) {
      onCheckout(plan);
      setGoingTo(false);
    } else {
      onNavigate?.('billing');
      setTimeout(() => setDismissed(true), 200);
      setGoingTo(false);
    }
  }, [onNavigate, onCheckout, lockState, plan]);

  if (agent?.isSuperAdmin) return null;
  if (!lockState) return null;
  if (lockState === 'grace' && dismissed) return null;

  const isLocked = lockState === 'locked';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isLocked ? 'Workspace access locked' : 'Trial ended — grace period'}
      style={{
        position:        'fixed',
        inset:           0,
        zIndex:          9999,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: isLocked ? 'rgba(15,23,42,0.97)' : 'rgba(15,23,42,0.72)',
        backdropFilter:  'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          background:   '#ffffff',
          borderRadius: '24px',
          padding:      '40px 36px',
          maxWidth:     '440px',
          width:        '90%',
          boxShadow:    '0 32px 80px rgba(0,0,0,0.4)',
          textAlign:    'center',
          position:     'relative',
        }}
      >
        {/* Dismiss × — grace only */}
        {!isLocked && (
          <button
            onClick={dismiss}
            title="Remind me later"
            style={{
              position:   'absolute',
              top:        14,
              right:      14,
              background: 'none',
              border:     'none',
              cursor:     'pointer',
              color:      '#94a3b8',
              fontSize:   22,
              lineHeight: 1,
              padding:    '4px 8px',
              borderRadius: 6,
            }}
          >
            ×
          </button>
        )}

        {/* Icon */}
        <div style={{ fontSize: 52, marginBottom: 16, lineHeight: 1 }}>
          {isLocked ? '🔒' : '⏰'}
        </div>

        {/* Heading */}
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: '0 0 10px' }}>
          {isLocked ? 'Workspace Locked' : 'Trial Period Ended'}
        </h2>

        {/* Body */}
        <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.7, margin: '0 0 28px' }}>
          {isLocked
            ? 'Your free trial and 7-day grace period have both expired. Add a payment method to restore full access to your workspace immediately.'
            : `Your 14-day free trial has ended. You have ${graceDaysLeft} day${graceDaysLeft !== 1 ? 's' : ''} remaining before your workspace is locked. Subscribe now to keep everything running without interruption.`
          }
        </p>

        {/* CTA */}
        <button
          onClick={goToBilling}
          disabled={goingToBilling}
          style={{
            display:      'block',
            width:        '100%',
            padding:      '13px 20px',
            background:   'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
            color:        '#fff',
            border:       'none',
            borderRadius: 14,
            fontSize:     15,
            fontWeight:   700,
            cursor:       'pointer',
            marginBottom: isLocked ? 0 : 14,
            boxShadow:    '0 4px 18px rgba(109,40,217,0.4)',
            transition:   'opacity .15s',
            opacity:      goingToBilling ? 0.7 : 1,
          }}
        >
          {isLocked ? 'Subscribe to Restore Access' : 'Add Payment Method'}
        </button>

        {!isLocked && (
          <button
            onClick={dismiss}
            style={{
              background:   'none',
              border:       'none',
              color:        '#94a3b8',
              fontSize:     13,
              cursor:       'pointer',
              padding:      '4px 8px',
            }}
          >
            Remind me tomorrow
          </button>
        )}

        {/* Lock badge */}
        {isLocked && (
          <p style={{ marginTop: 20, fontSize: 11, color: '#94a3b8' }}>
            Plan: <strong style={{ color: '#64748b' }}>{plan || 'Trial'}</strong>
            &nbsp;·&nbsp;Contact{' '}
            <a href="mailto:support@atelier-omnicore.com" style={{ color: '#7c3aed' }}>
              support
            </a>{' '}
            if you need help.
          </p>
        )}
      </div>
    </div>
  );
}
