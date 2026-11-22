import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, CheckCircle, XCircle, Clock, Loader2, Banknote } from 'lucide-react';
import clsx from 'clsx';
import { leaveAPI } from '@/services/api';

const TYPE_COLORS = { Sick: 'badge-warning', Casual: 'badge-neutral', Unpaid: 'badge-danger' };
const STATUS_MAP  = {
  pending:  { cls: 'badge-warning', icon: Clock       },
  approved: { cls: 'badge-success', icon: CheckCircle },
  rejected: { cls: 'badge-danger',  icon: XCircle     },
};

export default function LeaveApprovals() {
  const [leaves, setLeaves] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [convertModal, setConvertModal] = useState({ open: false, leaveId: null, comment: '' });

  const formatDateShort = (dateVal) => {
    if (!dateVal) return '—';
    const d = new Date(dateVal);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const mapDbToUI = (dbLeaves) => {
    return dbLeaves.map((l) => ({
      id: l._id,
      name: l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : 'Unknown Employee',
      dept: l.employee?.department?.name || 'Unassigned',
      type: l.leaveType ? l.leaveType.charAt(0).toUpperCase() + l.leaveType.slice(1) : 'Unpaid',
      from: formatDateShort(l.startDate),
      to: formatDateShort(l.endDate),
      days: l.totalDays,
      reason: l.reason,
      status: l.status,
      applied: formatDateShort(l.createdAt),
    }));
  };

  const fetchLeaves = async () => {
    try {
      setLoading(true);
      const { data } = await leaveAPI.getAll();
      setLeaves(mapDbToUI(data.data || []));
    } catch (err) {
      console.error('Failed to fetch leave requests:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaves();
  }, []);

  const handle = async (id, action) => {
    try {
      setActingId(id);
      if (action === 'approve') {
        await leaveAPI.approve(id);
      } else {
        await leaveAPI.reject(id);
      }
      await fetchLeaves();
    } catch (err) {
      console.error('Failed to update leave request:', err);
    } finally {
      setActingId(null);
    }
  };

  const openConvertModal = (id) => setConvertModal({ open: true, leaveId: id, comment: '' });
  const closeConvertModal = () => setConvertModal({ open: false, leaveId: null, comment: '' });

  const confirmConvert = async () => {
    try {
      setActingId(convertModal.leaveId);
      await leaveAPI.convertToUnpaid(convertModal.leaveId, { comments: convertModal.comment || undefined });
      closeConvertModal();
      await fetchLeaves();
    } catch (err) {
      console.error('Failed to convert leave to unpaid:', err);
    } finally {
      setActingId(null);
    }
  };

  const filtered = filter === 'all' ? leaves : leaves.filter(l => l.status === filter);
  const counts = {
    pending: leaves.filter(l => l.status === 'pending').length,
    approved: leaves.filter(l => l.status === 'approved').length,
    rejected: leaves.filter(l => l.status === 'rejected').length,
  };

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Leave Approvals</h1>
          <p className="text-slate-400 text-sm mt-0.5">{counts.pending} pending requests require your action</p>
        </div>
      </motion.div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[['all', 'All', leaves.length], ['pending', 'Pending', counts.pending], ['approved', 'Approved', counts.approved], ['rejected', 'Rejected', counts.rejected]].map(([v, l, c]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={clsx('px-4 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5',
              filter === v ? 'bg-primary-600 text-white' : 'btn-secondary')}>
            {l} <span className="px-1.5 py-0.5 rounded-full bg-white/10 text-[10px]">{c}</span>
          </button>
        ))}
      </div>

      {/* Leave cards */}
      <div className="space-y-3">
        {loading ? (
          <div className="glass-card p-16 flex-center flex-col gap-3">
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
            <p className="text-slate-500 text-sm">Loading leave requests...</p>
          </div>
        ) : (
          <AnimatePresence>
            {filtered.map((leave) => {
              const S = STATUS_MAP[leave.status] || STATUS_MAP.pending;
              const StatusIcon = S.icon;
              const isActing = actingId === leave.id;
              const canConvertToUnpaid = leave.status === 'pending' && leave.type === 'Sick';
              return (
                <motion.div key={leave.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
                  className="glass-card p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500/40 to-accent-500/40 flex-center flex-shrink-0">
                      <span className="text-xs font-bold text-white">{leave.name.split(' ').map(n => n[0]).join('')}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex-between flex-wrap gap-2">
                        <div>
                          <p className="text-sm font-semibold text-white">{leave.name}</p>
                          <p className="text-xs text-slate-400">{leave.dept} · Applied {leave.applied}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={clsx('badge text-[10px]', TYPE_COLORS[leave.type] || 'badge-neutral')}>{leave.type}</span>
                          <span className={clsx('badge text-[10px]', S.cls)}>
                            <StatusIcon className="w-2.5 h-2.5" />{leave.status}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                        <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{leave.from} → {leave.to}</span>
                        <span>{leave.days} day{leave.days > 1 ? 's' : ''}</span>
                        <span className="text-slate-500 italic">"{leave.reason}"</span>
                      </div>
                      {leave.status === 'pending' && (
                        <div className="flex gap-2 mt-3 flex-wrap">
                          <button onClick={() => handle(leave.id, 'approve')} disabled={isActing}
                            className="flex items-center gap-1.5 px-4 py-1.5 bg-accent-500/10 border border-accent-500/20 text-accent-400 text-xs rounded-xl hover:bg-accent-500/20 transition-all disabled:opacity-50">
                            <CheckCircle className="w-3.5 h-3.5" />Approve
                          </button>
                          {canConvertToUnpaid && (
                            <button onClick={() => openConvertModal(leave.id)} disabled={isActing}
                              className="flex items-center gap-1.5 px-4 py-1.5 bg-warning-500/10 border border-warning-500/20 text-warning-400 text-xs rounded-xl hover:bg-warning-500/20 transition-all disabled:opacity-50">
                              <Banknote className="w-3.5 h-3.5" />Make Unpaid
                            </button>
                          )}
                          <button onClick={() => handle(leave.id, 'reject')} disabled={isActing}
                            className="flex items-center gap-1.5 px-4 py-1.5 bg-danger-500/10 border border-danger-500/20 text-danger-400 text-xs rounded-xl hover:bg-danger-500/20 transition-all disabled:opacity-50">
                            <XCircle className="w-3.5 h-3.5" />Decline
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
        {!loading && filtered.length === 0 && (
          <div className="glass-card p-16 flex-center flex-col gap-3">
            <Calendar className="w-8 h-8 text-slate-600" />
            <p className="text-slate-500 text-sm">No {filter} leave requests</p>
          </div>
        )}
      </div>

      {/* Convert-to-unpaid confirmation modal */}
      <AnimatePresence>
        {convertModal.open && (
          <div className="fixed inset-0 bg-black/60 z-50 flex-center p-4" onClick={closeConvertModal}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-md p-6"
              onClick={e => e.stopPropagation()}>
              <div className="flex-between mb-4">
                <h3 className="font-display font-bold text-white">Convert to Unpaid Leave</h3>
                <button onClick={closeConvertModal} className="text-slate-400 hover:text-white">✕</button>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                This will mark the leave as <span className="text-warning-400 font-medium">Unpaid</span> and approve it. The employee will not be paid for these days.
              </p>
              <label className="input-label">Note (optional)</label>
              <textarea
                value={convertModal.comment}
                onChange={e => setConvertModal({ ...convertModal, comment: e.target.value })}
                placeholder="e.g. No medical certificate provided"
                rows={3}
                className="input-field text-sm resize-none"
              />
              <div className="flex gap-2 mt-5">
                <button onClick={closeConvertModal} className="btn-secondary flex-1 justify-center text-xs">Cancel</button>
                <button onClick={confirmConvert} disabled={actingId === convertModal.leaveId} className="btn-primary flex-1 justify-center text-xs">
                  {actingId === convertModal.leaveId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Banknote className="w-3.5 h-3.5" />}
                  Confirm Unpaid
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}