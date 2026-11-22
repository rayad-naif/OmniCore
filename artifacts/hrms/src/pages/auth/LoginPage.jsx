import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Mail, Lock, Shield, LogIn } from 'lucide-react';
import { loginUser, selectAuth, clearError } from '@/store/slices/authSlice';
import BrandMark from '@/components/common/BrandMark';
import { productName } from '@/services/brand';
import { workspaceFromUrl } from '@/services/workspace';
import { fadeUp, spring } from '@/motion/variants';
import LoginHeroVisual from '@/components/auth/LoginHeroVisual';


const schema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password required'),
});

const formContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.2 } },
};

const formItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

export default function LoginPage() {
  const dispatch = useDispatch();
  const { isLoading, error, workspaceChoices } = useSelector(selectAuth);
  const [lastCredentials, setLastCredentials] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState(null);

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    root.classList.add('dark');
    return () => { if (!hadDark) root.classList.remove('dark'); };
  }, []);

  // Employee login links carry the company: /hrms/login?w=<workspace id>.
  const onSubmit = (data) => {
    const workspace = workspaceFromUrl();
    const credentials = workspace ? { ...data, workspace } : data;
    setLastCredentials(data);
    dispatch(loginUser(credentials));
  };
  const chooseWorkspace = (workspace) => {
    if (lastCredentials) dispatch(loginUser({ ...lastCredentials, workspace }));
  };

  return (
    <div className="dark min-h-screen bg-surface-950 bg-mesh flex relative overflow-hidden">

      {/* Ambient orbs */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-24 -left-24 w-[420px] h-[420px] rounded-full bg-primary-600/20 blur-3xl"
        animate={{ x: [0, 40, 0], y: [0, 30, 0], scale: [1, 1.08, 1] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute bottom-[-8rem] left-1/3 w-[360px] h-[360px] rounded-full bg-accent-500/15 blur-3xl"
        animate={{ x: [0, -30, 0], y: [0, -25, 0], scale: [1, 1.1, 1] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute top-1/4 right-[-6rem] w-[300px] h-[300px] rounded-full bg-primary-500/15 blur-3xl"
        animate={{ x: [0, -20, 0], y: [0, 40, 0], scale: [1, 1.06, 1] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
      />

      {/* ── Left panel — HRMS Hero ── */}
      <div className="hidden lg:flex w-[48%] bg-surface-900/60 border-r border-white/5 p-10 xl:p-12 relative z-10">
        <LoginHeroVisual />
      </div>

      {/* ── Right panel — Login Form ── */}
      <div className="flex-1 flex-center p-6 lg:p-12 relative z-10">
        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={spring.smooth}
        >
          {/* Mobile logo */}
          <motion.div
            className="flex items-center gap-2 mb-8 lg:hidden"
            variants={fadeUp}
            initial="hidden"
            animate="visible"
          >
            <BrandMark className="w-9 h-9" />
            <span className="font-display font-bold text-lg text-white">{productName()}</span>
          </motion.div>

          {/* Form card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.smooth, delay: 0.1 }}
            className="glass-card p-8 border border-white/10 shadow-2xl"
          >
                        <motion.div className="mb-7" variants={fadeUp} initial="hidden" animate="visible">
              <div className="mb-4">
                <BrandMark className="w-12 h-12" textClassName="text-lg" />
              </div>
              <h2 className="font-display text-2xl font-bold text-white mb-1">Welcome back</h2>
              <p className="text-slate-400 text-sm">Sign in to your workspace</p>
            </motion.div>

            <motion.form
              onSubmit={handleSubmit(onSubmit)}
              className="space-y-5"
              variants={formContainer}
              initial="hidden"
              animate="show"
            >
              {/* Email */}
              <motion.div variants={formItem}>
                <label className="input-label">Email Address</label>
                <div className="relative">
                  <Mail className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${focusedField === 'email' ? 'text-primary-400' : 'text-slate-500'}`} />
                  <motion.input
                    {...register('email')}
                    type="email"
                    placeholder="you@company.com"
                    autoComplete="email"
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField(null)}
                    whileFocus={{ scale: 1.01 }}
                    className="input-field pl-10"
                  />
                  <AnimatePresence>
                    {focusedField === 'email' && (
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        exit={{ scaleX: 0 }}
                        className="absolute bottom-0 left-3 right-3 h-0.5 bg-gradient-to-r from-primary-500 to-accent-500 rounded-full origin-left"
                      />
                    )}
                  </AnimatePresence>
                </div>
                <AnimatePresence>
                  {errors.email && (
                    <motion.p
                      className="text-xs text-danger-400 mt-1.5"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      {errors.email.message}
                    </motion.p>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Password */}
              <motion.div variants={formItem}>
                <label className="input-label">Password</label>
                <div className="relative">
                  <Lock className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${focusedField === 'password' ? 'text-primary-400' : 'text-slate-500'}`} />
                  <motion.input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    whileFocus={{ scale: 1.01 }}
                    className="input-field pl-10 pr-10"
                  />
                  <motion.button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                    whileTap={{ scale: 0.85 }}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={showPassword ? 'hide' : 'show'}
                        initial={{ opacity: 0, rotate: -60 }}
                        animate={{ opacity: 1, rotate: 0 }}
                        exit={{ opacity: 0, rotate: 60 }}
                        transition={{ duration: 0.2 }}
                        className="flex"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>
                  <AnimatePresence>
                    {focusedField === 'password' && (
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        exit={{ scaleX: 0 }}
                        className="absolute bottom-0 left-3 right-3 h-0.5 bg-gradient-to-r from-primary-500 to-accent-500 rounded-full origin-left"
                      />
                    )}
                  </AnimatePresence>
                </div>
                <AnimatePresence>
                  {errors.password && (
                    <motion.p
                      className="text-xs text-danger-400 mt-1.5"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      {errors.password.message}
                    </motion.p>
                  )}
                </AnimatePresence>
              </motion.div>

              <motion.div className="flex items-center justify-end" variants={formItem}>
                <motion.a
                  href="/hrms/forgot-password"
                  whileHover={{ x: 2 }}
                  className="text-xs text-accent-400 hover:text-accent-300 transition-colors"
                >
                  Forgot password?
                </motion.a>
              </motion.div>

              {workspaceChoices?.length > 0 && (
                <div className="rounded-xl border border-primary-500/30 bg-primary-500/10 p-4">
                  <p className="text-sm text-slate-200 mb-3">You work for more than one company. Choose one:</p>
                  <div className="space-y-2">
                    {workspaceChoices.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => chooseWorkspace(w.id)}
                        className="w-full rounded-lg border border-white/10 bg-surface-800 px-3 py-2 text-left text-sm text-white hover:border-primary-400"
                      >
                        {w.name}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => dispatch(clearError())} className="mt-3 text-xs text-slate-400 hover:text-slate-200">
                    Cancel
                  </button>
                </div>
              )}

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, y: -8 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-danger-500/10 border border-danger-500/30 text-danger-400 text-sm px-4 py-3 rounded-xl"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

                           <motion.button
                type="submit"
                disabled={isLoading}
                className="btn-primary w-full justify-center py-3.5 text-base"
                variants={formItem}
                whileHover={!isLoading ? { scale: 1.02 } : {}}
                whileTap={!isLoading ? { scale: 0.98 } : {}}
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Authenticating...
                  </div>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    Sign in
                  </>
                )}
              </motion.button>
            </motion.form>

            {/* Trust badge */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="flex items-center justify-center mt-6 pt-5 border-t border-white/5"
            >
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <Shield className="w-3 h-3 text-primary-400" />
                Encrypted &amp; Secure
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}