import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock, Calendar, Send, XCircle, CheckCircle,
  AlertCircle, Loader2, Trash2, MessageSquare,
} from 'lucide-react';
import clsx from 'clsx';
import { lateRequestAPI } from '@/services/api';

const STATUS_MAP = {
  pending:  { cls: 'badge-warning', icon: Clock,       label: 'Pending Review' },
  approved: { cls: 'badge-success', icon: CheckCircle, label: 'Approved'       },
  rejected: { cls: 'badge-danger',  icon: XCircle,     label: 'Rejected'       },
};

const todayStr = () => new Date().toISOString().split('T')[0];

const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
});

// "09:15" -> "9:15 AM"
const fmtTime = (t) => {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};

const emptyForm = { date: todayStr(), lateFrom: '', lateTo: '', reason: '' };

export default function MyLateRequests() {
  const [requests,     setRequests]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [filter,       setFilter]       = useState('all');

  const [form,          setForm]          = useState(emptyForm);
  const [submitting,    setSubmitting]    = useState(false);
  const [formError,     setFormError]     = useState('');
  const [formSuccess,   setFormSuccess]   = useState(false);
  const [cancellingId,  setCancellingId]  = useState(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await lateRequestAPI.getMine();
      setRequests(data?.data || []);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess(false);

    if (!form.date || !form.lateFrom || !form.lateTo || !form.reason.trim()) {
      setFormError('Please fill in every field.');
      return;
    }
    if (form.lateTo <= form.lateFrom) {
      setFormError('The "until" time must be after the "from" time.');
      return;
    }

    setSubmitting(true);
    try {
      await lateRequestAPI.create(form);
      setFormSuccess(true);
      setForm(emptyForm);
      await fetchRequests();
      setTimeout(() => setFormSuccess(false), 2500);
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id) => {
    setCancellingId(id);
    try {
      await lateRequestAPI.cancel(id);
      await fetchRequests();
    } catch {
      // Cancellation failed silently — the item simply remains in the list,
      // which is enough signal without adding another toast system here.
    } finally {
      setCancellingId(null);
    }
  };

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);
  const counts = {
    pending:  requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-display text-2xl font-bold text-white">Late Requests</h1>
        <p className="text-slate-400 text-sm mt-0.5">Let HR know in advance if you'll be arriving late</p>
      </motion.div>

      {/* Submit form */}
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="glass-card p-5 space-y-4"
      >
        <h3 className="font-semibold text-white text-sm flex items-center gap-2">
          <Clock className="w-4 h-4 text-warning-400" />Submit a New Request
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="input-label">Date</label>
            <input
              type="date"
              min={todayStr()}
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="input-field text-xs w-full"
            />
          </div>
          <div>
            <label className="input-label">Late From</label>
            <input
              type="time"
              value={form.lateFrom}
              onChange={e => { setForm(f => ({ ...f, lateFrom: e.target.value })); setFormError(''); }}
              className="input-field text-xs w-full"
            />
          </div>
          <div>
            <label className="input-label">Late Until</label>
            <input
              type="time"
              value={form.lateTo}
              onChange={e => { setForm(f => ({ ...f, lateTo: e.target.value })); setFormError(''); }}
              className="input-field text-xs w-full"
            />
            <p className="text-[10px] text-slate-600 mt-1">The window you might arrive within</p>
          </div>
        </div>

        <div>
          <label className="input-label">Reason</label>
          <textarea
            rows={3}
            value={form.reason}
            onChange={e => { setForm(f => ({ ...f, reason: e.target.value })); setFormError(''); }}
            placeholder="e.g. Doctor's appointment in the morning, will head to office right after"
            className="input-field text-xs w-full resize-none"
          />
        </div>

        {formError && (
          <div className="flex items-center gap-2 bg-danger-500/10 border border-danger-500/20 rounded-xl px-3 py-2 text-danger-400 text-xs">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{formError}
          </div>
        )}
        {formSuccess && (
          <div className="flex items-center gap-2 bg-accent-500/10 border border-accent-500/20 rounded-xl px-3 py-2 text-accent-400 text-xs">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />Request submitted — awaiting review.
          </div>
        )}

        <button type="submit" disabled={submitting} className="btn-primary text-xs justify-center disabled:opacity-60 disabled:cursor-not-allowed">
          {submitting
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Submitting…</>
            : <><Send className="w-3.5 h-3.5" />Submit Request</>}
        </button>
      </motion.form>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          ['all', 'All', requests.length],
          ['pending', 'Pending', counts.pending],
          ['approved', 'Approved', counts.approved],
          ['rejected', 'Rejected', counts.rejected],
        ].map(([v, l, c]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={clsx('px-4 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5',
              filter === v ? 'bg-primary-600 text-white' : 'btn-secondary')}>
            {l} <span className="px-1.5 py-0.5 rounded-full bg-white/10 text-[10px]">{c}</span>
          </button>
        ))}
      </div>

      {/* Requests list */}
      <div className="space-y-3">
        {loading ? (
          <div className="glass-card p-16 flex-center flex-col gap-3">
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
            <p className="text-slate-500 text-sm">Loading your requests…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-card p-16 flex-center flex-col gap-3">
            <Clock className="w-8 h-8 text-slate-600" />
            <p className="text-slate-500 text-sm">No {filter === 'all' ? '' : filter} late requests</p>
          </div>
        ) : (
          <AnimatePresence>
            {filtered.map((r) => {
              const S = STATUS_MAP[r.status] || STATUS_MAP.pending;
              const StatusIcon = S.icon;
              const isCancelling = cancellingId === r._id;
              return (
                <motion.div key={r._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
                  className="glass-card p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-white flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />{fmtDate(r.date)}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Expected late window: <span className="text-slate-200">{fmtTime(r.lateFrom)} – {fmtTime(r.lateTo)}</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-1.5 italic">"{r.reason}"</p>
                      {r.status === 'rejected' && r.reviewNote && (
                        <p className="text-[11px] text-danger-400 mt-1.5 flex items-center gap-1">
                          <MessageSquare className="w-3 h-3 flex-shrink-0" />HR note: {r.reviewNote}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className={clsx('badge text-[10px]', S.cls)}>
                        <StatusIcon className="w-2.5 h-2.5" />{S.label}
                      </span>
                      {r.status === 'pending' && (
                        <button onClick={() => handleCancel(r._id)} disabled={isCancelling}
                          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-danger-400 transition-colors disabled:opacity-50">
                          {isCancelling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}