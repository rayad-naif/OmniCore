import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Plus, CheckCircle, XCircle, Clock, AlertTriangle, Loader2, Home } from 'lucide-react';
import clsx from 'clsx';
import { leaveAPI, workFromHomeAPI } from '@/services/api';

const STATUS_MAP = {
  approved: { cls: 'badge-success', icon: CheckCircle, color: 'text-accent-400' },
  pending:  { cls: 'badge-warning', icon: Clock,       color: 'text-warning-400' },
  rejected: { cls: 'badge-danger',  icon: XCircle,     color: 'text-danger-400' },
};

const LEAVE_TYPES = [
  { value: 'sick',   label: 'Sick / Emergency' },
  { value: 'casual', label: 'Casual' },
  { value: 'unpaid', label: 'Unpaid' },
];
const TYPE_LABEL = Object.fromEntries(LEAVE_TYPES.map(t => [t.value, t.label]));
const CASUAL_QUOTA = 10;

export default function MyLeaves() {
  const [showApply, setShowApply] = useState(false);
  const [form, setForm] = useState({ type: 'casual', from: '', to: '', reason: '' });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showWfhApply, setShowWfhApply] = useState(false);
  const [wfhForm, setWfhForm] = useState({ from: '', to: '', reason: '' });
  const [wfhHistory, setWfhHistory] = useState([]);
  const [wfhLoading, setWfhLoading] = useState(true);
  const [wfhSubmitting, setWfhSubmitting] = useState(false);

  const mapDbToUI = (dbLeaves) => {
    return dbLeaves.map((l) => ({
      id: l._id,
      type: l.leaveType || '',
      from: l.startDate ? l.startDate.split('T')[0] : '',
      to: l.endDate ? l.endDate.split('T')[0] : '',
      days: l.totalDays,
      reason: l.reason,
      status: l.status,
      approvedBy: l.approvedBy ? `${l.approvedBy.firstName} ${l.approvedBy.lastName}` : '—',
      comments: l.comments || '',
    }));
  };

  const fetchLeaves = async () => {
    try {
      setLoading(true);
      const { data } = await leaveAPI.getAll();
      setHistory(mapDbToUI(data.data || []));
    } catch (err) {
      console.error('Failed to fetch leaves:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchWfhRequests = async () => {
    try {
      setWfhLoading(true);
      const { data } = await workFromHomeAPI.getAll();
      setWfhHistory(data.data || []);
    } catch (err) {
      console.error('Failed to fetch work from home requests:', err);
    } finally {
      setWfhLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaves();
    fetchWfhRequests();
  }, []);

  const calcDays = () => {
    if (!form.from || !form.to) return 0;
    const diff = (new Date(form.to) - new Date(form.from)) / 86400000 + 1;
    return Math.max(0, Math.round(diff));
  };

  const handleWfhSubmit = async () => {
    if (!wfhForm.from || !wfhForm.to || !wfhForm.reason || wfhSubmitting) return;
    try {
      setWfhSubmitting(true);
      await workFromHomeAPI.create({ startDate: wfhForm.from, endDate: wfhForm.to, reason: wfhForm.reason });
      setWfhForm({ from: '', to: '', reason: '' });
      setShowWfhApply(false);
      await fetchWfhRequests();
    } catch (err) {
      console.error('Failed to submit work from home request:', err);
    } finally {
      setWfhSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.from || !form.to || !form.reason || submitting) return;
    try {
      setSubmitting(true);
      await leaveAPI.create({
        leaveType: form.type,
        startDate: form.from,
        endDate: form.to,
        totalDays: calcDays(),
        reason: form.reason,
      });
      setForm({ type: 'casual', from: '', to: '', reason: '' });
      setShowApply(false);
      await fetchLeaves();
    } catch (err) {
      console.error('Failed to submit leave:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Only Casual is quota-limited (10/year). Filtering by the current
  // calendar year is what makes the quota "renew" automatically each January.
  const getCasualBalance = () => {
    const currentYear = new Date().getFullYear();
    const used = history
      .filter((l) =>
        l.type === 'casual' &&
        l.status === 'approved' &&
        l.from && new Date(l.from).getFullYear() === currentYear
      )
      .reduce((sum, l) => sum + l.days, 0);
    return { total: CASUAL_QUOTA, used, remaining: Math.max(0, CASUAL_QUOTA - used) };
  };
  const casualBalance = getCasualBalance();

  const safeDateString = (dateVal) => {
    if (!dateVal) return '—';
    const d = new Date(dateVal);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">My Leaves</h1>
          <p className="text-slate-400 text-sm mt-0.5">Track and manage your leave requests</p>
        </div>
        <button onClick={() => setShowApply(true)} className="btn-primary text-xs">
          <Plus className="w-3.5 h-3.5" />Apply for Leave
        </button>
      </motion.div>

      {/* Work from home requests */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/5 flex-between gap-3">
          <div>
            <h3 className="font-semibold text-white text-sm">Work From Home Requests</h3>
            <p className="text-xs text-slate-500 mt-0.5">Request approval to work remotely</p>
          </div>
          <button onClick={() => setShowWfhApply(true)} className="btn-secondary text-xs">
            <Home className="w-3.5 h-3.5" />Request WFH
          </button>
        </div>
        <div className="divide-y divide-white/5">
          {wfhLoading ? (
            <div className="p-8 flex-center gap-2"><Loader2 className="w-4 h-4 text-primary-500 animate-spin" /><p className="text-slate-500 text-sm">Loading WFH requests...</p></div>
          ) : wfhHistory.length === 0 ? (
            <div className="p-8 flex-center flex-col gap-2"><Home className="w-6 h-6 text-slate-600" /><p className="text-slate-500 text-sm">No work from home requests found</p></div>
          ) : wfhHistory.map((request) => {
            const s = STATUS_MAP[request.status] || STATUS_MAP.pending;
            const StatusIcon = s.icon;
            return <div key={request._id} className="p-4 hover:bg-white/5 transition-colors">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent-500/10 flex-center flex-shrink-0"><Home className="w-4 h-4 text-accent-400" /></div>
                <div className="flex-1 min-w-0"><div className="flex-between flex-wrap gap-2 mb-1"><div className="flex items-center gap-2"><span className="text-sm font-medium text-white">Work From Home</span><span className={clsx('badge text-[10px]', s.cls)}>{request.status}</span></div><span className="text-[10px] text-slate-500">{request.totalDays} day{request.totalDays > 1 ? 's' : ''}</span></div>
                  <p className="text-xs text-slate-400 mb-1">{safeDateString(request.startDate)}{request.startDate !== request.endDate && ` → ${safeDateString(request.endDate)}`} · {request.reason}</p>
                  {request.comments && <p className="text-[10px] text-slate-500 flex items-center gap-1"><StatusIcon className={clsx('w-3 h-3', s.color)} />{request.approvedBy ? `${request.approvedBy.firstName} ${request.approvedBy.lastName}` : 'Manager'}: "{request.comments}"</p>}
                </div>
              </div>
            </div>;
          })}
        </div>
      </motion.div>

      {/* Casual leave balance */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-4">
          <div className="flex-between mb-3">
            <p className="text-xs font-semibold text-white">Casual Leave ({new Date().getFullYear()})</p>
            <span className="text-[10px] text-slate-500">{casualBalance.used}/{casualBalance.total}</span>
          </div>
          <p className="text-3xl font-display font-bold" style={{ color: '#f59e0b' }}>{casualBalance.remaining}</p>
          <p className="text-[10px] text-slate-500 mb-2">days remaining</p>
          <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${(casualBalance.remaining / casualBalance.total) * 100}%`, background: '#f59e0b' }} />
          </div>
        </motion.div>
      </div>

      {/* Leave history */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/5 flex-between">
          <h3 className="font-semibold text-white text-sm">Leave History</h3>
          <span className="text-xs text-slate-500">{history.length} records</span>
        </div>
        <div className="divide-y divide-white/5">
          {loading ? (
            <div className="p-16 flex-center flex-col gap-3">
              <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
              <p className="text-slate-500 text-sm">Loading leave history...</p>
            </div>
          ) : history.length === 0 ? (
            <div className="p-16 flex-center flex-col gap-3">
              <Calendar className="w-8 h-8 text-slate-600" />
              <p className="text-slate-500 text-sm">No leave records found</p>
            </div>
          ) : (
            history.map((leave) => {
              const s = STATUS_MAP[leave.status] || STATUS_MAP.pending;
              const StatusIcon = s.icon;
              const typeLabel = TYPE_LABEL[leave.type] || leave.type;
              return (
                <div key={leave.id} className="p-4 hover:bg-white/5 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary-500/10 flex-center flex-shrink-0 mt-0.5">
                      <Calendar className="w-4 h-4 text-primary-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex-between flex-wrap gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">{typeLabel} Leave</span>
                          <span className={clsx('badge text-[10px]', s.cls)}>{leave.status}</span>
                        </div>
                        <span className="text-[10px] text-slate-500">{leave.days} day{leave.days > 1 ? 's' : ''}</span>
                      </div>
                      <p className="text-xs text-slate-400 mb-1">
                        {safeDateString(leave.from)}
                        {leave.from !== leave.to && ` → ${safeDateString(leave.to)}`}
                        {' · '}{leave.reason}
                      </p>
                      {leave.comments && (
                        <p className="text-[10px] text-slate-500 flex items-center gap-1">
                          <StatusIcon className={clsx('w-3 h-3', s.color)} />{leave.approvedBy}: "{leave.comments}"
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </motion.div>

      {/* Apply modal */}
      <AnimatePresence>
        {showApply && (
          <div className="fixed inset-0 bg-black/60 z-50 flex-center p-4" onClick={() => setShowApply(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-md p-6"
              onClick={e => e.stopPropagation()}>
              <div className="flex-between mb-5">
                <h3 className="font-display font-bold text-white">Apply for Leave</h3>
                <button onClick={() => setShowApply(false)} className="text-slate-400 hover:text-white">✕</button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="input-label">Leave Type</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="input-field text-sm">
                    {LEAVE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="input-label">From Date</label>
                    <input type="date" value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} className="input-field text-sm" />
                  </div>
                  <div>
                    <label className="input-label">To Date</label>
                    <input type="date" value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} className="input-field text-sm" />
                  </div>
                </div>
                {calcDays() > 0 && (
                  <div className="p-3 bg-primary-500/10 border border-primary-500/20 rounded-xl text-xs text-primary-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {form.type === 'casual'
                      ? `${calcDays()} day${calcDays() > 1 ? 's' : ''} will be deducted from your Casual balance (${casualBalance.remaining} remaining).`
                      : `${calcDays()} day${calcDays() > 1 ? 's' : ''} requested.`}
                  </div>
                )}
                <div>
                  <label className="input-label">Reason</label>
                  <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
                    placeholder="Brief reason for your leave..." rows={3}
                    className="input-field text-sm resize-none" />
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setShowApply(false)} className="btn-secondary flex-1 justify-center text-xs">Cancel</button>
                <button onClick={handleSubmit} disabled={submitting} className="btn-primary flex-1 justify-center text-xs">
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  Submit Request
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showWfhApply && (
          <div className="fixed inset-0 bg-black/60 z-50 flex-center p-4" onClick={() => setShowWfhApply(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
              <div className="flex-between mb-5"><h3 className="font-display font-bold text-white">Request Work From Home</h3><button onClick={() => setShowWfhApply(false)} className="text-slate-400 hover:text-white">×</button></div>
              <div className="space-y-4"><div className="grid grid-cols-2 gap-3"><div><label className="input-label">From Date</label><input type="date" value={wfhForm.from} onChange={e => setWfhForm({ ...wfhForm, from: e.target.value })} className="input-field text-sm" /></div><div><label className="input-label">To Date</label><input type="date" value={wfhForm.to} onChange={e => setWfhForm({ ...wfhForm, to: e.target.value })} className="input-field text-sm" /></div></div><div><label className="input-label">Reason</label><textarea value={wfhForm.reason} onChange={e => setWfhForm({ ...wfhForm, reason: e.target.value })} placeholder="Why do you need to work from home?" rows={3} className="input-field text-sm resize-none" /></div></div>
              <div className="flex gap-2 mt-5"><button onClick={() => setShowWfhApply(false)} className="btn-secondary flex-1 justify-center text-xs">Cancel</button><button onClick={handleWfhSubmit} disabled={wfhSubmitting} className="btn-primary flex-1 justify-center text-xs">{wfhSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Home className="w-3.5 h-3.5" />}Submit Request</button></div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
