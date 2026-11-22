import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock, Calendar, CheckCircle, XCircle, Loader2,
  ArrowLeftRight, AlertCircle, Ban, Check, Banknote, Home,
} from 'lucide-react';
import clsx from 'clsx';
import { lateRequestAPI, shiftSwapAPI, leaveAPI, workFromHomeAPI } from '@/services/api';

// ─── Formatters ──────────────────────────────────────────────────────────────
const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
const fmtDateShort = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const fmtTime = (t) => {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};
const fmtSwapDate = (d) =>
  d
    ? new Date(d).toLocaleDateString('en-US', {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      })
    : '—';

// ─── Status config ────────────────────────────────────────────────────────────
const LATE_STATUS = {
  pending:  { pill: 'bg-amber-500/15 text-amber-400 border-amber-500/25',  icon: Clock       },
  approved: { pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25', icon: CheckCircle },
  rejected: { pill: 'bg-red-500/15 text-red-400 border-red-500/25',        icon: XCircle     },
};
const SWAP_STATUS = {
  pending:   'bg-amber-500/15 text-amber-400 border-amber-500/25',
  approved:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  rejected:  'bg-red-500/15 text-red-400 border-red-500/25',
  cancelled: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
};
// Leave requests reuse the same pending/approved/rejected palette as late requests
const LEAVE_STATUS = LATE_STATUS;
const LEAVE_TYPE_STYLES = {
  Sick:   'bg-amber-500/15 text-amber-400 border-amber-500/25',
  Casual: 'bg-slate-500/15 text-slate-300 border-slate-500/25',
  Unpaid: 'bg-red-500/15 text-red-400 border-red-500/25',
};

// ─── Shared Status Pill ───────────────────────────────────────────────────────
function StatusPill({ status, statusMap }) {
  const cls = statusMap[status] || statusMap.cancelled || Object.values(statusMap)[0];
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide', cls)}>
      {status}
    </span>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ person, size = 'md' }) {
  const name = person ? `${person.firstName} ${person.lastName}` : '?';
  const initials = name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  const sz = size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs';
  return (
    <div className={clsx('rounded-full flex-shrink-0 flex items-center justify-center font-bold text-white overflow-hidden bg-gradient-to-br from-indigo-500/50 to-violet-600/50', sz)}>
      {person?.avatar
        ? <img src={person.avatar} alt={name} className="w-full h-full object-cover" />
        : initials}
    </div>
  );
}

// ─── Filter Tabs ──────────────────────────────────────────────────────────────
function FilterTabs({ value, onChange, options }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map(({ key, label, count }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={clsx(
            'px-3 py-1.5 rounded-xl text-[11px] font-medium transition-all inline-flex items-center gap-1.5',
            value === key
              ? 'bg-primary-600 text-white shadow-[0_0_12px_rgba(99,102,241,0.3)]'
              : 'bg-white/5 border border-white/10 text-slate-400 hover:bg-white/10 hover:text-white',
          )}
        >
          {label}
          <span className={clsx('px-1.5 py-0.5 rounded-full text-[9px] font-bold', value === key ? 'bg-white/20' : 'bg-white/10')}>
            {count}
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, label }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-16 flex flex-col items-center gap-3">
      <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
        <Icon className="w-5 h-5 text-slate-600" />
      </div>
      <p className="text-slate-500 text-sm">{label}</p>
    </div>
  );
}

// ─── Late Request Card ────────────────────────────────────────────────────────
function LateRequestCard({ r, actingId, onApprove, onReject }) {
  const S = LATE_STATUS[r.status] || LATE_STATUS.pending;
  const StatusIcon = S.icon;
  const isActing = actingId === r._id;
  const name = r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : 'Unknown';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="rounded-2xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.05] transition-colors p-4"
    >
      <div className="flex items-start gap-3">
        <Avatar person={r.employee} />
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-white leading-tight">{name}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {r.employee?.department?.name || 'Unassigned'} · Applied {fmtDateShort(r.createdAt)}
              </p>
            </div>
            <span className={clsx('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide', S.pill)}>
              <StatusIcon className="w-2.5 h-2.5" />{r.status}
            </span>
          </div>

          {/* Details */}
          <div className="flex items-center gap-4 mt-2.5 text-[11px] text-slate-400 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />{fmtDate(r.date)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-500" />{fmtTime(r.lateFrom)} – {fmtTime(r.lateTo)}
            </span>
          </div>

          {r.reason && (
            <p className="text-[11px] text-slate-500 italic mt-2 leading-relaxed">"{r.reason}"</p>
          )}

          {r.status !== 'pending' && r.reviewedBy && (
            <p className="text-[10px] text-slate-600 mt-2">
              Reviewed by {r.reviewedBy.firstName} {r.reviewedBy.lastName}
              {r.reviewNote && <> · <span className="italic">"{r.reviewNote}"</span></>}
            </p>
          )}

          {/* Actions */}
          {r.status === 'pending' && (
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => onApprove(r._id)}
                disabled={isActing}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-medium hover:bg-emerald-500/20 transition-all disabled:opacity-50"
              >
                {isActing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Approve
              </button>
              <button
                onClick={() => onReject(r._id)}
                disabled={isActing}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-medium hover:bg-red-500/20 transition-all disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />Decline
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Swap Request Card ────────────────────────────────────────────────────────
function SwapRequestCard({ req, resolvingId, onResolve }) {
  const isResolving = resolvingId === req._id;
  const targetName = req.targetEmployee?.firstName
    ? `${req.targetEmployee.firstName} ${req.targetEmployee.lastName}`
    : req.targetEmployeeName || '—';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="rounded-2xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.05] transition-colors p-4"
    >
      <div className="flex items-start gap-3">
        {/* Swap icon instead of single avatar */}
        <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center bg-indigo-500/15 border border-indigo-500/20">
          <ArrowLeftRight className="w-4 h-4 text-indigo-400" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-white leading-tight">
                {req.requester?.firstName} {req.requester?.lastName}
                <span className="text-slate-500 font-normal mx-1.5">↔</span>
                {targetName}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Offering: {req.requesterAssignment?.shiftType?.name || '—'}
                {req.requesterAssignment?.startTime && (
                  <span className="text-slate-600"> ({req.requesterAssignment.startTime}–{req.requesterAssignment.endTime})</span>
                )}
              </p>
            </div>
            <StatusPill status={req.status} statusMap={SWAP_STATUS} />
          </div>

          {/* Swap date */}
          {req.requestedDate && (
            <div className="flex items-center gap-1.5 mt-2.5 text-[11px] text-slate-400">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              Swap date: <span className="text-amber-400 font-medium ml-1">{fmtSwapDate(req.requestedDate)}</span>
            </div>
          )}

          {req.reason && (
            <p className="text-[11px] text-slate-500 italic mt-2 leading-relaxed">"{req.reason}"</p>
          )}

          {/* Actions */}
          {req.status === 'pending' && (
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => onResolve(req._id, 'approved')}
                disabled={isResolving}
                title="Approve swap — shifts will be automatically switched for the requested date"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-medium hover:bg-emerald-500/20 transition-all disabled:opacity-50"
              >
                {isResolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Approve
              </button>
              <button
                onClick={() => onResolve(req._id, 'rejected')}
                disabled={isResolving}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-medium hover:bg-red-500/20 transition-all disabled:opacity-50"
              >
                <Ban className="w-3.5 h-3.5" />Reject
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Leave Request Card ───────────────────────────────────────────────────────
function LeaveRequestCard({ l, actingId, onApprove, onReject, onConvert }) {
  const S = LEAVE_STATUS[l.status] || LEAVE_STATUS.pending;
  const StatusIcon = S.icon;
  const isActing = actingId === l._id;
  const name = l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : 'Unknown Employee';
  const type = l.leaveType ? l.leaveType.charAt(0).toUpperCase() + l.leaveType.slice(1) : 'Unpaid';
  const canConvertToUnpaid = l.status === 'pending' && type === 'Sick';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="rounded-2xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.05] transition-colors p-4"
    >
      <div className="flex items-start gap-3">
        <Avatar person={l.employee} />
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-white leading-tight">{name}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {l.employee?.department?.name || 'Unassigned'} · Applied {fmtDateShort(l.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide', LEAVE_TYPE_STYLES[type] || LEAVE_TYPE_STYLES.Casual)}>
                {type}
              </span>
              <span className={clsx('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide', S.pill)}>
                <StatusIcon className="w-2.5 h-2.5" />{l.status}
              </span>
            </div>
          </div>

          {/* Details */}
          <div className="flex items-center gap-4 mt-2.5 text-[11px] text-slate-400 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />{fmtDateShort(l.startDate)} → {fmtDateShort(l.endDate)}
            </span>
            <span>{l.totalDays} day{l.totalDays > 1 ? 's' : ''}</span>
          </div>

          {l.reason && (
            <p className="text-[11px] text-slate-500 italic mt-2 leading-relaxed">"{l.reason}"</p>
          )}

          {l.status !== 'pending' && l.reviewedBy && (
            <p className="text-[10px] text-slate-600 mt-2">
              Reviewed by {l.reviewedBy.firstName} {l.reviewedBy.lastName}
              {l.reviewNote && <> · <span className="italic">"{l.reviewNote}"</span></>}
            </p>
          )}

          {/* Actions */}
          {l.status === 'pending' && (
            <div className="flex gap-2 mt-3 flex-wrap">
              <button
                onClick={() => onApprove(l._id)}
                disabled={isActing}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-medium hover:bg-emerald-500/20 transition-all disabled:opacity-50"
              >
                {isActing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Approve
              </button>
              {canConvertToUnpaid && (
                <button
                  onClick={() => onConvert(l._id)}
                  disabled={isActing}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-medium hover:bg-amber-500/20 transition-all disabled:opacity-50"
                >
                  <Banknote className="w-3.5 h-3.5" />Make Unpaid
                </button>
              )}
              <button
                onClick={() => onReject(l._id)}
                disabled={isActing}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-medium hover:bg-red-500/20 transition-all disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />Decline
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function WorkFromHomeRequestCard({ request, actingId, onApprove, onReject }) {
  const status = LATE_STATUS[request.status] || LATE_STATUS.pending;
  const StatusIcon = status.icon;
  const isActing = actingId === request._id;
  const name = request.employee ? `${request.employee.firstName} ${request.employee.lastName}` : 'Unknown Employee';
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} className="rounded-2xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.05] transition-colors p-4">
      <div className="flex items-start gap-3"><Avatar person={request.employee} /><div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap"><div><p className="text-sm font-semibold text-white leading-tight">{name}</p><p className="text-[11px] text-slate-500 mt-0.5">{request.employee?.department?.name || 'Unassigned'} · Applied {fmtDateShort(request.createdAt)}</p></div><span className={clsx('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide', status.pill)}><StatusIcon className="w-2.5 h-2.5" />{request.status}</span></div>
        <div className="flex items-center gap-4 mt-2.5 text-[11px] text-slate-400 flex-wrap"><span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-slate-500" />{fmtDateShort(request.startDate)} → {fmtDateShort(request.endDate)}</span><span>{request.totalDays} day{request.totalDays > 1 ? 's' : ''}</span></div>
        {request.reason && <p className="text-[11px] text-slate-500 italic mt-2 leading-relaxed">"{request.reason}"</p>}
        {request.status !== 'pending' && request.approvedBy && <p className="text-[10px] text-slate-600 mt-2">Reviewed by {request.approvedBy.firstName} {request.approvedBy.lastName}{request.comments && <> · <span className="italic">"{request.comments}"</span></>}</p>}
        {request.status === 'pending' && <div className="flex gap-2 mt-3"><button onClick={() => onApprove(request._id)} disabled={isActing} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-medium hover:bg-emerald-500/20 transition-all disabled:opacity-50">{isActing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}Approve</button><button onClick={() => onReject(request._id)} disabled={isActing} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-medium hover:bg-red-500/20 transition-all disabled:opacity-50"><XCircle className="w-3.5 h-3.5" />Decline</button></div>}
      </div></div>
    </motion.div>
  );
}

// ─── Decline Modal (shared: late requests + leave requests) ──────────────────
function DeclineModal({ modal, onChange, onClose, onConfirm, actingId }) {
  if (!modal.open) return null;
  const isLeave = modal.kind === 'leave';
  const isWfh = modal.kind === 'wfh';
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-red-500/15 flex items-center justify-center">
              <XCircle className="w-4 h-4 text-red-400" />
            </div>
            <h3 className="font-semibold text-white text-sm">
              {isLeave ? 'Decline Leave Request' : isWfh ? 'Decline Work From Home Request' : 'Decline Late Request'}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
          {isLeave
            ? <>This leave request will be marked as <span className="text-red-400 font-medium">Rejected</span>.</>
            : isWfh
              ? <>This work from home request will be marked as <span className="text-red-400 font-medium">Rejected</span>.</>
            : <>This day will show as <span className="text-red-400 font-medium">Unapproved</span> in the attendance tracker.</>}
        </p>
        <label className="block text-[11px] text-slate-400 mb-1.5 font-medium uppercase tracking-wider">Note (optional)</label>
        <textarea
          value={modal.note}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isLeave ? 'e.g. No leave balance remaining' : isWfh ? 'e.g. On-site presence is required' : 'e.g. Please submit requests before 9 AM next time'}
          rows={3}
          className="w-full px-4 py-2.5 rounded-xl border border-white/10 bg-surface-950 text-white text-xs focus:outline-none focus:border-primary-500 resize-none"
        />
        <div className="flex gap-2.5 mt-5">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-slate-300 text-xs font-medium hover:bg-white/5 transition">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={actingId === modal.id}
            className="flex-1 py-2 rounded-xl bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {actingId === modal.id
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <XCircle className="w-3.5 h-3.5" />}
            Confirm Decline
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Convert-to-Unpaid Modal (leave only) ─────────────────────────────────────
function ConvertModal({ modal, onChange, onClose, onConfirm, actingId }) {
  if (!modal.open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white text-sm">Convert to Unpaid Leave</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
          This will mark the leave as <span className="text-amber-400 font-medium">Unpaid</span> and approve it. The employee will not be paid for these days.
        </p>
        <label className="block text-[11px] text-slate-400 mb-1.5 font-medium uppercase tracking-wider">Note (optional)</label>
        <textarea
          value={modal.comment}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. No medical certificate provided"
          rows={3}
          className="w-full px-4 py-2.5 rounded-xl border border-white/10 bg-surface-950 text-white text-xs focus:outline-none focus:border-primary-500 resize-none"
        />
        <div className="flex gap-2.5 mt-5">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-slate-300 text-xs font-medium hover:bg-white/5 transition">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={actingId === modal.leaveId}
            className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {actingId === modal.leaveId
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Banknote className="w-3.5 h-3.5" />}
            Confirm Unpaid
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }) {
  return (
    <div className={clsx('rounded-2xl border p-4', color)}>
      <p className="text-[11px] font-medium uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-[10px] mt-1 opacity-60">{sub}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
const TABS = [
  { key: 'leave', label: 'Leave Requests',      icon: Calendar       },
  { key: 'wfh',   label: 'WFH Requests',        icon: Home           },
  { key: 'late',  label: 'Late Requests',       icon: Clock          },
  { key: 'swap',  label: 'Shift Swaps Requests', icon: ArrowLeftRight },
];

export default function RequestsApprovals() {
  // ── Tab state ──
  const [activeTab, setActiveTab] = useState('leave');

  // ── Late requests ──
  const [lateRequests, setLateRequests] = useState([]);
  const [lateFilter, setLateFilter]     = useState('pending');
  const [lateLoading, setLateLoading]   = useState(true);
  const [actingId, setActingId]         = useState(null);
  const [rejectModal, setRejectModal]   = useState({ open: false, id: null, note: '', kind: 'late' });

  // ── Swap requests ──
  const [swapRequests, setSwapRequests] = useState([]);
  const [swapFilter, setSwapFilter]     = useState('pending');
  const [swapLoading, setSwapLoading]   = useState(true);
  const [resolvingSwapId, setResolvingSwapId] = useState(null);

  // ── Leave requests ──
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [leaveFilter, setLeaveFilter]     = useState('pending');
  const [leaveLoading, setLeaveLoading]   = useState(true);
  const [convertModal, setConvertModal]   = useState({ open: false, leaveId: null, comment: '' });
  const [wfhRequests, setWfhRequests] = useState([]);
  const [wfhFilter, setWfhFilter] = useState('pending');
  const [wfhLoading, setWfhLoading] = useState(true);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchLate = useCallback(async () => {
    try {
      setLateLoading(true);
      const { data } = await lateRequestAPI.getAll();
      setLateRequests(data?.data || []);
    } catch (err) {
      console.error('Failed to fetch late requests:', err);
    } finally {
      setLateLoading(false);
    }
  }, []);

  const fetchSwaps = useCallback(async () => {
    try {
      setSwapLoading(true);
      const res = await shiftSwapAPI.getAll();
      setSwapRequests(res.data?.data || []);
    } catch (err) {
      console.error('Failed to fetch swap requests:', err);
    } finally {
      setSwapLoading(false);
    }
  }, []);

  const fetchLeaves = useCallback(async () => {
    try {
      setLeaveLoading(true);
      const { data } = await leaveAPI.getAll();
      setLeaveRequests(data?.data || []);
    } catch (err) {
      console.error('Failed to fetch leave requests:', err);
    } finally {
      setLeaveLoading(false);
    }
  }, []);

  const fetchWfh = useCallback(async () => {
    try {
      setWfhLoading(true);
      const { data } = await workFromHomeAPI.getAll();
      setWfhRequests(data?.data || []);
    } catch (err) {
      console.error('Failed to fetch work from home requests:', err);
    } finally {
      setWfhLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLate();
    fetchSwaps();
    fetchLeaves();
    fetchWfh();
  }, [fetchLate, fetchSwaps, fetchLeaves, fetchWfh]);

  // ── Late actions ───────────────────────────────────────────────────────────
  const handleApproveLate = async (id) => {
    try {
      setActingId(id);
      await lateRequestAPI.approve(id);
      await fetchLate();
    } catch (err) {
      console.error('Failed to approve late request:', err);
    } finally {
      setActingId(null);
    }
  };

  const openRejectModal  = (id, kind = 'late') => setRejectModal({ open: true, id, note: '', kind });
  const closeRejectModal = () => setRejectModal({ open: false, id: null, note: '', kind: 'late' });
  const confirmReject    = async () => {
    try {
      setActingId(rejectModal.id);
      if (rejectModal.kind === 'leave') {
        await leaveAPI.reject(rejectModal.id);
        await fetchLeaves();
      } else if (rejectModal.kind === 'wfh') {
        await workFromHomeAPI.reject(rejectModal.id, { comments: rejectModal.note || undefined });
        await fetchWfh();
      } else {
        await lateRequestAPI.reject(rejectModal.id, rejectModal.note || undefined);
        await fetchLate();
      }
      closeRejectModal();
    } catch (err) {
      console.error('Failed to reject request:', err);
    } finally {
      setActingId(null);
    }
  };

  // ── Swap actions ───────────────────────────────────────────────────────────
  const handleResolveSwap = async (id, status) => {
    setResolvingSwapId(id);
    try {
      await shiftSwapAPI.updateStatus(id, { status });
      await fetchSwaps();
    } catch (err) {
      console.error('Unable to resolve swap request:', err);
    } finally {
      setResolvingSwapId(null);
    }
  };

  // ── Leave actions ──────────────────────────────────────────────────────────
  const handleApproveLeave = async (id) => {
    try {
      setActingId(id);
      await leaveAPI.approve(id);
      await fetchLeaves();
    } catch (err) {
      console.error('Failed to approve leave request:', err);
    } finally {
      setActingId(null);
    }
  };

  const handleApproveWfh = async (id) => {
    try {
      setActingId(id);
      await workFromHomeAPI.approve(id);
      await fetchWfh();
    } catch (err) {
      console.error('Failed to approve work from home request:', err);
    } finally {
      setActingId(null);
    }
  };

  const openConvertModal  = (id) => setConvertModal({ open: true, leaveId: id, comment: '' });
  const closeConvertModal = () => setConvertModal({ open: false, leaveId: null, comment: '' });
  const confirmConvert    = async () => {
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

  // ── Derived counts ─────────────────────────────────────────────────────────
  const lateCounts = {
    all:      lateRequests.length,
    pending:  lateRequests.filter((r) => r.status === 'pending').length,
    approved: lateRequests.filter((r) => r.status === 'approved').length,
    rejected: lateRequests.filter((r) => r.status === 'rejected').length,
  };
  const swapCounts = {
    all:       swapRequests.length,
    pending:   swapRequests.filter((r) => r.status === 'pending').length,
    approved:  swapRequests.filter((r) => r.status === 'approved').length,
    rejected:  swapRequests.filter((r) => r.status === 'rejected').length,
    cancelled: swapRequests.filter((r) => r.status === 'cancelled').length,
  };
  const leaveCounts = {
    all:      leaveRequests.length,
    pending:  leaveRequests.filter((l) => l.status === 'pending').length,
    approved: leaveRequests.filter((l) => l.status === 'approved').length,
    rejected: leaveRequests.filter((l) => l.status === 'rejected').length,
  };
  const wfhCounts = {
    all: wfhRequests.length,
    pending: wfhRequests.filter((r) => r.status === 'pending').length,
    approved: wfhRequests.filter((r) => r.status === 'approved').length,
    rejected: wfhRequests.filter((r) => r.status === 'rejected').length,
  };

  const totalPending = lateCounts.pending + swapCounts.pending + leaveCounts.pending + wfhCounts.pending;

  const filteredLate = lateFilter === 'all'
    ? lateRequests
    : lateRequests.filter((r) => r.status === lateFilter);

  const filteredSwaps = swapFilter === 'all'
    ? swapRequests
    : swapRequests.filter((r) => r.status === swapFilter);

  const filteredLeaves = leaveFilter === 'all'
    ? leaveRequests
    : leaveRequests.filter((l) => l.status === leaveFilter);
  const filteredWfh = wfhFilter === 'all' ? wfhRequests : wfhRequests.filter((r) => r.status === wfhFilter);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Page Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between flex-wrap gap-3"
      >
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Requests & Approvals</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {totalPending > 0
              ? <><span className="text-amber-400 font-semibold">{totalPending} pending</span> requests require your attention</>
              : 'All requests are up to date'}
          </p>
        </div>

        {/* Live badge */}
        {totalPending > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-semibold">
            <AlertCircle className="w-3.5 h-3.5" />
            {totalPending} action{totalPending !== 1 ? 's' : ''} needed
          </div>
        )}
      </motion.div>

      {/* ── Summary Stats ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"
      >
        <StatCard
          label="Leave Requests — Pending"
          value={leaveCounts.pending}
          sub="awaiting decision"
          color="border-amber-500/20 bg-amber-500/5 text-amber-300"
        />
        <StatCard
          label="Leave Requests — Approved"
          value={leaveCounts.approved}
          sub="this period"
          color="border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
        />
        <StatCard label="WFH Requests — Pending" value={wfhCounts.pending} sub="awaiting decision" color="border-cyan-500/20 bg-cyan-500/5 text-cyan-300" />
        <StatCard label="WFH Requests — Approved" value={wfhCounts.approved} sub="this period" color="border-emerald-500/20 bg-emerald-500/5 text-emerald-300" />
        <StatCard
          label="Late Requests — Pending"
          value={lateCounts.pending}
          sub="awaiting decision"
          color="border-amber-500/20 bg-amber-500/5 text-amber-300"
        />
        <StatCard
          label="Late Requests — Approved"
          value={lateCounts.approved}
          sub="this period"
          color="border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
        />
        <StatCard
          label="Swaps Requests — Pending"
          value={swapCounts.pending}
          sub="awaiting decision"
          color="border-indigo-500/20 bg-indigo-500/5 text-indigo-300"
        />
        <StatCard
          label="Swaps Requests — Approved"
          value={swapCounts.approved}
          sub="shifts auto-updated"
          color="border-violet-500/20 bg-violet-500/5 text-violet-300"
        />
      </motion.div>

      {/* ── Tab Switcher ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex gap-1.5 p-1 rounded-2xl bg-white/[0.03] border border-white/8 w-fit flex-wrap"
      >
        {TABS.map(({ key, label, icon: Icon }) => {
          const pendingCount =
            key === 'late' ? lateCounts.pending
            : key === 'swap' ? swapCounts.pending
            : key === 'wfh' ? wfhCounts.pending
            : leaveCounts.pending;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={clsx(
                'relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all',
                activeTab === key
                  ? 'bg-primary-600 text-white shadow-[0_0_14px_rgba(99,102,241,0.35)]'
                  : 'text-slate-400 hover:text-white hover:bg-white/5',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {pendingCount > 0 && (
                <span className={clsx(
                  'px-1.5 py-0.5 rounded-full text-[9px] font-bold',
                  activeTab === key ? 'bg-white/25 text-white' : 'bg-amber-500/20 text-amber-400',
                )}>
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </motion.div>

      {/* ── Tab Content ── */}
      <AnimatePresence mode="wait">
        {activeTab === 'wfh' && (
          <motion.div key="wfh" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2.5"><div className="w-7 h-7 rounded-lg bg-cyan-500/15 flex items-center justify-center"><Home className="w-3.5 h-3.5 text-cyan-400" /></div><div><p className="text-sm font-semibold text-white">Work From Home Requests</p><p className="text-[11px] text-slate-500">Employees requesting to work remotely</p></div></div>
              <FilterTabs value={wfhFilter} onChange={setWfhFilter} options={[{ key: 'all', label: 'All', count: wfhCounts.all }, { key: 'pending', label: 'Pending', count: wfhCounts.pending }, { key: 'approved', label: 'Approved', count: wfhCounts.approved }, { key: 'rejected', label: 'Rejected', count: wfhCounts.rejected }]} />
            </div>
            <div className="space-y-2.5">
              {wfhLoading ? <div className="rounded-2xl border border-white/8 bg-white/[0.02] py-16 flex flex-col items-center gap-3"><Loader2 className="w-7 h-7 text-primary-500 animate-spin" /><p className="text-slate-500 text-sm">Loading WFH requests…</p></div>
                : filteredWfh.length === 0 ? <EmptyState icon={Home} label={`No ${wfhFilter === 'all' ? '' : wfhFilter + ' '}work from home requests`} />
                : <AnimatePresence>{filteredWfh.map((request) => <WorkFromHomeRequestCard key={request._id} request={request} actingId={actingId} onApprove={handleApproveWfh} onReject={(id) => openRejectModal(id, 'wfh')} />)}</AnimatePresence>}
            </div>
          </motion.div>
        )}
        {activeTab === 'leave' && (
          <motion.div
            key="leave"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-4"
          >
            {/* Header + filter */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center">
                  <Calendar className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Leave Requests</p>
                  <p className="text-[11px] text-slate-500">Sick, casual, and unpaid leave awaiting review</p>
                </div>
              </div>
              <FilterTabs
                value={leaveFilter}
                onChange={setLeaveFilter}
                options={[
                  { key: 'all',      label: 'All',      count: leaveCounts.all      },
                  { key: 'pending',  label: 'Pending',  count: leaveCounts.pending  },
                  { key: 'approved', label: 'Approved', count: leaveCounts.approved },
                  { key: 'rejected', label: 'Rejected', count: leaveCounts.rejected },
                ]}
              />
            </div>

            {/* Cards */}
            <div className="space-y-2.5">
              {leaveLoading ? (
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] py-16 flex flex-col items-center gap-3">
                  <Loader2 className="w-7 h-7 text-primary-500 animate-spin" />
                  <p className="text-slate-500 text-sm">Loading leave requests…</p>
                </div>
              ) : filteredLeaves.length === 0 ? (
                <EmptyState icon={Calendar} label={`No ${leaveFilter === 'all' ? '' : leaveFilter + ' '}leave requests`} />
              ) : (
                <AnimatePresence>
                  {filteredLeaves.map((l) => (
                    <LeaveRequestCard
                      key={l._id}
                      l={l}
                      actingId={actingId}
                      onApprove={handleApproveLeave}
                      onReject={(id) => openRejectModal(id, 'leave')}
                      onConvert={openConvertModal}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'late' && (
          <motion.div
            key="late"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-4"
          >
            {/* Header + filter */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Late Requests</p>
                  <p className="text-[11px] text-slate-500">Employees requesting excuse for late attendance</p>
                </div>
              </div>
              <FilterTabs
                value={lateFilter}
                onChange={setLateFilter}
                options={[
                  { key: 'all',      label: 'All',      count: lateCounts.all      },
                  { key: 'pending',  label: 'Pending',  count: lateCounts.pending  },
                  { key: 'approved', label: 'Approved', count: lateCounts.approved },
                  { key: 'rejected', label: 'Rejected', count: lateCounts.rejected },
                ]}
              />
            </div>

            {/* Cards */}
            <div className="space-y-2.5">
              {lateLoading ? (
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] py-16 flex flex-col items-center gap-3">
                  <Loader2 className="w-7 h-7 text-primary-500 animate-spin" />
                  <p className="text-slate-500 text-sm">Loading late requests…</p>
                </div>
              ) : filteredLate.length === 0 ? (
                <EmptyState icon={Clock} label={`No ${lateFilter === 'all' ? '' : lateFilter + ' '}late requests`} />
              ) : (
                <AnimatePresence>
                  {filteredLate.map((r) => (
                    <LateRequestCard
                      key={r._id}
                      r={r}
                      actingId={actingId}
                      onApprove={handleApproveLate}
                      onReject={(id) => openRejectModal(id, 'late')}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'swap' && (
          <motion.div
            key="swap"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-4"
          >
            {/* Header + filter */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/15 flex items-center justify-center">
                  <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Shift Swaps Requests</p>
                  <p className="text-[11px] text-slate-500">Approving auto-creates one-day shift overrides for both employees</p>
                </div>
              </div>
              <FilterTabs
                value={swapFilter}
                onChange={setSwapFilter}
                options={[
                  { key: 'all',       label: 'All',       count: swapCounts.all       },
                  { key: 'pending',   label: 'Pending',   count: swapCounts.pending   },
                  { key: 'approved',  label: 'Approved',  count: swapCounts.approved  },
                  { key: 'rejected',  label: 'Rejected',  count: swapCounts.rejected  },
                  { key: 'cancelled', label: 'Cancelled', count: swapCounts.cancelled },
                ]}
              />
            </div>

            {/* Cards */}
            <div className="space-y-2.5">
              {swapLoading ? (
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] py-16 flex flex-col items-center gap-3">
                  <Loader2 className="w-7 h-7 text-primary-500 animate-spin" />
                  <p className="text-slate-500 text-sm">Loading swap requests…</p>
                </div>
              ) : filteredSwaps.length === 0 ? (
                <EmptyState icon={ArrowLeftRight} label={`No ${swapFilter === 'all' ? '' : swapFilter + ' '}swap requests`} />
              ) : (
                <AnimatePresence>
                  {filteredSwaps.map((req) => (
                    <SwapRequestCard
                      key={req._id}
                      req={req}
                      resolvingId={resolvingSwapId}
                      onResolve={handleResolveSwap}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Decline Modal (late + leave) ── */}
      <AnimatePresence>
        <DeclineModal
          modal={rejectModal}
          onChange={(note) => setRejectModal((m) => ({ ...m, note }))}
          onClose={closeRejectModal}
          onConfirm={confirmReject}
          actingId={actingId}
        />
      </AnimatePresence>

      {/* ── Convert-to-Unpaid Modal (leave only) ── */}
      <AnimatePresence>
        <ConvertModal
          modal={convertModal}
          onChange={(comment) => setConvertModal((m) => ({ ...m, comment }))}
          onClose={closeConvertModal}
          onConfirm={confirmConvert}
          actingId={actingId}
        />
      </AnimatePresence>
    </div>
  );
}
