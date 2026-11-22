import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Plus, Loader2, X, Clock, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { format, addDays, startOfWeek, isSameDay } from 'date-fns';
import { shiftAssignmentAPI, shiftTypeAPI, employeeAPI } from '@/services/api';
import toast from 'react-hot-toast';


const WORK_MODE_LABELS = {
  office: 'Office',
  remote: 'Remote',
  hybrid: 'Hybrid',
};

// Day pill config: label shown on button, JS getDay() index
const DAY_PILLS = [
  { label: 'Sun', idx: 0 },
  { label: 'Mon', idx: 1 },
  { label: 'Tue', idx: 2 },
  { label: 'Wed', idx: 3 },
  { label: 'Thu', idx: 4 },
  { label: 'Fri', idx: 5 },
  { label: 'Sat', idx: 6 },
];

function AssignmentModal({ item, selectedEmployee, shiftTypes, onClose, onSave }) {
  const isEdit = Boolean(item?._id);
  // In edit mode, originalWeekday is the day of the record being edited (always updated).
  // Extra days selected beyond the original will have NEW assignments created.
  const originalWeekday = isEdit && typeof item?.weekday === 'number' ? item.weekday : null;

  const [form, setForm] = useState({
    employee: selectedEmployee?._id || '',
    recurring: item?.recurring ?? true,
    // weekdays drives all pill selections for both create and edit modes
    weekdays: typeof item?.weekday === 'number' ? [item.weekday] : [],
    shiftType: item?.shiftType?._id || item?.shiftType || '',
    startDate: item?.startDate ? new Date(item.startDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    endDate: item?.endDate ? new Date(item.endDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    notes: item?.notes || '',
  });
  const [submitting, setSubmitting] = useState(false);

  const selectedShiftDetails = useMemo(
    () => shiftTypes.find(t => t._id === form.shiftType),
    [form.shiftType, shiftTypes]
  );

  // Toggle a day pill — works in both create and edit modes.
  // In edit mode the original weekday can still be toggled (deselecting means
  // the existing record's shift config is updated but no extra creates happen
  // for that day — the record is always updated regardless).
  const toggleDay = (idx) => {
    setForm(p => {
      const already = p.weekdays.includes(idx);
      return {
        ...p,
        weekdays: already ? p.weekdays.filter(d => d !== idx) : [...p.weekdays, idx],
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.shiftType) {
      toast.error('Please select a shift type configuration.');
      return;
    }
    if (form.recurring && form.weekdays.length === 0) {
      toast.error('Please select at least one weekday.');
      return;
    }

    setSubmitting(true);

    const sharedPayload = {
      employee: form.employee,
      shiftType: form.shiftType,
      recurring: form.recurring,
      startDate: form.startDate,
      endDate: form.endDate,
      notes: form.notes,
      startTime: selectedShiftDetails?.startTime,
      endTime: selectedShiftDetails?.endTime,
      crossDay: selectedShiftDetails?.crossDay,
      workMode: selectedShiftDetails?.workMode || 'office',
      breakEnabled: selectedShiftDetails?.breakEnabled,
      breakDurationMinutes: selectedShiftDetails?.breakDurationMinutes,
    };

    try {
      if (isEdit) {
        // Always update the original record (the one that was clicked to open edit).
        await shiftAssignmentAPI.update(item._id, {
          ...sharedPayload,
          ...(form.recurring ? { weekday: originalWeekday } : {}),
        });

        // For any EXTRA days the user toggled on (beyond the original), create new assignments.
        const extraDays = form.recurring
          ? form.weekdays.filter(d => d !== originalWeekday)
          : [];

        if (extraDays.length > 0) {
          const creates = await Promise.allSettled(
            extraDays.map(day =>
              shiftAssignmentAPI.create({ ...sharedPayload, weekday: day })
            )
          );
          const succeeded = creates.filter(r => r.status === 'fulfilled');
          const failed    = creates.filter(r => r.status === 'rejected');
          if (failed.length > 0) {
            toast.success(
              `Updated + added ${succeeded.length} day${succeeded.length !== 1 ? 's' : ''}. ${failed.length} skipped (conflict).`
            );
          } else {
            toast.success(
              `Updated + added ${succeeded.length} new day${succeeded.length !== 1 ? 's' : ''} successfully.`
            );
          }
        } else {
          toast.success('Shift assignment updated.');
        }
      } else if (form.recurring) {
        // Create: one API call per selected day, all in parallel.
        const results = await Promise.allSettled(
          form.weekdays.map(day =>
            shiftAssignmentAPI.create({ ...sharedPayload, weekday: day })
          )
        );
        const succeeded = results.filter(r => r.status === 'fulfilled');
        const failed    = results.filter(r => r.status === 'rejected');
        if (succeeded.length > 0 && failed.length === 0) {
          toast.success(`${succeeded.length} day${succeeded.length > 1 ? 's' : ''} assigned successfully.`);
        } else if (succeeded.length > 0) {
          toast.success(`${succeeded.length} assigned, ${failed.length} skipped (conflict).`);
        } else {
          toast.error(failed[0]?.reason?.response?.data?.message || 'All assignments failed.');
          return;
        }
      } else {
        await shiftAssignmentAPI.create(sharedPayload);
        toast.success('Date-range shift assigned.');
      }
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save shift allocation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-900 p-6 shadow-xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white">
            {isEdit ? 'Modify Assigned Shift' : 'Assign Shift Roster'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Target User Card */}
          <div className="p-3 rounded-2xl bg-white/5 border border-white/5 text-xs text-slate-300">
            Assigning to:{' '}
            <span className="text-white font-semibold">
              {selectedEmployee?.firstName} {selectedEmployee?.lastName}
            </span>
          </div>

          {/* Shift Type Selector */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Shift Configuration Profile</label>
            <select
              value={form.shiftType}
              onChange={(e) => setForm(prev => ({ ...prev, shiftType: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-xl border border-white/10 bg-surface-950 text-white text-sm focus:outline-none focus:border-primary-500"
              required
            >
              <option value="" disabled>-- Select Shift Type --</option>
              {shiftTypes.map((type) => (
                <option key={type._id} value={type._id}>
                  {type.name} ({type.startTime} – {type.endTime}){type.crossDay ? ' [Cross-Day]' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Shift preview */}
          {selectedShiftDetails && (
            <div className="p-3 rounded-2xl bg-primary-500/10 border border-primary-500/20 text-xs text-slate-300 space-y-1">
              <p><strong className="text-white">Timeline:</strong> {selectedShiftDetails.startTime} – {selectedShiftDetails.endTime}</p>
              <p><strong className="text-white">Overnight:</strong> {selectedShiftDetails.crossDay ? 'Yes (wraps midnight)' : 'No'}</p>
              <p><strong className="text-white">Work mode:</strong> {selectedShiftDetails.workMode}</p>
            </div>
          )}

          {/* Assignment type toggle */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="radio"
                checked={form.recurring === true}
                onChange={() => setForm(p => ({ ...p, recurring: true }))}
                className="text-primary-500 focus:ring-0"
              />
              Recurring (weekly)
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="radio"
                checked={form.recurring === false}
                onChange={() => setForm(p => ({ ...p, recurring: false, weekday: null, weekdays: [] }))}
                className="text-primary-500 focus:ring-0"
              />
              Date range
            </label>
          </div>

          {/* ── Recurring: day pills — multi-select in both create and edit modes ── */}
          {form.recurring && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-slate-400">Select days</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setForm(p => ({ ...p, weekdays: DAY_PILLS.map(d => d.idx) }))}
                    className="text-[10px] text-primary-400 hover:text-primary-300 transition"
                  >
                    All
                  </button>
                  <span className="text-slate-600 text-[10px]">·</span>
                  <button
                    type="button"
                    onClick={() => setForm(p => ({ ...p, weekdays: [1, 2, 3, 4, 5] }))}
                    className="text-[10px] text-primary-400 hover:text-primary-300 transition"
                  >
                    Weekdays
                  </button>
                  <span className="text-slate-600 text-[10px]">·</span>
                  <button
                    type="button"
                    onClick={() => {
                      // In edit mode keep the original day selected (can't remove it here — use delete button)
                      setForm(p => ({ ...p, weekdays: isEdit && originalWeekday !== null ? [originalWeekday] : [] }));
                    }}
                    className="text-[10px] text-slate-500 hover:text-slate-300 transition"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {DAY_PILLS.map(({ label, idx }) => {
                  const isSelected = form.weekdays.includes(idx);
                  const isOriginal = isEdit && idx === originalWeekday;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleDay(idx)}
                      title={isOriginal ? 'Original assigned day (always updated)' : undefined}
                      className={`relative py-2 rounded-xl text-[11px] font-semibold transition border ${
                        isSelected
                          ? 'bg-primary-500 border-primary-400 text-white shadow-[0_0_8px_rgba(99,102,241,0.4)]'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {label}
                      {/* Small dot marks the original day in edit mode */}
                      {isOriginal && (
                        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white/70" />
                      )}
                    </button>
                  );
                })}
              </div>

              <p className="text-[10px] text-slate-500 mt-1.5">
                {isEdit
                  ? form.weekdays.length <= 1
                    ? 'Tap extra days to also apply this shift to those days.'
                    : `${form.weekdays.length - 1} extra day${form.weekdays.length - 1 !== 1 ? 's' : ''} will be created alongside the update.`
                  : form.weekdays.length === 0
                    ? 'Tap days to select. One assignment is created per day.'
                    : `${form.weekdays.length} day${form.weekdays.length > 1 ? 's' : ''} selected — ${form.weekdays.length} assignment${form.weekdays.length > 1 ? 's' : ''} will be created.`}
              </p>
            </div>
          )}

          {/* ── Date range fields ── */}
          {!form.recurring && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Start Date</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm(p => ({ ...p, startDate: e.target.value }))}
                  className="w-full px-4 py-2 rounded-xl border border-white/10 bg-surface-950 text-white text-xs focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">End Date</label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm(p => ({ ...p, endDate: e.target.value }))}
                  className="w-full px-4 py-2 rounded-xl border border-white/10 bg-surface-950 text-white text-xs focus:outline-none"
                  required
                />
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))}
              className="w-full px-4 py-2 rounded-xl border border-white/10 bg-surface-950 text-white text-xs focus:outline-none h-16 resize-none"
              placeholder="Optional reference notes..."
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-xl bg-primary-500 font-medium text-white text-sm hover:bg-primary-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit
              ? form.recurring && form.weekdays.length > 1
                ? `Update + Add ${form.weekdays.length - 1} Day${form.weekdays.length - 1 !== 1 ? 's' : ''}`
                : 'Save Changes'
              : form.recurring && form.weekdays.length > 1
                ? `Assign ${form.weekdays.length} Days`
                : 'Confirm Assignment'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
// `initialAssignmentId` is the day the trash icon was clicked on — it's
// pre-checked. `days` is every recurring assignment the employee currently
// has, each `{ label, idx, assignment }`, so the admin can tick extra days
// and remove them all in one confirm instead of repeating the delete flow.
function DeleteConfirmModal({ isOpen, days, initialAssignmentId, onClose, onConfirm, isDeleting }) {
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    if (isOpen) {
      setSelectedIds(initialAssignmentId ? [initialAssignmentId] : []);
    }
  }, [isOpen, initialAssignmentId]);

  if (!isOpen) return null;

  const toggleId = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const count = selectedIds.length;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-surface-900 p-6 shadow-2xl"
      >
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-500 mb-4">
            <Trash2 className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">Remove Shift Assignment</h3>
          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            Removing the shift for the day you selected. Tap any other days below if you'd like to remove those too — all checked days will be deleted together.
          </p>
        </div>

        {days.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-5">
            {days.map(({ label, idx, assignment }) => {
              const checked = selectedIds.includes(assignment._id);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleId(assignment._id)}
                  disabled={isDeleting}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition disabled:opacity-50 ${
                    checked
                      ? 'border-red-500/40 bg-red-500/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                      checked ? 'bg-red-500 border-red-500' : 'border-white/20'
                    }`}
                  >
                    {checked && <span className="h-1.5 w-1.5 rounded-sm bg-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold text-white">{label}</span>
                    <span className="block text-[10px] text-slate-400 truncate">
                      {assignment.shiftType?.name || 'Assigned shift'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="flex-1 py-2 rounded-xl border border-white/10 bg-transparent font-medium text-slate-300 text-xs hover:bg-white/5 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(selectedIds)}
            disabled={isDeleting || count === 0}
            className="flex-1 py-2 rounded-xl bg-red-500 font-medium text-white text-xs hover:bg-red-600 transition disabled:opacity-50 flex items-center justify-center gap-1"
          >
            {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {count > 1 ? `Yes, Remove ${count} Days` : 'Yes, Remove'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function getWeekDates(start) {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function isDateInRange(date, assignment) {
  if (!assignment?.startDate || !assignment?.endDate) return false;
  const start = new Date(assignment.startDate);
  const end = new Date(assignment.endDate);
  return date >= start && date <= end;
}

export default function ShiftAssignmentManagement() {
  const [assignments, setAssignments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [shiftTypes, setShiftTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [activeItem, setActiveItem] = useState(null);
  const [activeDate, setActiveDate] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [deletingIds, setDeletingIds] = useState([]);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState(null); // id of the assignment whose trash icon was clicked

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  // Weekday columns Monday..Sunday with JS getDay() mapping
  const weekdays = [
    { label: 'Mon', idx: 1 },
    { label: 'Tue', idx: 2 },
    { label: 'Wed', idx: 3 },
    { label: 'Thu', idx: 4 },
    { label: 'Fri', idx: 5 },
    { label: 'Sat', idx: 6 },
    { label: 'Sun', idx: 0 },
  ];

  const selectedAssignments = useMemo(() => {
    if (!selectedEmployee) return [];
    return assignments.filter((assignment) => {
      const employeeId = assignment.employee?._id || assignment.employee;
      return employeeId === selectedEmployee._id;
    });
  }, [assignments, selectedEmployee]);

  // Every day (Mon..Sun) the selected employee currently has a recurring
  // shift on — feeds the multi-day delete picker so the admin can check off
  // more than one day at a time instead of deleting them one by one.
  const deletableDays = useMemo(() => {
    return weekdays
      .map(({ label, idx }) => ({
        label,
        idx,
        assignment: selectedAssignments.find((a) => a.recurring && a.weekday === idx),
      }))
      .filter((d) => d.assignment);
  }, [selectedAssignments]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [shiftRes, empRes, assignRes] = await Promise.all([
        shiftTypeAPI.getAll(),
        employeeAPI.getAll({ page: 1, limit: 500 }),
        shiftAssignmentAPI.getAll({ page: 1, limit: 500 }),
      ]);
      const activeEmployees = (empRes.data?.data || []).filter(
        (employee) => !['terminated', 'resigned'].includes(employee.status)
      );
      setShiftTypes(shiftRes.data?.data || []);
      setEmployees(activeEmployees);
      setAssignments(assignRes.data?.data || []);
      if (!selectedEmployee && activeEmployees.length) {
        setSelectedEmployee(activeEmployees[0]);
      }
    } catch (err) {
      setError('Unable to load shift assignments or lookup data.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMany = async (ids) => {
    if (!ids.length) return;
    setDeletingIds(ids);
    try {
      const results = await Promise.allSettled(ids.map((id) => shiftAssignmentAPI.delete(id)));
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - succeeded;

      if (failed === 0) {
        toast.success(succeeded > 1 ? `${succeeded} shift assignments removed.` : 'Shift assignment removed.');
      } else if (succeeded > 0) {
        toast.success(`${succeeded} removed, ${failed} failed.`);
      } else {
        toast.error('Unable to delete the selected shift assignment(s).');
      }
      fetchData();
    } finally {
      setDeletingIds([]);
    }
  };

  const openModal = (assignment = null, weekday = null) => {
    if (assignment) {
      setActiveItem(assignment);
      setActiveDate(null);
    } else {
      setActiveItem({
        employee: selectedEmployee?._id,
        recurring: true,
        weekday: weekday,
        startTime: '09:00',
        endTime: '18:00',
      });
      setActiveDate(null);
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setActiveItem(null);
    setActiveDate(null);
    setShowModal(false);
  };

  const handlePrevWeek = () => setWeekStart((prev) => addDays(prev, -7));
  const handleNextWeek = () => setWeekStart((prev) => addDays(prev, 7));

  const handleEmployeeSelect = (employee) => {
    setSelectedEmployee(employee);
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex-center h-64 text-slate-400 gap-3">
        <Loader2 className="w-5 h-5 animate-spin" />Loading shift assignment calendar…
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
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Shift Assignment Calendar</h1>
          <p className="text-slate-400 text-sm mt-0.5">Select any employee on the left and assign shifts directly on the weekly calendar.</p>
        </div>
        <button onClick={() => openModal(null, null)} className="btn-primary text-xs inline-flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" /> Assign Shift
        </button>
      </motion.div>


      <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-4">
        <div className="rounded-3xl border border-white/10 bg-surface-900 p-4">
          <div className="flex-between mb-4">
            <h2 className="text-white font-semibold">Employees</h2>
            <span className="text-xs text-slate-500">{employees.length} total</span>
          </div>
          <div className="space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
            {employees.map((employee) => {
              const active = selectedEmployee?._id === employee._id;
              const currentShift = selectedAssignments.find((assignment) => {
                const today = new Date();
                if (assignment.recurring && typeof assignment.weekday === 'number') {
                  return assignment.weekday === today.getDay();
                }
                return isDateInRange(today, assignment);
              });
              return (
                <button
                  key={employee._id}
                  onClick={() => handleEmployeeSelect(employee)}
                  className={`w-full text-left rounded-2xl p-3 transition ${active ? 'bg-primary-600/10 border border-primary-500' : 'bg-white/5 hover:bg-white/10'}`}
                >
                  <div className="flex-between gap-3">
                    <div>
                      <p className="text-sm text-white font-medium">{employee.firstName} {employee.lastName}</p>
                      <p className="text-[11px] text-slate-400 mt-1">{employee.employeeId || employee.email}</p>
                    </div>
                    <span className="text-[11px] text-slate-500">{employee.role?.replace(/_/g, ' ')}</span>
                  </div>
                  {active && currentShift && (
                    <p className="text-xs text-slate-300 mt-2">Current assigned: {currentShift.shiftType?.name || 'Assigned shift'}</p>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-surface-900 p-4">
          <div className="flex-between gap-3 mb-4">
            <div>
              <p className="text-sm text-slate-400">Weekly</p>
              <h2 className="text-white font-semibold">Mon – Sun</h2>
            </div>
            <div className="inline-flex items-center gap-2">
              <button onClick={handlePrevWeek} className="btn-secondary btn-sm"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={handleNextWeek} className="btn-secondary btn-sm"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>

                  {/* ─── MAIN CALENDAR GRID COMPONENT ─── */}
        <div className="grid grid-cols-7 gap-2">
          {weekdays.map(({ label, idx }) => {
            const assignment = selectedAssignments.find((a) => a.recurring && a.weekday === idx);
            const isToday = idx === new Date().getDay();
            
            return (
              <div key={label} className="relative group">
                <button
                  type="button"
                  onClick={() => openModal(assignment || null, idx)}
                  className={`w-full rounded-3xl border p-3 text-left transition min-h-[140px] ${
                    assignment ? 'border-primary-500/30 bg-primary-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
                  } ${isToday ? 'ring-1 ring-primary-500' : ''}`}
                >
                  <div className="flex-between mb-2">
                    <span className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{label}</span>
                  </div>
                  {assignment ? (
                    <div className="space-y-1">
                      <p className="text-sm text-white font-semibold pr-6 truncate">{assignment.shiftType?.name || 'Assigned shift'}</p>
                      <p className="text-[11px] text-slate-300">{assignment.startTime} – {assignment.endTime}</p>
                      <p className="text-[11px] text-slate-400">{WORK_MODE_LABELS[assignment.workMode] || assignment.workMode}</p>
                    </div>
                  ) : (
                    <div className="h-16 flex items-center justify-center rounded-2xl border border-dashed border-white/10 text-slate-500 text-xs">
                      + Assign
                    </div>
                  )}
                </button>

                {assignment && (
                  <button
                    type="button"
                    disabled={deletingIds.includes(assignment._id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteTarget(assignment._id);
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                    title="Delete Assignment"
                  >
                    {deletingIds.includes(assignment._id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* ─── NEW: FULL-WEEK TIMELINE VISUALIZATION BREAKDOWN PANEL ─── */}
        <div className="mt-5 rounded-2xl bg-white/5 border border-white/5 p-4 space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Employee Weekly Allocation Timeline</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Day-by-day continuous visual timeline tracking active operations.</p>
          </div>

          <div className="space-y-3">
            {weekdays.map(({ label, idx }) => {
              const assignment = selectedAssignments.find((a) => a.recurring && a.weekday === idx);
              
              let startPercent = 0;
              let widthPercent = 0;

              if (assignment && assignment.startTime && assignment.endTime) {
                const [startH, startM] = assignment.startTime.split(':').map(Number);
                const [endH, endM] = assignment.endTime.split(':').map(Number);
                
                const startMinutes = startH * 60 + startM;
                let endMinutes = endH * 60 + endM;

                if (endMinutes <= startMinutes || assignment.crossDay) {
                  endMinutes += 24 * 60;
                }

                const totalDayMinutes = 24 * 60;
                startPercent = (startMinutes / totalDayMinutes) * 100;
                widthPercent = ((endMinutes - startMinutes) / totalDayMinutes) * 100;

                if (startPercent > 100) startPercent = 100;
                if (startPercent + widthPercent > 100) widthPercent = 100 - startPercent;
              }

              return (
                <div key={label} className="grid grid-cols-[50px_1fr] items-center gap-4 text-[11px]">
                  <span className="font-medium text-slate-400 text-xs font-mono uppercase tracking-wider">{label}</span>
                  
                  {assignment ? (
                    <div className="relative">
                      {/* Timeline background rail track */}
                      <div className="relative w-full h-5 bg-surface-950 rounded-lg overflow-hidden border border-white/5 flex items-center px-2">
                        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/5 pointer-events-none" title="Midday marker" />
                        
                        {/* Active shift bar block chart */}
                        <motion.div
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          style={{
                            left: `${startPercent}%`,
                            width: `${widthPercent}%`,
                            originX: 0
                          }}
                          className="absolute h-3/4 bg-gradient-to-r from-primary-500 to-indigo-500 rounded-md shadow-[0_0_10px_rgba(99,102,241,0.2)] flex items-center px-1.5 overflow-hidden"
                        >
                          <span className="text-[9px] text-white font-medium whitespace-nowrap truncate">
                            {assignment.shiftType?.name} ({assignment.startTime}-{assignment.endTime})
                          </span>
                        </motion.div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-5 flex items-center justify-center rounded-lg border border-dashed border-white/5 text-slate-600 text-[10px]">
                      No work shift allocated
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          {/* Time Axis Legend Axis Marker Grid */}
          <div className="grid grid-cols-[50px_1fr] gap-4 pt-1 border-t border-white/5 text-[9px] font-mono text-slate-500">
            <span />
            <div className="flex justify-between px-1">
              <span>00:00 (Midnight)</span>
              <span>12:00 (Noon)</span>
              <span>24:00 (Midnight)</span>
            </div>
          </div>
        </div>

        {/* ─── LEGACY GENERAL DATA REFERENCE CARDS ─── */}
        <div className="grid grid-cols-2 gap-3 mt-4 text-slate-400 text-xs">
          <div className="rounded-2xl bg-white/5 p-3">
            <p className="font-semibold text-white text-xs mb-2">Shift types</p>
            <ul className="space-y-1">
              {shiftTypes.slice(0, 5).map((shift) => (
                <li key={shift._id} className="truncate">{shift.name}</li>
              ))}
              {shiftTypes.length > 5 && <li className="text-slate-500">+{shiftTypes.length - 5} more</li>}
            </ul>
          </div>
          <div className="rounded-2xl bg-white/5 p-3">
            <p className="font-semibold text-white text-xs mb-2">Tips</p>
            <p className="text-[11px] leading-5 text-slate-500">Click a day to assign or edit the selected employee's shift. Existing shift types can be reused across employees.</p>
          </div>
        </div>
        </div>
      </div>

      {showModal && selectedEmployee && (
        <AssignmentModal
          item={activeItem}
          selectedEmployee={selectedEmployee}
          shiftTypes={shiftTypes}
          onClose={closeModal}
          onSave={() => { closeModal(); fetchData(); }}
        />
      )}
      <DeleteConfirmModal
        isOpen={Boolean(confirmDeleteTarget)}
        days={deletableDays}
        initialAssignmentId={confirmDeleteTarget}
        isDeleting={deletingIds.length > 0}
        onClose={() => setConfirmDeleteTarget(null)}
        onConfirm={async (ids) => {
          await handleDeleteMany(ids);
          setConfirmDeleteTarget(null); // Close the layout once done
        }}
      />
    </div>
  );
}