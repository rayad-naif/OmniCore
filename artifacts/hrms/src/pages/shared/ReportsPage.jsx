import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart2, Download, FileText, Users, Clock, DollarSign, X, Calendar, Loader2, AlertCircle, Wallet, Landmark, TrendingUp, Receipt } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { downloadStyledExcel, downloadStyledExcelMulti } from '../../services/excelExport';
import api from '../../services/api';

// Only 4 reports visible (Recruitment & Performance hidden per requirement)
const REPORTS = [
  {
    key: 'headcount',
    icon: Users,
    title: 'Headcount Report',
    desc: 'Total employees by dept, role & status',
    color: 'text-primary-400',
    bg: 'bg-primary-500/10',
    hasDateRange: false,
  },
  {
    key: 'attendance',
    icon: Clock,
    title: 'Attendance Report',
    desc: 'Monthly attendance summary with trends',
    color: 'text-accent-400',
    bg: 'bg-accent-500/10',
    hasDateRange: true,
  },
  {
    key: 'payroll',
    icon: DollarSign,
    title: 'Payroll Summary',
    desc: 'Salary disbursement and deductions breakdown',
    color: 'text-warning-400',
    bg: 'bg-warning-500/10',
    hasDateRange: true,
  },
  {
    key: 'leave',
    icon: FileText,
    title: 'Leave Analytics',
    desc: 'Leave utilization and balance report',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    hasDateRange: true,
  },
  {
    key: 'advances',
    icon: Wallet,
    title: 'Advances Report',
    desc: 'Salary advance requests and deduction status',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    hasDateRange: true,
  },
  {
    key: 'loans',
    icon: Landmark,
    title: 'Loan Report',
    desc: 'Employee loans, EMI schedule & outstanding balances',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    hasDateRange: true,
  },
  {
    key: 'earnings',
    icon: TrendingUp,
    title: 'Earnings Report',
    desc: 'Business revenue & commission income by person',
    color: 'text-teal-400',
    bg: 'bg-teal-500/10',
    hasDateRange: true,
  },
  {
    key: 'expenses',
    icon: Receipt,
    title: 'Expense Report',
    desc: 'Business expenses by category & payer',
    color: 'text-rose-400',
    bg: 'bg-rose-500/10',
    hasDateRange: true,
  },
];

// ─── Date-range modal ────────────────────────────────────────────────────────
function DateRangeModal({ report, onClose, onConfirm }) {
  const today = new Date().toISOString().split('T')[0];
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .split('T')[0];

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const [error, setError] = useState('');

  const handleConfirm = () => {
    if (!startDate || !endDate) { setError('Please select both dates.'); return; }
    if (startDate > endDate) { setError('Start date must be before end date.'); return; }
    onConfirm({ startDate, endDate });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="glass-card w-full max-w-sm p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary-400" />
            <h2 className="text-white font-semibold text-sm">{report.title}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-slate-400 text-xs">Select the date range to generate the report.</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Start Date</label>
            <input
              type="date"
              value={startDate}
              max={today}
              onChange={e => { setStartDate(e.target.value); setError(''); }}
              className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">End Date</label>
            <input
              type="date"
              value={endDate}
              max={today}
              onChange={e => { setEndDate(e.target.value); setError(''); }}
              className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-xs">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary text-xs flex-1 justify-center">Cancel</button>
          <button onClick={handleConfirm} className="btn-primary text-xs flex-1 justify-center">
            Generate Report
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Report data modal (preview + export) ───────────────────────────────────
function ReportDataModal({ report, data, dateRange, onClose }) {
  const [exporting, setExporting] = useState(false);

  const exportToExcel = async () => {
    if (!data || !data.rows || data.rows.length === 0) return;
    setExporting(true);
    try {
      const rangeLabel = dateRange?.startDate
        ? `${dateRange.startDate} → ${dateRange.endDate}`
        : 'As of today';
      const filename = `${report.title.replace(/\s+/g, '_')}_${dateRange?.startDate || 'latest'}_to_${dateRange?.endDate || 'now'}.xlsx`;
      await downloadStyledExcel(report.title, rangeLabel, data.rows, filename);
    } finally {
      setExporting(false);
    }
  };

  const headers = data?.rows?.length > 0 ? Object.keys(data.rows[0]) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="glass-card w-full max-w-3xl p-6 space-y-4 max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between flex-shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">{report.title}</h2>
            <p className="text-slate-400 text-xs mt-0.5">
              {dateRange.startDate} → {dateRange.endDate}
              {data?.summary && (
                <span className="ml-2 text-slate-500">· {data.rows?.length ?? 0} records</span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors ml-4">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Summary cards */}
        {data?.summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-shrink-0">
            {Object.entries(data.summary).map(([k, v]) => (
              <div key={k} className="bg-slate-800/50 rounded-xl p-3">
                <p className="text-[10px] text-slate-500 capitalize">{k.replace(/_/g, ' ')}</p>
                <p className="text-white font-semibold text-sm mt-0.5">{v}</p>
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        <div className="overflow-auto flex-1 rounded-xl border border-white/5">
          {headers.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900/90 backdrop-blur-sm">
                <tr>
                  {headers.map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-slate-400 font-medium capitalize whitespace-nowrap">
                      {h.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={i} className="border-t border-white/5 hover:bg-white/2 transition-colors">
                    {headers.map(h => (
                      <td key={h} className="px-3 py-2.5 text-slate-300 whitespace-nowrap">
                        {row[h] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
              No records found for this date range.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 flex-shrink-0 pt-1">
          <button onClick={onClose} className="btn-secondary text-xs">Close</button>
          <button
            onClick={exportToExcel}
            disabled={!data?.rows?.length || exporting}
            className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Preparing...
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                Export Excel
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [dateModal, setDateModal] = useState(null);      // report object
  const [dataModal, setDataModal] = useState(null);      // { report, data, dateRange }
  const [loading, setLoading] = useState(null);          // report key
  const [fetchError, setFetchError] = useState(null);

  // Dashboard summary charts
  const [growth, setGrowth] = useState([]);
  const [deptDist, setDeptDist] = useState([]);
  const [chartsLoading, setChartsLoading] = useState(true);

  const DEPT_COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#64748b'];

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/reports/summary');
        if (res.data?.data?.growth) setGrowth(res.data.data.growth);
        if (res.data?.data?.deptDist) setDeptDist(res.data.data.deptDist);
      } catch {
        // fallback: charts stay empty — not a blocking error
      } finally {
        setChartsLoading(false);
      }
    })();
  }, []);

  const handleReportClick = (report) => {
    if (report.hasDateRange) {
      setDateModal(report);
    } else {
      // Headcount has no date range, fetch directly
      fetchReport(report, null);
    }
  };

  const fetchReport = async (report, dateRange) => {
    setLoading(report.key);
    setFetchError(null);
    try {
      const params = dateRange ? { startDate: dateRange.startDate, endDate: dateRange.endDate } : {};
      const res = await api.get(`/reports/${report.key}`, { params });
      setDataModal({ report, data: res.data.data, dateRange: dateRange || {} });
    } catch (err) {
      setFetchError(err.response?.data?.message || 'Failed to fetch report. Please try again.');
    } finally {
      setLoading(null);
    }
  };

  const handleDateConfirm = (dateRange) => {
    const report = dateModal;
    setDateModal(null);
    fetchReport(report, dateRange);
  };

  const [exportingAll, setExportingAll] = useState(false);

  const exportAllExcel = async () => {
    setExportingAll(true);
    try {
      const sheetsConfig = [];
      for (const r of REPORTS) {
        try {
          const res = await api.get(`/reports/${r.key}`);
          const rows = res.data?.data?.rows;
          if (rows?.length) {
            sheetsConfig.push({
              reportTitle: r.title,
              dateRangeLabel: r.hasDateRange ? 'All available records' : 'As of today',
              rows,
            });
          }
        } catch {
          // one report failing shouldn't block the rest from exporting
        }
      }
      if (sheetsConfig.length) {
        await downloadStyledExcelMulti(
          sheetsConfig,
          `HRMS_All_Reports_${new Date().toISOString().split('T')[0]}.xlsx`
        );
      }
    } finally {
      setExportingAll(false);
    }
  };

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Reports & Analytics</h1>
          <p className="text-slate-400 text-sm mt-0.5">Company-wide insights and data exports</p>
        </div>
        <button onClick={exportAllExcel} disabled={exportingAll} className="btn-primary text-xs disabled:opacity-60 disabled:cursor-not-allowed">
          {exportingAll ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Preparing...
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5" />
              Export All
            </>
          )}
        </button>
      </motion.div>

      {fetchError && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {fetchError}
          <button onClick={() => setFetchError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="glass-card p-5">
          <h3 className="font-semibold text-white text-sm mb-4">Headcount Growth</h3>
          {chartsLoading ? (
            <div className="flex items-center justify-center h-[180px]">
              <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
            </div>
          ) : growth.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={growth}>
                <defs>
                  <linearGradient id="gEmp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '11px' }} />
                <Area type="monotone" dataKey="employees" name="Employees" stroke="#6366f1" fill="url(#gEmp)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-slate-500 text-sm">No data available</div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="glass-card p-5">
          <h3 className="font-semibold text-white text-sm mb-3">Department Distribution</h3>
          {chartsLoading ? (
            <div className="flex items-center justify-center h-[150px]">
              <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
            </div>
          ) : deptDist.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={150}>
                <PieChart>
                  <Pie data={deptDist} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={2} dataKey="value">
                    {deptDist.map((e, i) => (
                      <Cell key={i} fill={e.fill || DEPT_COLORS[i % DEPT_COLORS.length]} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '11px' }}
                    formatter={(value, name, props) => [`${props.payload.count} employee${props.payload.count === 1 ? '' : 's'} (${value}%)`, props.payload.name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {deptDist.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.fill || DEPT_COLORS[i % DEPT_COLORS.length] }} />
                    <span className="text-[11px] text-slate-400 flex-1 truncate">{d.name}</span>
                    <span className="text-[11px] text-slate-500">{d.count} · {d.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[150px] text-slate-500 text-sm">No data available</div>
          )}
        </motion.div>
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {REPORTS.map((r, i) => (
          <motion.div
            key={r.key}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.06 }}
            className="glass-card-hover p-4"
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl flex-center flex-shrink-0 ${r.bg}`}>
                <r.icon className={`w-5 h-5 ${r.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">{r.title}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{r.desc}</p>
                {r.hasDateRange && (
                  <p className="text-[10px] text-slate-600 mt-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Select date range to view data
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4">
              <button
                onClick={() => handleReportClick(r)}
                disabled={loading === r.key}
                className="btn-primary text-xs w-full justify-center disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading === r.key ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <BarChart2 className="w-3.5 h-3.5" />
                    {r.hasDateRange ? 'View & Export' : 'View Report'}
                  </>
                )}
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {dateModal && (
          <DateRangeModal
            report={dateModal}
            onClose={() => setDateModal(null)}
            onConfirm={handleDateConfirm}
          />
        )}
        {dataModal && (
          <ReportDataModal
            report={dataModal.report}
            data={dataModal.data}
            dateRange={dataModal.dateRange}
            onClose={() => setDataModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}