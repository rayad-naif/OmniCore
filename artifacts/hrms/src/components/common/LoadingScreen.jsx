import { useEffect, useState } from 'react';
import BrandMark from '@/components/common/BrandMark';
import { productName } from '@/services/brand';
import { motion, useReducedMotion } from 'framer-motion';

// Cycles while real data loads underneath — gives the wait a sense of
// purpose instead of a blank spinner.
const STATUS_MESSAGES = [
  'Authenticating session',
  'Syncing workforce data',
  'Loading your workspace',
];

// Small dots orbiting the mark — a quiet nod to a connected team/workforce,
// this screen's signature element.
const ORBIT_NODES = [0, 1, 2, 3, 4, 5];
const ORBIT_RADIUS = 54; // px, fits inside the 128px (w-32) orbit box

export default function LoadingScreen() {
  const prefersReducedMotion = useReducedMotion();
  const [progress, setProgress] = useState(6);
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    // Climbs fast, then eases and holds just shy of 100% — real completion
    // is driven by the actual data load finishing, not this timer, so the
    // bar never claims to be done before the app actually is.
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= 96) return p;
        const step = p < 40 ? 6 : p < 75 ? 3 : 1;
        return Math.min(96, p + step);
      });
    }, 180);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setStatusIndex((i) => (i + 1) % STATUS_MESSAGES.length);
    }, 1400);
    return () => clearInterval(id);
  }, []);

  const wordmark = productName();

  return (
    <div className="min-h-screen bg-slate-950 text-white relative flex items-center justify-center overflow-hidden px-6">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(circle at 50% 42%, rgba(99,102,241,0.14), transparent 55%)' }}
      />
      {/* Faint structural grid — subtle, not decorative noise */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '42px 42px',
        }}
      />

      <div className="relative flex flex-col items-center gap-7">
        {/* Logo + orbiting network */}
        <div className="relative w-32 h-32 flex items-center justify-center">
          {!prefersReducedMotion && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'conic-gradient(from 0deg, transparent 0%, rgba(99,102,241,0.55) 18%, transparent 32%)',
                maskImage: 'radial-gradient(circle, transparent 58%, black 60%, black 64%, transparent 66%)',
                WebkitMaskImage: 'radial-gradient(circle, transparent 58%, black 60%, black 64%, transparent 66%)',
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
            />
          )}

          <motion.div
            className="absolute inset-0"
            animate={prefersReducedMotion ? {} : { rotate: 360 }}
            transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
          >
            {ORBIT_NODES.map((i) => {
              const angle = (i / ORBIT_NODES.length) * 360;
              return (
                <div
                  key={i}
                  className="absolute left-1/2 top-1/2 w-1.5 h-1.5 -ml-[3px] -mt-[3px]"
                  style={{ transform: `rotate(${angle}deg) translate(${ORBIT_RADIUS}px) rotate(-${angle}deg)` }}
                >
                  <motion.span
                    className="block w-full h-full rounded-full bg-primary-400"
                    animate={{ opacity: [0.25, 1, 0.25] }}
                    transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.25, ease: 'easeInOut' }}
                  />
                </div>
              );
            })}
          </motion.div>

          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="relative w-16 h-16 rounded-2xl bg-primary-600 flex items-center justify-center shadow-glow-primary"
          >
            {!prefersReducedMotion && (
              <motion.div
                className="absolute inset-0 rounded-2xl bg-primary-500"
                animate={{ opacity: [0, 0.5, 0], scale: [1, 1.35, 1.35] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
              />
            )}
            <span className="relative"><BrandMark className="w-8 h-8" textClassName="text-xs" /></span>
          </motion.div>
        </div>

        {/* Wordmark */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-[1px] font-display font-bold text-white text-2xl tracking-tight">
            {wordmark.split('').map((letter, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.15 + i * 0.035, ease: 'easeOut' }}
              >
                {letter}
              </motion.span>
            ))}
          </div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55, duration: 0.4 }}
            className="text-[11px] text-slate-500 mt-2 tracking-[0.2em] uppercase"
          >
            HR · Workforce Platform
          </motion.p>
        </div>

        {/* Progress bar */}
        <div className="w-56 flex flex-col items-center gap-2.5">
          <div className="w-full h-1 rounded-full bg-white/5 overflow-hidden relative">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-primary-600 via-primary-400 to-accent-400"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
            {!prefersReducedMotion && (
              <motion.div
                className="absolute inset-y-0 w-10 bg-white/25 blur-sm"
                animate={{ left: ['-10%', '110%'] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </div>

          <div className="flex items-center justify-between w-full text-[11px] text-slate-500 font-mono tabular-nums">
            <motion.span
              key={statusIndex}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              {STATUS_MESSAGES[statusIndex]}…
            </motion.span>
            <span>{progress}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}