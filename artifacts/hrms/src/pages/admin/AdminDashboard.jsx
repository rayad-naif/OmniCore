import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Users, DollarSign, Clock, TrendingUp,
  Briefcase, Activity, PieChart as PieIcon,
} from 'lucide-react';
import {
  AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { dashboardAPI, attendanceAPI } from '@/services/api';
import StatCard from '@/components/dashboard/StatCard';
import RecentActivity from '@/components/dashboard/RecentActivity';
import TopPerformers from '@/components/dashboard/TopPerformers';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Build last-N-months array of { month, year } going back from today */
function lastNMonths(n) {
  const result = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const target = new Date(d.getFullYear(), d.getMonth() - i, 1);
    result.push({ month: target.getMonth() + 1, year: target.getFullYear() });
  }
  return result;
}

function calendarYearMonths(year) {
  return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year }));
}

/**
 * /attendance/report returns:
 *   stats: [{ _id: 'present'|'late'|'absent'|'on_leave', count, avgHours }]
 * Transform to: { month: 'Jul', present, late, absent, onLeave }
 */
function transformReportData(monthYear, stats) {
  const find = (status) => stats.find(s => s._id === status)?.count ?? 0;
  return {
    month:   MONTH_LABELS[monthYear.month - 1],
    present: find('present') + find('work_from_home'),
    late:    find('late'),
    absent:  find('absent'),
    onLeave: find('on_leave'),
  };
}

const fmtTime = (t) => t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

// 95 -> "1h 35m", 40 -> "40m"
const fmtDuration = (minutes) => {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
};
const fmtCurrency = (n) => {
  if (!n) return '—';
  return new Intl.NumberFormat('en-PK', { 
    style: 'currency', 
    currency: 'PKR',
    maximumFractionDigits: 0 
  }).format(n);
};

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay },
});

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-800 border border-white/10 rounded-xl px-4 py-3 shadow-xl">
      <p className="text-xs text-slate-400 mb-2">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-xs font-medium" style={{ color: p.color }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
};

const CustomPayrollTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-800 border border-white/10 rounded-xl px-4 py-3 shadow-xl">
      <p className="text-xs text-slate-400 mb-2">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-xs font-medium" style={{ color: p.color }}>
          {p.name}: {fmtCurrency(p.value)}
        </p>
      ))}
    </div>
  );
};

// ─── Status badge ─────────────────────────────────────────────────────────────
const STATUS_STYLES = {
  present:  { dot: 'bg-accent-400',   text: 'text-accent-400',   label: 'Present'  },
  late:     { dot: 'bg-warning-400',  text: 'text-warning-400',  label: 'Late'     },
  absent:   { dot: 'bg-danger-400',   text: 'text-danger-400',   label: 'Absent'   },
  on_leave: { dot: 'bg-primary-400',  text: 'text-primary-400',  label: 'On Leave' },
  remote:   { dot: 'bg-slate-400',    text: 'text-slate-400',    label: 'Remote'   },
  working:   { dot: 'bg-lime-400',    text: 'text-lime-800',    label: 'Working'   },

};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.absent;
  return (
    <span className={`flex items-center gap-1 text-[10px] font-medium ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ─── Live Attendance Table ────────────────────────────────────────────────────
const PAGE_SIZE = 10;

function LiveAttendanceTable({ employees, stats, loading }) {
  const [filter,      setFilter]      = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  // Reset to page 1 when filter changes
  const handleFilter = (key) => {
    setFilter(key);
    setCurrentPage(1);
  };

  const filtered = filter === 'all'
    ? employees
    : employees.filter(e =>
        e.status === filter ||
        (filter === 'remote' && (e.mode === 'remote' || e.mode === 'hybrid'))
      );

  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated   = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const filters = [
    { key: 'all',      label: 'All',      count: stats?.total    ?? 0 },
    { key: 'present',  label: 'Present',  count: stats?.present  ?? 0 },
    { key: 'late',     label: 'Late',     count: stats?.late     ?? 0 },
    { key: 'absent',   label: 'Absent',   count: stats?.absent   ?? 0 },
    { key: 'on_leave', label: 'On Leave', count: stats?.on_leave ?? 0 },
    { key: 'remote',   label: 'Remote',   count: stats?.remote   ?? 0 },
    { key: 'working',   label: 'Working',   count: stats?.working   ?? 0 },
  ];

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/5 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h3 className="font-semibold text-white text-sm">Live Attendance</h3>
          <p className="text-xs text-slate-500 mt-0.5">Today · real-time</p>
        </div>
        {/* Filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => handleFilter(f.key)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                filter === f.key
                  ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent'
              }`}
            >
              {f.label} <span className="ml-0.5 opacity-70">({f.count})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="py-10 text-center text-slate-500 text-sm">Loading attendance…</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-slate-500 text-sm">No records found.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Hours</th>
                <th>Mode</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((emp) => {
                const hours = emp.liveHours !== null
                  ? emp.liveHours.toFixed(1)
                  : emp.hours > 0
                  ? emp.hours.toFixed(1)
                  : null;

                return (
                  <tr key={emp.userId}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary-500/20 flex items-center justify-center text-[10px] font-bold text-primary-400 flex-shrink-0 overflow-hidden">
                          {emp.avatar
                            ? <img src={emp.avatar} alt="" className="w-full h-full object-cover" />
                            : emp.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-slate-200">{emp.name}</p>
                          <p className="text-[10px] text-slate-500">{emp.employeeId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-xs text-slate-400">{emp.dept}</td>
                    <td className="text-xs text-slate-300">{fmtTime(emp.checkIn)}</td>
                    <td className="text-xs text-slate-300">{fmtTime(emp.checkOut)}</td>
                    <td className="text-xs">
                      {hours ? (
                        <span className={emp.liveHours !== null ? 'text-accent-400' : 'text-slate-300'}>
                          {hours}h
                          {emp.liveHours !== null && (
                            <span className="ml-0.5 text-[9px] text-accent-500 animate-pulse">●</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="text-xs">
                      <span className={`text-[10px] capitalize ${
                        emp.mode === 'remote' ? 'text-primary-400'
                        : emp.mode === 'hybrid' ? 'text-warning-400'
                        : 'text-slate-400'
                      }`}>
                        {emp.mode === '—' ? '—' : emp.mode}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={emp.status} />
                      {emp.status === 'late' && emp.lateMinutes > 0 && (
                        <p className="text-[10px] text-warning-400 mt-0.5">
                          Late by {fmtDuration(emp.lateMinutes)}
                        </p>
                      )}
                      {emp.status === 'late' && emp.lateApproval && (
                        <span className={`inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full mt-1 ${
                          emp.lateApproval === 'approved'
                            ? 'bg-accent-500/10 text-accent-400'
                            : 'bg-danger-500/10 text-danger-400'
                        }`}>
                          {emp.lateApproval === 'approved' ? 'Approved' : 'Unapproved'}
                        </span>
                      )}
                      {(emp.status === 'present' || emp.status === 'working') && emp.earlyMinutes > 0 && (
                        <p className="text-[10px] text-accent-400 mt-0.5">
                          Early by {fmtDuration(emp.earlyMinutes)}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination footer ── */}
      {!loading && filtered.length > PAGE_SIZE && (
        <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between">
          {/* Result count */}
          <p className="text-[11px] text-slate-500">
            Showing{' '}
            <span className="text-slate-300 font-medium">
              {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)}
            </span>
          </p>
          {/* Nav buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 rounded-lg text-xs font-medium border border-white/10 text-slate-400 hover:text-slate-300 hover:bg-white/5 disabled:opacity-50 transition-colors"
            >
              ← Prev
            </button>
            <span className="text-[11px] text-slate-500">
              Page <span className="font-medium text-slate-300">{currentPage}</span> of{' '}
              <span className="font-medium text-slate-300">{totalPages}</span>
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 rounded-lg text-xs font-medium border border-white/10 text-slate-400 hover:text-slate-300 hover:bg-white/5 disabled:opacity-50 transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [dashStats,       setDashStats]       = useState(null);
  const [attendanceTrend, setAttendanceTrend] = useState([]);
  const [liveData,        setLiveData]        = useState({ stats: null, employees: [] });
  const [loading,         setLoading]         = useState({ stats: true, trend: true, live: true });

  // ── 1. Dashboard stat cards (with attendance, employees on leave, depts, payroll trend) ───
  useEffect(() => {
    dashboardAPI.getAdminStats()
      .then(({ data }) => setDashStats(data.data))
      .catch((err) => console.error('Failed to load dashboard stats:', err))
      .finally(() => setLoading(p => ({ ...p, stats: false })));
  }, []);

  // ── 2. Attendance trend — calendar-year Jan–Dec /attendance/report calls ──────
  useEffect(() => {
    const year = new Date().getFullYear();
    const months = calendarYearMonths(year);
    Promise.allSettled(
      months.map(m => attendanceAPI.getReport({ month: m.month, year: m.year }))
    ).then(results => {
      const trend = results.map((r, i) => {
        const stats = r.status === 'fulfilled' ? (r.value.data?.data?.stats ?? []) : [];
        return transformReportData(months[i], stats);
      });
      setAttendanceTrend(trend);
    }).finally(() => setLoading(p => ({ ...p, trend: false })));
  }, []);

  // ── 3. Live attendance for today ──────────────────────────────────────────────
  useEffect(() => {
    attendanceAPI.getAdminToday()
      .then(({ data }) => setLiveData({ stats: data.data.stats, employees: data.data.employees }))
      .catch(() => {})
      .finally(() => setLoading(p => ({ ...p, live: false })));
  }, []);

  // ── Stat card definitions ─────────────────────────────────────────────────────
  const STATS = [
    {
      label:    'Total Employees',
      value:    loading.stats ? '…' : (dashStats?.totalEmployees?.toLocaleString() ?? '—'),
      change:   null, up: true, // (the original showed a fixed '+12%')
      icon:     Users,
      color:    'text-primary-400', bg: 'bg-primary-500/10',
    },
    {
      label:    'Employees Absent Today',
      value:    loading.live ? '…' : (liveData.stats?.absent?.toLocaleString() ?? '—'),
      change:   null,
      icon:     Users,
      color:    'text-danger-400',  bg: 'bg-danger-500/10',
    },
    {
      label:    'Employees Present Today',
      value:    loading.stats ? '…' : (dashStats?.presentToday?.toLocaleString() ?? '—'),
      change:   null,
      icon:     Clock,
      color:    'text-warning-400', bg: 'bg-warning-500/10',
    },
    {
      label:    'Employees on Leave',
      value:    loading.stats ? '…' : (dashStats?.employeesOnLeave?.toLocaleString() ?? '—'),
      change:   null,
      icon:     Briefcase,
      color:    'text-danger-400',  bg: 'bg-danger-500/10',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <motion.div {...fadeUp(0)} className="flex-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">Admin dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-accent-400 bg-accent-500/10 border border-accent-500/20 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 bg-accent-400 rounded-full animate-pulse" />
            Live · Real-time
          </span>
        </div>
      </motion.div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {STATS.map((stat, i) => (
          <motion.div key={stat.label} {...fadeUp(i * 0.08)}>
            <StatCard {...stat} loading={loading.stats} />
          </motion.div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Attendance trend — LIVE */}
        <motion.div {...fadeUp(0.2)} className="xl:col-span-2 glass-card p-5">
          <div className="flex-between mb-5">
            <div>
              <h3 className="font-semibold text-white text-sm">Attendance Trend</h3>
              <p className="text-xs text-slate-500 mt-0.5">Last 12 months</p>
            </div>
            <Activity className="w-4 h-4 text-primary-400" />
          </div>
          {loading.trend ? (
            <div className="h-[200px] flex items-center justify-center text-slate-500 text-sm">Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={attendanceTrend}>
                <defs>
                  <linearGradient id="gPresent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gAbsent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gLate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gOnLeave" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="present" stroke="#6366f1" fill="url(#gPresent)" strokeWidth={2} name="Present" />
                <Area type="monotone" dataKey="late"    stroke="#f59e0b" fill="url(#gLate)"    strokeWidth={2} name="Late" />
                <Area type="monotone" dataKey="absent"  stroke="#ef4444" fill="url(#gAbsent)"  strokeWidth={2} name="Absent" />
                <Area type="monotone" dataKey="onLeave" stroke="#3b82f6" fill="url(#gOnLeave)" strokeWidth={2} name="On Leave" />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', color: '#94a3b8', paddingTop: '8px' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        {/* Dept. Distribution — DYNAMIC from API ───────────────────────────────*/}
        <motion.div {...fadeUp(0.25)} className="glass-card p-5">
          <div className="flex-between mb-5">
            <div>
              <h3 className="font-semibold text-white text-sm">Dept. Distribution</h3>
              <p className="text-xs text-slate-500 mt-0.5">Employee count by department</p>
            </div>
            <PieIcon className="w-4 h-4 text-accent-400" />
          </div>
          {loading.stats ? (
            <div className="h-[160px] flex items-center justify-center text-slate-500 text-sm">Loading…</div>
          ) : dashStats?.departmentDistribution?.length ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie 
                    data={dashStats.departmentDistribution} 
                    cx="50%" cy="50%" innerRadius={50} outerRadius={75} 
                    paddingAngle={3} dataKey="value"
                  >
                    {dashStats.departmentDistribution.map((entry, i) => 
                      <Cell key={i} fill={entry.color} stroke="transparent" />
                    )}
                  </Pie>
                  <Tooltip
                    formatter={(v) => `${v} employees`}
                    contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#f8fafc', fontSize: '12px' }}
                    labelStyle={{ color: '#f8fafc' }}
                    itemStyle={{ color: '#cbd5e1' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-1.5 mt-3">
                {dashStats.departmentDistribution.map((d) => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    <span className="text-[10px] text-slate-400 truncate">{d.name}</span>
                    <span className="text-[10px] text-slate-500 ml-auto">{d.value}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-slate-500 text-sm">No data</div>
          )}
        </motion.div>
      </div>

      {/* Payroll + Activity + Performers */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Payroll Disbursed — 6 month graph from API */}
        <motion.div {...fadeUp(0.3)} className="glass-card p-5">
          <div className="flex-between mb-5">
            <div>
              <h3 className="font-semibold text-white text-sm">Payroll Disbursed</h3>
              <p className="text-xs text-slate-500 mt-0.5">Jan to Dec</p>
            </div>
            <DollarSign className="w-4 h-4 text-warning-400" />
          </div>
          {loading.stats ? (
            <div className="h-[180px] flex items-center justify-center text-slate-500 text-sm">Loading…</div>
          ) : dashStats?.payrollTrend?.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dashStats.payrollTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis 
                  tick={{ fill: '#64748b', fontSize: 11 }} 
                  axisLine={false} 
                  tickLine={false}
                  tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`}
                />
                <Tooltip content={<CustomPayrollTooltip />} />
                <Bar dataKey="net" name="Net Salary" fill="#6366f1" radius={[4, 4, 0, 0]} />
                {/* <Bar dataKey="gross" name="Gross Earnings" fill="#10b981" radius={[4, 4, 0, 0]} /> */}
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', color: '#94a3b8', paddingTop: '8px' }} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-slate-500 text-sm">No data</div>
          )}
        </motion.div>

        <motion.div {...fadeUp(0.35)} className="glass-card p-5">
          <RecentActivity />
        </motion.div>

        <motion.div {...fadeUp(0.4)} className="glass-card p-5">
          <TopPerformers />
        </motion.div>
      </div>

      {/* Live attendance table */}
      <motion.div {...fadeUp(0.45)}>
        <LiveAttendanceTable
          employees={liveData.employees}
          stats={liveData.stats}
          loading={loading.live}
        />
      </motion.div>
    </div>
  );
}
