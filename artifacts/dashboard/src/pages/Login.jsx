import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Login.jsx
 * Atelier OmniCore — Agent sign-in page
 *
 * Features:
 *  - Email + password with show/hide toggle
 *  - Client-side validation before network call
 *  - Inline error display from AuthContext
 *  - Loading spinner on submit
 *  - Redirect to intended route (via location.state.from) after login
 *  - Auto-redirect if already authenticated
 */

// ─── Minimal input component ──────────────────────────────────────────────────
function Field({ id, label, type = 'text', value, onChange, error, autoComplete, suffix }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          className={`
            w-full px-4 py-2.5 rounded-xl border text-sm bg-white
            transition-shadow duration-150 outline-none
            focus:ring-2 focus:ring-violet-500 focus:border-violet-500
            placeholder:text-slate-400
            ${error ? 'border-red-400 bg-red-50' : 'border-slate-300'}
          `}
        />
        {suffix && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">
            {suffix}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
  );
}

// ─── Login page ───────────────────────────────────────────────────────────────
export default function Login() {
  const { login, isAuthenticated, isLoading: authLoading, error: authError, clearError } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();

  const [form, setForm]         = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting]   = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      const dest = location.state?.from?.pathname || '/dashboard/inbox';
      navigate(dest, { replace: true });
    }
  }, [isAuthenticated, authLoading, navigate, location]);

  const updateField = (field) => (e) => {
    clearError();
    setFieldErrors(fe => ({ ...fe, [field]: '' }));
    setForm(f => ({ ...f, [field]: e.target.value }));
  };

  function validate() {
    const errors = {};
    if (!form.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = 'Enter a valid email address';
    }
    if (!form.password) {
      errors.password = 'Password is required';
    } else if (form.password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }
    return errors;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length) { setFieldErrors(errors); return; }

    setSubmitting(true);
    try {
      await login({ email: form.email.trim(), password: form.password });
      // Navigation is handled by the useEffect above after isAuthenticated flips
    } catch {
      // Error is set in AuthContext; no additional handling needed
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Left panel — branding */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] bg-violet-700 p-12 text-white">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight">OmniCore</span>
        </div>

        {/* Hero copy */}
        <div>
          <h1 className="text-3xl font-bold leading-snug mb-4">
            Every customer conversation,<br />one intelligent platform.
          </h1>
          <p className="text-violet-200 text-sm leading-relaxed">
            AI-powered omnichannel helpdesk. Handle support across web chat,
            email, and knowledge base — all from a single agent workspace.
          </p>

          {/* Feature pills */}
          <div className="mt-8 flex flex-wrap gap-2">
            {['AI First Responder', 'Real-Time Chat', 'SLA Tracking', 'Smart Inbox'].map(f => (
              <span key={f} className="px-3 py-1 rounded-full bg-white/15 text-xs font-medium">
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Testimonial */}
        <blockquote className="border-l-2 border-white/40 pl-4">
          <p className="text-sm text-violet-100 italic leading-relaxed">
            "OmniCore cut our first-response time by 70% in the first week."
          </p>
          <footer className="mt-2 text-xs text-violet-300">— Atelier Client, 2026</footer>
        </blockquote>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
              </svg>
            </div>
            <span className="font-bold text-slate-900">OmniCore</span>
          </div>

          <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
          <p className="text-sm text-slate-500 mt-1 mb-8">Sign in to your agent workspace</p>

          {/* Global auth error */}
          {authError && (
            <div className="mb-5 flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0 mt-0.5">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <Field
              id="email"
              label="Work email"
              type="email"
              value={form.email}
              onChange={updateField('email')}
              error={fieldErrors.email}
              autoComplete="email"
            />

            <Field
              id="password"
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={updateField('password')}
              error={fieldErrors.password}
              autoComplete="current-password"
              suffix={
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="text-slate-400 hover:text-slate-600 focus:outline-none"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                    </svg>
                  )}
                </button>
              }
            />

            {/* Forgot password */}
            <div className="flex justify-end -mt-1">
              <a href="/forgot-password" className="text-xs text-violet-600 hover:text-violet-800 font-medium">
                Forgot password?
              </a>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className={`
                w-full flex items-center justify-center gap-2
                py-2.5 rounded-xl font-semibold text-sm text-white
                transition-all duration-150
                ${submitting
                  ? 'bg-violet-400 cursor-not-allowed'
                  : 'bg-violet-600 hover:bg-violet-700 active:scale-[.98] shadow-sm hover:shadow-md'}
              `}
            >
              {submitting && <Spinner />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400">or</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* SSO placeholder */}
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <p className="mt-8 text-center text-xs text-slate-400">
            Need access?{' '}
            <a href="mailto:support@iratelier.com" className="text-violet-600 hover:text-violet-800 font-medium">
              Contact your administrator
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
