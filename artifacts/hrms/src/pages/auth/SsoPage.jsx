import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ssoLogin, selectAuth } from '@/store/slices/authSlice';
import BrandMark from '@/components/common/BrandMark';
import { productName } from '@/services/brand';

const homeFor = (role) =>
  ({
    super_admin: '/dashboard/admin',
    admin: '/dashboard/admin',
    senior_manager: '/dashboard/manager',
    hr_recruiter: '/dashboard/recruiter',
  })[role] || '/dashboard/employee';

// Landing page for "Open HR" in the OmniCore dashboard: exchanges the one-time
// code for an HR session.
export default function SsoPage() {
  const [params] = useSearchParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { error } = useSelector(selectAuth);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = params.get('code');
    if (!code) return;
    // Drop the code from the address bar and history straight away.
    window.history.replaceState(null, '', '/hrms/sso');
    dispatch(ssoLogin(code)).then((res) => {
      if (res.meta.requestStatus === 'fulfilled') {
        navigate(homeFor(res.payload.user?.role), { replace: true });
      }
    });
  }, [dispatch, navigate, params]);

  return (
    <div className="dark min-h-screen bg-surface-950 flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-surface-900/80 p-8 text-center">
        <div className="flex justify-center mb-4">
          <BrandMark className="w-12 h-12" textClassName="text-lg" />
        </div>
        <h1 className="font-display text-lg font-bold text-white">{productName()}</h1>
        {error ? (
          <>
            <p className="mt-3 text-sm text-red-400">{error}</p>
            <Link to="/login" className="mt-6 inline-block text-sm text-primary-400 hover:text-primary-300">
              Sign in with email and password
            </Link>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-400">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
