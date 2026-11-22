import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, CreditCard, AlertTriangle, CheckCircle, ChevronRight, Banknote, Calendar, Percent } from 'lucide-react';
import { loanAPI, payrollAPI } from '@/services/api';
import clsx from 'clsx';

const fmt = (n) => `PKR ${(n || 0).toLocaleString()}`;
const initials = (name) => name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?';

export default function LoanSetupModal({ onClose, onSuccess }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [employees,       setEmployees]       = useState([]);
  const [loadingEmps,     setLoadingEmps]     = useState(true);
  const [submitting,      setSubmitting]      = useState(false);
  const [error,           setError]           = useState('');
  const [successMsg,      setSuccessMsg]      = useState('');
  const [search,          setSearch]          = useState('');
  const [selectedEmp,     setSelectedEmp]     = useState(null);

  // Form fields
  const [loanAmount,         setLoanAmount]         = useState('');
  const [interestPercentage, setInterestPercentage] = useState('0');
  const [tenureMonths,       setTenureMonths]        = useState('');
  const [termsAndConditions, setTermsAndConditions] = useState('');
  const [loanDate,           setLoanDate]           = useState(() => new Date().toISOString().slice(0, 10));

  // ── Load employees ─────────────────────────────────────────────────────────
  useEffect(() => {
    const now = new Date();
    payrollAPI
      .getEligible({ month: now.getMonth() + 1, year: now.getFullYear() })
      .then(({ data }) => setEmployees(data?.data || []))
      .catch(() => setEmployees([]))
      .finally(() => setLoadingEmps(false));
  }, []);

  // ── Filtered employee list ─────────────────────────────────────────────────
  const filteredEmps = useMemo(() => {
    const q = search.toLowerCase();
    return employees.filter(
      (e) =>
        !q ||
        e.name?.toLowerCase().includes(q) ||
        e.employeeId?.toLowerCase().includes(q) ||
        e.dept?.toLowerCase().includes(q)
    );
  }, [employees, search]);

  // ── Live EMI preview ───────────────────────────────────────────────────────
  const preview = useMemo(() => {
    const principal = parseFloat(loanAmount) || 0;
    const rate      = parseFloat(interestPercentage) || 0;
    const months    = parseInt(tenureMonths) || 0;
    if (principal <= 0 || months <= 0) return null;
    const interest        = principal * (rate / 100);
    const totalRepayment  = Math.round(principal + interest);
    const monthlyEMI      = Math.round(totalRepayment / months);
    return { totalRepayment, monthlyEMI, interest };
  }, [loanAmount, interestPercentage, tenureMonths]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setError('');
    if (!selectedEmp || !loanAmount || !tenureMonths || !loanDate) {
      setError('Please select an employee and fill in all required fields.');
      return;
    }
    try {
      setSubmitting(true);
      const payload = {
        employee:           selectedEmp._id,
        loanAmount:         parseFloat(loanAmount),
        interestPercentage: parseFloat(interestPercentage || 0),
        tenureMonths:       parseInt(tenureMonths),
        termsAndConditions,
        loanDate,
      };
      const { data } = await loanAPI.create(payload);
      if (data?.success) {
        setSuccessMsg(
          `Loan of ${fmt(parseFloat(loanAmount))} set up for ${selectedEmp.name}. Monthly EMI: ${fmt(preview?.monthlyEMI)} will auto-deduct on payroll run.`
        );
      } else {
        setError(data?.message || 'Failed to create loan.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'An error occurred while setting up the loan.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDone = () => {
    onSuccess?.();
    onClose();
  };

  // ── Reset form when employee changes ──────────────────────────────────────
  const handleSelectEmp = (emp) => {
    setSelectedEmp(emp);
    setLoanAmount('');
    setInterestPercentage('0');
    setTenureMonths('');
    setTermsAndConditions('');
    setLoanDate(new Date().toISOString().slice(0, 10));
    setError('');
    setSuccessMsg('');
    setSearch('');
  };

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ────────────────────────────────────────────────────── */}
          <div className="p-5 border-b border-white/5 flex items-center justify-between flex-shrink-0">
            <div>
              <h2 className="font-display font-bold text-white text-base flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary-400" />
                Setup Employee Loan
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure loan — EMI deducts automatically on each payroll run
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={submitting}
              className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── Success screen ────────────────────────────────────────────── */}
          {successMsg ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-accent-500/15 border border-accent-500/20 flex items-center justify-center">
                <CheckCircle className="w-7 h-7 text-accent-400" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm mb-1">Loan Configured Successfully</p>
                <p className="text-slate-400 text-xs leading-relaxed max-w-sm">{successMsg}</p>
              </div>
              <button onClick={handleDone} className="btn-primary text-xs flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" />Done
              </button>
            </div>
          ) : (
            <div className="flex flex-1 overflow-hidden">

              {/* ── Left: Employee picker ──────────────────────────────── */}
              <div className="w-64 flex-shrink-0 border-r border-white/5 flex flex-col">
                <div className="p-3 border-b border-white/5">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search employees…"
                    className="input-field py-2 text-xs w-full"
                  />
                </div>
                <div className="flex-1 overflow-y-auto">
                  {loadingEmps ? (
                    <div className="p-6 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-primary-400" />
                      Loading employees…
                    </div>
                  ) : filteredEmps.length === 0 ? (
                    <div className="p-6 text-center text-slate-500 text-xs">No employees found</div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {filteredEmps.map((emp) => {
                        const isSelected = selectedEmp?._id === emp._id;
                        return (
                          <div
                            key={emp._id}
                            onClick={() => handleSelectEmp(emp)}
                            className={clsx(
                              'flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors',
                              isSelected
                                ? 'bg-primary-500/10 border-r-2 border-primary-500'
                                : 'hover:bg-white/3'
                            )}
                          >
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500/30 to-accent-500/30 flex items-center justify-center flex-shrink-0">
                              <span className="text-[10px] font-bold text-white">{initials(emp.name)}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={clsx('text-xs font-medium truncate', isSelected ? 'text-white' : 'text-slate-300')}>
                                {emp.name}
                              </p>
                              <p className="text-[10px] text-slate-500 truncate">{emp.employeeId} · {emp.dept}</p>
                            </div>
                            {isSelected && <ChevronRight className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Right: Loan form ───────────────────────────────────── */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {!selectedEmp ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center">
                      <CreditCard className="w-5 h-5 text-slate-600" />
                    </div>
                    <p className="text-slate-500 text-xs">Select an employee to configure their loan</p>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 overflow-y-auto p-5 space-y-4">
                      {/* Selected employee card */}
                      <div className="flex items-center gap-3 p-3 bg-primary-500/10 border border-primary-500/20 rounded-xl">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-white">{initials(selectedEmp.name)}</span>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white">{selectedEmp.name}</p>
                          <p className="text-xs text-slate-400">{selectedEmp.dept} · {selectedEmp.employeeId}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-medium text-slate-200">{fmt(selectedEmp.basicSalary)}</p>
                          <p className="text-[10px] text-slate-500">basic / mo</p>
                        </div>
                      </div>

                      {/* Error */}
                      {error && (
                        <div className="flex items-start gap-2 p-3 bg-danger-500/10 border border-danger-500/20 rounded-xl text-danger-400 text-xs">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                          {error}
                        </div>
                      )}

                      {/* Loan Amount */}
                      <div>
                        <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                          Loan Principal *
                        </label>
                        <div className="relative">
                          <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                          <input
                            type="number"
                            min="1"
                            placeholder="e.g. 50000"
                            value={loanAmount}
                            onChange={(e) => setLoanAmount(e.target.value)}
                            className="input-field py-2 text-xs pl-9 w-full"
                          />
                        </div>
                      </div>

                      {/* Interest + Tenure row */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                            Interest %
                          </label>
                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              placeholder="0"
                              value={interestPercentage}
                              onChange={(e) => setInterestPercentage(e.target.value)}
                              className="input-field py-2 text-xs pr-7 w-full"
                            />
                            <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                            Tenure (Months) *
                          </label>
                          <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                            <input
                              type="number"
                              min="1"
                              placeholder="e.g. 12"
                              value={tenureMonths}
                              onChange={(e) => setTenureMonths(e.target.value)}
                              className="input-field py-2 text-xs pl-9 w-full"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Loan Date */}
                      <div>
                        <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                          Loan Date *
                        </label>
                        <div className="relative">
                          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                          <input
                            type="date"
                            value={loanDate}
                            onChange={(e) => setLoanDate(e.target.value)}
                            className="input-field py-2 text-xs pl-9 w-full"
                          />
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">
                          Date the employee received/took the loan
                        </p>
                      </div>

                      {/* Live EMI preview */}
                      {preview && (
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: 'Interest',        value: fmt(preview.interest),       color: 'text-warning-400', bg: 'bg-warning-500/10 border-warning-500/20' },
                            { label: 'Total Repayment', value: fmt(preview.totalRepayment), color: 'text-primary-400', bg: 'bg-primary-500/10 border-primary-500/20' },
                            { label: 'Monthly EMI',     value: fmt(preview.monthlyEMI),     color: 'text-accent-400',  bg: 'bg-accent-500/10 border-accent-500/20'   },
                          ].map((s) => (
                            <div key={s.label} className={clsx('rounded-xl p-3 text-center border', s.bg)}>
                              <p className={clsx('text-sm font-display font-bold', s.color)}>{s.value}</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* EMI vs salary check */}
                      {preview && selectedEmp.basicSalary > 0 && (
                        <div className={clsx(
                          'flex items-start gap-2 p-3 rounded-xl border text-xs',
                          preview.monthlyEMI > selectedEmp.basicSalary * 0.5
                            ? 'bg-danger-500/10 border-danger-500/20 text-danger-400'
                            : 'bg-white/5 border-white/10 text-slate-400'
                        )}>
                          {preview.monthlyEMI > selectedEmp.basicSalary * 0.5
                            ? <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                            : <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-accent-400" />
                          }
                          EMI is{' '}
                          <strong className="text-white">
                            {Math.round((preview.monthlyEMI / selectedEmp.basicSalary) * 100)}%
                          </strong>{' '}
                          of basic salary
                          {preview.monthlyEMI > selectedEmp.basicSalary * 0.5 && ' — exceeds 50% threshold'}
                        </div>
                      )}

                      {/* Terms */}
                      <div>
                        <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                          Internal Remarks / Terms
                        </label>
                        <textarea
                          rows="2"
                          placeholder="Approval context, conditions, or notes…"
                          value={termsAndConditions}
                          onChange={(e) => setTermsAndConditions(e.target.value)}
                          className="input-field py-2 text-xs w-full resize-none"
                        />
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-white/5 flex items-center justify-between flex-shrink-0">
                      <p className="text-[10px] text-slate-500">
                        EMI auto-deducts each payroll run until fully paid
                      </p>
                      <div className="flex gap-2">
                        <button onClick={onClose} disabled={submitting} className="btn-secondary text-xs">
                          Cancel
                        </button>
                        <button
                          onClick={handleSubmit}
                          disabled={submitting || !selectedEmp || !loanAmount || !tenureMonths || !loanDate}
                          className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-40"
                        >
                          {submitting
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</>
                            : <><CheckCircle className="w-3.5 h-3.5" />Confirm Loan</>}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}