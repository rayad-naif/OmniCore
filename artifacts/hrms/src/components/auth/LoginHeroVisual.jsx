import { motion } from 'framer-motion';
import {
  Users, Clock, DollarSign, Calendar, BarChart2,
  UserCheck, Shield, Zap,
} from 'lucide-react';
import { spring, staggerContainer, staggerItem } from '@/motion/variants';
import BrandMark from '@/components/common/BrandMark';
import { productName } from '@/services/brand';

// The original showed the HRMS vendor's logo video; white-label builds show
// the agency / platform logo instead.
const VIDEO_URL = '';
const USE_VIDEO_LOGO = false;

const HR_MODULES = [
  { icon: Users,      label: 'Employees',  color: 'text-primary-400', bg: 'bg-primary-500/15', border: 'border-primary-500/25', x: -130, y: -80,  delay: 0.2 },
  { icon: Clock,      label: 'Attendance', color: 'text-accent-400',  bg: 'bg-accent-500/15',  border: 'border-accent-500/25',  x:  130, y: -60,  delay: 0.35 },
  { icon: DollarSign, label: 'Payroll',    color: 'text-warning-400', bg: 'bg-warning-500/15', border: 'border-warning-500/25', x: -120, y:  90,  delay: 0.5 },
  { icon: Calendar,   label: 'Leaves',     color: 'text-danger-400',  bg: 'bg-danger-500/15',  border: 'border-danger-500/25',  x:  125, y:  75,  delay: 0.65 },
];

const WORKFLOW = [
  { icon: UserCheck, label: 'Onboard',  step: '01' },
  { icon: Clock,     label: 'Track',    step: '02' },
  { icon: BarChart2, label: 'Analyze',  step: '03' },
  { icon: Shield,    label: 'Secure',   step: '04' },
];

const STATS = [
  { value: '99.9%', label: 'Uptime' },
  { value: '100%', label: 'Performance' },
  { value: '100%', label: 'Payroll Accuracy' },
];

function CentralLogo() {
  return (
    <div className="relative w-56 h-56 flex-center">
      {/* Rotating rings */}
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-full border border-primary-500/20"
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
      />
      <motion.div
        aria-hidden
        className="absolute inset-3 rounded-full border border-dashed border-accent-500/20"
        animate={{ rotate: -360 }}
        transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
      />
      <motion.div
        aria-hidden
        className="absolute inset-6 rounded-full border border-primary-400/10"
        animate={{ scale: [1, 1.04, 1], opacity: [0.4, 0.8, 0.4] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Glow pulse — replaces the blinking box-shadow */}
      <motion.div
        aria-hidden
        className="absolute inset-8 rounded-full bg-primary-500/10 blur-2xl"
        animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Logo container */}
      <motion.div
        className="relative z-10 w-50 h-50 rounded-full overflow-hidden bg-surface-900/80 border border-white/10 shadow-3xl flex-center"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        {USE_VIDEO_LOGO ? (
          <video
            src={VIDEO_URL}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            className="w-full h-full object-contain"
            style={{ willChange: 'transform' }}
          />
        ) : (
          <BrandMark className="w-24 h-24" textClassName="text-3xl" />
        )}
      </motion.div>
    </div>
  );
}

export default function LoginHeroVisual() {
  return (
    <div className="relative flex flex-col justify-between h-full w-full">
      {/* Subtle animated grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(99,102,241,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.8) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Top brand */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring.smooth}
        className="flex items-center gap-3 relative z-10"
      >
        <motion.div
          whileHover={{ rotate: 8, scale: 1.05 }}
          className="w-12 h-12 rounded-xl overflow-hidden border border-white/10 bg-surface-800 flex-center"
        >
          <BrandMark className="w-9 h-9" />
        </motion.div>
        <div>
          <p className="font-display font-bold text-lg">
            <span className="text-white">{productName()}</span>
          </p>
          {/* <p className="text-[10px] text-slate-500 tracking-widest uppercase">AI Workforce Platform</p> */}
        </div>
      </motion.div>

      {/* Center hero */}
      <div className="relative z-10 flex flex-col items-center py-8">
        <div className="relative w-full max-w-sm h-64 flex-center">
          <CentralLogo />

          {/* Floating HRMS module cards */}
          {HR_MODULES.map((mod) => {
            const Icon = mod.icon;
            return (
              <motion.div
                key={mod.label}
                initial={{ opacity: 0, scale: 0.6, x: 0, y: 0 }}
                animate={{ opacity: 1, scale: 1, x: mod.x, y: mod.y }}
                transition={{ ...spring.smooth, delay: mod.delay }}
                className={`absolute flex items-center gap-2 px-3 py-2 rounded-xl border backdrop-blur-sm ${mod.bg} ${mod.border} shadow-lg`}
              >
                <motion.div
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 3, repeat: Infinity, delay: mod.delay, ease: 'easeInOut' }}
                  className="flex items-center gap-2"
                >
                  <Icon className={`w-3.5 h-3.5 ${mod.color}`} />
                  <span className="text-[11px] font-medium text-slate-200 whitespace-nowrap">{mod.label}</span>
                </motion.div>
              </motion.div>
            );
          })}
        </div>

        {/* Headline */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.smooth, delay: 0.3 }}
          className="text-center mt-6 max-w-lg"
        >
          <h1 className="font-display text-4xl font-bold text-white leading-tight mb-3">
            The Future of
            <br />
            <motion.span
              className="text-gradient bg-[length:200%_auto] inline-block"
              animate={{ backgroundPosition: ['0% center', '200% center'] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
            >
              Workforce Intelligence
            </motion.span>
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            Manage employees, automate payroll, track attendance, and unlock real-time HR analytics — all in one place.
          </p>
        </motion.div>

        {/* HR Workflow pipeline */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="flex items-center gap-2 mt-8 w-full max-w-md"
        >
          {WORKFLOW.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div key={step.label} variants={staggerItem} custom={i} className="flex-1 flex flex-col items-center gap-1.5">
                <motion.div
                  whileHover={{ scale: 1.08, y: -2 }}
                  className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex-center relative"
                >
                  <Icon className="w-4 h-4 text-primary-400" />
                  <span className="absolute -top-1.5 -right-1.5 text-[8px] font-bold text-slate-500 bg-surface-800 px-1 rounded">
                    {step.step}
                  </span>
                </motion.div>
                <span className="text-[10px] text-slate-500">{step.label}</span>
                {i < WORKFLOW.length - 1 && (
                  <motion.div
                    aria-hidden
                    className="absolute hidden"
                  />
                )}
              </motion.div>
            );
          })}
        </motion.div>

        {/* Connecting line under workflow */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.8, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="h-px w-full max-w-md bg-gradient-to-r from-transparent via-primary-500/40 to-transparent mt-3 origin-left"
        />

        {/* Stats row */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-3 gap-3 mt-6 w-full max-w-md"
        >
          {STATS.map((stat, i) => (
            <motion.div
              key={stat.label}
              variants={staggerItem}
              custom={i}
              whileHover={{ y: -3, borderColor: 'rgba(99,102,241,0.4)' }}
              className="glass-card p-3 text-center cursor-default"
            >
              <p className="text-lg font-display font-bold text-primary-400">{stat.value}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{stat.label}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="flex items-center justify-between relative z-10"
      >
        <p className="text-xs text-slate-600">© {new Date().getFullYear()} {productName()}</p>
        {/* <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="flex items-center gap-1.5 text-[10px] text-accent-400"
        >
          <Zap className="w-3 h-3" />
          AI-Powered
        </motion.div> */}
      </motion.div>
    </div>
  );
}