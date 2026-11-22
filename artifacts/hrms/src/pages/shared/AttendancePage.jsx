import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock, CheckCircle, XCircle, AlertTriangle,
  Wifi, Download, Calendar, ChevronLeft, ChevronRight,
  X, Eye, User, TrendingUp, AlertCircle, Edit2, Search,
  Save, Loader2, UserPlus,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import clsx from 'clsx';
import * as XLSX from 'xlsx';
import { attendanceAPI, employeeAPI } from '@/services/api';

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUS_MAP = {
  present:        { label: 'Present',  cls: 'badge-success', color: 'text-accent-400'  },
  working:        { label: 'Working',  cls: 'badge-primary', color: 'text-primary-400' },
  late:           { label: 'Late',     cls: 'badge-warning', color: 'text-warning-400' },
  absent:         { label: 'Absent',   cls: 'badge-danger',  color: 'text-danger-400'  },
  on_leave:       { label: 'On Leave', cls: 'badge-primary', color: 'text-primary-400' },
  work_from_home: { label: 'WFH',      cls: 'badge-primary', color: 'text-primary-400' },
  half_day:       { label: 'Half Day', cls: 'badge-warning', color: 'text-warning-400' },
};

const LEAVE_TYPE_LABELS = {
  sick:   'Medical Leave',
  casual: 'Casual Leave',
  unpaid: 'Unpaid Leave',
};

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_NAMES = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';

const fmtDate = (date) =>
  date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

// Builds a 'YYYY-MM-DD' key from a Date's LOCAL calendar fields, not its UTC ones.
// IMPORTANT: never use date.toISOString().split('T')[0] for a date the admin picked
// on the calendar — the picker builds Date objects at local midnight, and
// toISOString() converts to UTC first, which rolls the date back a day for any
// positive UTC offset (e.g. Pakistan, UTC+5). That mismatch was why selecting a
// specific day could silently query the wrong date on the backend.
const toDateKey = (date) => {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const fmtShortDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const initials = (name) =>
  name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?';

// 95 -> "1h 35m", 40 -> "40m"
const fmtDuration = (minutes) => {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
};
const fmtLate = fmtDuration; // kept for readability at call sites

// Convert "HH:MM" local time string → ISO string on a given date
const timeStringToISO = (date, timeStr, dayOffset = 0) => {
  if (!date || !timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  const d = new Date(date);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
};

// Convert ISO → "HH:MM" for <input type="time">
const isoToTimeInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};
const isOvernightShift = (inTime, outTime) =>
  !!inTime && !!outTime && outTime <= inTime;
// ─── Date Range Picker ────────────────────────────────────────────────────────
function DateRangePicker({ startDate, endDate, onChange, onClose }) {
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [hovered, setHovered] = useState(null);
  const ref = useRef();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const prevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  const nextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();

  const handleDayClick = (day) => {
    const clicked = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    if (!startDate || (startDate && endDate)) {
      onChange({ start: clicked, end: null });
    } else {
      onChange(clicked < startDate
        ? { start: clicked, end: startDate }
        : { start: startDate, end: clicked }
      );
    }
  };

  const getDay = (day) => new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
  const isInRange = (day) => {
    const d = getDay(day); const end = endDate || hovered;
    if (!startDate || !end) return false;
    const [s, e] = startDate <= end ? [startDate, end] : [end, startDate];
    return d > s && d < e;
  };
  const isStart = (day) => startDate && getDay(day).toDateString() === startDate.toDateString();
  const isEnd   = (day) => endDate   && getDay(day).toDateString() === endDate.toDateString();
  const isToday = (day) => getDay(day).toDateString() === today.toDateString();

  const applyPreset = (label) => {
    const now = new Date(); const start = new Date();
    if (label === 'Today')        { onChange({ start: now, end: now }); }
    else if (label === 'This Week') {
      const day = now.getDay();
      start.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      onChange({ start, end: now });
    } else if (label === 'This Month') {
      start.setDate(1); onChange({ start, end: now });
    } else if (label === 'Last Month') {
      onChange({ start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 0) });
    } else if (label === 'Last 7 Days') {
      start.setDate(now.getDate() - 6); onChange({ start, end: now });
    } else if (label === 'Last 30 Days') {
      start.setDate(now.getDate() - 29); onChange({ start, end: now });
    }
  };

  return (
    <div ref={ref} className="absolute right-0 top-12 z-50 flex bg-surface-800 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
      <div className="w-36 border-r border-white/5 p-3 space-y-1">
        <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-2 px-1">Quick Select</p>
        {['Today','This Week','This Month','Last Month','Last 7 Days','Last 30 Days'].map(p => (
          <button key={p} onClick={() => applyPreset(p)}
            className="w-full text-left text-xs text-slate-300 hover:text-white hover:bg-white/5 px-2 py-1.5 rounded-lg transition-colors">
            {p}
          </button>
        ))}
      </div>
      <div className="p-4 w-72">
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors">
            <ChevronLeft className="w-4 h-4 text-slate-400" />
          </button>
          <span className="text-sm font-semibold text-white">
            {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
          </span>
          <button onClick={nextMonth} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors">
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        <div className="grid grid-cols-7 mb-1">
          {DAY_NAMES.map(d => <div key={d} className="text-center text-[10px] text-slate-500 font-medium py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5">
          {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
            <button
              key={day}
              onClick={() => handleDayClick(day)}
              onMouseEnter={() => setHovered(getDay(day))}
              onMouseLeave={() => setHovered(null)}
              className={clsx('relative h-8 text-xs transition-colors',
                isInRange(day) && 'bg-primary-500/15',
                isStart(day)   && 'rounded-l-full',
                isEnd(day)     && 'rounded-r-full',
              )}
            >
              <span className={clsx(
                'relative z-10 w-7 h-7 mx-auto flex items-center justify-center rounded-full text-xs transition-all',
                isStart(day) || isEnd(day) ? 'bg-primary-600 text-white font-semibold'
                  : isToday(day) ? 'text-primary-400 font-semibold'
                  : 'text-slate-300 hover:bg-white/10',
              )}>{day}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
          <div className="text-[10px] text-slate-400">
            {startDate
              ? <span><span className="text-white">{fmtDate(startDate)}</span>{endDate && <> → <span className="text-white">{fmtDate(endDate)}</span></>}</span>
              : 'Select start date'}
          </div>
          <div className="flex gap-2">
            <button onClick={() => onChange({ start: null, end: null })}
              className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors">Clear</button>
            {startDate && endDate && (
              <button onClick={onClose}
                className="text-[10px] bg-primary-600 hover:bg-primary-500 text-white px-2.5 py-1 rounded-lg transition-colors">
                Apply
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Rectify Attendance Modal ─────────────────────────────────────────────────
function RectifyModal({ onClose }) {
  // Step 1: pick employee + date. Step 2: edit times.
  const [step, setStep] = useState(1);

  // Step 1 state
  const [empSearch, setEmpSearch] = useState('');
  const [employees, setEmployees] = useState([]);
  const [empLoading, setEmpLoading] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [rectifyDate, setRectifyDate] = useState(toDateKey(new Date()));

  // Step 2 state
  const [record, setRecord] = useState(null);       // existing attendance record or null
  const [recordLoading, setRecordLoading] = useState(false);
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [status, setStatus] = useState('present');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const searchDebounce = useRef(null);

  // Fetch employees as admin types
  useEffect(() => {
    if (empSearch.trim().length < 2) { setEmployees([]); return; }
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(async () => {
      setEmpLoading(true);
      try {
        const res = await employeeAPI.getAll({ search: empSearch, limit: 10 });
        setEmployees(res.data?.data || res.data?.employees || []);
      } catch { setEmployees([]); }
      finally { setEmpLoading(false); }
    }, 350);
    return () => clearTimeout(searchDebounce.current);
  }, [empSearch]);

  // Step 1 → 2: fetch the record for that employee+date
  const handleProceed = async () => {
    if (!selectedEmp || !rectifyDate) return;
    setRecordLoading(true);
    try {
      const res = await attendanceAPI.getHistory({
        employeeId: selectedEmp._id || selectedEmp.userId,
        startDate: rectifyDate,
        endDate: rectifyDate,
        limit: 1,
      });
      const existing = (res.data?.data || [])[0] || null;
      setRecord(existing);
      setCheckInTime(existing?.checkIn?.time  ? isoToTimeInput(existing.checkIn.time)  : '');
      setCheckOutTime(existing?.checkOut?.time ? isoToTimeInput(existing.checkOut.time) : '');
      setStatus(existing?.status || 'present');
      setStep(2);
    } catch {
      setRecord(null);
      setCheckInTime('');
      setCheckOutTime('');
      setStatus('present');
      setStep(2);
    } finally {
      setRecordLoading(false);
    }
  };

 const handleSave = async () => {
    if (!checkInTime) { setSaveError('Check-in time is required.'); return; }
    if (checkOutTime && checkInTime === checkOutTime) {
      setSaveError('Check-in and check-out times can\'t be identical.'); return;
    }
    setSaving(true);
    setSaveError('');
    try {
      // Cross-day/night shifts are valid (e.g. check-in 8:00 PM, check-out
      // 5:00 AM) — when the check-out clock time isn't later than check-in,
      // it's interpreted as happening the next calendar day.
      const overnight = isOvernightShift(checkInTime, checkOutTime);
      const payload = {
        employeeId: selectedEmp._id || selectedEmp.userId,
        date: rectifyDate,
        checkIn:  checkInTime  ? timeStringToISO(rectifyDate, checkInTime)  : null,
        checkOut: checkOutTime ? timeStringToISO(rectifyDate, checkOutTime, overnight ? 1 : 0) : null,
        status,
      };
      await attendanceAPI.rectify(payload);
      setSaveSuccess(true);
      setTimeout(() => { setSaveSuccess(false); onClose(); }, 1200);
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const empName = (e) => e.firstName && e.lastName ? `${e.firstName} ${e.lastName}` : e.name || 'Employee';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.18 }}
        className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-warning-500/15 flex items-center justify-center">
              <Edit2 className="w-3.5 h-3.5 text-warning-400" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-sm">Rectify Attendance</h2>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {step === 1 ? 'Step 1 of 2 — Select employee & date' : `Step 2 of 2 — Edit times for ${empName(selectedEmp)}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex">
          <div className={clsx('h-0.5 flex-1 transition-colors', step >= 1 ? 'bg-primary-600' : 'bg-white/5')} />
          <div className={clsx('h-0.5 flex-1 transition-colors', step >= 2 ? 'bg-primary-600' : 'bg-white/5')} />
        </div>

        <div className="p-5 space-y-4">

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <>
              {/* Employee search */}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Search Employee</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                  <input
                    value={empSearch}
                    onChange={e => { setEmpSearch(e.target.value); setSelectedEmp(null); }}
                    placeholder="Name or employee ID…"
                    className="input-field py-2 text-xs pl-9 w-full"
                  />
                  {empLoading && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 animate-spin" />
                  )}
                </div>

                {/* Dropdown results */}
                {employees.length > 0 && !selectedEmp && (
                  <div className="mt-1.5 bg-surface-800 border border-white/10 rounded-xl overflow-hidden shadow-xl max-h-48 overflow-y-auto">
                    {employees.map(emp => (
                      <button key={emp._id}
                        onClick={() => { setSelectedEmp(emp); setEmpSearch(empName(emp)); setEmployees([]); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/5 transition-colors text-left border-b border-white/5 last:border-0"
                      >
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500/30 to-accent-500/30 flex items-center justify-center flex-shrink-0">
                          {emp.avatar
                            ? <img src={emp.avatar} className="w-full h-full object-cover rounded-full" alt="" />
                            : <span className="text-[10px] font-bold text-white">{initials(empName(emp))}</span>}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-white">{empName(emp)}</p>
                          <p className="text-[10px] text-slate-500">{emp.employeeId || emp.department?.name || ''}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Selected badge */}
                {selectedEmp && (
                  <div className="mt-2 flex items-center gap-2 bg-primary-500/10 border border-primary-500/20 rounded-xl px-3 py-2">
                    <CheckCircle className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" />
                    <span className="text-xs text-primary-300 font-medium">{empName(selectedEmp)}</span>
                    <button onClick={() => { setSelectedEmp(null); setEmpSearch(''); }}
                      className="ml-auto text-primary-500 hover:text-primary-300 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Date */}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Date to Rectify</label>
                <input
                  type="date"
                  value={rectifyDate}
                  max={toDateKey(new Date())}
                  onChange={e => setRectifyDate(e.target.value)}
                  className="input-field py-2 text-xs w-full"
                />
              </div>

              <button
                onClick={handleProceed}
                disabled={!selectedEmp || !rectifyDate || recordLoading}
                className="btn-primary text-xs w-full justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {recordLoading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Fetching record…</>
                  : <>Next — Edit Times</>}
              </button>
            </>
          )}

          {/* ── STEP 2 ── */}
          {step === 2 && (
            <>
              {/* Context info */}
              <div className="bg-white/3 border border-white/5 rounded-xl px-3 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-white">{empName(selectedEmp)}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {new Date(rectifyDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                </div>
                {record ? (
                  <span className="text-[10px] bg-accent-500/10 text-accent-400 px-2 py-1 rounded-lg border border-accent-500/20">Record found</span>
                ) : (
                  <span className="text-[10px] bg-warning-500/10 text-warning-400 px-2 py-1 rounded-lg border border-warning-500/20">No record yet</span>
                )}
              </div>

              {/* Time inputs */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Check-in Time</label>
                  <input
                    type="time"
                    value={checkInTime}
                    onChange={e => { setCheckInTime(e.target.value); setSaveError(''); }}
                    className="input-field py-2 text-xs w-full"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Check-out Time</label>
                  <input
                    type="time"
                    value={checkOutTime}
                    onChange={e => { setCheckOutTime(e.target.value); setSaveError(''); }}
                    className="input-field py-2 text-xs w-full"
                  />
                  <p className="text-[10px] text-slate-600 mt-1">Leave blank if not checked out</p>
                  {isOvernightShift(checkInTime, checkOutTime) && (
                    <p className="text-[10px] text-accent-400 mt-1">
                      {/* Cross-day shift — check-out will be recorded on the next calendar day. */}
                    </p>
                  )}
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Status</label>
                <select value={status} onChange={e => setStatus(e.target.value)} className="input-field py-2 text-xs w-full">
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="absent">Absent</option>
                  <option value="half_day">Half Day</option>
                  <option value="work_from_home">Work From Home</option>
                  <option value="on_leave">On Leave</option>
                </select>
              </div>

              {saveError && (
                <div className="flex items-center gap-2 bg-danger-500/10 border border-danger-500/20 rounded-xl px-3 py-2 text-danger-400 text-xs">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {saveError}
                </div>
              )}

              {saveSuccess && (
                <div className="flex items-center gap-2 bg-accent-500/10 border border-accent-500/20 rounded-xl px-3 py-2 text-accent-400 text-xs">
                  <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  Attendance updated successfully!
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setStep(1)} className="btn-secondary text-xs flex-1 justify-center">
                  <ChevronLeft className="w-3.5 h-3.5" />Back
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || saveSuccess}
                  className="btn-primary text-xs flex-1 justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</>
                    : saveSuccess
                    ? <><CheckCircle className="w-3.5 h-3.5" />Saved!</>
                    : <><Save className="w-3.5 h-3.5" />Save Changes</>}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Add Attendance Modal ─────────────────────────────────────────────────────
// Unlike Rectify (which edits an existing punch), this creates a brand-new
// manual attendance record for an employee — e.g. someone who forgot to
// check in, or has no biometric device. Mode is always 'manual' and status
// is always 'present'; no dropdowns for either, so the record can't
// accidentally be tagged as an office/biometric punch.
function AddAttendanceModal({ onClose }) {
  const [empSearch, setEmpSearch] = useState('');
  const [employees, setEmployees] = useState([]);
  const [empLoading, setEmpLoading] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState(null);

  const [addDate, setAddDate] = useState(toDateKey(new Date()));
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const searchDebounce = useRef(null);

  useEffect(() => {
    if (empSearch.trim().length < 2) { setEmployees([]); return; }
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(async () => {
      setEmpLoading(true);
      try {
        const res = await employeeAPI.getAll({ search: empSearch, limit: 10 });
        setEmployees(res.data?.data || res.data?.employees || []);
      } catch { setEmployees([]); }
      finally { setEmpLoading(false); }
    }, 350);
    return () => clearTimeout(searchDebounce.current);
  }, [empSearch]);

  const empName = (e) => e.firstName && e.lastName ? `${e.firstName} ${e.lastName}` : e.name || 'Employee';

  const handleSave = async () => {
    if (!selectedEmp)   { setSaveError('Please select an employee.'); return; }
    if (!addDate)        { setSaveError('Please select a date.'); return; }
    if (!checkInTime)    { setSaveError('Check-in time is required.'); return; }
    if (checkOutTime && checkInTime === checkOutTime) {
      setSaveError('Check-in and check-out times can\'t be identical.'); return;
    }
    setSaving(true);
    setSaveError('');
    try {
      // Cross-day shift: check-out clock time not later than check-in means
      // it happened the next calendar day.
      const overnight = isOvernightShift(checkInTime, checkOutTime);
      const payload = {
        employeeId: selectedEmp._id || selectedEmp.userId,
        date:       addDate,
        checkIn:    timeStringToISO(addDate, checkInTime),
        checkOut:   checkOutTime ? timeStringToISO(addDate, checkOutTime, overnight ? 1 : 0) : null,
        status:     'present',
        workMode:   'manual',
      };
      await attendanceAPI.rectify(payload);
      setSaveSuccess(true);
      setTimeout(() => { setSaveSuccess(false); onClose(); }, 1200);
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.18 }}
        className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent-500/15 flex items-center justify-center">
              <UserPlus className="w-3.5 h-3.5 text-accent-400" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-sm">Add Attendance</h2>
              <p className="text-[10px] text-slate-500 mt-0.5">Manually create a check-in for an employee</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Employee search */}
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Select Employee</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
              <input
                value={empSearch}
                onChange={e => { setEmpSearch(e.target.value); setSelectedEmp(null); setSaveError(''); }}
                placeholder="Name or employee ID…"
                className="input-field py-2 text-xs pl-9 w-full"
              />
              {empLoading && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 animate-spin" />
              )}
            </div>

            {employees.length > 0 && !selectedEmp && (
              <div className="mt-1.5 bg-surface-800 border border-white/10 rounded-xl overflow-hidden shadow-xl max-h-48 overflow-y-auto">
                {employees.map(emp => (
                  <button key={emp._id}
                    onClick={() => { setSelectedEmp(emp); setEmpSearch(empName(emp)); setEmployees([]); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/5 transition-colors text-left border-b border-white/5 last:border-0"
                  >
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500/30 to-accent-500/30 flex items-center justify-center flex-shrink-0">
                      {emp.avatar
                        ? <img src={emp.avatar} className="w-full h-full object-cover rounded-full" alt="" />
                        : <span className="text-[10px] font-bold text-white">{initials(empName(emp))}</span>}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-white">{empName(emp)}</p>
                      <p className="text-[10px] text-slate-500">{emp.employeeId || emp.department?.name || ''}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {selectedEmp && (
              <div className="mt-2 flex items-center gap-2 bg-primary-500/10 border border-primary-500/20 rounded-xl px-3 py-2">
                <CheckCircle className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" />
                <span className="text-xs text-primary-300 font-medium">{empName(selectedEmp)}</span>
                <button onClick={() => { setSelectedEmp(null); setEmpSearch(''); }}
                  className="ml-auto text-primary-500 hover:text-primary-300 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Date */}
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Date</label>
            <input
              type="date"
              value={addDate}
              max={toDateKey(new Date())}
              onChange={e => { setAddDate(e.target.value); setSaveError(''); }}
              className="input-field py-2 text-xs w-full"
            />
          </div>

          {/* Time inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Check-in Time</label>
              <input
                type="time"
                value={checkInTime}
                onChange={e => { setCheckInTime(e.target.value); setSaveError(''); }}
                className="input-field py-2 text-xs w-full"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Check-out Time</label>
              <input
                type="time"
                value={checkOutTime}
                onChange={e => { setCheckOutTime(e.target.value); setSaveError(''); }}
                className="input-field py-2 text-xs w-full"
              />
              <p className="text-[10px] text-slate-600 mt-1">Optional — leave blank if not checked out</p>
            </div>
          </div>

          {/* Fixed Mode + Status — informational only, not editable */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/3 border border-white/5 rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-slate-500">Mode</p>
              <p className="text-xs font-medium text-slate-300 mt-0.5">Manual</p>
            </div>
            <div className="bg-white/3 border border-white/5 rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-slate-500">Status</p>
              <p className="text-xs font-medium text-accent-400 mt-0.5">Present</p>
            </div>
          </div>

          {saveError && (
            <div className="flex items-center gap-2 bg-danger-500/10 border border-danger-500/20 rounded-xl px-3 py-2 text-danger-400 text-xs">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {saveError}
            </div>
          )}

          {saveSuccess && (
            <div className="flex items-center gap-2 bg-accent-500/10 border border-accent-500/20 rounded-xl px-3 py-2 text-accent-400 text-xs">
              <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
              Attendance added successfully!
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving || saveSuccess}
            className="btn-primary text-xs w-full justify-center disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</>
              : saveSuccess
              ? <><CheckCircle className="w-3.5 h-3.5" />Saved!</>
              : <><Save className="w-3.5 h-3.5" />Add Attendance</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Employee Detail Modal ────────────────────────────────────────────────────
function EmployeeDetailModal({ employee, onClose }) {
  const now = new Date();
  const [startDate, setStartDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [endDate,   setEndDate]   = useState(now);
  const [showPicker, setShowPicker] = useState(false);
  const [records,    setRecords]    = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(true);
  const pickerAnchorRef = useRef();

  const RECORDS_PAGE_SIZE = 10;

  const stats = useMemo(() => {
    const present  = records.filter(r => r.status === 'present' || r.status === 'work_from_home').length;
    const late     = records.filter(r => r.status === 'late').length;
    const absent   = records.filter(r => r.status === 'absent').length;
    const on_leave = records.filter(r => r.status === 'on_leave').length;
    const totalHours = records.reduce((sum, r) => {
      if (r.totalHours > 0) return sum + r.totalHours;
      if (r.checkIn?.time && !r.checkOut?.time)
        return sum + (Date.now() - new Date(r.checkIn.time).getTime()) / 3600000;
      return sum;
    }, 0);
    return { present, late, absent, on_leave, totalHours: parseFloat(totalHours.toFixed(1)) };
  }, [records]);

  const fetchRecords = useCallback(async (start, end, pageNumber = page) => {
    if (!start || !end || !employee) return;
    setLoading(true);
    try {
      const res = await attendanceAPI.getHistory({
        employeeId: employee.userId,
        startDate:  toDateKey(start),
        endDate:    toDateKey(end),
        page:       pageNumber,
        limit:      RECORDS_PAGE_SIZE,
      });
      setRecords(res.data?.data || []);
      setTotalRecords(res.data?.total || 0);
    } catch {
      setRecords([]);
      setTotalRecords(0);
    } finally { setLoading(false); }
  }, [employee, page]);

  useEffect(() => { if (employee) fetchRecords(startDate, endDate, page); }, [employee, page, startDate, endDate, fetchRecords]);
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleDateChange = ({ start, end }) => { setStartDate(start); setEndDate(end); };
  const handleApply = () => {
    if (startDate && endDate) {
      setPage(1);
      fetchRecords(startDate, endDate, 1);
      setShowPicker(false);
    }
  };

  const handleExport = () => {
    if (records.length === 0) return;
    const rows = records.map(r => ({
      'Date':        fmtShortDate(r.date),
      'Check In':    fmt(r.checkIn?.time),
      'Check Out':   fmt(r.checkOut?.time),
      'Total Hours': r.totalHours > 0 ? r.totalHours.toFixed(1) : '0',
      'Work Mode':   r.workMode || '—',
      'Status':      STATUS_MAP[r.status]?.label || r.status,
      'Late By':     r.status === 'late' && fmtLate(r.lateMinutes) ? fmtLate(r.lateMinutes) : '—',
      'Early By':    r.status === 'present' && fmtDuration(r.earlyMinutes) ? fmtDuration(r.earlyMinutes) : '—',
    }));
    const summary = [
      { 'Date': 'Employee',    'Check In': employee.name,   'Check Out': '', 'Total Hours': '', 'Work Mode': '', 'Status': '' },
      { 'Date': 'Department',  'Check In': employee.dept,   'Check Out': '', 'Total Hours': '', 'Work Mode': '', 'Status': '' },
      { 'Date': 'Present Days','Check In': stats.present,   'Check Out': '', 'Total Hours': '', 'Work Mode': '', 'Status': '' },
      { 'Date': 'Late Days',   'Check In': stats.late,      'Check Out': '', 'Total Hours': '', 'Work Mode': '', 'Status': '' },
      { 'Date': 'Total Hours', 'Check In': stats.totalHours,'Check Out': '', 'Total Hours': '', 'Work Mode': '', 'Status': '' },
      { 'Date': '—',           'Check In': '—',             'Check Out': '', 'Total Hours': '', 'Work Mode': '', 'Status': '' },
    ];
    const ws = XLSX.utils.json_to_sheet([...summary, ...rows]);
    ws['!cols'] = [{ wch: 20 },{ wch: 14 },{ wch: 14 },{ wch: 14 },{ wch: 14 },{ wch: 14 },{ wch: 12 },{ wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, employee.name.slice(0, 31));
    XLSX.writeFile(wb, `attendance_${employee.name.replace(/\s+/g, '_')}_${toDateKey(startDate)}_to_${toDateKey(endDate)}.xlsx`);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }} transition={{ duration: 0.2 }}
          className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        >
          <div className="p-5 border-b border-white/5 flex items-start justify-between gap-4 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500/30 to-accent-500/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {employee.avatar
                  ? <img src={employee.avatar} alt={employee.name} className="w-full h-full object-cover" />
                  : <span className="text-sm font-bold text-white">{initials(employee.name)}</span>}
              </div>
              <div>
                <h2 className="font-display font-bold text-white text-base leading-tight">{employee.name}</h2>
                <p className="text-xs text-slate-400 mt-0.5">{employee.employeeId} · {employee.dept}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="relative" ref={pickerAnchorRef}>
                <button onClick={() => setShowPicker(p => !p)}
                  className={clsx('btn-secondary text-xs flex items-center gap-1.5', showPicker && 'border-primary-500/50 text-primary-400')}>
                  <Calendar className="w-3.5 h-3.5" />
                  {startDate && endDate ? `${fmtDate(startDate)} – ${fmtDate(endDate)}` : 'Date Range'}
                </button>
                <AnimatePresence>
                  {showPicker && (
                    <motion.div initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.97 }} transition={{ duration: 0.15 }}>
                      <DateRangePicker startDate={startDate} endDate={endDate} onChange={handleDateChange}
                        onClose={() => { if (startDate && endDate) handleApply(); else setShowPicker(false); }} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <button onClick={handleExport} disabled={records.length === 0 || loading}
                className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                <Download className="w-3.5 h-3.5" />Export
              </button>
              <button onClick={onClose}
                className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-px bg-white/5 flex-shrink-0">
            {[
              { label: 'Present',     value: stats.present,          icon: CheckCircle,   color: 'text-accent-400'  },
              { label: 'Late',        value: stats.late,             icon: AlertTriangle, color: 'text-warning-400' },
              { label: 'Absent',      value: stats.absent,           icon: XCircle,       color: 'text-danger-400'  },
              { label: 'On Leave',    value: stats.on_leave,         icon: Calendar,      color: 'text-primary-400' },
              { label: 'Total Hours', value: `${stats.totalHours}h`, icon: TrendingUp,    color: 'text-slate-300'   },
            ].map(s => (
              <div key={s.label} className="bg-surface-900 p-3 flex flex-col items-center gap-1">
                <s.icon className={clsx('w-3.5 h-3.5', s.color)} />
                <p className={clsx('text-base font-display font-bold', loading ? 'text-slate-600' : 'text-white')}>
                  {loading ? '—' : s.value}
                </p>
                <p className="text-[10px] text-slate-500 text-center leading-tight">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-10 text-center text-slate-500 text-sm">Loading records…</div>
            ) : records.length === 0 ? (
              <div className="p-10 text-center">
                <AlertCircle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">No attendance records found for this period.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th><th>Check In</th><th>Check Out</th>
                    <th>Total Hours</th><th>Work Mode</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => {
                    const s = STATUS_MAP[r.status] || { label: r.status, cls: 'badge-primary' };
                    const isLive = r.checkIn?.time && !r.checkOut?.time;
                    const liveH  = isLive ? parseFloat(((Date.now() - new Date(r.checkIn.time).getTime()) / 3600000).toFixed(1)) : null;
                    const hoursDisplay = r.totalHours > 0 ? `${r.totalHours.toFixed(1)}h` : liveH ? `${liveH.toFixed(1)}h` : '—';
                    return (
                      <tr key={r._id || i}>
                        <td className="text-xs font-medium text-slate-200">{fmtShortDate(r.date)}</td>
                        <td className="text-xs">
                          {r.checkIn?.time
                            ? <div><span className="text-slate-200">{fmt(r.checkIn.time)}</span>
                                {r.status === 'late' && (
                                  <span className="ml-1.5 text-[9px] text-warning-400 bg-warning-500/10 px-1.5 py-0.5 rounded-full">
                                    Late{fmtLate(r.lateMinutes) ? ` ${fmtLate(r.lateMinutes)}` : ''}
                                  </span>
                                )}
                                {r.status === 'present' && fmtDuration(r.earlyMinutes) && (
                                  <span className="ml-1.5 text-[9px] text-accent-400 bg-accent-500/10 px-1.5 py-0.5 rounded-full">
                                    Early {fmtDuration(r.earlyMinutes)}
                                  </span>
                                )}
                              </div>
                            : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="text-xs">
                          {r.checkOut?.time ? <span className="text-slate-200">{fmt(r.checkOut.time)}</span>
                            : r.checkIn?.time ? <span className="text-warning-400 text-[10px]">Still working</span>
                            : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="text-xs">
                          <span className={isLive ? 'text-warning-400' : r.totalHours > 0 ? 'text-accent-400' : 'text-slate-600'}>
                            {hoursDisplay}
                            {isLive && <span className="ml-1 text-[9px] text-warning-500 animate-pulse">●</span>}
                          </span>
                        </td>
                        <td className="text-xs">
                          {r.workMode === 'remote' && <span className="flex items-center gap-1 text-primary-400"><Wifi className="w-3 h-3" />Remote</span>}
                          {r.workMode === 'hybrid' && <span className="flex items-center gap-1 text-warning-400"><Wifi className="w-3 h-3" />Hybrid</span>}
                          {r.workMode === 'office' && <span className="text-slate-400">Office</span>}
                          {(!r.workMode || r.workMode === '—') && <span className="text-slate-600">—</span>}
                        </td>
                        <td>
                          <span className={clsx('badge text-[10px]', s.cls)}>{s.label}</span>
                          {r.status === 'late' && fmtLate(r.lateMinutes) && (
                            <p className="text-[10px] text-warning-400 mt-0.5">by {fmtLate(r.lateMinutes)}</p>
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
                            <p className="text-[10px] text-accent-400 mt-0.5">early by {fmtDuration(r.earlyMinutes)}</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {!loading && records.length > 0 && (
            <>
              <div className="px-5 py-3 border-t border-white/5 flex-shrink-0 flex items-center justify-between">
                <p className="text-[11px] text-slate-500">
                  Showing <span className="text-slate-300 font-medium">{(page - 1) * RECORDS_PAGE_SIZE + 1}</span>–
                  <span className="text-slate-300 font-medium">{Math.min(page * RECORDS_PAGE_SIZE, totalRecords)}</span>
                  of <span className="text-slate-300 font-medium">{totalRecords}</span> records · {fmtDate(startDate)} – {fmtDate(endDate)}
                </p>
                <button onClick={handleExport} className="btn-secondary text-xs flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" />Export to Excel
                </button>
              </div>

              {totalRecords > RECORDS_PAGE_SIZE && (
                <div className="px-5 py-3 border-t border-white/5 flex-shrink-0 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    Page {page} of {Math.max(1, Math.ceil(totalRecords / RECORDS_PAGE_SIZE))}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(Math.max(1, Math.ceil(totalRecords / RECORDS_PAGE_SIZE)), p + 1))}
                      disabled={page === Math.max(1, Math.ceil(totalRecords / RECORDS_PAGE_SIZE))}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Main Attendance Page ─────────────────────────────────────────────────────
export default function AttendancePage() {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const [loading,          setLoading]          = useState(true);
  const [rangeLoading,     setRangeLoading]     = useState(false);
  const [employees,        setEmployees]        = useState([]);
  const [records,          setRecords]          = useState([]);
  const [totalRecords,     setTotalRecords]     = useState(0);
  const [stats,            setStats]            = useState({ present: 0, late: 0, absent: 0, on_leave: 0, remote: 0, total: 0 });
  const [weekly,           setWeekly]           = useState([]);
  const [filter,           setFilter]           = useState('all');
  const [search,           setSearch]           = useState('');
  const [showPicker,       setShowPicker]       = useState(false);
  const [startDate,        setStartDate]        = useState(null);
  const [endDate,          setEndDate]          = useState(null);
  const [isDateFiltered,   setIsDateFiltered]   = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showRectify,      setShowRectify]      = useState(false); // ← new
  const [showAddAttendance, setShowAddAttendance] = useState(false);
  const [page,             setPage]             = useState(1);
  const TABLE_PAGE_SIZE = 10;

  const loadToday = () => {
    setLoading(true);
    Promise.all([attendanceAPI.getAdminToday(), attendanceAPI.getAdminWeekly()])
      .then(([t, w]) => {
        setStats(t.data.data.stats);
        setEmployees(t.data.data.employees);
        setWeekly(w.data.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadToday(); }, []);

  const applyDateRange = async (start, end, pageNumber = 1) => {
    if (!start || !end) return;
    setRangeLoading(true);
    setIsDateFiltered(true);
    try {
      const { data } = await attendanceAPI.getAdminRange({
        startDate: toDateKey(start),
        endDate:   toDateKey(end),
        page:      pageNumber,
        limit:     TABLE_PAGE_SIZE,
      });
      setRecords(data.data.records || []);
      setTotalRecords(data.data.total || 0);
      setStats(data.data.stats || { present: 0, late: 0, absent: 0, on_leave: 0, remote: 0, total: 0 });
    } catch {
      setRecords([]);
      setTotalRecords(0);
    } finally { setRangeLoading(false); }
  };

  const handleDateChange = ({ start, end }) => { setStartDate(start); setEndDate(end); };
  const handleApply = () => {
    if (startDate && endDate) {
      setPage(1);
      applyDateRange(startDate, endDate, 1);
      setShowPicker(false);
    }
  };
  const clearDateRange = () => {
    setStartDate(null); setEndDate(null); setIsDateFiltered(false);
    setRecords([]);
    setTotalRecords(0);
    loadToday();
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const dataRows = isDateFiltered ? records : employees;
    return dataRows.filter(r => {
      const matchesFilter = filter === 'all'
        || (filter === 'present' ? ['present', 'late', 'working'].includes(r.status) : r.status === filter);
      const matchesSearch = !q || r.name?.toLowerCase().includes(q)
        || r.employeeId?.toLowerCase().includes(q)
        || r.dept?.toLowerCase().includes(q)
        || (isDateFiltered && r.date && new Date(r.date).toLocaleDateString('en-US').toLowerCase().includes(q));
      return matchesFilter && matchesSearch;
    });
  }, [records, employees, filter, search, isDateFiltered]);

  // Whenever the underlying list changes shape (new data load, search, or
  // status filter), snap back to page 1 so we're never stuck on an empty page.
  useEffect(() => { setPage(1); }, [employees, filter, search, isDateFiltered]);

  useEffect(() => {
    if (isDateFiltered && startDate && endDate) {
      applyDateRange(startDate, endDate, page);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const totalPages = Math.max(1, Math.ceil((isDateFiltered ? totalRecords : filtered.length) / TABLE_PAGE_SIZE));
  const pagedEmployees = useMemo(() => {
    if (isDateFiltered) return filtered; // backend already returns a paginated page of records
    return filtered.slice((page - 1) * TABLE_PAGE_SIZE, page * TABLE_PAGE_SIZE);
  }, [filtered, page, isDateFiltered]);

  const handleExport = () => {
    if (!(filtered.length || (isDateFiltered && totalRecords > 0))) return;
    const rows = filtered.map(r => ({
      'Employee ID':  r.employeeId || '—',
      'Name':         r.name,
      'Department':   r.dept,
      'Date':         r.date ? fmtShortDate(r.date) : (isDateFiltered ? `${fmtDate(startDate)} – ${fmtDate(endDate)}` : new Date().toLocaleDateString('en-US')),
      'Check In':     fmt(r.checkIn),
      'Check Out':    fmt(r.checkOut),
      'Total Hours':  r.hours > 0 ? r.hours.toFixed(1) : r.liveHours ? `${r.liveHours.toFixed(1)} (live)` : '0',
      'Work Mode':    r.mode === '—' ? 'N/A' : r.mode,
      'Status':       r.status === 'on_leave' && r.leaveType
        ? `On Leave (${LEAVE_TYPE_LABELS[r.leaveType] || r.leaveType})`
        : STATUS_MAP[r.status]?.label || r.status,
      'Late By':      r.status === 'late' && fmtLate(r.lateMinutes) ? fmtLate(r.lateMinutes) : '—',
      'Early By':     (r.status === 'present' || r.status === 'working') && fmtDuration(r.earlyMinutes) ? fmtDuration(r.earlyMinutes) : '—',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch:12 },{ wch:22 },{ wch:18 },{ wch:24 },{ wch:12 },{ wch:12 },{ wch:14 },{ wch:12 },{ wch:12 },{ wch:12 },{ wch:12 }];
    const wb   = XLSX.utils.book_new();
    const name = isDateFiltered
      ? `${startDate.toLocaleDateString('en-US',{month:'short',day:'numeric'})} to ${endDate.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`
      : `Today ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    XLSX.writeFile(wb, `attendance_${isDateFiltered ? `${toDateKey(startDate)}_to_${toDateKey(endDate)}` : 'today'}.xlsx`);
  };

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="flex-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-white">Attendance Tracker</h1>
            <p className="text-slate-400 text-sm mt-0.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-accent-400 rounded-full animate-pulse-slow" />
              {isDateFiltered ? `${fmtDate(startDate)} – ${fmtDate(endDate)}` : `Live · ${today}`}
            </p>
          </div>
          <div className="flex gap-2 relative flex-wrap">
            {/* ── Add Attendance button ── */}
            <button
              onClick={() => setShowAddAttendance(true)}
              className="btn-secondary text-xs flex items-center gap-1.5 border-accent-500/30 text-accent-400 hover:border-accent-500/60"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Add Attendance
            </button>

            {/* ── Rectify button ── */}
            <button
              onClick={() => setShowRectify(true)}
              className="btn-secondary text-xs flex items-center gap-1.5 border-warning-500/30 text-warning-400 hover:border-warning-500/60"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Rectify
            </button>

            <button
              onClick={() => setShowPicker(p => !p)}
              className={clsx('btn-secondary text-xs flex items-center gap-1.5', isDateFiltered && 'border-primary-500/50 text-primary-400')}
            >
              <Calendar className="w-3.5 h-3.5" />
              {isDateFiltered ? `${fmtDate(startDate)} – ${fmtDate(endDate)}` : 'Date Range'}
              {isDateFiltered && (
                <span onClick={(e) => { e.stopPropagation(); clearDateRange(); }} className="ml-1 hover:text-white transition-colors">
                  <X className="w-3 h-3" />
                </span>
              )}
            </button>
            <button onClick={handleExport} disabled={filtered.length === 0}
              className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
              <Download className="w-3.5 h-3.5" />Export
            </button>
            <AnimatePresence>
              {showPicker && (
                <motion.div initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }} transition={{ duration: 0.15 }}>
                  <DateRangePicker startDate={startDate} endDate={endDate} onChange={handleDateChange}
                    onClose={() => { if (startDate && endDate) handleApply(); else setShowPicker(false); }} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { label: 'Present',       value: stats.present,  icon: CheckCircle,   color: 'text-accent-400',  bg: 'bg-accent-500/10',  filter: 'present'  },
            { label: 'Late',          value: stats.late,     icon: AlertTriangle, color: 'text-warning-400', bg: 'bg-warning-500/10', filter: 'late'     },
            { label: 'Absent',        value: stats.absent,   icon: XCircle,       color: 'text-danger-400',  bg: 'bg-danger-500/10',  filter: 'absent'   },
            { label: 'On Leave',      value: stats.on_leave, icon: Calendar,      color: 'text-primary-400', bg: 'bg-primary-500/10', filter: 'on_leave' },
            { label: 'Remote/Hybrid', value: stats.remote,   icon: Wifi,          color: 'text-slate-300',   bg: 'bg-white/5',        filter: 'all'      },
          ].map(s => (
            <motion.button key={s.label} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              onClick={() => setFilter(filter === s.filter ? 'all' : s.filter)}
              className={clsx('stat-card text-left transition-all', filter === s.filter && 'border-primary-500/30')}>
              <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center', s.bg)}>
                <s.icon className={clsx('w-4 h-4', s.color)} />
              </div>
              <div>
                <p className="text-xl font-display font-bold text-white">
                  {loading || rangeLoading ? '—' : s.value}
                </p>
                <p className="text-[10px] text-slate-500">{s.label}</p>
              </div>
            </motion.button>
          ))}
        </div>

        {/* Weekly chart */}
        {!isDateFiltered && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="glass-card p-5">
            <h3 className="font-semibold text-white text-sm mb-4">This Week's Attendance</h3>
            {loading || weekly.length === 0 ? (
              <div className="h-44 flex items-center justify-center text-slate-500 text-xs">
                {loading ? 'Loading…' : 'No data yet this week'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={weekly} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '11px' }} />
                  <Bar dataKey="present" name="Present" stackId="a" fill="#10b981" radius={[0,0,0,0]} />
                  <Bar dataKey="late"    name="Late"    stackId="a" fill="#f59e0b" />
                  <Bar dataKey="absent"  name="Absent"  stackId="a" fill="#ef4444" />
                  <Bar dataKey="on_leave" name="On Leave" stackId="a" fill="#3b82f6" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </motion.div>
        )}

        {/* Employee table */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="glass-card overflow-hidden">
          <div className="p-4 border-b border-white/5 flex gap-3 flex-wrap items-center">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, employee ID or department…"
              className="input-field py-2 text-xs flex-1 min-w-48" />
            <select value={filter} onChange={e => setFilter(e.target.value)} className="input-field w-auto py-2 text-xs">
              <option value="all">All Status</option>
              <option value="present">Present</option>
              <option value="working">Working</option>
              <option value="late">Late</option>
              <option value="absent">Absent</option>
              <option value="on_leave">On Leave</option>
            </select>
            <span className="text-[10px] text-slate-500 whitespace-nowrap">
              {filtered.length} / {isDateFiltered ? totalRecords : employees.length} {isDateFiltered ? 'records' : 'employees'}
            </span>
          </div>

          {loading || rangeLoading ? (
            <div className="p-10 text-center text-slate-500 text-xs">
              {rangeLoading ? 'Fetching records for selected range…' : 'Loading attendance data…'}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-xs">No records match your search</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th><th>Department</th>
                    {isDateFiltered && <th>Date</th>}
                    <th>Check In</th><th>Check Out</th><th>Total Hours</th><th>Mode</th><th>Status</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedEmployees.map((r, i) => {
                    const s        = STATUS_MAP[r.status] || { label: r.status, cls: 'badge-primary' };
                    const totalHours = r.totalHours ?? r.hours ?? 0;
                    const hoursVal = totalHours > 0 ? totalHours : r.liveHours;
                    const isLive   = totalHours === 0 && r.liveHours !== null;
                    return (
                      <tr key={r.userId || i}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500/30 to-accent-500/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
                              {r.avatar
                                ? <img src={r.avatar} alt={r.name} className="w-full h-full object-cover" />
                                : <span className="text-[10px] font-bold text-white">{initials(r.name)}</span>}
                            </div>
                            <div>
                              <p className="text-xs font-medium text-white">{r.name}</p>
                              <p className="text-[10px] text-slate-500">{r.employeeId}</p>
                            </div>
                          </div>
                        </td>
                        <td className="text-slate-400 text-xs">{r.dept}</td>
                        {isDateFiltered && (
                          <td className="text-xs text-slate-300">{fmtShortDate(r.date)}</td>
                        )}
                        <td className="text-xs">
                          <span className={r.checkIn ? 'text-slate-300' : 'text-slate-600'}>{fmt(r.checkIn)}</span>
                        </td>
                        <td className="text-xs">
                          <span className={r.checkOut ? 'text-slate-300' : 'text-slate-600'}>{fmt(r.checkOut)}</span>
                        </td>
                        <td className="text-xs">
                          {hoursVal > 0
                            ? <span className={isLive ? 'text-warning-400' : 'text-accent-400'}>
                                {hoursVal.toFixed(1)}h
                                {isLive && <span className="text-[10px] text-slate-500 ml-1">(live)</span>}
                              </span>
                            : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="text-xs">
                          {r.mode === 'remote' && <span className="flex items-center gap-1 text-primary-400"><Wifi className="w-3 h-3" />Remote</span>}
                          {r.mode === 'hybrid' && <span className="flex items-center gap-1 text-warning-400"><Wifi className="w-3 h-3" />Hybrid</span>}
                          {r.mode === 'office' && <span className="text-slate-400">Office</span>}
                          {r.mode === '—'      && <span className="text-slate-600">—</span>}
                        </td>
                        <td>
                          <span className={clsx('badge text-[10px]', s.cls)}>{s.label}</span>
                          {(r.status === 'late') && fmtLate(r.lateMinutes) && (
                            <p className="text-[10px] text-warning-400 mt-0.5">Late by {fmtLate(r.lateMinutes)}</p>
                          )}
                          {r.status === 'late' && r.lateApproval && (
                            <span className={clsx('inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full mt-1',
                              r.lateApproval === 'approved'
                                ? 'bg-accent-500/10 text-accent-400'
                                : 'bg-danger-500/10 text-danger-400')}>
                              {r.lateApproval === 'approved' ? 'Approved' : 'Unapproved'}
                            </span>
                          )}
                          {(r.status === 'present' || r.status === 'working') && fmtDuration(r.earlyMinutes) && (
                            <p className="text-[10px] text-accent-400 mt-0.5">Early by {fmtDuration(r.earlyMinutes)}</p>
                          )}
                          {r.status === 'on_leave' && r.leaveType && (
                            <p className="text-[10px] text-slate-500 mt-0.5">{LEAVE_TYPE_LABELS[r.leaveType] || r.leaveType}</p>
                          )}
                        </td>
                        <td>
                          <button onClick={() => setSelectedEmployee(r)} title="View details"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-primary-400 hover:bg-primary-500/10 transition-colors">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !rangeLoading && (isDateFiltered ? totalRecords > TABLE_PAGE_SIZE : filtered.length > TABLE_PAGE_SIZE) && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
              <span className="text-[11px] text-slate-500">
                Showing {(page - 1) * TABLE_PAGE_SIZE + 1}–{Math.min(page * TABLE_PAGE_SIZE, isDateFiltered ? totalRecords : filtered.length)} of {isDateFiltered ? totalRecords : filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] text-slate-400">Page {page} of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showRectify && (
          <RectifyModal onClose={() => { setShowRectify(false); loadToday(); }} />
        )}
        {showAddAttendance && (
          <AddAttendanceModal onClose={() => { setShowAddAttendance(false); loadToday(); }} />
        )}
      </AnimatePresence>

      {selectedEmployee && (
        <EmployeeDetailModal employee={selectedEmployee} onClose={() => setSelectedEmployee(null)} />
      )}
    </>
  );
}
