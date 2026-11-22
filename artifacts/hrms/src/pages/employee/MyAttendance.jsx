import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Clock, CheckCircle, XCircle, TrendingUp, Wifi, ChevronLeft, ChevronRight, LogIn, LogOut, Loader2, AlertTriangle } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import clsx from 'clsx';
import { attendanceAPI } from '@/services/api';

const STATUS_MAP = {
  present:        { cls: 'badge-success', label: 'Present'  },
  late:           { cls: 'badge-warning', label: 'Late'     },
  absent:         { cls: 'badge-danger',  label: 'Absent'   },
  work_from_home: { cls: 'badge-primary', label: 'WFH'      },
  on_leave:       { cls: 'badge-warning', label: 'On Leave' },
  half_day:       { cls: 'badge-warning', label: 'Half Day' },
};

const STATUS_DOT = {
  present:        'bg-accent-400',
  late:           'bg-warning-400',
  absent:         'bg-danger-400',
  work_from_home: 'bg-primary-400',
  on_leave:       'bg-warning-400',
  half_day:       'bg-warning-400',
};

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const fmt = (isoString) => {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
};

const isSameDay = (a, b) => {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return d1.getFullYear() === d2.getFullYear()
    && d1.getMonth() === d2.getMonth()
    && d1.getDate() === d2.getDate();
};

// True when checkout lands on a different calendar day than check-in (overnight shift, e.g. 8 PM – 5 AM)
const crossesMidnight = (checkInTime, checkOutTime) => {
  if (!checkInTime || !checkOutTime) return false;
  return !isSameDay(checkInTime, checkOutTime);
};

// 95 -> "1h 35m", 40 -> "40m"
const fmtDuration = (minutes) => {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
};

// How long after the shift's scheduled end time the Check Out button should
// keep showing as "on time" before we flag it as overdue. Applies equally to
// cross-day (overnight) shifts, since duration below already wraps past midnight.
const CHECKOUT_GRACE_MINUTES = 120;

// Minutes between shift start and shift end, wrapping past midnight for
// cross-day shifts (e.g. 21:00 -> 06:00 = 540 minutes, not a negative number).
const shiftDurationMinutes = (startTime, endTime, isCrossDay) => {
  if (!startTime || !endTime) return null;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (isCrossDay || mins <= 0) mins += 24 * 60;
  return mins;
};

const PAGE_SIZE = 10;

// Custom dark-themed tooltip that shows check-in/check-out times, not just the hour count
const DailyTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  return (
    <div className="bg-surface-800 border border-white/10 rounded-xl px-3 py-2.5 text-xs min-w-[140px]">
      <p className="text-slate-300 font-semibold mb-1.5">{d.fullDate}</p>
      <p className="text-accent-400 font-medium mb-1.5">{d.hours.toFixed(1)}h worked</p>
      <div className="space-y-0.5 text-slate-400">
        <p>In: <span className="text-slate-200">{d.checkIn}</span></p>
        <p>
          Out: <span className="text-slate-200">{d.checkOut}</span>
          {d.crossesMidnight && <span className="ml-1 text-[9px] text-primary-400"></span>}
        </p>
      </div>
      {d.status && STATUS_MAP[d.status] && (
        <p className="mt-1.5 text-slate-500">{STATUS_MAP[d.status].label}</p>
      )}
    </div>
  );
};

export default function MyAttendance() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());

  const [loading, setLoading] = useState(true);
  const [stats,   setStats]   = useState({ presentDays: 0, lateDays: 0, absentDays: 0, totalHours: 0 });
  const [records, setRecords] = useState([]);
  const [page,    setPage]    = useState(1);

  // ── Remote check-in/out card state ──────────────────────────────────────
  // `today` mirrors GET /attendance/today: { data: record|null, assignedWorkMode, shiftStart, shiftEnd, isCrossDay }
  const [today,         setToday]         = useState(null);
  const [todayLoading,  setTodayLoading]  = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError,   setActionError]   = useState('');
  const [tick,          setTick]          = useState(Date.now()); // re-renders elapsed/overdue while a session is open

  const fetchStats = () => {
    setLoading(true);
    return attendanceAPI.getMyStats({ month, year })
      .then(({ data }) => {
        const d = data.data;
        setStats(d.stats);
        setRecords(d.records);
        setPage(1);
      })
      .catch(() => {
        setStats({ presentDays: 0, lateDays: 0, absentDays: 0, totalHours: 0 });
        setRecords([]);
        setPage(1);
      })
      .finally(() => setLoading(false));
  };

  const fetchToday = () => {
    setTodayLoading(true);
    return attendanceAPI.getToday()
      .then(({ data }) => setToday(data))
      .catch(() => setToday(null))
      .finally(() => setTodayLoading(false));
  };

  useEffect(() => {
    fetchStats();
     
  }, [month, year]);

  // Today's check-in/out state doesn't depend on the month/year selector —
  // fetch it once on mount and keep a live clock ticking for the elapsed /
  // overdue labels while a session is open.
  useEffect(() => {
    fetchToday();
    const clock = setInterval(() => setTick(Date.now()), 30000);
    return () => clearInterval(clock);
     
  }, []);

  const handleCheckIn = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      await attendanceAPI.checkIn({ workMode: 'remote' });
      await fetchToday();
      fetchStats();
    } catch (err) {
      setActionError(err?.response?.data?.message || 'Check-in failed. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckOut = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      await attendanceAPI.checkOut({});
      await fetchToday();
      fetchStats();
    } catch (err) {
      setActionError(err?.response?.data?.message || 'Check-out failed. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  // Live "Xh Ym elapsed" label while checked in
  const elapsedLabel = useMemo(() => {
    const rec = today?.data;
    if (!rec?.isWorking || !rec?.checkIn?.time) return null;
    const mins = Math.floor((tick - new Date(rec.checkIn.time).getTime()) / 60000);
    return fmtDuration(mins);
  }, [today, tick]);

  // True once we're more than CHECKOUT_GRACE_MINUTES past the shift's
  // scheduled end — cross-day-aware, so it doesn't misfire right at midnight.
  const isOverdue = useMemo(() => {
    const rec = today?.data;
    if (!rec?.isWorking || !rec?.checkIn?.time || !today?.shiftStart || !today?.shiftEnd) return false;
    const durationMin = shiftDurationMinutes(today.shiftStart, today.shiftEnd, today.isCrossDay);
    if (durationMin == null) return false;
    const elapsedMin = (tick - new Date(rec.checkIn.time).getTime()) / 60000;
    return elapsedMin > durationMin + CHECKOUT_GRACE_MINUTES;
  }, [today, tick]);

  const years = [now.getFullYear() - 1, now.getFullYear()];

  // Build the daily chart series straight from the records we already fetch for the table.
  const chartData = useMemo(() => {
    return records
      .slice()
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((r) => ({
        date: r.date,
        day: new Date(r.date).getDate(),
        fullDate: new Date(r.date).toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
        }),
        hours: r.totalHours || 0,
        checkIn: fmt(r.checkIn?.time),
        checkOut: fmt(r.checkOut?.time),
        crossesMidnight: crossesMidnight(r.checkIn?.time, r.checkOut?.time),
        status: r.status,
      }));
  }, [records]);

  // Thin out x-axis labels once the month has enough days that every label would overlap
  const tickInterval = chartData.length > 20 ? 1 : 0;

  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const pagedRecords = useMemo(
    () => records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [records, page]
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between flex-wrap gap-3"
      >
        <div>
          <h1 className="font-display text-2xl font-bold text-white">My Attendance</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {MONTHS[month - 1]} {year} · Personal attendance record
          </p>
        </div>

        {/* Month / Year selectors */}
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className="bg-surface-800 border border-white/10 text-slate-300 text-xs rounded-xl px-3 py-2 outline-none"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="bg-surface-800 border border-white/10 text-slate-300 text-xs rounded-xl px-3 py-2 outline-none"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </motion.div>

      {/* Remote Check In / Check Out */}
      {!todayLoading && today?.assignedWorkMode === 'remote' && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="glass-card p-5 flex items-center justify-between flex-wrap gap-4"
        >
          <div>
            <div className="flex items-center gap-1.5 text-primary-400 text-xs font-medium mb-1.5">
              <Wifi className="w-3.5 h-3.5" />
              Remote Shift · {today.shiftStart} – {today.shiftEnd}
            </div>

            {today.data?.isWorking ? (
              <p className="text-white text-sm">
                Checked in at {fmt(today.data.checkIn?.time)}
                {elapsedLabel && <span className="text-slate-400"> · {elapsedLabel} elapsed</span>}
              </p>
            ) : today.data?.isCheckedOut ? (
              <p className="text-white text-sm">
                Attendance completed · {fmt(today.data.checkIn?.time)} – {fmt(today.data.checkOut?.time)}
              </p>
            ) : (
              <p className="text-white text-sm">You haven't checked in yet</p>
            )}

            {isOverdue && (
              <p className="flex items-center gap-1 text-warning-400 text-[11px] mt-1">
                <AlertTriangle className="w-3 h-3" /> Your shift ended a while ago — don't forget to check out
              </p>
            )}
            {actionError && (
              <p className="text-danger-400 text-[11px] mt-1">{actionError}</p>
            )}
          </div>

          {today.data?.isWorking ? (
            <button
              onClick={handleCheckOut}
              disabled={actionLoading}
              className="flex items-center gap-1.5 bg-danger-500/15 hover:bg-danger-500/25 text-danger-400 text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
              Check Out
            </button>
          ) : !today.data?.isCheckedOut ? (
            <button
              onClick={handleCheckIn}
              disabled={actionLoading}
              className="flex items-center gap-1.5 bg-accent-500/15 hover:bg-accent-500/25 text-accent-400 text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              Check In
            </button>
          ) : null}
        </motion.div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Present Days',   value: loading ? '—' : stats.presentDays, icon: CheckCircle, color: 'text-accent-400',  bg: 'bg-accent-500/10'  },
          { label: 'Late Check-ins', value: loading ? '—' : stats.lateDays,    icon: Clock,       color: 'text-warning-400', bg: 'bg-warning-500/10' },
          { label: 'Absent Days',    value: loading ? '—' : stats.absentDays,  icon: XCircle,     color: 'text-danger-400',  bg: 'bg-danger-500/10'  },
          { label: 'Total Hours',    value: loading ? '—' : `${stats.totalHours}h`, icon: TrendingUp, color: 'text-primary-400', bg: 'bg-primary-500/10' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
            className="stat-card"
          >
            <div className={`w-9 h-9 rounded-xl flex-center ${s.bg}`}>
              <s.icon className={`w-4 h-4 ${s.color}`} />
            </div>
            <div>
              <p className="text-2xl font-display font-bold text-white">{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Daily Hours chart */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
        className="glass-card p-5"
      >
        <h3 className="font-semibold text-white text-sm mb-4">Daily Hours</h3>
        {loading ? (
          <div className="h-40 flex-center text-slate-500 text-xs">Loading…</div>
        ) : chartData.length === 0 ? (
          <div className="h-40 flex-center text-slate-500 text-xs">No data for this period</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval={tickInterval}
              />
              <YAxis domain={[0, 'auto']} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<DailyTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
              <Bar dataKey="hours" name="Hours" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => {
                  let fill = 'rgba(99,102,241,0.4)';
                  if (isSameDay(d.date, now)) fill = '#6366f1';
                  else if (d.status === 'absent') fill = 'rgba(239,68,68,0.45)';
                  else if (d.status === 'on_leave') fill = 'rgba(245,158,11,0.45)';
                  else if (d.hours === 0) fill = 'rgba(100,116,139,0.25)';
                  return <Cell key={i} fill={fill} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      {/* Attendance Logs */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="glass-card overflow-hidden"
      >
        <div className="p-4 border-b border-white/5 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-white text-sm">Attendance Logs</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Your check-in &amp; check-out history for {MONTHS[month - 1]} {year}
            </p>
          </div>
          {!loading && records.length > 0 && (
            <span className="text-[10px] text-slate-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, records.length)} of {records.length}
            </span>
          )}
        </div>

        {!loading && records.length > 0 && (
          <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-white/5 bg-white/[0.015]">
            {Object.entries(STATUS_MAP).map(([key, { label }]) => (
              <span key={key} className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className={clsx('w-1.5 h-1.5 rounded-full', STATUS_DOT[key])} />
                {label}
              </span>
            ))}
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-slate-500 text-xs">Loading records…</div>
        ) : records.length === 0 ? (
          <div className="p-10 text-center">
            <Clock className="w-8 h-8 text-slate-700 mx-auto mb-2" />
            <p className="text-slate-500 text-xs">No attendance records for this period</p>
            <p className="text-slate-600 text-[11px] mt-0.5">Try a different month or check back after your next check-in</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Check In</th>
                  <th>Check Out</th>
                  <th>Total Hours</th>
                  <th>Mode</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pagedRecords.map((r, i) => {
                  const dateObj = new Date(r.date);
                  const dateLabel = dateObj.toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric',
                  });
                  const weekdayLabel = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                  const isToday  = isSameDay(r.date, now);
                  const checkIn  = fmt(r.checkIn?.time);
                  const checkOut = fmt(r.checkOut?.time);
                  const mode     = r.workMode || '—';

                  return (
                    <tr key={r._id || i} className={clsx(isToday && 'bg-primary-500/[0.05]')}>
                      <td className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-300 font-medium">{dateLabel}</span>
                          <span className="text-slate-600">{weekdayLabel}</span>
                          {isToday && (
                            <span className="text-[9px] text-primary-400 bg-primary-500/10 px-1.5 py-0.5 rounded-full">
                              Today
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="text-xs">
                        <span className={checkIn === '—' ? 'text-slate-600' : 'text-slate-300'}>
                          {checkIn}
                        </span>
                        {r.status === 'late' && (
                          <span className="ml-1.5 text-[9px] text-warning-400 bg-warning-500/10 px-1.5 py-0.5 rounded-full">
                            Late{fmtDuration(r.lateMinutes) ? ` ${fmtDuration(r.lateMinutes)}` : ''}
                          </span>
                        )}
                        {r.status === 'late' && r.lateApproval && (
                          <span className={clsx('ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full',
                            r.lateApproval === 'approved'
                              ? 'text-accent-400 bg-accent-500/10'
                              : 'text-danger-400 bg-danger-500/10')}>
                            {r.lateApproval === 'approved' ? 'Approved' : 'Unapproved'}
                          </span>
                        )}
                        {r.status === 'present' && fmtDuration(r.earlyMinutes) && (
                          <span className="ml-1.5 text-[9px] text-accent-400 bg-accent-500/10 px-1.5 py-0.5 rounded-full">
                            Early {fmtDuration(r.earlyMinutes)}
                          </span>
                        )}
                      </td>

                      <td className="text-xs">
                        <span className={checkOut === '—' ? 'text-slate-600' : 'text-slate-300'}>
                          {checkOut}
                        </span>
                        {crossesMidnight(r.checkIn?.time, r.checkOut?.time) && (
                          <span className="ml-1 text-[9px] text-primary-400"></span>
                        )}
                      </td>

                      <td className="text-xs">
                        {(() => {
                          if (r.totalHours > 0) {
                            return <span className="text-accent-400">{r.totalHours.toFixed(1)}h</span>;
                          }
                          if (r.checkIn?.time && !r.checkOut?.time) {
                            const elapsed = (Date.now() - new Date(r.checkIn.time).getTime()) / 3600000;
                            return (
                              <span className="text-warning-400">
                                {elapsed.toFixed(1)}h <span className="text-[10px] text-slate-500">(live)</span>
                              </span>
                            );
                          }
                          return <span className="text-slate-600">—</span>;
                        })()}
                      </td>

                      <td className="text-xs">
                        {mode === 'remote' && (
                          <span className="flex items-center gap-1 text-primary-400 text-[11px]">
                            <Wifi className="w-3 h-3" />Remote
                          </span>
                        )}
                        {mode === 'hybrid' && (
                          <span className="flex items-center gap-1 text-warning-400 text-[11px]">
                            <Wifi className="w-3 h-3" />Hybrid
                          </span>
                        )}
                        {mode === 'office' && (
                          <span className="text-slate-400 text-[11px]">Office</span>
                        )}
                        {mode === '—' && (
                          <span className="text-slate-600 text-[11px]">—</span>
                        )}
                      </td>

                      <td>
                        {r.status in STATUS_MAP && (
                          <span className={clsx('badge text-[10px]', STATUS_MAP[r.status].cls)}>
                            {STATUS_MAP[r.status].label}
                          </span>
                        )}
                        {r.status === 'late' && fmtDuration(r.lateMinutes) && (
                          <p className="text-[10px] text-warning-400 mt-0.5">Late by {fmtDuration(r.lateMinutes)}</p>
                        )}
                        {r.status === 'late' && r.lateApproval && (
                          <span className={clsx('inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full mt-1',
                            r.lateApproval === 'approved'
                              ? 'bg-accent-500/10 text-accent-400'
                              : 'bg-danger-500/10 text-danger-400')}>
                            {r.lateApproval === 'approved' ? 'Approved' : 'Unapproved'}
                          </span>
                        )}
                        {r.status === 'present' && fmtDuration(r.earlyMinutes) && (
                          <p className="text-[10px] text-accent-400 mt-0.5">Early by {fmtDuration(r.earlyMinutes)}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-white/5"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, idx) => idx + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={clsx(
                    'min-w-[28px] h-7 px-1.5 rounded-lg text-xs font-medium transition-colors',
                    p === page
                      ? 'bg-primary-500/20 text-primary-400'
                      : 'text-slate-500 hover:text-white hover:bg-white/5'
                  )}
                >
                  {p}
                </button>
              ))}
            </div>

            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-white/5"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}