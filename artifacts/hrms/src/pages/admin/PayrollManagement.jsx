import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DollarSign, Download, CheckCircle, TrendingUp,
  Users, AlertCircle, X, Loader2, Play, AlertTriangle, CreditCard, Trash2, Info,
  Banknote, TrendingDown, ShieldCheck, Clock, Star, Gift, ChevronRight, Percent,
  History, Award, ChevronDown, ChevronLeft, Lock, Calendar, Pencil,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { advanceAPI, loanAPI, performanceBonusAPI, employeeAPI } from '@/services/api';
import clsx from 'clsx';
import * as XLSX from 'xlsx';
import { payrollAPI } from '@/services/api';
import LoanSetupModal from '@/pages/shared/LoanSetupModal';
import toast from 'react-hot-toast';

// ─── Constants ────────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const PAYROLL_STATUS_MAP = {
  draft:            { cls: 'badge-neutral', label: 'Unpaid'   },
  pending_approval: { cls: 'badge-warning', label: 'Unpaid'   },
  approved:         { cls: 'badge-success', label: 'Paid'     },
  processed:        { cls: 'badge-success', label: 'Paid'     },
  paid:             { cls: 'badge-success', label: 'Paid'     },
  cancelled:        { cls: 'badge-danger',  label: 'Cancelled'},
};

const ADVANCE_STATUS_MAP = {
  pending:   { cls: 'badge-warning', label: 'Pending'   },
  approved:  { cls: 'badge-primary', label: 'Approved'  },
  rejected:  { cls: 'badge-danger',  label: 'Rejected'  },
  deducted:  { cls: 'badge-success', label: 'Deducted'  },
  cancelled: { cls: 'badge-neutral', label: 'Cancelled' },
};

const HOLD_STATUS = {
  not_clear: { cls: 'badge-warning', label: 'Not Clear' },
  clear:     { cls: 'badge-success', label: 'Clear'     },
};

// AFTER
const EARNING_FIELDS = [
  ['basicSalary',         'Basic Salary'         ],
  // ['houseRentAllowance',  'HRA'                ],
  // ['conveyanceAllowance', 'Conveyance'         ],
  // ['medicalAllowance',    'Medical Allowance'  ],
  ['performanceBonus',    'Performance Bonus'    ],
  ['releasedHoldAmount',  'Released Hold Amount' ],
  // ['overtimePay',         'Overtime Pay'       ],
  // ['specialAllowance',    'Special Allowance'  ],
  // ['otherEarnings',       'Other Earnings'     ],
];

const DEDUCTION_FIELDS = [
  // ['providentFund',          'Provident Fund'   ],
  // ['employeeStateInsurance', 'ESI'              ],
  // ['professionalTax',        'Professional Tax' ],
  // ['incomeTax',              'Income Tax (TDS)' ],
  ['advanceDeductions',      'Advance Salary'   ],
  ['loanDeductions',         'Loan Deductions'  ],
  ['absentDeductions',       'Absent Deductions'],
  ['salaryHoldDeduction', 'Salary Hold Deduction'],

  // ['otherDeductions',        'Other Deductions' ],
];

const fmt = (n) => `PKR ${(n || 0).toLocaleString()}`;
const initials = (name) => name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?';

// ─── Run Payroll Modal ────────────────────────────────────────────────────────
// ─── Run Payroll Modal ────────────────────────────────────────────────────────
function RunPayrollModal({ month, year, onClose, onSuccess }) {
  const [employees,       setEmployees]       = useState([]);
  const [selected,        setSelected]        = useState(new Set());
  const [loading,         setLoading]         = useState(true);
  const [running,         setRunning]         = useState(false);
  const [result,          setResult]          = useState(null);
  const [search,          setSearch]          = useState('');
  // ── Approve-all state ──────────────────────────────────────────────────────
  const [approving,       setApproving]       = useState(false);
  const [approveProgress, setApproveProgress] = useState({ done: 0, total: 0 });
  const [approveErrors,   setApproveErrors]   = useState([]);
  const [allApproved,     setAllApproved]     = useState(false);

  useEffect(() => {
    payrollAPI.getEligible({ month: month + 1, year })
      .then(({ data }) => {
        const employees = data?.data || [];
        setEmployees(employees);
        const preselect = new Set(
          employees.filter(e => !e.existingStatus).map(e => e._id.toString())
        );
        setSelected(preselect);
      })
      .catch(() => setEmployees([]))
      .finally(() => setLoading(false));
  }, [month, year]);

  const filteredEmps = useMemo(() => {
    const q = search.toLowerCase();
    return employees.filter(e =>
      !q || e.name.toLowerCase().includes(q) || e.employeeId?.toLowerCase().includes(q)
    );
  }, [employees, search]);

  const toggleAll = () => {
    const eligible = filteredEmps.filter(e => !['approved','paid','processed'].includes(e.existingStatus));
    if (eligible.every(e => selected.has(e._id.toString()))) {
      const next = new Set(selected);
      eligible.forEach(e => next.delete(e._id.toString()));
      setSelected(next);
    } else {
      const next = new Set(selected);
      eligible.forEach(e => next.add(e._id.toString()));
      setSelected(next);
    }
  };

  const toggleOne = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handleRun = async () => {
    if (!selected.size) return;
    setRunning(true);
    try {
      const { data } = await payrollAPI.run({
        employeeIds: [...selected],
        month: month + 1,
        year,
      });
      setResult(data);
    } catch (err) {
      setResult({ error: err.response?.data?.message || 'Payroll run failed' });
    } finally {
      setRunning(false);
    }
  };

  // ── Approve all created/updated payrolls in one go ─────────────────────────
  const handleApproveAll = async () => {
    const toApprove = [
      ...(result.data?.created || []),
      ...(result.data?.updated || []),
    ];
    if (!toApprove.length) return;

    setApproving(true);
    setApproveProgress({ done: 0, total: toApprove.length });
    const errors = [];

    for (const record of toApprove) {
      try {
        await payrollAPI.approve(record._id);
      } catch (err) {
        errors.push(err.response?.data?.message || `Failed: ${record._id}`);
      }
      setApproveProgress(prev => ({ ...prev, done: prev.done + 1 }));
    }

    setApproveErrors(errors);
    setApproving(false);
    setAllApproved(true);
  };

  const handleDone = () => {
    onSuccess();
    onClose();
  };

  const approveTotal = (result?.data?.created?.length || 0) + (result?.data?.updated?.length || 0);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget && !running && !approving) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="p-5 border-b border-white/5 flex items-center justify-between flex-shrink-0">
            <div>
              <h2 className="font-display font-bold text-white text-base">
                Run Payroll — {MONTHS[month]} {year}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {running
                  ? `Calculating payroll for ${selected.size} employee${selected.size !== 1 ? 's' : ''}…`
                  : result
                  ? 'Payroll created — review and approve below'
                  : 'Select active employees to calculate and save payroll'}
              </p>
            </div>
            <button onClick={onClose} disabled={running || approving}
              className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors disabled:opacity-40">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── RUNNING: full-screen loading animation ── */}
          {running ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 space-y-6">
              {/* Spinner */}
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-full border-4 border-primary-500/15" />
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Play className="w-6 h-6 text-primary-400" />
                </div>
              </div>

              {/* Label */}
              <div className="text-center space-y-1.5">
                <p className="text-sm font-semibold text-white">Calculating Payroll…</p>
                <p className="text-xs text-slate-400">
                  Processing {selected.size} employee{selected.size !== 1 ? 's' : ''} — this may take a moment
                </p>
              </div>

              {/* Bouncing dots */}
              <div className="flex items-center gap-1.5">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full bg-primary-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.18}s` }}
                  />
                ))}
              </div>

              {/* Employee chips (only shown if ≤10 selected) */}
              {selected.size <= 10 && (
                <div className="flex flex-wrap justify-center gap-1.5 max-w-sm">
                  {employees
                    .filter(e => selected.has(e._id.toString()))
                    .map(e => (
                      <span key={e._id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-500/10 border border-primary-500/20 text-[10px] text-primary-300">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        {e.name}
                      </span>
                    ))}
                </div>
              )}
            </div>

          ) : result ? (
            /* ── RESULT: stats + approve-all ── */
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {result.error ? (
                <div className="p-4 bg-danger-500/10 border border-danger-500/20 rounded-xl text-danger-400 text-sm">
                  {result.error}
                </div>
              ) : (
                <>
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Created', value: result.data?.created?.length ?? 0, color: 'text-accent-400',  bg: 'bg-accent-500/10'  },
                      { label: 'Updated', value: result.data?.updated?.length ?? 0, color: 'text-primary-400', bg: 'bg-primary-500/10' },
                      { label: 'Errors',  value: result.data?.errors?.length  ?? 0, color: 'text-danger-400',  bg: 'bg-danger-500/10'  },
                    ].map(s => (
                      <div key={s.label} className={`rounded-xl p-4 text-center ${s.bg}`}>
                        <p className={`text-2xl font-display font-bold ${s.color}`}>{s.value}</p>
                        <p className="text-xs text-slate-400 mt-1">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 text-center">{result.message}</p>

                  {/* Errors list */}
                  {result.data?.errors?.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Errors</p>
                      {result.data.errors.map((e, i) => (
                        <div key={i} className="flex items-start gap-2 p-2.5 bg-danger-500/5 border border-danger-500/15 rounded-lg">
                          <AlertTriangle className="w-3.5 h-3.5 text-danger-400 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-slate-300">{e.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Approve All block ── */}
                  {approveTotal > 0 && (
                    <div className={`rounded-xl border p-4 space-y-3 ${allApproved ? 'bg-accent-500/10 border-accent-500/20' : 'bg-white/5 border-white/10'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg flex-shrink-0 ${allApproved ? 'bg-accent-500/15' : 'bg-primary-500/10'}`}>
                          {allApproved
                            ? <CheckCircle className="w-4 h-4 text-accent-400" />
                            : <ShieldCheck className="w-4 h-4 text-primary-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white">
                            {allApproved ? 'All Payrolls Approved' : 'Approve All Payrolls'}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {allApproved
                              ? `${approveTotal - approveErrors.length} approved${approveErrors.length ? `, ${approveErrors.length} failed` : ' successfully'}`
                              : `${approveTotal} payroll record${approveTotal !== 1 ? 's' : ''} ready — approve them all at once`}
                          </p>
                        </div>
                      </div>

                      {/* Progress bar while approving */}
                      {approving && (
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[10px] text-slate-400">
                            <span>Approving payrolls…</span>
                            <span>{approveProgress.done} / {approveProgress.total}</span>
                          </div>
                          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary-500 rounded-full transition-all duration-300"
                              style={{ width: `${approveProgress.total > 0 ? (approveProgress.done / approveProgress.total) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Approve button */}
                      {!allApproved && !approving && (
                        <button
                          onClick={handleApproveAll}
                          className="btn-primary w-full justify-center text-xs"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Approve All {approveTotal} Payroll{approveTotal !== 1 ? 's' : ''}
                        </button>
                      )}

                      {/* Approve errors */}
                      {allApproved && approveErrors.length > 0 && (
                        <div className="space-y-1">
                          {approveErrors.map((e, i) => (
                            <div key={i} className="flex items-start gap-2 p-2 bg-danger-500/5 border border-danger-500/15 rounded-lg">
                              <AlertTriangle className="w-3 h-3 text-danger-400 flex-shrink-0 mt-0.5" />
                              <p className="text-[10px] text-slate-400">{e}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              <button onClick={handleDone} className="btn-primary w-full justify-center text-xs">
                <CheckCircle className="w-3.5 h-3.5" />Done — View Payroll
              </button>
            </div>

          ) : (
            /* ── SELECTION: employee list ── */
            <>
              {/* Search + select-all */}
              <div className="p-4 border-b border-white/5 flex items-center gap-3 flex-shrink-0">
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search employees…"
                  className="input-field py-2 text-xs flex-1" />
                <button onClick={toggleAll}
                  className="btn-secondary text-xs whitespace-nowrap">
                  {filteredEmps.filter(e => !['approved','paid','processed'].includes(e.existingStatus))
                    .every(e => selected.has(e._id.toString()))
                    ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {/* Employee list */}
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="p-10 text-center text-slate-500 text-sm">Loading employees…</div>
                ) : filteredEmps.length === 0 ? (
                  <div className="p-10 text-center text-slate-500 text-sm">No active employees found</div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {filteredEmps.map(emp => {
                      const id        = emp._id.toString();
                      const locked    = ['approved','paid','processed'].includes(emp.existingStatus);
                      const isChecked = selected.has(id);

                      return (
                        <div
                          key={id}
                          onClick={() => !locked && toggleOne(id)}
                          className={clsx(
                            'flex items-center gap-3 px-4 py-3 transition-colors',
                            locked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-white/3',
                            isChecked && !locked && 'bg-primary-500/5',
                          )}
                        >
                          {/* Checkbox */}
                          <div className={clsx(
                            'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
                            locked ? 'border-white/10 bg-white/5'
                              : isChecked ? 'bg-primary-600 border-primary-600'
                              : 'border-white/20 hover:border-white/40',
                          )}>
                            {(isChecked || locked) && (
                              <CheckCircle className="w-2.5 h-2.5 text-white" />
                            )}
                          </div>

                          {/* Avatar */}
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500/30 to-accent-500/30 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-bold text-white">{initials(emp.name)}</span>
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-white truncate">{emp.name}</p>
                            <p className="text-[10px] text-slate-500">{emp.employeeId} · {emp.dept}</p>
                          </div>

                          {/* Salary */}
                          <div className="text-right flex-shrink-0">
                            {emp.basicSalary > 0 ? (
                              <p className="text-xs font-medium text-slate-200">{fmt(emp.basicSalary)}</p>
                            ) : (
                              <p className="text-xs text-warning-400 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />No salary
                              </p>
                            )}
                            <p className="text-[10px] text-slate-500">basic</p>
                          </div>

                          {/* Existing status badge */}
                          {emp.existingStatus && (
                            <span className={clsx('badge text-[10px] flex-shrink-0', PAYROLL_STATUS_MAP[emp.existingStatus]?.cls)}>
                              {PAYROLL_STATUS_MAP[emp.existingStatus]?.label}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-white/5 flex items-center justify-between flex-shrink-0">
                <p className="text-xs text-slate-400">
                  <span className="text-white font-medium">{selected.size}</span> employee{selected.size !== 1 ? 's' : ''} selected
                </p>
                <div className="flex gap-2">
                  <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
                  <button
                    onClick={handleRun}
                    disabled={!selected.size || running}
                    className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <Play className="w-3.5 h-3.5" />Run Payroll
                  </button>
                </div>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Payslip Modal ────────────────────────────────────────────────────────────
function PayslipModal({ record, onClose, onApprove }) {
  const [approving, setApproving] = useState(false);
  const emp  = record.employee;
  const name = emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown';

  const handleApprove = async () => {
    setApproving(true);
    try { await onApprove(record._id); onClose(); }
    finally { setApproving(false); }
  };

  const handleExport = () => {
    const rows = [
      { Item: 'Employee',    Value: name },
      { Item: 'Employee ID', Value: emp?.employeeId || '—' },
      { Item: 'Department',  Value: emp?.department?.name || '—' },
      { Item: 'Period',      Value: `${MONTHS[(record.payPeriod?.month || 1) - 1]} ${record.payPeriod?.year}` },
      { Item: '─── Earnings ───', Value: '' },
      ...EARNING_FIELDS.map(([k, l]) => ({ Item: l, Value: record.earnings?.[k] || 0 })),
      { Item: 'Gross Earnings',   Value: record.grossEarnings   || 0 },
      { Item: '─── Deductions ───', Value: '' },
      ...DEDUCTION_FIELDS.map(([k, l]) => ({ Item: l, Value: record.deductions?.[k] || 0 })),
      { Item: 'Total Deductions', Value: record.totalDeductions || 0 },
      { Item: 'Net Take-Home',    Value: record.netSalary       || 0 },
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 24 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Payslip');
    XLSX.writeFile(wb, `payslip_${emp?.employeeId}_${record.payPeriod?.month}_${record.payPeriod?.year}.xlsx`);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="font-display font-bold text-white">
                Payslip — {MONTHS[(record.payPeriod?.month || 1) - 1]} {record.payPeriod?.year}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {emp?.employeeId} · {emp?.department?.name || '—'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleExport} className="btn-secondary text-xs flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" />Export
              </button>
              <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Employee */}
          <div className="flex items-center gap-3 p-3 bg-primary-500/10 border border-primary-500/20 rounded-xl mb-5">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-white">{initials(name)}</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">{name}</p>
              <p className="text-xs text-slate-400">{emp?.department?.name || '—'}</p>
            </div>
            <span className={clsx('badge text-[10px]', PAYROLL_STATUS_MAP[record.status]?.cls)}>
              {PAYROLL_STATUS_MAP[record.status]?.label}
            </span>
          </div>

          {/* Attendance summary */}
          {/* {record.attendanceSummary && (
            <div className="grid grid-cols-4 gap-2 mb-5">
              {[
                { label: 'Working',  value: record.attendanceSummary.totalWorkingDays },
                { label: 'Present',  value: record.attendanceSummary.presentDays      },
                { label: 'Absent',   value: record.attendanceSummary.absentDays       },
                { label: 'Leaves',   value: record.attendanceSummary.leaveDays        },
              ].map(s => (
                <div key={s.label} className="bg-white/5 rounded-xl p-2.5 text-center">
                  <p className="text-sm font-bold text-white">{s.value ?? 0}</p>
                  <p className="text-[10px] text-slate-500">{s.label}</p>
                </div>
              ))}
            </div>
          )} */}

          {/* Earnings */}
          <div className="space-y-1 mb-4">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Earnings</p>
            {EARNING_FIELDS.filter(([k]) => (record.earnings?.[k] || 0) > 0).map(([k, l]) => (
              <div key={k} className="flex justify-between text-xs py-1.5 border-b border-white/5">
                <span className="text-slate-400">{l}</span>
                <span className="text-slate-200">{fmt(record.earnings?.[k])}</span>
              </div>
            ))}
            <div className="flex justify-between text-xs py-2 font-bold">
              <span className="text-white">Gross Earnings</span>
              <span className="text-primary-400">{fmt(record.grossEarnings)}</span>
            </div>
          </div>

          {/* Deductions */}
          <div className="space-y-1 mb-5">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Deductions</p>
            {DEDUCTION_FIELDS.filter(([k]) => (record.deductions?.[k] || 0) > 0).map(([k, l]) => (
              <div key={k} className="flex justify-between text-xs py-1.5 border-b border-white/5">
                <span className="text-slate-400">{l}</span>
                <span className="text-danger-400">-{fmt(record.deductions?.[k])}</span>
              </div>
            ))}
            <div className="flex justify-between text-xs py-2 font-bold">
              <span className="text-white">Total Deductions</span>
              <span className="text-danger-400">-{fmt(record.totalDeductions)}</span>
            </div>
          </div>

          {/* Net */}
          <div className="flex justify-between items-center p-4 bg-accent-500/10 border border-accent-500/20 rounded-xl mb-4">
            <span className="font-bold text-white">Net Take-Home</span>
            <span className="text-2xl font-display font-bold text-accent-400">{fmt(record.netSalary)}</span>
          </div>

          {['draft','pending_approval'].includes(record.status) && (
            <button onClick={handleApprove} disabled={approving}
              className="btn-primary w-full justify-center text-xs disabled:opacity-60">
              {approving
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Approving…</>
                : <><CheckCircle className="w-3.5 h-3.5" />Approve Payroll</>}
            </button>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
// ─── Edit Payroll Modal ────────────────────────────────────────────────────────
// Lets an admin rectify a mistake on an already-created payroll record
// (wrong bonus amount, wrong deduction, typo in remarks, etc.) without having
// to delete and re-run the whole thing.
function EditPayrollModal({ record, onClose, onSaved }) {
  const emp  = record.employee;
  const name = emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown';
  const locked = ['paid'].includes(record.status);

  const [earnings, setEarnings] = useState(() => {
    const e = {};
    EARNING_FIELDS.forEach(([k]) => { e[k] = record.earnings?.[k] ?? 0; });
    return e;
  });
  const [deductions, setDeductions] = useState(() => {
    const d = {};
    DEDUCTION_FIELDS.forEach(([k]) => { d[k] = record.deductions?.[k] ?? 0; });
    return d;
  });
  const [remarks, setRemarks] = useState(record.remarks || '');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  // Rough live preview only — the server recalculates the authoritative
  // gross/total/net figures (and factors in fields not shown in this form,
  // like releasedHoldAmount) when the save actually happens.
  const grossPreview = Object.values(earnings).reduce((s, v) => s + (Number(v) || 0), 0)
    + (record.earnings?.releasedHoldAmount || 0);
  const deductionsPreview = Object.values(deductions).reduce((s, v) => s + (Number(v) || 0), 0);
  const netPreview = grossPreview - deductionsPreview;

  const setEarning   = (k, v) => setEarnings(prev => ({ ...prev, [k]: v }));
  const setDeduction = (k, v) => setDeductions(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        earnings:   Object.fromEntries(Object.entries(earnings).map(([k, v]) => [k, Number(v) || 0])),
        deductions: Object.fromEntries(Object.entries(deductions).map(([k, v]) => [k, Number(v) || 0])),
        remarks,
      };
      const { data } = await payrollAPI.update(record._id, payload);
      onSaved(data?.data || { ...record, ...payload });
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update payroll record');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="p-5 border-b border-white/5 flex items-start justify-between flex-shrink-0">
            <div>
              <h3 className="font-display font-bold text-white text-base">Edit Payroll</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {name} · {emp?.employeeId} · {MONTHS[(record.payPeriod?.month || 1) - 1]} {record.payPeriod?.year}
              </p>
            </div>
            <button onClick={onClose} disabled={saving}
              className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors disabled:opacity-40 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          {locked ? (
            <div className="p-5">
              <div className="flex items-start gap-2 p-3 bg-warning-500/10 border border-warning-500/20 rounded-lg">
                <AlertTriangle className="w-3.5 h-3.5 text-warning-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-warning-300">
                  This payroll has already been marked <strong>Paid</strong> and can no longer be edited. Delete and re-run it instead if it needs correcting.
                </p>
              </div>
              <button onClick={onClose} className="btn-secondary w-full justify-center text-xs mt-4">Close</button>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* Earnings */}
                <div className="space-y-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Earnings</p>
                  {EARNING_FIELDS.map(([k, l]) => (
                    <div key={k} className="flex items-center justify-between gap-3">
                      <label className="text-xs text-slate-400">{l}</label>
                      <input
                        type="number"
                        value={earnings[k]}
                        onChange={e => setEarning(k, e.target.value)}
                        className="input-field py-1.5 text-xs w-32 text-right"
                      />
                    </div>
                  ))}
                </div>

                {/* Deductions */}
                <div className="space-y-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Deductions</p>
                  {DEDUCTION_FIELDS.map(([k, l]) => (
                    <div key={k} className="flex items-center justify-between gap-3">
                      <label className="text-xs text-slate-400">{l}</label>
                      <input
                        type="number"
                        value={deductions[k]}
                        onChange={e => setDeduction(k, e.target.value)}
                        className="input-field py-1.5 text-xs w-32 text-right"
                      />
                    </div>
                  ))}
                </div>

                {/* Remarks */}
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-1.5">Remarks</label>
                  <textarea
                    value={remarks}
                    onChange={e => setRemarks(e.target.value)}
                    rows={2}
                    placeholder="Reason for this correction…"
                    className="input-field py-2 text-xs w-full resize-none"
                  />
                </div>

                {/* Live preview */}
                <div className="rounded-xl bg-white/5 p-3 space-y-1">
                  <div className="flex justify-between text-xs"><span className="text-slate-400">Gross Earnings</span><span className="text-primary-400">{fmt(grossPreview)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-slate-400">Total Deductions</span><span className="text-danger-400">-{fmt(deductionsPreview)}</span></div>
                  <div className="flex justify-between text-xs font-bold pt-1 border-t border-white/10"><span className="text-white">Net (estimated)</span><span className="text-accent-400">{fmt(netPreview)}</span></div>
                </div>

                {error && (
                  <div className="flex items-start gap-2 p-3 bg-danger-500/10 border border-danger-500/20 rounded-lg">
                    <AlertTriangle className="w-3.5 h-3.5 text-danger-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-danger-400">{error}</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-white/5 flex justify-end gap-2 flex-shrink-0">
                <button onClick={onClose} disabled={saving} className="btn-secondary text-xs">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-40">
                  {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</> : <><CheckCircle className="w-3.5 h-3.5" />Save Changes</>}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Advance Modal ────────────────────────────────────────────────────────────
function AdvanceModal({ onClose }) {
  const [employees,    setEmployees]    = useState([]);
  const [selectedEmp,  setSelectedEmp]  = useState(null);
  const [summary,      setSummary]      = useState(null);
  const [amount,       setAmount]       = useState('');
  const [reason,       setReason]       = useState('');
  const [advanceDate,  setAdvanceDate]  = useState(() => new Date().toISOString().slice(0, 10));
  const [search,       setSearch]       = useState('');
  const [loadingEmps,  setLoadingEmps]  = useState(true);
  const [loadingSum,   setLoadingSum]   = useState(false);
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState('');
  const [successMsg,   setSuccessMsg]   = useState('');
  const [tab,          setTab]          = useState('grant'); // 'grant' | 'history'
  const [history,      setHistory]      = useState([]);
  const [loadingHist,  setLoadingHist]  = useState(false);
  const [cancelling,   setCancelling]   = useState(null);

  // Load all active employees
    useEffect(() => {
      const now = new Date();
      payrollAPI.getEligible({ month: now.getMonth() + 1, year: now.getFullYear() })
        .then(({ data }) => setEmployees(data?.data || []))
        .catch(() => setEmployees([]))
        .finally(() => setLoadingEmps(false));
    }, []);

  // When employee selected, fetch their advance summary
  useEffect(() => {
    if (!selectedEmp) { setSummary(null); return; }
    setLoadingSum(true);
    setError('');
    setSuccessMsg('');
    setAmount('');
    setAdvanceDate(new Date().toISOString().slice(0, 10));
    advanceAPI.getSummary(selectedEmp._id)
      .then(({ data }) => setSummary(data?.data))
      .catch(() => setSummary(null))
      .finally(() => setLoadingSum(false));
  }, [selectedEmp]);

  // Load advance history for selected employee
  useEffect(() => {
    if (!selectedEmp || tab !== 'history') return;
    setLoadingHist(true);
    advanceAPI.getAll({ employeeId: selectedEmp._id, limit: 50 })
      .then(({ data }) => setHistory(data?.data || []))
      .catch(() => setHistory([]))
      .finally(() => setLoadingHist(false));
  }, [selectedEmp, tab]);

  const filteredEmps = useMemo(() => {
    const q = search.toLowerCase();
    return employees.filter(e =>
      !q || e.name.toLowerCase().includes(q) || e.employeeId?.toLowerCase().includes(q)
    );
  }, [employees, search]);

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Please enter a valid amount'); return; }
    if (!selectedEmp)     { setError('Please select an employee'); return; }
    if (!advanceDate)     { setError('Please select the advance date'); return; }

    setError('');
    setSubmitting(true);
    try {
      await advanceAPI.create({
        employeeId:  selectedEmp._id,
        amount:      amt,
        reason:      reason.trim(),
        advanceDate,
      });
      setSuccessMsg(`✓ Advance of ${fmt(amt)} granted to ${selectedEmp.name}`);
      setAmount('');
      setReason('');
      setAdvanceDate(new Date().toISOString().slice(0, 10));
      // Refresh summary
      const { data } = await advanceAPI.getSummary(selectedEmp._id);
      setSummary(data?.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to grant advance');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (advanceId) => {
    setCancelling(advanceId);
    try {
      await advanceAPI.cancel(advanceId);
      setHistory(prev => prev.map(a => a._id === advanceId ? { ...a, status: 'cancelled' } : a));
      // Refresh summary
      const { data } = await advanceAPI.getSummary(selectedEmp._id);
      setSummary(data?.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to cancel advance');
    } finally {
      setCancelling(null);
    }
  };

  const ADVANCE_STATUS = {
    pending:   { cls: 'badge-warning', label: 'Pending'   },
    approved:  { cls: 'badge-primary', label: 'Approved'  },
    rejected:  { cls: 'badge-danger',  label: 'Rejected'  },
    deducted:  { cls: 'badge-success', label: 'Deducted'  },
    cancelled: { cls: 'badge-neutral', label: 'Cancelled' },
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] flex overflow-hidden shadow-2xl"
        >
          {/* ── Left panel — employee list ─────────────────────────────────── */}
          <div className="w-64 border-r border-white/5 flex flex-col flex-shrink-0">
            <div className="p-4 border-b border-white/5">
              <h2 className="font-display font-bold text-white text-sm">Advance Salary</h2>
              <p className="text-[10px] text-slate-400 mt-0.5">Select employee</p>
            </div>
            <div className="p-3 border-b border-white/5">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                className="input-field py-1.5 text-xs w-full"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingEmps ? (
                <div className="p-4 text-center text-slate-500 text-xs">Loading…</div>
              ) : filteredEmps.map(emp => (
                <button
                  key={emp._id}
                  onClick={() => { setSelectedEmp(emp); setTab('grant'); setError(''); setSuccessMsg(''); }}
                  className={clsx(
                    'w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors border-b border-white/3',
                    selectedEmp?._id === emp._id
                      ? 'bg-primary-500/15 border-l-2 border-l-primary-500'
                      : 'hover:bg-white/5',
                  )}
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500/30 to-accent-500/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-white">{initials(emp.name)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white truncate">{emp.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{emp.dept}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Right panel ───────────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Header */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
              <div>
                {selectedEmp ? (
                  <>
                    <p className="text-sm font-semibold text-white">{selectedEmp.name}</p>
                    <p className="text-[10px] text-slate-400">{selectedEmp.employeeId} · {selectedEmp.dept}</p>
                  </>
                ) : (
                  <p className="text-sm text-slate-400">Select an employee on the left</p>
                )}
              </div>
              <button onClick={onClose}
                className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {!selectedEmp ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-600">
                <CreditCard className="w-10 h-10" />
                <p className="text-sm">Select an employee to manage advances</p>
              </div>
            ) : (
              <>
                {/* Tabs */}
                <div className="flex border-b border-white/5 flex-shrink-0">
                  {[['grant','Grant Advance'],['history','History']].map(([key, label]) => (
                    <button key={key} onClick={() => setTab(key)}
                      className={clsx(
                        'px-4 py-2.5 text-xs font-medium transition-colors border-b-2',
                        tab === key
                          ? 'text-primary-400 border-primary-500'
                          : 'text-slate-500 border-transparent hover:text-slate-300',
                      )}>
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {tab === 'grant' ? (
                    <>
                      {/* Salary guard info */}
                      {loadingSum ? (
                        <div className="text-slate-500 text-xs text-center py-4">Checking advance limit…</div>
                      ) : summary && (
                        <div className="bg-white/5 rounded-xl p-4 space-y-3">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Advance Summary</p>

                          {/* Visual bar */}
                          <div>
                            <div className="flex justify-between text-[10px] text-slate-400 mb-1.5">
                              <span>Used: {fmt(summary.totalPending)}</span>
                              <span>Limit: {fmt(summary.basicSalary)}</span>
                            </div>
                            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                              <div
                                className={clsx(
                                  'h-full rounded-full transition-all',
                                  summary.totalPending >= summary.basicSalary
                                    ? 'bg-danger-500'
                                    : summary.totalPending > summary.basicSalary * 0.7
                                    ? 'bg-warning-500'
                                    : 'bg-accent-500',
                                )}
                                style={{ width: `${Math.min(100, (summary.totalPending / summary.basicSalary) * 100)}%` }}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { label: 'Basic Salary',     value: fmt(summary.basicSalary),   color: 'text-white'         },
                              { label: 'Pending Advance',  value: fmt(summary.totalPending),  color: 'text-warning-400'   },
                              { label: 'Still Available',  value: fmt(summary.remaining),     color: summary.remaining > 0 ? 'text-accent-400' : 'text-danger-400' },
                            ].map(s => (
                              <div key={s.label} className="bg-white/5 rounded-lg p-2.5 text-center">
                                <p className={`text-sm font-bold ${s.color}`}>{s.value}</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
                              </div>
                            ))}
                          </div>

                          {!summary.canTakeAdvance && (
                            <div className="flex items-center gap-2 p-2.5 bg-danger-500/10 border border-danger-500/20 rounded-lg">
                              <AlertTriangle className="w-3.5 h-3.5 text-danger-400 flex-shrink-0" />
                              <p className="text-xs text-danger-400">
                                This employee has reached their advance limit (equal to basic salary). Previous advances must be deducted via payroll first.
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Grant form */}
                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1.5">
                            Advance Amount
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">PKR</span>
                            <input
                              type="number"
                              value={amount}
                              onChange={e => { setAmount(e.target.value); setError(''); setSuccessMsg(''); }}
                              placeholder="0.00"
                              min="1"
                              max={summary?.remaining || 999999}
                              className="input-field pl-9 py-2.5 text-sm w-full"
                              disabled={!summary?.canTakeAdvance}
                            />
                          </div>
                          {summary?.remaining > 0 && (
                            <p className="text-[10px] text-slate-500 mt-1">
                              Maximum: {fmt(summary.remaining)}
                            </p>
                          )}
                        </div>

                        <div>
                          <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1.5">
                            Advance Date
                          </label>
                          <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                            <input
                              type="date"
                              value={advanceDate}
                              onChange={e => { setAdvanceDate(e.target.value); setError(''); setSuccessMsg(''); }}
                              className="input-field pl-9 py-2.5 text-sm w-full"
                              disabled={!summary?.canTakeAdvance}
                            />
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1">
                            Date the employee takes the advance
                          </p>
                        </div>

                        <div>
                          <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1.5">
                            Reason <span className="text-slate-600 normal-case">(optional)</span>
                          </label>
                          <textarea
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="Medical emergency, personal need, etc."
                            rows={2}
                            className="input-field py-2 text-xs w-full resize-none"
                            disabled={!summary?.canTakeAdvance}
                          />
                        </div>

                        {/* Info note */}
                        <div className="flex items-start gap-2 p-3 bg-primary-500/5 border border-primary-500/15 rounded-lg">
                          <Info className="w-3.5 h-3.5 text-primary-400 flex-shrink-0 mt-0.5" />
                          <p className="text-[10px] text-slate-400">
                            This advance will be automatically deducted from the employee's next payroll run under <span className="text-white">Loan Deductions</span>.
                          </p>
                        </div>

                        {error && (
                          <div className="flex items-start gap-2 p-3 bg-danger-500/10 border border-danger-500/20 rounded-lg">
                            <AlertTriangle className="w-3.5 h-3.5 text-danger-400 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-danger-400">{error}</p>
                          </div>
                        )}

                        {successMsg && (
                          <div className="flex items-center gap-2 p-3 bg-accent-500/10 border border-accent-500/20 rounded-lg">
                            <CheckCircle className="w-3.5 h-3.5 text-accent-400 flex-shrink-0" />
                            <p className="text-xs text-accent-400">{successMsg}</p>
                          </div>
                        )}

                        <button
                          onClick={handleSubmit}
                          disabled={submitting || !amount || !advanceDate || !summary?.canTakeAdvance}
                          className="btn-primary w-full justify-center text-xs disabled:opacity-40"
                        >
                          {submitting
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Granting…</>
                            : <><CreditCard className="w-3.5 h-3.5" />Grant Advance</>}
                        </button>
                      </div>
                    </>
                  ) : (
                    /* History tab */
                    <div>
                      {loadingHist ? (
                        <div className="py-8 text-center text-slate-500 text-xs">Loading history…</div>
                      ) : history.length === 0 ? (
                        <div className="py-8 text-center text-slate-500 text-xs">No advance history for this employee</div>
                      ) : (
                        <div className="space-y-2">
                          {history.map(a => (
                            <div key={a._id}
                              className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <p className="text-sm font-bold text-white">{fmt(a.amount)}</p>
                                  <span className={clsx('badge text-[10px]', ADVANCE_STATUS[a.status]?.cls)}>
                                    {ADVANCE_STATUS[a.status]?.label}
                                  </span>
                                </div>
                                {a.reason && <p className="text-[10px] text-slate-400 truncate">{a.reason}</p>}
                                <p className="text-[10px] text-slate-500 mt-0.5">
                                  {new Date(a.requestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                  {a.deductedIn?.month && (
                                    <> · Deducted in {MONTHS[a.deductedIn.month - 1]} {a.deductedIn.year}</>
                                  )}
                                </p>
                              </div>
                              {['pending','approved'].includes(a.status) && (
                                <button
                                  onClick={() => handleCancel(a._id)}
                                  disabled={cancelling === a._id}
                                  title="Cancel advance"
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-danger-400 hover:bg-danger-500/10 transition-colors disabled:opacity-40"
                                >
                                  {cancelling === a._id
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : <Trash2 className="w-3.5 h-3.5" />}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Performance Bonus Modal ──────────────────────────────────────────────────
function PerformanceBonusModal({ onClose, onSuccess }) {
  const now = new Date();
  const [employees,   setEmployees]   = useState([]);
  const [loadingEmps, setLoadingEmps] = useState(true);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [search,      setSearch]      = useState('');
  const [amount,      setAmount]      = useState('');
  const [note,        setNote]        = useState('');
  const [bonusMonth,  setBonusMonth]  = useState(now.getMonth() + 1);
  const [bonusYear,   setBonusYear]   = useState(now.getFullYear());
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');
  const [tab,         setTab]         = useState('grant'); // 'grant' | 'history'
  const [history,     setHistory]     = useState([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [revoking,    setRevoking]    = useState(null);
  const [successMsg,  setSuccessMsg]  = useState('');

  // Load employees
  useEffect(() => {
    payrollAPI.getEligible({ month: now.getMonth() + 1, year: now.getFullYear() })
      .then(({ data }) => setEmployees(data?.data || []))
      .catch(() => setEmployees([]))
      .finally(() => setLoadingEmps(false));
  }, []);

  // Load bonus history when history tab selected
  useEffect(() => {
    if (!selectedEmp || tab !== 'history') return;
    setLoadingHist(true);
    performanceBonusAPI.getAll({ employeeId: selectedEmp._id })
      .then(({ data }) => setHistory(data?.data || []))
      .catch(() => setHistory([]))
      .finally(() => setLoadingHist(false));
  }, [selectedEmp, tab]);

  const filteredEmps = useMemo(() => {
    const q = search.toLowerCase();
    return employees.filter(e =>
      !q || e.name?.toLowerCase().includes(q) || e.employeeId?.toLowerCase().includes(q)
    );
  }, [employees, search]);

  const handleSelectEmp = (emp) => {
    setSelectedEmp(emp);
    setTab('grant');
    setError('');
    setSuccessMsg('');
    setAmount('');
    setNote('');
    setSearch('');
  };

  const handleGrant = async () => {
    const amt = parseFloat(amount);
    if (!selectedEmp)    { setError('Select an employee first.'); return; }
    if (!amt || amt <= 0) { setError('Enter a valid bonus amount.'); return; }
    setError('');
    setSubmitting(true);
    try {
      await performanceBonusAPI.create({
        employee: selectedEmp._id,
        amount:   amt,
        month:    bonusMonth,
        year:     bonusYear,
        note:     note.trim(),
      });
      setSuccessMsg(`Bonus of ${fmt(amt)} granted to ${selectedEmp.name} for ${MONTHS[bonusMonth - 1]} ${bonusYear}. It will be included in the next payroll run.`);
      setAmount('');
      setNote('');
      onSuccess?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to grant bonus.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (bonusId) => {
    setRevoking(bonusId);
    try {
      await performanceBonusAPI.revoke(bonusId);
      setHistory(prev => prev.filter(b => b._id !== bonusId));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to revoke bonus.');
    } finally {
      setRevoking(null);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] flex overflow-hidden shadow-2xl"
        >
          {/* ── Left: employee list ─────────────────────────────────────── */}
          <div className="w-64 border-r border-white/5 flex flex-col flex-shrink-0">
            <div className="p-4 border-b border-white/5">
              <div className="flex items-center gap-2 mb-0.5">
                <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center">
                  <Star className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <h2 className="font-display font-bold text-white text-sm">Performance Bonus</h2>
              </div>
              <p className="text-[10px] text-slate-400 pl-9">Select an employee to grant bonus</p>
            </div>
            <div className="p-3 border-b border-white/5">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search employees…"
                className="input-field py-1.5 text-xs w-full"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingEmps ? (
                <div className="p-6 flex flex-col items-center gap-2 text-slate-500 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />Loading…
                </div>
              ) : filteredEmps.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs">No employees found</div>
              ) : (
                filteredEmps.map(emp => (
                  <button
                    key={emp._id}
                    onClick={() => handleSelectEmp(emp)}
                    className={clsx(
                      'w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors border-b border-white/3',
                      selectedEmp?._id === emp._id
                        ? 'bg-amber-500/10 border-l-2 border-l-amber-400'
                        : 'hover:bg-white/5',
                    )}
                  >
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500/30 to-orange-500/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-white">{initials(emp.name)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-white truncate">{emp.name}</p>
                      <p className="text-[10px] text-slate-500 truncate">{emp.dept || '—'}</p>
                    </div>
                    {selectedEmp?._id === emp._id && (
                      <ChevronRight className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* ── Right panel ────────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header with close */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
              <div>
                {selectedEmp ? (
                  <>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                        <span className="text-xs font-bold text-white">{initials(selectedEmp.name)}</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{selectedEmp.name}</p>
                        <p className="text-[10px] text-slate-400">{selectedEmp.dept} · Basic: {fmt(selectedEmp.basicSalary)}</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-400">No employee selected</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!selectedEmp ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <Gift className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <p className="text-white font-medium text-sm">Grant a Performance Bonus</p>
                  <p className="text-slate-500 text-xs mt-1 max-w-xs">
                    Select an employee from the left to grant them a bonus. It will automatically appear in their payroll earnings.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Tabs */}
                <div className="flex border-b border-white/5 flex-shrink-0">
                  {[
                    { id: 'grant',   label: 'Grant Bonus'  },
                    { id: 'history', label: 'Bonus History' },
                  ].map(t => (
                    <button
                      key={t.id}
                      onClick={() => { setTab(t.id); setError(''); setSuccessMsg(''); }}
                      className={clsx(
                        'flex-1 py-2.5 text-xs font-medium transition-colors border-b-2',
                        tab === t.id
                          ? 'text-amber-400 border-amber-400'
                          : 'text-slate-500 border-transparent hover:text-slate-300',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                  {tab === 'grant' ? (
                    <div className="space-y-4">
                      {/* Month / Year selectors */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1.5">Bonus Month</label>
                          <select
                            value={bonusMonth}
                            onChange={e => setBonusMonth(+e.target.value)}
                            className="input-field py-2 text-xs w-full"
                          >
                            {MONTHS.map((m, i) => (
                              <option key={m} value={i + 1}>{m}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1.5">Year</label>
                          <select
                            value={bonusYear}
                            onChange={e => setBonusYear(+e.target.value)}
                            className="input-field py-2 text-xs w-full"
                          >
                            {[bonusYear - 1, bonusYear, bonusYear + 1].map(y => (
                              <option key={y} value={y}>{y}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Amount */}
                      <div>
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1.5">
                          Bonus Amount *
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-medium">PKR</span>
                          <input
                            type="number"
                            value={amount}
                            onChange={e => { setAmount(e.target.value); setError(''); setSuccessMsg(''); }}
                            placeholder="Enter any amount"
                            min="1"
                            className="input-field pl-11 py-2.5 text-sm w-full"
                          />
                        </div>
                        {/* Quick amount chips */}
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {[5000, 10000, 15000, 25000, 50000].map(v => (
                            <button
                              key={v}
                              onClick={() => { setAmount(String(v)); setError(''); setSuccessMsg(''); }}
                              className={clsx(
                                'px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-colors',
                                amount === String(v)
                                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                                  : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-300'
                              )}
                            >
                              {(v / 1000)}k
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Note */}
                      <div>
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1.5">
                          Note / Reason <span className="text-slate-600 normal-case font-normal">(optional)</span>
                        </label>
                        <textarea
                          value={note}
                          onChange={e => setNote(e.target.value)}
                          placeholder="e.g. Exceptional Q3 performance, project completion reward…"
                          rows={2}
                          className="input-field py-2 text-xs w-full resize-none"
                        />
                      </div>

                      {/* Preview pill */}
                      {parseFloat(amount) > 0 && (
                        <div className="flex items-center justify-between p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                          <div className="flex items-center gap-2">
                            <Star className="w-4 h-4 text-amber-400" />
                            <div>
                              <p className="text-xs text-slate-300">
                                Bonus for <span className="text-white font-medium">{selectedEmp.name}</span>
                              </p>
                              <p className="text-[10px] text-slate-500">{MONTHS[bonusMonth - 1]} {bonusYear} payroll</p>
                            </div>
                          </div>
                          <p className="text-lg font-display font-bold text-amber-400">{fmt(parseFloat(amount))}</p>
                        </div>
                      )}

                      {/* Info note */}
                      <div className="flex items-start gap-2 p-3 bg-primary-500/5 border border-primary-500/15 rounded-lg">
                        <Info className="w-3.5 h-3.5 text-primary-400 flex-shrink-0 mt-0.5" />
                        <p className="text-[10px] text-slate-400">
                          This bonus will be included in <span className="text-white">{selectedEmp.name}'s</span> earnings under <span className="text-white">Performance Bonus</span> when payroll is next run for {MONTHS[bonusMonth - 1]} {bonusYear}.
                        </p>
                      </div>

                      {error && (
                        <div className="flex items-start gap-2 p-3 bg-danger-500/10 border border-danger-500/20 rounded-lg">
                          <AlertTriangle className="w-3.5 h-3.5 text-danger-400 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-danger-400">{error}</p>
                        </div>
                      )}

                      {successMsg && (
                        <div className="flex items-start gap-2 p-3 bg-accent-500/10 border border-accent-500/20 rounded-lg">
                          <CheckCircle className="w-3.5 h-3.5 text-accent-400 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-accent-400">{successMsg}</p>
                        </div>
                      )}

                      <button
                        onClick={handleGrant}
                        disabled={submitting || !amount}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/30 disabled:cursor-not-allowed text-black disabled:text-black/40 font-semibold text-xs rounded-xl transition-colors"
                      >
                        {submitting
                          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Granting…</>
                          : <><Star className="w-3.5 h-3.5" />Grant Bonus</>}
                      </button>
                    </div>
                  ) : (
                    /* History tab */
                    <div>
                      {loadingHist ? (
                        <div className="py-8 flex items-center justify-center gap-2 text-slate-500 text-xs">
                          <Loader2 className="w-4 h-4 animate-spin text-amber-400" />Loading history…
                        </div>
                      ) : history.length === 0 ? (
                        <div className="py-10 text-center">
                          <Gift className="w-7 h-7 text-slate-700 mx-auto mb-2" />
                          <p className="text-slate-500 text-xs">No bonuses granted yet for {selectedEmp.name}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {history.map(b => {
                            const empName = b.employee
                              ? `${b.employee.firstName} ${b.employee.lastName}`
                              : selectedEmp.name;
                            return (
                              <div key={b._id} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                                <div className={clsx(
                                  'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                                  b.isProcessed ? 'bg-accent-500/15' : 'bg-amber-500/15'
                                )}>
                                  <Star className={clsx('w-4 h-4', b.isProcessed ? 'text-accent-400' : 'text-amber-400')} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <p className="text-sm font-bold text-white">{fmt(b.amount)}</p>
                                    <span className={clsx(
                                      'badge text-[10px]',
                                      b.isProcessed ? 'badge-success' : 'badge-warning'
                                    )}>
                                      {b.isProcessed ? 'Processed' : 'Pending'}
                                    </span>
                                  </div>
                                  {b.note && <p className="text-[10px] text-slate-400 truncate">{b.note}</p>}
                                  <p className="text-[10px] text-slate-500 mt-0.5">
                                    {MONTHS[b.month - 1]} {b.year}
                                    {b.grantedBy && (
                                      <> · by {b.grantedBy.firstName} {b.grantedBy.lastName}</>
                                    )}
                                    {b.createdAt && (
                                      <> · {new Date(b.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>
                                    )}
                                  </p>
                                </div>
                                {!b.isProcessed && (
                                  <button
                                    onClick={() => handleRevoke(b._id)}
                                    disabled={revoking === b._id}
                                    title="Revoke bonus"
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-danger-400 hover:bg-danger-500/10 transition-colors disabled:opacity-40"
                                  >
                                    {revoking === b._id
                                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      : <Trash2 className="w-3.5 h-3.5" />}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Month / Year Picker ────────────────────────────────────────────────────
// A compact calendar-style dropdown so admins can jump to any past month/year
// (payrolls can be back-dated before 2026), not just the current year's months.
// It renders as an absolutely-positioned popover anchored to the trigger button,
// so it overlays the page instead of pushing any layout around.
function MonthYearPicker({ month, year, onChange, minYear = 2015 }) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(year);
  const wrapRef = useRef(null);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  useEffect(() => { if (open) setViewYear(year); }, [open, year]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isFutureMonth = (m, y) => y > currentYear || (y === currentYear && m > currentMonth);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="input-field w-auto py-2 text-xs flex items-center gap-1.5"
      >
        <Calendar className="w-3.5 h-3.5 text-slate-400" />
        {MONTHS[month]} {year}
        <ChevronDown className={clsx('w-3 h-3 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 z-50 w-56 bg-surface-900 border border-white/10 rounded-xl shadow-2xl p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setViewYear(y => Math.max(minYear, y - 1))}
                disabled={viewYear <= minYear}
                className="w-6 h-6 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-semibold text-white">{viewYear}</span>
              <button
                type="button"
                onClick={() => setViewYear(y => Math.min(currentYear, y + 1))}
                disabled={viewYear >= currentYear}
                className="w-6 h-6 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {MONTHS.map((m, i) => {
                const isActive = i === month && viewYear === year;
                const isFuture = isFutureMonth(i, viewYear);
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={isFuture}
                    onClick={() => { onChange(i, viewYear); setOpen(false); }}
                    className={clsx(
                      'text-[11px] py-1.5 rounded-lg transition-colors',
                      isActive
                        ? 'bg-primary-500 text-white font-semibold'
                        : isFuture
                          ? 'text-slate-600 cursor-not-allowed'
                          : 'text-slate-300 hover:bg-white/10'
                    )}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PayrollManagement() {
  const now = new Date();

  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear,  setSelectedYear]  = useState(now.getFullYear());
  const [records,       setRecords]       = useState([]);
  const [trend,         setTrend]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [trendLoad,     setTrendLoad]     = useState(true);
  const [search,        setSearch]        = useState('');
  const [statusFilter,  setStatusFilter]  = useState('');
  const [selectedRec,   setSelectedRec]   = useState(null);
  const [editingRec,    setEditingRec]    = useState(null);
  const [deletingId,    setDeletingId]    = useState(null);
  const [showRunModal,  setShowRunModal]  = useState(false);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [showHoldSalaryModal, setShowHoldSalaryModal] = useState(false);
  const [loans,           setLoans]           = useState([]);
  const [loansLoading,    setLoansLoading]    = useState(true);
  const [loanExpanded,    setLoanExpanded]    = useState(false);
  const [loanHistoryId,   setLoanHistoryId]   = useState(null);
  const [loanHistoryData, setLoanHistoryData] = useState({});
  const [bonuses,         setBonuses]         = useState([]);
  const [bonusesLoading,  setBonusesLoading]  = useState(true);
  const [bonusExpanded,   setBonusExpanded]   = useState(false);
  const [holdReleaseExpanded, setHoldReleaseExpanded] = useState(false);
  const [advances,        setAdvances]        = useState([]);
  const [advancesLoading, setAdvancesLoading] = useState(true);
  const [advanceExpanded, setAdvanceExpanded] = useState(false);

  const fetchLoans = useCallback(() => {
    setLoansLoading(true);
    loanAPI.getAll({ limit: 200 })
      .then(({ data }) => setLoans(data?.data || []))
      .catch(() => setLoans([]))
      .finally(() => setLoansLoading(false));
  }, []);

  useEffect(() => { fetchLoans(); }, [fetchLoans]);

  const fetchBonuses = useCallback(() => {
    setBonusesLoading(true);
    performanceBonusAPI.getAll({ limit: 500 })
      .then(({ data }) => setBonuses(data?.data || []))
      .catch(() => setBonuses([]))
      .finally(() => setBonusesLoading(false));
  }, []);

  useEffect(() => { fetchBonuses(); }, [fetchBonuses]);

  const fetchAdvances = useCallback(() => {
    setAdvancesLoading(true);
    advanceAPI.getAll({ limit: 500 })
      .then(({ data }) => setAdvances(data?.data || []))
      .catch(() => setAdvances([]))
      .finally(() => setAdvancesLoading(false));
  }, []);

  useEffect(() => { fetchAdvances(); }, [fetchAdvances]);

  const handleToggleLoanHistory = useCallback((loanId) => {
    if (loanHistoryId === loanId) { setLoanHistoryId(null); return; }
    setLoanHistoryId(loanId);
    // deductionHistory is already in the loan object from the GET /loans response
  }, [loanHistoryId]);

  const fetchPayroll = useCallback(() => {
    setLoading(true);
    payrollAPI.getAll({ month: selectedMonth + 1, year: selectedYear, limit: 200 })
      .then(({ data }) => setRecords(data?.data || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [selectedMonth, selectedYear]);

  useEffect(() => { fetchPayroll(); }, [fetchPayroll]);

  useEffect(() => {
    payrollAPI.getTrend()
      .then(({ data }) => setTrend(data?.data || []))
      .catch(() => setTrend([]))
      .finally(() => setTrendLoad(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return records.filter(r => {
      const name = `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.toLowerCase();
      const id   = (r.employee?.employeeId || '').toLowerCase();
      return (!q || name.includes(q) || id.includes(q))
        && (!statusFilter || r.status === statusFilter);
    });
  }, [records, search, statusFilter]);

  const totalGross = filtered.reduce((s, r) => s + (r.grossEarnings   || 0), 0);
  const totalNet   = filtered.reduce((s, r) => s + (r.netSalary       || 0), 0);
  const totalPF    = filtered.reduce((s, r) => s + (r.deductions?.providentFund || 0), 0);

  // Loan aggregates
  const activeLoans    = loans.filter(l => l.status === 'active');
  const pausedLoans    = loans.filter(l => l.status === 'paused');
  const paidLoans      = loans.filter(l => l.status === 'fully_paid');
  const totalDisbursed = loans.reduce((s, l) => s + (l.loanAmount || 0), 0);
  const totalOutstanding = loans
    .filter(l => ['active','paused'].includes(l.status))
    .reduce((s, l) => s + (l.remainingBalance || 0), 0);
  const totalMonthlyEMI = activeLoans.reduce((s, l) => s + (l.monthlyEMI || 0), 0);
  const totalLoanDeductions = filtered.reduce((s, r) => s + (r.deductions?.loanDeductions || 0), 0);

  // Advance salary aggregates
  const pendingAdvances = advances.filter(a => ['pending', 'approved'].includes(a.status));
  const deductedAdvances = advances.filter(a => a.status === 'deducted');
  const currentPeriodAdvances = advances.filter(a => a.deductedIn?.month === selectedMonth + 1 && a.deductedIn?.year === selectedYear);
  const totalPendingAdvances = pendingAdvances.reduce((sum, a) => sum + (a.amount || 0), 0);
  const totalDeductedAdvances = deductedAdvances.reduce((sum, a) => sum + (a.amount || 0), 0);
  const advancesDeductedThisRun = filtered.reduce((sum, record) => sum + (record.deductions?.advanceDeductions || 0), 0);

  // Bonus aggregates
  const regularBonuses        = bonuses.filter(b => b.bonusType !== 'released_hold');
  const releasedHoldBonuses   = bonuses.filter(b => b.bonusType === 'released_hold');
  const pendingBonuses        = regularBonuses.filter(b => !b.isProcessed);
  const processedBonuses      = regularBonuses.filter(b => b.isProcessed);
  const totalPendingBonus     = pendingBonuses.reduce((s, b) => s + (b.amount || 0), 0);
  const totalProcessedBonus   = processedBonuses.reduce((s, b) => s + (b.amount || 0), 0);
  const thisMonthBonuses      = regularBonuses.filter(b => b.month === selectedMonth + 1 && b.year === selectedYear);
  const totalBonusThisMonth   = thisMonthBonuses.reduce((s, b) => s + (b.amount || 0), 0);
  const totalBonusFromPayroll = filtered.reduce((s, r) => s + (r.earnings?.performanceBonus || 0), 0);
  const totalReleasedHoldAmount = releasedHoldBonuses.reduce((s, b) => s + (b.amount || 0), 0);
  const pendingReleasedHolds    = releasedHoldBonuses.filter(b => !b.isProcessed);
  const processedReleasedHolds  = releasedHoldBonuses.filter(b => b.isProcessed);

  const handleApprove = async (id) => {
    await payrollAPI.approve(id);
    setRecords(prev => prev.map(r => r._id === id ? { ...r, status: 'approved' } : r));
  };

  const handleEditSaved = (updated) => {
    setRecords(prev => prev.map(r => r._id === updated._id ? { ...r, ...updated, employee: r.employee } : r));
  };

  const handleDelete = async (record) => {
    const name = record.employee
      ? `${record.employee.firstName || ''} ${record.employee.lastName || ''}`.trim()
      : 'this employee';
    if (!window.confirm(`Delete the ${MONTHS[(record.payPeriod?.month || 1) - 1]} ${record.payPeriod?.year} payroll for ${name}? This cannot be undone.`)) {
      return;
    }
    setDeletingId(record._id);
    try {
      await payrollAPI.remove(record._id);
      setRecords(prev => prev.filter(r => r._id !== record._id));
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete payroll record');
    } finally {
      setDeletingId(null);
    }
  };

  const handleExport = () => {
    if (!filtered.length) return;
    const rows = filtered.map(r => ({
      'Employee ID': r.employee?.employeeId || '—',
      'Name':        `${r.employee?.firstName} ${r.employee?.lastName}`,
      'Department':  r.employee?.department?.name || '—',
      'Basic':       r.earnings?.basicSalary || 0,
      'Gross':       r.grossEarnings  || 0,
      'Deductions':  r.totalDeductions || 0,
      'Net Pay':     r.netSalary      || 0,
      'Status':      PAYROLL_STATUS_MAP[r.status]?.label || r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch:14 },{ wch:22 },{ wch:18 },{ wch:12 },{ wch:12 },{ wch:14 },{ wch:12 },{ wch:12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Payroll ${MONTHS[selectedMonth]} ${selectedYear}`);
    XLSX.writeFile(wb, `payroll_${selectedYear}_${selectedMonth + 1}.xlsx`);
  };

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="flex justify-between flex-wrap gap-3 items-start">
          <div>
            <h1 className="font-display text-2xl font-bold text-white">Payroll Management</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {MONTHS[selectedMonth]} {selectedYear} · {loading ? '…' : `${filtered.length} employees`}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <MonthYearPicker
              month={selectedMonth}
              year={selectedYear}
              onChange={(m, y) => { setSelectedMonth(m); setSelectedYear(y); }}
            />
            <button onClick={handleExport} disabled={!filtered.length}
              className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40">
              <Download className="w-3.5 h-3.5" />Export
            </button>
            {/* ← Run Payroll button */}
            <button onClick={() => setShowRunModal(true)}
              className="btn-primary text-xs flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5" />Run Payroll
            </button>
            <button onClick={() => setShowAdvanceModal(true)}
              className="btn-secondary text-xs flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" />Advance Salary
            </button>
              <button
                onClick={() => setShowLoanModal(true)}
                className="btn-secondary text-xs flex items-center gap-1.5"
              >
                <CreditCard className="w-3.5 h-3.5" />
                Setup Loan
              </button>
              <button
                onClick={() => setShowBonusModal(true)}
                className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/25 text-amber-400 hover:text-amber-300 font-medium transition-colors"
              >
                <Star className="w-3.5 h-3.5" />
                Performance Bonus
              </button>
              {/* <button
                onClick={() => setShowHoldSalaryModal(true)}
                className="btn-secondary text-xs flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5" />
                Salary Hold
              </button> */}
          </div>
        </motion.div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Gross',   value: loading ? '…' : fmt(totalGross), icon: DollarSign,  color: 'text-primary-400', bg: 'bg-primary-500/10' },
            { label: 'Total Net Pay', value: loading ? '…' : fmt(totalNet),   icon: TrendingUp,  color: 'text-accent-400',  bg: 'bg-accent-500/10'  },
            { label: 'Total PF',      value: loading ? '…' : fmt(totalPF),    icon: AlertCircle, color: 'text-warning-400', bg: 'bg-warning-500/10' },
            { label: 'Employees',     value: loading ? '…' : filtered.length, icon: Users,       color: 'text-slate-300',   bg: 'bg-white/5'        },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }} className="stat-card">
              <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center', s.bg)}>
                <s.icon className={clsx('w-4 h-4', s.color)} />
              </div>
              <div>
                <p className="text-2xl font-display font-bold text-white">{s.value}</p>
                <p className="text-xs text-slate-500">{s.label}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* ─── Loan Overview Panel ────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="glass-card overflow-hidden"
        >
          {/* Panel header */}
          <div
            className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/3 transition-colors select-none"
            onClick={() => setLoanExpanded(v => !v)}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-violet-500/15 flex items-center justify-center">
                <Banknote className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Employee Loan Overview</p>
                <p className="text-[10px] text-slate-500">
                  {loansLoading ? 'Loading…' : `${activeLoans.length} active · ${paidLoans.length} fully paid · ${pausedLoans.length} paused`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={e => { e.stopPropagation(); setShowLoanModal(true); }}
                className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3"
              >
                <CreditCard className="w-3 h-3" />New Loan
              </button>
              <div className={clsx('w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center transition-transform duration-200', loanExpanded && 'rotate-180')}>
                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {/* KPI strip — always visible */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/5 border-t border-white/5">
            {[
              { label: 'Total Disbursed',  value: loansLoading ? '…' : fmt(totalDisbursed),    icon: DollarSign,   color: 'text-violet-400',  bg: 'bg-violet-500/10'  },
              { label: 'Outstanding',      value: loansLoading ? '…' : fmt(totalOutstanding),   icon: TrendingDown, color: 'text-warning-400', bg: 'bg-warning-500/10' },
              { label: 'Monthly EMI Pool', value: loansLoading ? '…' : fmt(totalMonthlyEMI),    icon: Clock,        color: 'text-primary-400', bg: 'bg-primary-500/10' },
              { label: 'Deducted This Run',value: loading      ? '…' : fmt(totalLoanDeductions),icon: ShieldCheck,  color: 'text-accent-400',  bg: 'bg-accent-500/10'  },
            ].map(s => (
              <div key={s.label} className={clsx('flex items-center gap-3 p-4', s.bg)}>
                <s.icon className={clsx('w-4 h-4 flex-shrink-0', s.color)} />
                <div>
                  <p className={clsx('text-base font-display font-bold', s.color)}>{s.value}</p>
                  <p className="text-[10px] text-slate-500">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Expanded: per-employee loan table */}
          {loanExpanded && (
            <div className="border-t border-white/5">
              {loansLoading ? (
                <div className="p-8 flex items-center justify-center gap-2 text-slate-500 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin text-violet-400" />Loading loan records…
                </div>
              ) : loans.length === 0 ? (
                <div className="p-8 text-center">
                  <Banknote className="w-7 h-7 text-slate-700 mx-auto mb-2" />
                  <p className="text-slate-500 text-xs">No loan records yet. Set up a loan to get started.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Date</th>
                        <th>Principal</th>
                        <th>Interest</th>
                        <th>Monthly EMI</th>
                        <th>Outstanding</th>
                        <th>Progress</th>
                        <th>Status</th>
                        <th>History</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loans.map(loan => {
                        const emp        = loan.employee;
                        const name       = emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown';
                        const paidSoFar  = (loan.totalRepaymentAmount || 0) - (loan.remainingBalance || 0);
                        const pct        = loan.totalRepaymentAmount > 0
                          ? Math.min(100, Math.round((paidSoFar / loan.totalRepaymentAmount) * 100))
                          : 0;
                        const statusCfg  = {
                          active:     { cls: 'badge-primary',  label: 'Active'      },
                          paused:     { cls: 'badge-warning',  label: 'Paused'      },
                          fully_paid: { cls: 'badge-success',  label: 'Fully Paid'  },
                          pending:    { cls: 'badge-neutral',  label: 'Pending'     },
                        }[loan.status] || { cls: 'badge-neutral', label: loan.status };

                        return (
                          <>
                          <tr key={loan._id} className="group">
                            <td>
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/30 to-primary-500/30 flex items-center justify-center flex-shrink-0">
                                  <span className="text-[10px] font-bold text-white">{initials(name)}</span>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-white">{name}</p>
                                  <p className="text-[10px] text-slate-500">{emp?.employeeId || '—'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="text-slate-300 text-xs">
                              {loan.createdAt && (
                                <>  {new Date(loan.createdAt).toLocaleDateString('en-GB', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric'
                                }).replace(/\//g, '-')}</>
                              )}
                            </td>
                            <td className="text-slate-300 text-xs">{fmt(loan.loanAmount)}</td>
                            <td className="text-slate-400 text-xs">{loan.interestPercentage ?? 0}%</td>
                            <td className="text-primary-400 text-xs font-medium">{fmt(loan.monthlyEMI)}</td>
                            <td className="text-warning-400 text-xs font-medium">{fmt(loan.remainingBalance)}</td>
                            <td className="min-w-[100px]">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                  <div
                                    className={clsx(
                                      'h-full rounded-full transition-all',
                                      pct >= 100 ? 'bg-accent-500' : pct >= 50 ? 'bg-primary-500' : 'bg-violet-500'
                                    )}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-slate-500 w-7 text-right">{pct}%</span>
                              </div>
                            </td>
                            <td>
                              <span className={clsx('badge text-[10px]', statusCfg.cls)}>{statusCfg.label}</span>
                            </td>
                            <td>
                              {(loan.deductionHistory?.length > 0) ? (
                                <button
                                  onClick={() => handleToggleLoanHistory(loan._id)}
                                  className={clsx(
                                    'flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg transition-colors',
                                    loanHistoryId === loan._id
                                      ? 'bg-violet-500/20 text-violet-300'
                                      : 'bg-white/5 text-slate-400 hover:bg-violet-500/10 hover:text-violet-400'
                                  )}
                                >
                                  <History className="w-3 h-3" />
                                  {loan.deductionHistory.length}
                                  <ChevronDown className={clsx('w-3 h-3 transition-transform', loanHistoryId === loan._id && 'rotate-180')} />
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-600">No payments yet</span>
                              )}
                            </td>
                          </tr>
                          {/* Deduction history expansion row */}
                          {loanHistoryId === loan._id && loan.deductionHistory?.length > 0 && (
                            <tr key={`${loan._id}-hist`}>
                              <td colSpan={8} className="p-0 bg-violet-500/5">
                                <div className="px-4 py-3 space-y-2">
                                  <p className="text-[10px] text-violet-400 uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5">
                                    <History className="w-3 h-3" /> Deduction History — {name}
                                  </p>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {loan.deductionHistory.map((entry, idx) => (
                                      <div key={entry._id || idx} className="flex items-center gap-3 p-2.5 bg-white/5 rounded-lg border border-white/5">
                                        <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                                          <span className="text-[9px] font-bold text-violet-400">#{idx + 1}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs font-semibold text-white">{fmt(entry.amountDeducted)}</p>
                                          <p className="text-[10px] text-slate-500">
                                            {entry.month && entry.year
                                              ? `${MONTHS[entry.month - 1]} ${entry.year}`
                                              : entry.payrollId?.payPeriod?.month && entry.payrollId?.payPeriod?.year
                                              ? `${MONTHS[entry.payrollId.payPeriod.month - 1]} ${entry.payrollId.payPeriod.year}`
                                              : entry.date
                                              ? new Date(entry.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')
                                              : 'Unknown period'}
                                          </p>
                                        </div>
                                        <CheckCircle className="w-3.5 h-3.5 text-accent-500 flex-shrink-0" />
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex items-center justify-between pt-1 border-t border-white/5 mt-2">
                                    <p className="text-[10px] text-slate-500">
                                      Total paid: <span className="text-accent-400 font-semibold">{fmt(loan.deductionHistory.reduce((s, e) => s + (e.amountDeducted || 0), 0))}</span>
                                    </p>
                                    <p className="text-[10px] text-slate-500">
                                      Remaining: <span className="text-warning-400 font-semibold">{fmt(loan.remainingBalance)}</span>
                                    </p>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </motion.div>

        {/* ─── Performance Bonus Overview Panel ──────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.17 }} className="glass-card overflow-hidden">
          <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/3 transition-colors select-none" onClick={() => setAdvanceExpanded(v => !v)}>
            <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-xl bg-cyan-500/15 flex items-center justify-center"><CreditCard className="w-4 h-4 text-cyan-400" /></div><div><p className="text-sm font-semibold text-white">Advance Salary Overview</p><p className="text-[10px] text-slate-500">{advancesLoading ? 'Loading…' : `${pendingAdvances.length} awaiting deduction · ${deductedAdvances.length} deducted`}</p></div></div>
            <div className="flex items-center gap-3"><button onClick={event => { event.stopPropagation(); setShowAdvanceModal(true); }} className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3"><CreditCard className="w-3 h-3" />New Advance</button><ChevronDown className={clsx('w-4 h-4 text-slate-400 transition-transform', advanceExpanded && 'rotate-180')} /></div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/5 border-t border-white/5">{[{ label: 'Awaiting Deduction', value: advancesLoading ? '…' : fmt(totalPendingAdvances), icon: Clock, color: 'text-cyan-400', bg: 'bg-cyan-500/10' }, { label: 'Total Deducted', value: advancesLoading ? '…' : fmt(totalDeductedAdvances), icon: CheckCircle, color: 'text-accent-400', bg: 'bg-accent-500/10' }, { label: `${MONTHS[selectedMonth]} Deducted`, value: advancesLoading ? '…' : fmt(currentPeriodAdvances.reduce((sum, advance) => sum + (advance.amount || 0), 0)), icon: Calendar, color: 'text-primary-400', bg: 'bg-primary-500/10' }, { label: 'Deducted This Run', value: loading ? '…' : fmt(advancesDeductedThisRun), icon: ShieldCheck, color: 'text-warning-400', bg: 'bg-warning-500/10' }].map(item => <div key={item.label} className={clsx('flex items-center gap-3 p-4', item.bg)}><item.icon className={clsx('w-4 h-4 flex-shrink-0', item.color)} /><div><p className={clsx('text-base font-display font-bold', item.color)}>{item.value}</p><p className="text-[10px] text-slate-500">{item.label}</p></div></div>)}</div>
          {advanceExpanded && <div className="border-t border-white/5">{advancesLoading ? <div className="p-8 flex items-center justify-center gap-2 text-slate-500 text-xs"><Loader2 className="w-4 h-4 animate-spin text-cyan-400" />Loading advance records…</div> : advances.length === 0 ? <div className="p-8 text-center"><CreditCard className="w-7 h-7 text-slate-700 mx-auto mb-2" /><p className="text-slate-500 text-xs">No advance salary records yet.</p></div> : <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Employee</th><th>Requested</th><th>Amount</th><th>Reason</th><th>Deducted In</th><th>Status</th></tr></thead><tbody>{advances.map(advance => { const employee = advance.employee; const name = employee ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() : 'Unknown'; const status = ADVANCE_STATUS_MAP[advance.status] || { cls: 'badge-neutral', label: advance.status }; return <tr key={advance._id}><td><div className="flex items-center gap-2.5"><div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500/30 to-primary-500/30 flex items-center justify-center"><span className="text-[10px] font-bold text-white">{initials(name)}</span></div><div><p className="text-xs font-medium text-white">{name}</p><p className="text-[10px] text-slate-500">{employee?.employeeId || '—'}</p></div></div></td><td className="text-xs text-slate-300">{new Date(advance.requestedAt || advance.createdAt).toLocaleDateString('en-GB')}</td><td className="text-xs font-medium text-cyan-400">{fmt(advance.amount)}</td><td className="max-w-[220px] truncate text-xs text-slate-400" title={advance.reason}>{advance.reason || '—'}</td><td className="text-xs text-slate-300">{advance.deductedIn?.month ? `${MONTHS[advance.deductedIn.month - 1]} ${advance.deductedIn.year}` : '—'}</td><td><span className={clsx('badge text-[10px]', status.cls)}>{status.label}</span></td></tr>; })}</tbody></table></div>}</div>}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
          className="glass-card overflow-hidden"
        >
          {/* Panel header */}
          <div
            className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/3 transition-colors select-none"
            onClick={() => setBonusExpanded(v => !v)}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center">
                <Award className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Performance Bonus Overview</p>
                <p className="text-[10px] text-slate-500">
                  {bonusesLoading ? 'Loading…' : `${regularBonuses.length} bonus entries · ${releasedHoldBonuses.length} released-hold entries`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={e => { e.stopPropagation(); setShowBonusModal(true); }}
                className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/25 text-amber-400 hover:text-amber-300 font-medium transition-colors"
              >
                <Star className="w-3 h-3" />Grant Bonus
              </button>
              <div className={clsx('w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center transition-transform duration-200', bonusExpanded && 'rotate-180')}>
                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {/* KPI strip — always visible */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/5 border-t border-white/5">
            {[
              { label: 'Pending Bonuses',      value: bonusesLoading ? '…' : fmt(totalPendingBonus),    icon: Clock,       color: 'text-amber-400',   bg: 'bg-amber-500/10'   },
              { label: 'Total Processed',       value: bonusesLoading ? '…' : fmt(totalProcessedBonus), icon: CheckCircle, color: 'text-accent-400',  bg: 'bg-accent-500/10'  },
              { label: `${MONTHS[selectedMonth]} Granted`,  value: bonusesLoading ? '…' : fmt(totalBonusThisMonth),  icon: Gift,        color: 'text-primary-400', bg: 'bg-primary-500/10' },
              { label: 'Paid in This Run',      value: loading      ? '…' : fmt(totalBonusFromPayroll), icon: Star,        color: 'text-warning-400', bg: 'bg-warning-500/10' },
            ].map(s => (
              <div key={s.label} className={clsx('flex items-center gap-3 p-4', s.bg)}>
                <s.icon className={clsx('w-4 h-4 flex-shrink-0', s.color)} />
                <div>
                  <p className={clsx('text-base font-display font-bold', s.color)}>{s.value}</p>
                  <p className="text-[10px] text-slate-500">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Expanded: per-bonus list */}
          {bonusExpanded && (
            <div className="border-t border-white/5">
              {bonusesLoading ? (
                <div className="p-8 flex items-center justify-center gap-2 text-slate-500 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />Loading bonus records…
                </div>
              ) : bonuses.length === 0 ? (
                <div className="p-8 text-center">
                  <Gift className="w-7 h-7 text-slate-700 mx-auto mb-2" />
                  <p className="text-slate-500 text-xs">No bonuses granted yet.</p>
                </div>
              ) : (
                <div className="space-y-6 p-4">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-400">Performance Bonuses</h4>
                      <span className="text-[10px] text-slate-500">{regularBonuses.length} entries</span>
                    </div>
                    {regularBonuses.length === 0 ? (
                      <div className="rounded-xl border border-white/5 bg-white/5 p-4 text-center text-[11px] text-slate-500">No regular performance bonuses yet.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Employee</th>
                              <th>Amount</th>
                              <th>For Period</th>
                              <th>Note</th>
                              <th>Granted By</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {regularBonuses.map(b => {
                              const empName = b.employee ? `${b.employee.firstName} ${b.employee.lastName}` : '—';
                              const grantor = b.grantedBy ? `${b.grantedBy.firstName} ${b.grantedBy.lastName}` : '—';
                              return (
                                <tr key={b._id}>
                                  <td>
                                    <div className="flex items-center gap-2.5">
                                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500/30 to-orange-500/30 flex items-center justify-center flex-shrink-0">
                                        <span className="text-[10px] font-bold text-white">{initials(empName)}</span>
                                      </div>
                                      <div>
                                        <p className="text-xs font-medium text-white">{empName}</p>
                                        <p className="text-[10px] text-slate-500">{b.employee?.employeeId || '—'}</p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="text-amber-400 text-xs font-bold">{fmt(b.amount)}</td>
                                  <td className="text-slate-400 text-xs">{MONTHS[(b.month || 1) - 1]} {b.year}</td>
                                  <td className="text-slate-400 text-xs max-w-[180px] truncate">{b.note || '—'}</td>
                                  <td className="text-slate-400 text-xs">{grantor}</td>
                                  <td>
                                    <span className={clsx('badge text-[10px]', b.isProcessed ? 'badge-success' : 'badge-warning')}>
                                      {b.isProcessed ? 'Processed' : 'Pending'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-violet-400">Released Hold Entries</h4>
                      <span className="text-[10px] text-slate-500">{releasedHoldBonuses.length} entries · {fmt(totalReleasedHoldAmount)}</span>
                    </div>
                    {releasedHoldBonuses.length === 0 ? (
                      <div className="rounded-xl border border-white/5 bg-white/5 p-4 text-center text-[11px] text-slate-500">No salary release entries yet.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Employee</th>
                              <th>Released Amount</th>
                              <th>For Period</th>
                              <th>Note</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {releasedHoldBonuses.map(b => {
                              const empName = b.employee ? `${b.employee.firstName} ${b.employee.lastName}` : '—';
                              return (
                                <tr key={b._id}>
                                  <td>
                                    <div className="flex items-center gap-2.5">
                                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 flex items-center justify-center flex-shrink-0">
                                        <span className="text-[10px] font-bold text-white">{initials(empName)}</span>
                                      </div>
                                      <div>
                                        <p className="text-xs font-medium text-white">{empName}</p>
                                        <p className="text-[10px] text-slate-500">{b.employee?.employeeId || '—'}</p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="text-violet-400 text-xs font-bold">{fmt(b.amount)}</td>
                                  <td className="text-slate-400 text-xs">{MONTHS[(b.month || 1) - 1]} {b.year}</td>
                                  <td className="text-slate-400 text-xs max-w-[220px] truncate">{b.note || '—'}</td>
                                  <td>
                                    <span className={clsx('badge text-[10px]', b.isProcessed ? 'badge-success' : 'badge-warning')}>
                                      {b.isProcessed ? 'Processed' : 'Pending'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>

        {/* ─── Released Hold Salary Overview Panel ───────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="glass-card overflow-hidden"
        >
          <div
            className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/3 transition-colors select-none"
            onClick={() => setHoldReleaseExpanded(v => !v)}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-violet-500/15 flex items-center justify-center">
                <Lock className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Released Hold Salary Overview</p>
                <p className="text-[10px] text-slate-500">
                  {bonusesLoading ? 'Loading…' : `${releasedHoldBonuses.length} released-hold entries`}
                </p>
              </div>
            </div>
            <div className={clsx('w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center transition-transform duration-200', holdReleaseExpanded && 'rotate-180')}>
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-white/5 border-t border-white/5">
            {[
              { label: 'Released Hold Total', value: bonusesLoading ? '…' : fmt(totalReleasedHoldAmount), icon: DollarSign, color: 'text-violet-400', bg: 'bg-violet-500/10' },
              { label: 'Pending Releases', value: bonusesLoading ? '…' : fmt(pendingReleasedHolds.reduce((s, b) => s + (b.amount || 0), 0)), icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
              { label: 'Processed Releases', value: bonusesLoading ? '…' : fmt(processedReleasedHolds.reduce((s, b) => s + (b.amount || 0), 0)), icon: CheckCircle, color: 'text-accent-400', bg: 'bg-accent-500/10' },
            ].map(s => (
              <div key={s.label} className={clsx('flex items-center gap-3 p-4', s.bg)}>
                <s.icon className={clsx('w-4 h-4 flex-shrink-0', s.color)} />
                <div>
                  <p className={clsx('text-base font-display font-bold', s.color)}>{s.value}</p>
                  <p className="text-[10px] text-slate-500">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {holdReleaseExpanded && (
            <div className="border-t border-white/5">
              {bonusesLoading ? (
                <div className="p-8 flex items-center justify-center gap-2 text-slate-500 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin text-violet-400" />Loading release records…
                </div>
              ) : releasedHoldBonuses.length === 0 ? (
                <div className="p-8 text-center">
                  <Lock className="w-7 h-7 text-slate-700 mx-auto mb-2" />
                  <p className="text-slate-500 text-xs">No released hold salary entries yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Released Amount</th>
                        <th>For Period</th>
                        <th>Note</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {releasedHoldBonuses.map(b => {
                        const empName = b.employee ? `${b.employee.firstName} ${b.employee.lastName}` : '—';
                        return (
                          <tr key={b._id}>
                            <td>
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 flex items-center justify-center flex-shrink-0">
                                  <span className="text-[10px] font-bold text-white">{initials(empName)}</span>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-white">{empName}</p>
                                  <p className="text-[10px] text-slate-500">{b.employee?.employeeId || '—'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="text-violet-400 text-xs font-bold">{fmt(b.amount)}</td>
                            <td className="text-slate-400 text-xs">{MONTHS[(b.month || 1) - 1]} {b.year}</td>
                            <td className="text-slate-400 text-xs max-w-[220px] truncate">{b.note || '—'}</td>
                            <td>
                              <span className={clsx('badge text-[10px]', b.isProcessed ? 'badge-success' : 'badge-warning')}>
                                {b.isProcessed ? 'Processed' : 'Pending'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </motion.div>

        {/* Trend chart */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="glass-card p-5">
          <h3 className="font-semibold text-white text-sm mb-4">Monthly Payroll Trend</h3>
          {trendLoad ? (
            <div className="h-[200px] flex items-center justify-center text-slate-500 text-sm">Loading…</div>
          ) : trend.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-slate-500 text-sm">
              No payroll data yet — run payroll to see trends
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={trend} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => `PKR ${(v / 1000).toFixed(0)}k`} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={v => [`PKR ${v.toLocaleString()}`]}
                  contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '12px' }}
                />
                <Bar dataKey="gross" name="Gross" radius={[4,4,0,0]} fill="rgba(99,102,241,0.4)" />
                <Bar dataKey="net"   name="Net"   radius={[4,4,0,0]} fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        {/* Table */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="glass-card overflow-hidden">
          <div className="p-4 border-b border-white/5 flex gap-3 flex-wrap items-center">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or employee ID…"
              className="input-field py-2 text-xs flex-1 min-w-48" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="input-field w-auto py-2 text-xs">
              <option value="">All Status</option>
              {Object.entries(PAYROLL_STATUS_MAP).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <span className="text-[10px] text-slate-500 whitespace-nowrap">
              {filtered.length} / {records.length} records
            </span>
          </div>

          {loading ? (
            <div className="p-10 text-center text-slate-500 text-sm">Loading payroll data…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center">
              <DollarSign className="w-8 h-8 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">
                {records.length === 0
                  ? `No payroll records for ${MONTHS[selectedMonth]} ${selectedYear}.`
                  : 'No records match your search.'}
              </p>
              {records.length === 0 && (
                <button onClick={() => setShowRunModal(true)}
                  className="btn-primary text-xs mt-4 flex items-center gap-1.5 mx-auto">
                  <Play className="w-3.5 h-3.5" />Run Payroll Now
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th><th>Dept</th><th>Basic</th><th>Gross</th>
                    <th>Deductions</th><th>Net Pay</th><th>Status</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const name  = `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.trim();
                    const s     = PAYROLL_STATUS_MAP[r.status] || { cls: 'badge-neutral', label: r.status };
                    return (
                      <tr key={r._id} className="group cursor-pointer" onClick={() => setSelectedRec(r)}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500/40 to-accent-500/40 flex items-center justify-center flex-shrink-0">
                              <span className="text-[10px] font-bold text-white">{initials(name)}</span>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-white">{name || '—'}</p>
                              <p className="text-[10px] text-slate-500">{r.employee?.employeeId}</p>
                            </div>
                          </div>
                        </td>
                        <td className="text-slate-400 text-xs">{r.employee?.department?.name || '—'}</td>
                        <td className="text-slate-300 text-xs">{fmt(r.earnings?.basicSalary)}</td>
                        <td className="text-slate-300 text-xs font-medium">{fmt(r.grossEarnings)}</td>
                        <td className="text-danger-400 text-xs">-{fmt(r.totalDeductions)}</td>
                        <td className="text-accent-400 text-xs font-bold">{fmt(r.netSalary)}</td>
                        <td><span className={clsx('badge text-[10px]', s.cls)}>{s.label}</span></td>
                        <td>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={e => { e.stopPropagation(); setSelectedRec(r); }}
                              className="btn-ghost p-1.5"
                              title="View payslip"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); setEditingRec(r); }}
                              className="btn-ghost p-1.5 hover:text-primary-400"
                              title="Edit payroll"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); handleDelete(r); }}
                              disabled={deletingId === r._id}
                              className="btn-ghost p-1.5 hover:text-danger-400 disabled:opacity-40"
                              title="Delete payroll"
                            >
                              {deletingId === r._id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>
 
      {/* Modals */}
      {showRunModal && (
        <RunPayrollModal
          month={selectedMonth}
          year={selectedYear}
          onClose={() => setShowRunModal(false)}
          onSuccess={fetchPayroll}
        />
      )}

      {selectedRec && (
        <PayslipModal
          record={selectedRec}
          onClose={() => setSelectedRec(null)}
          onApprove={handleApprove}
        />
      )}
      {editingRec && (
        <EditPayrollModal
          record={editingRec}
          onClose={() => setEditingRec(null)}
          onSaved={handleEditSaved}
        />
      )}
      {showAdvanceModal && (
        <AdvanceModal onClose={() => setShowAdvanceModal(false)} />
      )}
      {/* ─── ADD YOUR LOAN SETUP MODAL HERE ─── */}
      {showLoanModal && (
        <LoanSetupModal
          onClose={() => setShowLoanModal(false)}
          onSuccess={() => {
            setShowLoanModal(false);
            fetchLoans();
            fetchPayroll();
          }}
        />
      )}
      {showBonusModal && (
        <PerformanceBonusModal
          onClose={() => setShowBonusModal(false)}
          onSuccess={() => { fetchPayroll(); fetchBonuses(); }}
        />
      )}
      {showHoldSalaryModal && (
        <HoldSalaryModal
          onClose={() => setShowHoldSalaryModal(false)}
          onSuccess={() => {
            setShowHoldSalaryModal(false);
            fetchPayroll();
          }}
        />
      )}
    </>
  );
}
// ─── Hold Salary Modal ──────────────────────────────────────────────────────
function HoldSalaryModal({ onClose, onSuccess }) {
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Simple clear/not-clear flag for the currently selected employee
  // (fetched fresh per-employee — the list row's cached status can be stale)
  const [currentHoldStatus, setCurrentHoldStatus] = useState(null); // { amount, status } | null
  const [loadingStatus, setLoadingStatus] = useState(false);

  // The REAL installment-based hold record, straight from the Salary Hold
  // table — not the simple flag above, which can drift out of sync. If one
  // is still active with money left to deduct, block a new hold request.
  const [activeHoldInfo, setActiveHoldInfo] = useState(null);
  const [showActiveHoldPopup, setShowActiveHoldPopup] = useState(false);

  const toLocalDateTimeInput = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [form, setForm] = useState({
    employeeId: '',
    amount: '',
    startDateTime: toLocalDateTimeInput(new Date()),
    endDateTime: '',
    reason: '',
  });

  useEffect(() => {
    (async () => {
      try {
        setLoadingEmployees(true);
        // Pull a large page so the dropdown covers the whole active roster
        const { data } = await employeeAPI.getAll({ limit: 500, page: 1 });
        setEmployees((data.data || []).filter((e) => e.status !== 'terminated' && e.status !== 'resigned'));
      } catch {
        toast.error('Failed to load employees');
      } finally {
        setLoadingEmployees(false);
      }
    })();
  }, []);

  // Whenever the selected employee changes, fetch their live hold status so
  // we know whether to show the "create a hold" form or the clear/not-clear toggle.
  useEffect(() => {
    if (!form.employeeId) {
      setCurrentHoldStatus(null);
      setActiveHoldInfo(null);
      setShowActiveHoldPopup(false);
      return;
    }
    (async () => {
      try {
        setLoadingStatus(true);
        setShowActiveHoldPopup(false);
        const [{ data }, holdsResult] = await Promise.all([
          employeeAPI.getById(form.employeeId),
          employeeAPI.getSalaryHolds(form.employeeId).catch(() => ({ data: { data: [] } })),
        ]);
        const flag = data.data?.employeeProfile?.salaryHold ?? data.data?.salaryHold ?? { amount: 0, status: 'clear' };
        setCurrentHoldStatus({ amount: flag.amount || 0, status: flag.status || 'clear' });

        // Check the actual Salary Hold table (not the simple flag above,
        // which can be stale) for a hold that's still being deducted.
        const holds = holdsResult?.data?.data || [];
        const active = holds.find((h) => h.status === 'active' && (h.remainingBalance ?? 0) > 0);
        if (active) {
          setActiveHoldInfo(active);
          setShowActiveHoldPopup(true);
        } else {
          setActiveHoldInfo(null);
        }
      } catch {
        setCurrentHoldStatus({ amount: 0, status: 'clear' });
        setActiveHoldInfo(null);
      } finally {
        setLoadingStatus(false);
      }
    })();
  }, [form.employeeId]);

  const selectedEmployee = employees.find((e) => (e._id || e.id) === form.employeeId);
  const basicSalary = selectedEmployee?.salary?.basic ?? selectedEmployee?.salaryBasic ?? 0;
  const isCurrentlyOnHold = currentHoldStatus?.status === 'not_clear';

  // Number of whole months spanned by the selected start/end range — mirrors
  // the backend's calculation so the preview matches what will actually be deducted.
  const monthsBetween = (startStr, endStr) => {
    if (!startStr || !endStr) return 0;
    const s = new Date(startStr);
    const e = new Date(endStr);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) return 0;
    let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    if (e.getDate() > s.getDate()) months += 1;
    return Math.max(1, months);
  };

  const amountNum = Number(form.amount) || 0;
  const durationNum = monthsBetween(form.startDateTime, form.endDateTime);
  const dateRangeValid = durationNum > 0;
  const monthlyPreview = durationNum > 0 ? Math.round((amountNum / durationNum) * 100) / 100 : 0;
  const amountExceedsBasic = !!selectedEmployee && amountNum > basicSalary;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.employeeId) {
      toast.error('Please select an employee');
      return;
    }
    if (activeHoldInfo) {
      setShowActiveHoldPopup(true);
      return;
    }
    if (!amountNum || amountNum <= 0) {
      toast.error('Please enter a hold amount greater than 0');
      return;
    }
    if (!selectedEmployee || basicSalary <= 0) {
      toast.error('Selected employee has no basic salary configured');
      return;
    }
    if (amountExceedsBasic) {
      toast.error(`Hold amount cannot exceed the employee's basic salary (${basicSalary.toLocaleString()})`);
      return;
    }
    if (!dateRangeValid) {
      toast.error('End date & time must be after the start date & time');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await employeeAPI.createSalaryHold(form.employeeId, {
        amount: amountNum,
        startDate: new Date(form.startDateTime).toISOString(),
        endDate: new Date(form.endDateTime).toISOString(),
        reason: form.reason.trim(),
      });
      if (data.success) {
        toast.success(data.message || 'Salary hold created successfully');
        onSuccess();
      } else {
        toast.error(data.message || 'Failed to create salary hold');
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create salary hold');
    } finally {
      setSubmitting(false);
    }
  };

  // NOTE: releasing/toggling the simple clear/not-clear flag is intentionally
  // NOT done from here anymore — it must go through Employee Management's
  // "Release Hold Amount" action, which is the only place that adds the held
  // amount back into payroll as an earning. Payroll only shows the status here.

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-lg p-6 shadow-glow-primary overflow-hidden relative"
        >
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-slate-400 hover:text-white transition-colors"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-5 h-5 text-warning-400" />
            <h3 className="font-display text-xl font-bold text-white">Hold Salary</h3>
          </div>

          <div className="space-y-4">
            {/* Employee — always visible */}
            <div>
              <label className="input-label">Employee *</label>
              <select
                required
                name="employeeId"
                value={form.employeeId}
                onChange={handleChange}
                className="input-field"
                disabled={loadingEmployees}
              >
                <option value="">{loadingEmployees ? 'Loading employees...' : 'Select Employee'}</option>
                {employees.map((emp) => (
                  <option key={emp._id || emp.id} value={emp._id || emp.id}>
                    {emp.firstName} {emp.lastName} ({emp.employeeId || '—'})
                  </option>
                ))}
              </select>
            </div>

            {/* Basic salary display */}
            {selectedEmployee && (
              <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3 flex items-center justify-between">
                <span className="text-xs text-slate-400">Current Basic Salary</span>
                <span className="text-sm font-semibold text-white">
                  {(selectedEmployee.salary?.currency || 'PKR')} {basicSalary.toLocaleString()}
                </span>
              </div>
            )}

            {/* Once an employee is picked: either the Clear/Not Clear toggle
                (if already on hold) or the create-hold form (if clear) */}
            {form.employeeId && loadingStatus && (
              <p className="text-xs text-slate-500">Checking current salary status...</p>
            )}

            {form.employeeId && !loadingStatus && isCurrentlyOnHold && (
              <div className="rounded-xl border border-warning-500/30 bg-warning-500/5 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-warning-400" />
                  <p className="text-xs text-warning-400 font-semibold">Salary Already On Hold</p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Salary Status</span>
                  <span className={clsx('badge text-[10px]', HOLD_STATUS[currentHoldStatus.status]?.cls)}>
                    {HOLD_STATUS[currentHoldStatus.status]?.label}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  This employee's salary is already marked <strong>Not Clear</strong>
                  {currentHoldStatus.amount > 0 && (
                    <>
                      {' '}for {(selectedEmployee?.salary?.currency || 'PKR')} {currentHoldStatus.amount.toLocaleString()}
                    </>
                  )}
                  {' '}from Employee Management. A new hold can't be started until it's released.
                  Go to <strong>Employee Management → Hold Salary</strong> and use{' '}
                  <strong>Release Hold Amount</strong> to clear it — that also pays the held amount back
                  through payroll.
                </p>
                <div className="flex justify-end pt-2 border-t border-white/5">
                  <button type="button" onClick={onClose} className="btn-secondary text-xs">
                    Close
                  </button>
                </div>
              </div>
            )}

            {form.employeeId && !loadingStatus && !isCurrentlyOnHold && activeHoldInfo && (
              <div className="rounded-xl border border-warning-500/30 bg-warning-500/5 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-warning-400" />
                  <p className="text-xs text-warning-400 font-semibold">Salary Hold Already In Progress</p>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  This employee already has an active hold of{' '}
                  {(selectedEmployee?.salary?.currency || 'PKR')} {(activeHoldInfo.amount || 0).toLocaleString()},
                  with{' '}
                  <span className="text-warning-400 font-semibold">
                    {(selectedEmployee?.salary?.currency || 'PKR')} {(activeHoldInfo.remainingBalance || 0).toLocaleString()}
                  </span>{' '}
                  still to be deducted through payroll. A new hold request can't be submitted until this one
                  finishes deducting or is cancelled.
                </p>
                <div className="flex justify-end pt-2 border-t border-white/5">
                  <button type="button" onClick={onClose} className="btn-secondary text-xs">
                    Close
                  </button>
                </div>
              </div>
            )}

            {form.employeeId && !loadingStatus && !isCurrentlyOnHold && !activeHoldInfo && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Start Date & Time */}
                  <div>
                    <label className="input-label">Start Date &amp; Time *</label>
                    <input
                      required
                      type="datetime-local"
                      name="startDateTime"
                      value={form.startDateTime}
                      onChange={handleChange}
                      className="input-field"
                    />
                  </div>

                  {/* End Date & Time */}
                  <div>
                    <label className="input-label">End Date &amp; Time *</label>
                    <input
                      required
                      type="datetime-local"
                      name="endDateTime"
                      value={form.endDateTime}
                      onChange={handleChange}
                      min={form.startDateTime || undefined}
                      className="input-field"
                    />
                    {form.endDateTime && !dateRangeValid && (
                      <p className="text-[11px] text-danger-400 mt-1">End must be after start</p>
                    )}
                  </div>

                  {/* Amount */}
                  <div className="md:col-span-2">
                    <label className="input-label">Amount to Hold *</label>
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      max={basicSalary || undefined}
                      name="amount"
                      value={form.amount}
                      onChange={handleChange}
                      placeholder={selectedEmployee ? `Max ${basicSalary.toLocaleString()}` : 'Select an employee first'}
                      className={clsx('input-field', amountExceedsBasic && 'border-danger-500 focus:border-danger-500')}
                      disabled={!selectedEmployee}
                    />
                    {amountExceedsBasic && (
                      <p className="text-[11px] text-danger-400 mt-1">
                        Amount cannot exceed basic salary ({basicSalary.toLocaleString()})
                      </p>
                    )}
                    {!amountExceedsBasic && amountNum > 0 && dateRangeValid && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        ≈ {monthlyPreview.toLocaleString()} will be deducted per payroll run across {durationNum} month{durationNum > 1 ? 's' : ''}
                        {' '}(from the selected start to end date)
                      </p>
                    )}
                  </div>

                  {/* Reason */}
                  <div className="md:col-span-2">
                    <label className="input-label">Reason (optional)</label>
                    <textarea
                      name="reason"
                      value={form.reason}
                      onChange={handleChange}
                      rows={2}
                      placeholder="e.g. Equipment damage, advance recovery, policy violation..."
                      className="input-field"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2 border-t border-white/5">
                  <button type="button" onClick={onClose} className="btn-secondary" disabled={submitting}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={submitting || amountExceedsBasic || !selectedEmployee || !dateRangeValid}
                  >
                    {submitting ? 'Holding...' : 'Hold Salary'}
                  </button>
                </div>
              </form>
            )}

            {!form.employeeId && (
              <div className="flex justify-end gap-3 pt-2 border-t border-white/5">
                <button type="button" onClick={onClose} className="btn-secondary">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Active Hold Popup — fires as soon as an employee with a real,
          still-deducting Salary Hold record is selected */}
      {showActiveHoldPopup && activeHoldInfo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            className="bg-surface-900 border border-warning-500/30 rounded-2xl w-full max-w-sm shadow-glow-primary overflow-hidden"
          >
            <div className="px-6 py-5 space-y-3">
              <div className="w-10 h-10 rounded-full bg-warning-500/10 flex items-center justify-center">
                <Lock className="w-5 h-5 text-warning-400" />
              </div>
              <h3 className="font-display text-base font-bold text-white">Hold Already In Progress</h3>
              <p className="text-slate-400 text-xs leading-relaxed">
                <span className="text-white font-medium">
                  {selectedEmployee?.firstName} {selectedEmployee?.lastName}
                </span>{' '}
                already has an active salary hold of{' '}
                {(selectedEmployee?.salary?.currency || 'PKR')} {(activeHoldInfo.amount || 0).toLocaleString()}, with{' '}
                <span className="text-warning-400 font-semibold">
                  {(selectedEmployee?.salary?.currency || 'PKR')} {(activeHoldInfo.remainingBalance || 0).toLocaleString()}
                </span>{' '}
                left to be deducted through payroll.
              </p>
              <p className="text-slate-500 text-[11px] leading-relaxed">
                A new hold request can't be submitted until this one finishes deducting or is cancelled.
              </p>
            </div>
            <div className="flex justify-end px-6 py-3 border-t border-white/5">
              <button
                type="button"
                onClick={() => setShowActiveHoldPopup(false)}
                className="btn-secondary text-xs"
              >
                Got it
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
