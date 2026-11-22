import { useState, useEffect } from 'react';
import { workspaceOffsetMs } from '@/services/workspace';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock, CheckCircle, Calendar, DollarSign, Target,
  TrendingUp, Sun, Coffee, Sunset, Lock,
  ScrollText, X, Eye, EyeOff, MessageSquare, Building2, ChevronRight,
} from 'lucide-react';
import { useSelector } from 'react-redux';
import { selectUser } from '@/store/slices/authSlice';
import { attendanceAPI, dashboardAPI } from '@/services/api';
import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { fadeUp, staggerContainer, staggerItem, cardHover, spring } from '@/motion/variants';
import AnimatedNumber from '@/motion/AnimatedNumber';

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return { text: 'Good Morning', icon: Sun };
  if (h < 17) return { text: 'Good Afternoon', icon: Coffee };
  return { text: 'Good Evening', icon: Sunset };
};

// Mon–Sun week days (full week, including Sunday)
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── PKT-anchored date helpers ────────────────────────────────────────────────
// The backend always stores attendance.date as UTC-midnight representing the
// *Pakistan* calendar day (see getBusinessDateForPunch in attendance_routes.js),
// regardless of what timezone the server or the viewing browser is in. If this
// widget instead built its day boundaries from the browser's local timezone,
// a device that isn't set to PKT would compute a slightly different "midnight"
// and silently miss the edge day of the range (e.g. Monday's record existing
// in the DB but falling just outside the query window). To avoid that, we
// mirror the backend's own +5h shift here instead of trusting the client's
// local clock/timezone.
// (Originally fixed to Pakistan time; now the workspace's time zone.)
const pktNow = () => new Date(Date.now() + workspaceOffsetMs());

// Same "calendar day, ignoring timezone" key the backend uses for record.date
const businessDateKey = (d) => {
  const x = new Date(d);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
};

const formatWorkedDuration = (checkInTime, checkOutTime) => {
  if (!checkInTime) return null;

  const startedAt = new Date(checkInTime).getTime();
  const endedAt = new Date(checkOutTime || Date.now()).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return null;

  const totalMinutes = Math.floor((endedAt - startedAt) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

// ── Rules & Policy content ──────────────────────────────────────────────────
// Edit the items below to match your actual company policy.
const RULES_SECTIONS = [
  {
    title: 'Applying for Leave',
    icon: Calendar,
    color: 'text-primary-400',
    bg: 'bg-primary-500/10',
    border: 'border-primary-500/20',
    items: [
      'Submit planned leave (casual/annual) through the Leave module at least 5 working days in advance.',
      'For sick leave, apply as early as possible and notify your manager',
      'Leave is only confirmed once it shows as Approved — do not assume approval by default.',
      'Taking leave without an approved request will be marked as unauthorized absence.',
    ],
  },
  {
    title: 'Dropping a Message When You Apply',
    icon: MessageSquare,
    color: 'text-accent-400',
    bg: 'bg-accent-500/10',
    border: 'border-accent-500/20',
    items: [
      'After submitting your leave request, drop a message to your manager and Team Lead with your name, leave dates, and reason.',
      'For emergency or same-day leave, send the message as soon as possible — even before the request is formally approved.',
      'Keep your team lead informed of any handover items or pending tasks before you go on leave.',
      'If you\u2019re unreachable during leave, mention that clearly in your message.',
    ],
  },
  {
    title: 'Office Environment',
    icon: Building2,
    color: 'text-warning-400',
    bg: 'bg-warning-500/10',
    border: 'border-warning-500/20',
    items: [
      'Working hours are According to Shift Schedule, Monday to Sunday.',
      'Maintain punctuality — repeated late check-ins may affect your performance review.',
      'Keep mobile phones on silent mode during work hours.',
      'Maintain a clean and organized workspace at your desk.',
      'Be respectful and professional in all communication with colleagues and management.',
      'Keep personal calls and breaks brief and infrequent during working hours.',
    ],
  },
];

// ── Rules & Policy Modal ────────────────────────────────────────────────────
function RulesPolicyModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-surface-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-white/5 bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex-center">
                  <ScrollText className="w-5 h-5 text-primary-400" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-white">Rules &amp; Policy</h3>
                  <p className="text-xs text-slate-500">Leave guidelines &amp; office conduct</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
           <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="overflow-y-auto px-6 py-5 space-y-5"
            >
              {RULES_SECTIONS.map((section, i) => {
                const Icon = section.icon;
                return (
                  <motion.div
                    key={section.title}
                    variants={staggerItem}
                    custom={i}
                    whileHover={{ scale: 1.01 }}
                    className={clsx('rounded-xl p-4 border', section.border, section.bg)}
                  >
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className={clsx('w-8 h-8 rounded-lg flex-center bg-surface-900/40')}>
                        <Icon className={clsx('w-4 h-4', section.color)} />
                      </div>
                      <h4 className="text-sm font-semibold text-white">{section.title}</h4>
                    </div>
                    <ul className="space-y-2">
                      {section.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-slate-300 leading-relaxed">
                          <ChevronRight className={clsx('w-3.5 h-3.5 mt-0.5 flex-shrink-0', section.color)} />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                );
              })}
            </motion.div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-white/5 bg-white/[0.02] flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="btn-primary text-xs px-5 py-2.5 rounded-xl"
              >
                Got it
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function EmployeeDashboard() {
  const user     = useSelector(selectUser);
  const greeting = getGreeting();
  const GreetIcon = greeting.icon;

  // 1. Core State Declarations
  const [assignedWorkMode, setAssignedWorkMode] = useState('office'); 
  const [checkInState, setCheckInState] = useState({ isIn: false, time: null, workMode: 'office', loading: false });
  const [elapsed,      setElapsed]      = useState('');
  const [weekRecords,  setWeekRecords]  = useState([]); 
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [salaryVisible, setSalaryVisible] = useState(false);

  // const [stats, setStats]               = useState(null);

  const [stats, setStats] = useState({
    daysPresent:       '--',
    daysAbsent:        '--',
    leaveDays:         '--',
    leaveBalance:      '--',
    usedCasual:        0,
    performanceScore:  '--',
    netSalary:         '--',
    attendancePercent: 0,
    workingDays:       0,
  });

  // ── Live timer ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!checkInState.isIn || !checkInState.time) { setElapsed(''); return; }
    const tick = () => {
      const diff = Date.now() - new Date(checkInState.time).getTime();
      const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
      const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
      const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
      setElapsed(`${h}:${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [checkInState.isIn, checkInState.time]);

  // ── Fetch today's attendance ─────────────────────────────────────────────
      useEffect(() => {
          const fetchDashboardData = async () => {
            try {
              setAttendanceLoading(true);
              
              // Call your updated backend route
              const res = await attendanceAPI.getToday(); 
              
              if (res.data?.success) {
                const record = res.data.data; 
                
                // Save the shift work mode configuration profile
                setAssignedWorkMode(res.data.assignedWorkMode || 'office');
                
                if (record?.checkIn?.time) {
                  setCheckInState({
                    isIn: !record.checkOut?.time,
                    time: record.checkIn.time,
                    workMode: record.workMode || 'office',
                    loading: false
                  });
                } else {
                  // Reset to clean default if no device or manual log exists yet today
                  setCheckInState({ isIn: false, time: null, workMode: 'office', loading: false });
                }
              }
            } catch (err) {
              console.error(err);
              toast.error("Failed to load attendance status");
            } finally {
              setAttendanceLoading(false);
            }
          };

          fetchDashboardData();
        }, []);

  const handleCheckIn = async () => {
    setCheckInState((prev) => ({ ...prev, loading: true }));
    try {
      const { data } = await attendanceAPI.checkIn({ workMode: 'remote', method: 'manual', location: { address: 'web' } });
      if (data.success) {
        setCheckInState({ isIn: true, time: data.data.checkIn.time, workMode: 'remote', loading: false });
        toast.success('Remote check-in successful');
      } else {
        throw new Error(data.message || 'Check-in failed');
      }
    } catch (error) {
      console.error('Check-in error:', error);
      toast.error(error.response?.data?.message || error.message || 'Remote check-in failed');
      setCheckInState((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleCheckOut = async () => {
    setCheckInState((prev) => ({ ...prev, loading: true }));
    try {
      const { data } = await attendanceAPI.checkOut({ method: 'manual', location: { address: 'web' } });
      if (data.success) {
        setCheckInState({ isIn: false, time: null, workMode: 'office', loading: false });
        toast.success('Remote check-out successful');
      } else {
        throw new Error(data.message || 'Check-out failed');
      }
    } catch (error) {
      console.error('Check-out error:', error);
      toast.error(error.response?.data?.message || error.message || 'Remote check-out failed');
      setCheckInState((prev) => ({ ...prev, loading: false }));
    }
  };

  // ── Fetch this week's attendance (Mon–Sun) ────────────────────────────────
  useEffect(() => {
    const nowPkt = pktNow();
    const dayOfWeek = nowPkt.getUTCDay(); // 0=Sun,1=Mon,...,6=Sat (PKT calendar day)
    const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const monday = new Date(Date.UTC(
      nowPkt.getUTCFullYear(), nowPkt.getUTCMonth(), nowPkt.getUTCDate() + diffToMon
    ));
    const sunday = new Date(Date.UTC(
      monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6, 23, 59, 59, 999
    ));

    attendanceAPI.getHistory({
      startDate: monday.toISOString(),
      endDate:   sunday.toISOString(),
      limit:     7,
    })
      .then(({ data }) => setWeekRecords(data?.data || []))
      .catch(() => setWeekRecords([]));
  }, []);

  // ── Fetch dashboard stats ─────────────────────────────────────────────────
  useEffect(() => {
    dashboardAPI.getEmployeeStats()
      .then(({ data }) => {
        const d = data.data;
        setStats({
          daysPresent:       d.daysPresent       ?? '--',
          daysAbsent:        d.daysAbsent        ?? '--',
          leaveDays:         d.leaveDays         ?? '--',
          leaveBalance:      d.leaveBalance      ?? '--',
          usedCasual:        d.usedCasual        ?? 0,
          performanceScore:  d.performanceScore  ?? '--',
          netSalary:         d.netSalary         ?? '--',
          attendancePercent: d.attendancePercent ?? 0,
          workingDays:       d.workingDays       ?? 0,
        });
      })
      .catch(() => {});
  }, []);

  // ── Quick stats ──────────────────────────────────────────────────────────
  const QUICK_STATS = [
    {
      label: 'Days Present',
      value: stats.daysPresent,
      sub:   'This month',
      icon:  CheckCircle,
      color: 'text-accent-400',
      bg:    'bg-accent-500/10',
    },
    {
      label: 'Leave Balance',
      value: stats.leaveBalance !== '--' ? Number(stats.leaveBalance) : '--',
      suffix: stats.leaveBalance !== '--' ? ' / 10' : '',
      sub:   `${stats.usedCasual} casual used`,
      icon:  Calendar,
      color: 'text-primary-400',
      bg:    'bg-primary-500/10',
    },
    {
      label: 'Performance',
      value: stats.performanceScore !== '--' ? `${stats.performanceScore}` : '--',
      sub:   'Out of 5.0',
      icon:  TrendingUp,
      color: 'text-warning-400',
      bg:    'bg-warning-500/10',
    },
    {
      label: 'Net Salary',
      value: stats.netSalary !== '--' ? `PKR ${Number(stats.netSalary).toLocaleString()}` : '--',
      sub:   'Last month',
      icon:  DollarSign,
      color: 'text-accent-400',
      bg:    'bg-accent-500/10',
      isSalary: true,

    },
  ];

  const radialData = [{ value: stats.attendancePercent, fill: '#6366f1' }];

  // ── This week — map WEEK_DAYS to real records ─────────────────────────────
  const now      = new Date();               // used only for the greeting text below
  const nowPkt   = pktNow();
  const todayJs  = nowPkt.getUTCDay();        // 0=Sun,1=Mon,...,6=Sat (PKT calendar day)
  // Convert to our WEEK_DAYS index: Mon=0 ... Sat=5, Sun=6
  const todayIdx = todayJs === 0 ? 6 : todayJs - 1;

  const getWeekDayRecord = (idx) => {
    // idx: 0=Mon ... 5=Sat, 6=Sun
    const diffToMon = todayJs === 0 ? -6 : 1 - todayJs;
    const targetDate = new Date(Date.UTC(
      nowPkt.getUTCFullYear(), nowPkt.getUTCMonth(), nowPkt.getUTCDate() + diffToMon + idx
    ));
    const targetKey = businessDateKey(targetDate);
    return weekRecords.find(r => businessDateKey(r.date) === targetKey);
  };

  const fmtTime = (t) => t ? new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : null;

  return (
    <div className="space-y-6">

            {/* ── Greeting + status badge ─────────────────────────────────────────── */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        className="flex-between flex-wrap gap-4"
      >
        <div className="flex items-center gap-3">
          <motion.div
            whileHover={{ rotate: 12, scale: 1.08 }}
            transition={spring.snappy}
            className="w-10 h-10 rounded-xl bg-warning-500/10 flex-center"
          >
            <GreetIcon className="w-5 h-5 text-warning-400" />
          </motion.div>
          <div>
            <motion.h1
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="font-display text-2xl font-bold text-white"
            >
              {greeting.text},{' '}
              <span className="text-gradient">{user?.firstName}!</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-slate-400 text-sm"
            >
              {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </motion.p>
          </div>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          <motion.div
            layout
            key={checkInState.isIn ? 'in' : 'out'}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring.snappy}
            className={clsx(
              'flex items-center gap-3 px-5 py-3 rounded-2xl font-semibold text-sm w-fit shadow-lg',
              checkInState.isIn
                ? 'bg-danger-600/60 text-white/70 shadow-danger-500/10'
                : 'bg-accent-500/40 text-white/50 shadow-accent-500/10',
            )}
          >
            <motion.div
              animate={checkInState.isIn ? { scale: [1, 1.3, 1] } : {}}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="w-2.5 h-2.5 rounded-full bg-white/60"
            />
            {checkInState.isIn ? `Checked In ${elapsed}` : 'Not Checked In'}
            <Clock className="w-4 h-4 opacity-50" />
          </motion.div>

          {assignedWorkMode === 'remote' ? (
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              type="button"
              onClick={checkInState.isIn ? handleCheckOut : handleCheckIn}
              disabled={checkInState.loading || attendanceLoading}
              className={clsx(
                'btn-primary text-xs px-3 py-2 rounded-xl',
                (checkInState.loading || attendanceLoading) ? 'opacity-60 cursor-not-allowed' : '',
              )}
            >
              {checkInState.loading || attendanceLoading
                ? 'Please wait'
                : checkInState.isIn
                  ? 'Check Out'
                  : 'Remote Check In'}
            </motion.button>
          ) : (
            !checkInState.time && (
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                className="px-4 py-2 rounded-xl bg-white/5 border border-white/5 text-[11px] text-slate-400 max-w-[200px] text-right leading-tight"
              >
                Office Shift. Please register attendance on the biometric device.
              </motion.div>
            )
          )}
        </div>
      </motion.div>

            {/* ── Quick stats ──────────────────────────────────────────────────────── */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {QUICK_STATS.map((s, i) => {
          const Icon = s.icon;
          const isHidden = s.isSalary && !salaryVisible;
          const displayValue = isHidden ? '••••••' : s.value;
          return (
            <motion.div
              key={s.label}
              variants={cardHover}
              initial="rest"
              animate="rest"
              whileHover="hover"
              whileTap="tap"
              custom={i}
              className="stat-card group hover:border-primary-500/20 transition-colors"
            >
            
              <div className="flex items-start justify-between w-full">
                <motion.div
                  whileHover={{ rotate: 8 }}
                  className={clsx('w-9 h-9 rounded-xl flex-center', s.bg)}
                >
                  <Icon className={clsx('w-4 h-4', s.color)} />
                </motion.div>
                {s.isSalary && (
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setSalaryVisible((v) => !v)}
                    className="w-7 h-7 rounded-lg flex-center text-slate-500 hover:text-slate-300 hover:bg-white/8 transition-colors"
                    title={salaryVisible ? 'Hide salary' : 'Show salary'}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {salaryVisible ? (
                        <motion.span
                          key="eye-off"
                          initial={{ opacity: 0, scale: 0.7 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.7 }}
                          transition={{ duration: 0.15 }}
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                        </motion.span>
                      ) : (
                        <motion.span
                          key="eye"
                          initial={{ opacity: 0, scale: 0.7 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.7 }}
                          transition={{ duration: 0.15 }}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                )}
              </div>
              <div>
               
                  <p className="text-2xl font-display font-bold text-white tracking-wide">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={isHidden ? 'hidden' : 'visible'}
                      initial={{ opacity: 0, filter: 'blur(4px)' }}
                      animate={{ opacity: 1, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, filter: 'blur(4px)' }}
                      transition={{ duration: 0.2 }}
                      className="inline-block"
                    >
                      {isHidden ? (
                        <span className="text-slate-500 text-lg tracking-[0.18em]">••••••</span>
                      ) : (
                        <>
                          <AnimatedNumber value={s.value} />
                          {s.suffix && <span>{s.suffix}</span>}
                        </>
                      )}
                    </motion.span>
                  </AnimatePresence>
                </p>
                <p className="text-xs text-slate-500">{s.label}</p>
                <p className="text-[10px] text-slate-600">{s.sub}</p>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Attendance ring — dynamic */}
         <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={spring.smooth}
          className="glass-card p-5 flex flex-col items-center"
        >
          <h3 className="font-semibold text-white text-sm mb-4 self-start">Monthly Attendance</h3>
          <ResponsiveContainer width="100%" height={160}>
            <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="80%"
              data={radialData} startAngle={90} endAngle={-270}>
              <RadialBar dataKey="value" cornerRadius={8}
                background={{ fill: 'rgba(255,255,255,0.04)' }} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="text-center -mt-4">
            <motion.p
              key={stats.attendancePercent}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={spring.snappy}
              className="text-3xl font-display font-bold text-white"
            >
              {stats.attendancePercent}%
            </motion.p>
            <p className="text-xs text-slate-500">Attendance Rate</p>
          </div>
          <div className="grid grid-cols-3 gap-2 w-full mt-4 pt-4 border-t border-white/5">
            {[
              { label: 'Present', value: stats.daysPresent, color: 'text-accent-400'   },
              { label: 'Absent',  value: stats.daysAbsent,  color: 'text-danger-400'   },
              { label: 'Leave',   value: stats.leaveDays,   color: 'text-warning-400'  },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="text-center"
              >
                <p className={clsx('text-base font-bold', item.color)}>
                  <AnimatedNumber value={item.value} />
                </p>
                <p className="text-[10px] text-slate-500">{item.label}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* This Week — Mon–Sat, dynamic check-in/out times */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ ...spring.smooth, delay: 0.1 }}
          className="glass-card p-5"
        >
          <h3 className="font-semibold text-white text-sm mb-4">This Week</h3>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="space-y-2"
          >
            {WEEK_DAYS.map((day, i) => {
              const isToday   = i === todayIdx;
              const isPast    = i < todayIdx;
              const isFuture  = i > todayIdx;
              const record    = getWeekDayRecord(i);

              const checkIn  = fmtTime(record?.checkIn?.time);
              const checkOut = fmtTime(record?.checkOut?.time);
              const workedDuration = formatWorkedDuration(record?.checkIn?.time, record?.checkOut?.time);

              let statusLabel = null;
              let dotColor    = 'bg-surface-700';

              if (record) {
                if (record.status === 'present' || record.status === 'work_from_home') dotColor = 'bg-accent-500';
                else if (record.status === 'late')   dotColor = 'bg-warning-500';
                else if (record.status === 'absent') dotColor = 'bg-danger-500';
                else if (record.status === 'on_leave') dotColor = 'bg-primary-500';
              }

              if (isToday)  statusLabel = <span className="badge badge-primary text-[10px]">Today</span>;
              else if (record?.status === 'on_leave') statusLabel = <span className="badge badge-warning text-[10px]">Leave</span>;
              else if (record?.status === 'absent')   statusLabel = <span className="badge badge-danger  text-[10px]">Absent</span>;

              return (
                <motion.div
                  key={day}
                  variants={staggerItem}
                  custom={i}
                  whileHover={{ x: 4 }}
                  className={clsx(
                    'flex items-center gap-3 p-2.5 rounded-xl transition-all',
                    isToday  ? 'bg-primary-500/10 border border-primary-500/20' : 'hover:bg-white/5',
                    isFuture ? 'opacity-40' : '',
                  )}
                >
                  {/* Day letter circle */}
                  <div className={clsx(
                    'w-8 h-8 rounded-lg flex-center text-xs font-semibold flex-shrink-0',
                    isPast && record  ? 'bg-accent-500/10 text-accent-400'  :
                    isToday           ? 'bg-primary-600 text-white'         :
                    isPast && !record ? 'bg-danger-500/10 text-danger-400'  :
                    'bg-surface-700 text-slate-500',
                  )}>
                    {isPast && record ? '✓' : day[0]}
                  </div>

                  {/* Day name + times */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', dotColor)} />
                      <p className={clsx('text-xs font-medium', isToday ? 'text-white' : 'text-slate-400')}>{day}</p>
                    </div>
                    {checkIn ? (
                      <p className="text-[10px] text-slate-500">
                        {checkIn}{checkOut ? ` – ${checkOut}` : ' — still in'}
                        {workedDuration && (
                          <span className="ml-1.5 font-medium text-accent-400">
                            {checkOut ? `Worked ${workedDuration}` : `Working ${workedDuration}`}
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="text-[10px] text-slate-600">
                        {isFuture ? '—' : record?.status === 'on_leave' ? 'On leave' : isPast ? 'No record' : 'Not checked in'}
                      </p>
                    )}
                  </div>

                  {statusLabel}
                </motion.div>
              );
            })}
          </motion.div>
        </motion.div>

        {/* Rules & Policy */}
                <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ ...spring.smooth, delay: 0.15 }}
          className="glass-card p-5 flex flex-col"
        >
          <div className="flex-between mb-4">
            <div className="flex items-center gap-2">
              <ScrollText className="w-4 h-4 text-primary-400" />
              <h3 className="font-semibold text-white text-sm">Rules &amp; Policy</h3>
            </div>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              type="button"
              onClick={() => setShowRulesModal(true)}
              className="flex items-center gap-1.5 text-[11px] font-medium text-primary-400 bg-primary-500/10 hover:bg-primary-500/20 border border-primary-500/20 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              View
            </motion.button>
          </div>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="space-y-2.5 flex-1"
          >
            {RULES_SECTIONS.map((section, i) => {
              const Icon = section.icon;
              return (
                <motion.button
                  key={section.title}
                  variants={staggerItem}
                  custom={i}
                  whileHover={{ x: 4, backgroundColor: 'rgba(255,255,255,0.05)' }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => setShowRulesModal(true)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl transition-colors text-left group"
                >
                  <div className={clsx('w-8 h-8 rounded-lg flex-center flex-shrink-0', section.bg)}>
                    <Icon className={clsx('w-4 h-4', section.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">{section.title}</p>
                    <p className="text-[10px] text-slate-500">{section.items.length} guidelines</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0" />
                </motion.button>
              );
            })}
          </motion.div>
        </motion.div>

      </div>

      <RulesPolicyModal open={showRulesModal} onClose={() => setShowRulesModal(false)} />
    </div>
  );
}
