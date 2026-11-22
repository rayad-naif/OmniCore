import { useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { Loader2, Clock, Repeat, X, Ban, CalendarDays, User as UserIcon } from 'lucide-react';
import { shiftAssignmentAPI, shiftSwapAPI } from '@/services/api';
import { selectUser } from '@/store/slices/authSlice';
import toast from 'react-hot-toast';

const WORK_MODE_LABELS = {
  office: 'Office',
  remote: 'Remote',
  hybrid: 'Hybrid',
};

// Sunday -> Saturday, matching JS getDay() (0 = Sunday ... 6 = Saturday)
const WEEK_DAYS = [
  { label: 'Sunday',    short: 'Sun', idx: 0 },
  { label: 'Monday',    short: 'Mon', idx: 1 },
  { label: 'Tuesday',   short: 'Tue', idx: 2 },
  { label: 'Wednesday', short: 'Wed', idx: 3 },
  { label: 'Thursday',  short: 'Thu', idx: 4 },
  { label: 'Friday',    short: 'Fri', idx: 5 },
  { label: 'Saturday',  short: 'Sat', idx: 6 },
];

const STATUS_STYLES = {
  pending:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  approved:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  rejected:  'bg-red-500/10 text-red-400 border-red-500/20',
  cancelled: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

function StatusPill({ status }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-lg border text-[10px] font-semibold uppercase tracking-wide ${
        STATUS_STYLES[status] || STATUS_STYLES.cancelled
      }`}
    >
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SwapRequestModal – redesigned:
//   1. Dropdown of same-department colleagues (not free-text)
//   2. Specific date picker (not just weekday)
//   3. Submits targetEmployee (ID) + requestedDate to backend
// ─────────────────────────────────────────────────────────────────────────────
function SwapRequestModal({ myAssignment, onClose, onSubmitted }) {
  const user = useSelector(selectUser);

  const [colleagues,        setColleagues]        = useState([]);
  const [loadingColleagues, setLoadingColleagues] = useState(true);

  const [targetEmployeeId,  setTargetEmployeeId]  = useState('');
  const [requestedDate,     setRequestedDate]     = useState('');
  const [requestedTime,     setRequestedTime]     = useState('09:00');
  const [reason,            setReason]            = useState('');
  const [submitting,        setSubmitting]         = useState(false);

  // ── Fetch same-department employees on mount ────────────────────────────
  useEffect(() => {
    const loadColleagues = async () => {
      setLoadingColleagues(true);
      try {
        // Pass the current user's department so the backend returns only
        // employees from that department. excludeSelf=true removes the
        // requesting employee from the list.
        const deptId = user?.department?._id || user?.department;
        const res = await shiftSwapAPI.getDirectory({
          department: deptId || undefined,
          excludeSelf: 'true',
        });
        // Filter out the current user client-side as a safety net
        const all = res.data?.data || [];
        setColleagues(all.filter((e) => String(e._id) !== String(user?._id)));
      } catch (err) {
        toast.error('Unable to load department colleagues.');
      } finally {
        setLoadingColleagues(false);
      }
    };
    loadColleagues();
  }, [user]);

  // ── Minimum selectable date = tomorrow ─────────────────────────────────
  const minDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }, []);

  // ── Which weekday does the selected date fall on? ───────────────────────
  const selectedWeekday = useMemo(() => {
    if (!requestedDate) return null;
    return new Date(requestedDate).getDay();
  }, [requestedDate]);

  const selectedWeekdayLabel = useMemo(() => {
    if (selectedWeekday === null) return '';
    return WEEK_DAYS.find((d) => d.idx === selectedWeekday)?.label || '';
  }, [selectedWeekday]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!targetEmployeeId) {
      toast.error('Please select a colleague to swap with.');
      return;
    }
    if (!requestedDate) {
      toast.error('Please select a date for the swap.');
      return;
    }
    if (!requestedTime) {
      toast.error('Please select a time for the swap.');
      return;
    }

    // Combine the chosen date and time into one ISO datetime string
    const requestedDateTime = new Date(`${requestedDate}T${requestedTime}:00`).toISOString();

    setSubmitting(true);
    try {
      await shiftSwapAPI.create({
        requesterAssignment: myAssignment._id,
        targetEmployee:      targetEmployeeId,
        requestedDate:       requestedDateTime,
        reason,
      });
      toast.success('Swap request sent to admin for review.');
      onSubmitted();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Unable to submit swap request.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedColleague = colleagues.find((c) => c._id === targetEmployeeId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-900 p-6 shadow-xl"
      >
        {/* Header */}
        <div className="flex-between mb-4">
          <h3 className="text-base font-semibold text-white">Request Shift Swap</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* The shift being offered */}
          <div className="p-3 rounded-2xl bg-white/5 border border-white/5 text-xs text-slate-300 space-y-1">
            <p className="text-slate-400">You're offering:</p>
            <p className="text-white font-semibold">
              {WEEK_DAYS.find((d) => d.idx === myAssignment.weekday)?.label} —{' '}
              {myAssignment.shiftType?.name}
            </p>
            <p className="text-slate-400">
              {myAssignment.startTime} – {myAssignment.endTime}
            </p>
          </div>

          {/* ── Colleague dropdown (same department only) ─────────────────── */}
          <div>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5">
              <UserIcon className="w-3.5 h-3.5" /> Colleague to swap with
            </label>

            {loadingColleagues ? (
              <div className="flex items-center gap-2 text-xs text-slate-500 px-4 py-2.5 rounded-xl border border-white/10 bg-surface-950">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading colleagues…
              </div>
            ) : colleagues.length === 0 ? (
              <p className="text-xs text-slate-500 px-4 py-2.5 rounded-xl border border-white/10 bg-surface-950">
                No colleagues found in your department.
              </p>
            ) : (
              <select
                value={targetEmployeeId}
                onChange={(e) => setTargetEmployeeId(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-white/10 bg-surface-950 text-white text-sm focus:outline-none focus:border-primary-500"
                required
              >
                <option value="" disabled>— Select a colleague —</option>
                {colleagues.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.firstName} {c.lastName}
                    {c.employeeId ? ` (${c.employeeId})` : ''}
                  </option>
                ))}
              </select>
            )}

            {selectedColleague && (
              <p className="text-[10px] text-slate-500 mt-1 pl-1">
                Same department — swap request will be sent for admin approval.
              </p>
            )}
          </div>

          {/* ── Date & Time picker ───────────────────────────────────────── */}
          <div>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5">
              <CalendarDays className="w-3.5 h-3.5" /> Date &amp; time of swap
            </label>
            <div className="flex gap-2">
              {/* Calendar date picker */}
              <input
                type="date"
                value={requestedDate}
                min={minDate}
                onChange={(e) => setRequestedDate(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 bg-surface-950 text-white text-sm focus:outline-none focus:border-primary-500 [color-scheme:dark]"
                required
              />
              {/* Time picker */}
              <input
                type="time"
                value={requestedTime}
                onChange={(e) => setRequestedTime(e.target.value)}
                className="w-32 px-3 py-2.5 rounded-xl border border-white/10 bg-surface-950 text-white text-sm focus:outline-none focus:border-primary-500 [color-scheme:dark]"
                required
              />
            </div>
            {requestedDate && (
              <p className="text-[10px] text-slate-500 mt-1 pl-1">
                This falls on a <span className="text-primary-400 font-medium">{selectedWeekdayLabel}</span>
                {requestedTime && (
                  <> at <span className="text-primary-400 font-medium">{requestedTime}</span></>
                )}.
                {' '}Admin will verify both employees' schedules for this date.
              </p>
            )}
          </div>

          {/* ── Reason ───────────────────────────────────────────────────── */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Reason <span className="text-slate-600">(optional)</span></label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-white/10 bg-surface-950 text-white text-xs focus:outline-none h-20 resize-none"
              placeholder="Let admin know why you'd like to swap…"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || loadingColleagues || !targetEmployeeId || !requestedDate || !requestedTime}
            className="w-full py-2.5 rounded-xl bg-primary-500 font-medium text-white text-sm hover:bg-primary-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Send Request
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MyShifts – main component (unchanged structure, just wires new modal)
// ─────────────────────────────────────────────────────────────────────────────
export default function MyShifts() {
  const user = useSelector(selectUser);
  const [assignments,       setAssignments]       = useState([]);
  const [swapRequests,      setSwapRequests]       = useState([]);
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState('');
  const [swapModalAssignment, setSwapModalAssignment] = useState(null);
  const [cancellingId,      setCancellingId]      = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    const [assignRes, swapRes] = await Promise.allSettled([
      shiftAssignmentAPI.getAll({ page: 1, limit: 500 }),
      shiftSwapAPI.getMine(),
    ]);

    if (assignRes.status === 'fulfilled') {
      setAssignments(assignRes.value.data?.data || []);
    } else {
      setError('Unable to load your shift schedule.');
    }

    if (swapRes.status === 'fulfilled') {
      setSwapRequests(swapRes.value.data?.data || []);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const myAssignments = useMemo(() => {
    if (!user?._id) return [];
    return assignments.filter((a) => (a.employee?._id || a.employee) === user._id);
  }, [assignments, user]);

  const myRecurringByDay = useMemo(() => {
    const map = {};
    myAssignments
      .filter((a) => a.recurring && a.status !== 'cancelled')
      .forEach((a) => { map[a.weekday] = a; });
    return map;
  }, [myAssignments]);

  const myTemporaryAssignments = useMemo(
    () => myAssignments.filter((a) => !a.recurring && a.status !== 'cancelled'),
    [myAssignments]
  );

  const handleCancelRequest = async (id) => {
    setCancellingId(id);
    try {
      await shiftSwapAPI.cancel(id);
      toast.success('Swap request cancelled.');
      fetchData();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Unable to cancel request.');
    } finally {
      setCancellingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-center h-64 text-slate-400 gap-3">
        <Loader2 className="w-5 h-5 animate-spin" />Loading your shifts…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-center h-64 text-red-400 gap-3">
        <Clock className="w-5 h-5" />{error}
        <button onClick={fetchData} className="btn-secondary text-xs ml-2">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-display text-2xl font-bold text-white">My Shifts</h1>
        <p className="text-slate-400 text-sm mt-0.5">Your weekly schedule, Sunday through Saturday.</p>
      </motion.div>

      {/* ─── WEEKLY GRID: SUNDAY -> SATURDAY ─── */}
      <div className="rounded-3xl border border-white/10 bg-surface-900 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
          {WEEK_DAYS.map(({ label, short, idx }) => {
            const assignment = myRecurringByDay[idx];
            const isToday = idx === new Date().getDay();
            return (
              <div
                key={idx}
                className={`rounded-3xl border p-3 min-h-[150px] flex flex-col justify-between ${
                  assignment
                    ? 'border-primary-500/30 bg-primary-500/10'
                    : 'border-white/10 bg-white/5'
                } ${isToday ? 'ring-1 ring-primary-500' : ''}`}
              >
                <div>
                  <div className="flex-between mb-2">
                    <span className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{short}</span>
                    {isToday && <span className="text-[9px] text-primary-400 font-semibold">TODAY</span>}
                  </div>
                  {assignment ? (
                    <div className="space-y-1">
                      <p className="text-sm text-white font-semibold truncate">
                        {assignment.shiftType?.name || 'Assigned shift'}
                      </p>
                      <p className="text-[11px] text-slate-300">
                        {assignment.startTime} – {assignment.endTime}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {WORK_MODE_LABELS[assignment.workMode] || assignment.workMode}
                      </p>
                    </div>
                  ) : (
                    <div className="h-14 flex items-center justify-center rounded-2xl border border-dashed border-white/10 text-slate-500 text-xs">
                      Day off
                    </div>
                  )}
                </div>

                {assignment && (
                  <button
                    type="button"
                    onClick={() => setSwapModalAssignment(assignment)}
                    className="mt-2 w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-[11px] text-slate-300 hover:bg-white/10 hover:text-white transition"
                  >
                    <Repeat className="w-3 h-3" /> Request Swap
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── TEMPORARY / DATE-RANGE ASSIGNMENTS ─── */}
      {myTemporaryAssignments.length > 0 && (
        <div className="rounded-3xl border border-white/10 bg-surface-900 p-4">
          <h2 className="text-white font-semibold mb-3 text-sm">Temporary Assignments</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {myTemporaryAssignments.map((a) => (
              <div key={a._id} className="rounded-2xl bg-white/5 border border-white/5 p-3 text-xs text-slate-300">
                <p className="text-white font-semibold">{a.shiftType?.name}</p>
                <p className="text-slate-400 mt-1">
                  {new Date(a.startDate).toLocaleDateString()} – {new Date(a.endDate).toLocaleDateString()}
                </p>
                <p className="text-slate-400">{a.startTime} – {a.endTime}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── MY SWAP REQUESTS ─── */}
      <div className="rounded-3xl border border-white/10 bg-surface-900 p-4">
        <h2 className="text-white font-semibold mb-3 text-sm">My Swap Requests</h2>
        {swapRequests.length === 0 ? (
          <p className="text-xs text-slate-500">You haven't sent any swap requests yet.</p>
        ) : (
          <div className="space-y-2">
            {swapRequests.map((req) => {
              const targetName = req.targetEmployee
                ? `${req.targetEmployee.firstName} ${req.targetEmployee.lastName}`
                : req.targetEmployeeName || '—';
              const swapDate = req.requestedDate
                ? new Date(req.requestedDate).toLocaleDateString(undefined, {
                    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
                  })
                : null;

              return (
                <div key={req._id} className="rounded-2xl bg-white/5 border border-white/5 p-3">
                  <div className="flex-between gap-2 flex-wrap">
                    <div className="text-xs text-slate-300">
                      <p className="text-white font-medium">
                        You requested to swap with {targetName}
                      </p>
                      <p className="text-slate-400 mt-0.5">
                        {req.requesterAssignment?.shiftType?.name}{' '}
                        ({req.requesterAssignment?.startTime}–{req.requesterAssignment?.endTime})
                        {swapDate ? ` · ${swapDate}` : ''}
                      </p>
                      {req.reason && (
                        <p className="text-slate-500 mt-1 italic">"{req.reason}"</p>
                      )}
                      {req.adminNotes && (
                        <p className="text-slate-500 mt-1">Admin note: {req.adminNotes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill status={req.status} />
                      {req.status === 'pending' && (
                        <button
                          onClick={() => handleCancelRequest(req._id)}
                          disabled={cancellingId === req._id}
                          className="btn-secondary btn-icon"
                          title="Cancel request"
                        >
                          {cancellingId === req._id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Ban className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {swapModalAssignment && (
        <SwapRequestModal
          myAssignment={swapModalAssignment}
          onClose={() => setSwapModalAssignment(null)}
          onSubmitted={() => { setSwapModalAssignment(null); fetchData(); }}
        />
      )}
    </div>
  );
}
