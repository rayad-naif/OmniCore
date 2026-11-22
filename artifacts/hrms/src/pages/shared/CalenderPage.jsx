import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { CalendarDays, ChevronLeft, ChevronRight, Cake, Plus, UserRound, X, Pencil, Trash2, Home } from 'lucide-react';
import { employeeAPI, leaveAPI, calendarEventAPI, workFromHomeAPI } from '@/services/api';
import { selectUser } from '@/store/slices/authSlice';
import toast from 'react-hot-toast';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateKey = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const apiDateKey = (value) => String(value || '').slice(0, 10);
const birthdayKey = (value, year) => {
  const [, month, day] = String(value || '').slice(0, 10).split('-');
  return month && day ? `${year}-${month}-${day}` : null;
};
const displayName = (employee) => [employee?.firstName, employee?.lastName].filter(Boolean).join(' ') || employee?.email || 'Employee';
const initials = (employee) => displayName(employee).split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

function EmployeeAvatar({ employee, large = false }) {
  const size = large ? 'h-12 w-12 text-sm' : 'h-6 w-6 text-[9px]';
  return employee?.avatar
    ? <img src={employee.avatar} alt={displayName(employee)} className={`${size} shrink-0 rounded-full object-cover ring-2 ring-white/40 shadow-lg shadow-slate-950/30`} />
    : <span className={`${size} inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-accent-500 font-semibold text-white ring-2 ring-white/20 shadow-lg shadow-slate-950/30`}>{initials(employee)}</span>;
}

const EMPTY_FORM = (today) => ({ title: '', date: dateKey(today), endDate: dateKey(today), type: 'other', description: '' });

export default function CalenderPage() {
  const user = useSelector(selectUser);
  const isEmployee = user?.role === 'employee';
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(dateKey(today));
  const [employees, setEmployees] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [wfhRequests, setWfhRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);

  // Create form state
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventForm, setEventForm] = useState(EMPTY_FORM(today));

  // Edit form state
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM(today));

  // Delete confirmation state
  const [deletingEventId, setDeletingEventId] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    const loadCalendar = async () => {
      try {
        const [employeesResponse, leavesResponse, wfhResponse, eventsResponse] = await Promise.all([
          isEmployee ? employeeAPI.getBirthdays() : employeeAPI.getAll({ limit: 1000 }),
          leaveAPI.getAll(),
          workFromHomeAPI.getAll(),
          calendarEventAPI.getAll(),
        ]);
        setEmployees(employeesResponse.data.data || []);
        setLeaves(leavesResponse.data.data || []);
        setWfhRequests(wfhResponse.data.data || []);
        setEvents(eventsResponse.data.data || []);
      } catch (error) {
        toast.error(error.response?.data?.message || 'Unable to load calendar data');
      } finally {
        setLoading(false);
      }
    };
    loadCalendar();
  }, [isEmployee]);

  const days = useMemo(() => {
    const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const gridStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1 - firstDay.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return date;
    });
  }, [currentMonth]);

  const birthdaysByDate = useMemo(() => {
    const result = new Map();
    employees.forEach((employee) => {
      const key = birthdayKey(employee.dateOfBirth, currentMonth.getFullYear());
      if (key) result.set(key, [...(result.get(key) || []), employee]);
    });
    return result;
  }, [employees, currentMonth]);

  const leavesByDate = useMemo(() => {
    const result = new Map();
    leaves.filter((leave) => leave.status !== 'rejected').forEach((leave) => {
      const start = new Date(`${apiDateKey(leave.startDate)}T00:00:00`);
      const end = new Date(`${apiDateKey(leave.endDate)}T00:00:00`);
      for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
        const key = dateKey(day);
        result.set(key, [...(result.get(key) || []), leave]);
      }
    });
    return result;
  }, [leaves]);

  const wfhByDate = useMemo(() => {
    const result = new Map();
    wfhRequests.filter((request) => request.status !== 'rejected').forEach((request) => {
      const start = new Date(`${apiDateKey(request.startDate)}T00:00:00`);
      const end = new Date(`${apiDateKey(request.endDate)}T00:00:00`);
      for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
        const key = dateKey(day);
        result.set(key, [...(result.get(key) || []), request]);
      }
    });
    return result;
  }, [wfhRequests]);

  const eventsByDate = useMemo(() => events.reduce((result, event) => {
    const start = new Date(`${apiDateKey(event.date)}T00:00:00`);
    const end = new Date(`${apiDateKey(event.endDate || event.date)}T00:00:00`);
    for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
      const key = dateKey(day);
      result.set(key, [...(result.get(key) || []), event]);
    }
    return result;
  }, new Map()), [events]);

  const selectDate = (key) => {
    const date = new Date(`${key}T00:00:00`);
    setSelectedDate(key);
    setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };
  const moveMonth = (amount) => setCurrentMonth((month) => new Date(month.getFullYear(), month.getMonth() + amount, 1));
  const selectedBirthdays = birthdaysByDate.get(selectedDate) || [];
  const selectedLeaves = leavesByDate.get(selectedDate) || [];
  const selectedWfhRequests = wfhByDate.get(selectedDate) || [];
  const selectedEvents = eventsByDate.get(selectedDate) || [];

  // --- Create ---
  const addEvent = async (event) => {
    event.preventDefault();
    if (!eventForm.title.trim() || !eventForm.date) return;
    try {
      const { data } = await calendarEventAPI.create(eventForm);
      setEvents((current) => [...current, data.data]);
      selectDate(eventForm.date);
      setShowEventForm(false);
      setEventForm(EMPTY_FORM(today));
      toast.success('Event published to the company calendar');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Unable to create event');
    }
  };

  // --- Edit: open form pre-filled ---
  const openEditForm = (calendarEvent) => {
    setEditingEvent(calendarEvent);
    setEditForm({
      title: calendarEvent.title || '',
      date: apiDateKey(calendarEvent.date),
      endDate: apiDateKey(calendarEvent.endDate || calendarEvent.date),
      type: calendarEvent.type || 'other',
      description: calendarEvent.description || '',
    });
    setShowEditForm(true);
  };

  const saveEditEvent = async (e) => {
    e.preventDefault();
    if (!editForm.title.trim() || !editForm.date) return;
    try {
      const { data } = await calendarEventAPI.update(editingEvent._id, editForm);
      setEvents((current) => current.map((ev) => ev._id === editingEvent._id ? data.data : ev));
      setShowEditForm(false);
      setEditingEvent(null);
      toast.success('Event updated successfully');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Unable to update event');
    }
  };

  // --- Delete ---
  const confirmDelete = async () => {
    if (!deletingEventId) return;
    setDeleteLoading(true);
    try {
      await calendarEventAPI.delete(deletingEventId);
      setEvents((current) => current.filter((ev) => ev._id !== deletingEventId));
      setDeletingEventId(null);
      toast.success('Event deleted');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Unable to delete event');
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="font-display text-2xl font-bold text-white">{isEmployee ? 'My Calendar' : 'Team Calendar'}</h1><p className="mt-1 text-sm text-slate-400">{isEmployee ? 'Your birthday, leave, and company events in one place.' : 'Birthdays, employee leave, and team events in one place.'}</p></div>
        {!isEmployee && <button onClick={() => setShowEventForm(true)} className="btn-primary text-xs"><Plus className="h-4 w-4" /> Add Event</button>}
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-primary-500/20 bg-gradient-to-r from-primary-500/15 via-surface-900 to-accent-500/10 p-5 shadow-xl shadow-slate-950/30">
        <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full bg-primary-500/15 blur-3xl" />
        <div className="relative mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3"><div className="rounded-2xl bg-primary-500/20 p-3 text-primary-200 ring-1 ring-primary-400/20"><CalendarDays className="h-5 w-5" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-200">Selected date</p><h2 className="mt-0.5 text-lg font-bold text-white">{new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2></div></div>
          <span className="rounded-full border border-white/10 bg-slate-950/25 px-3 py-1.5 text-xs text-slate-300">{selectedBirthdays.length + selectedLeaves.length + selectedWfhRequests.length + selectedEvents.length} item{selectedBirthdays.length + selectedLeaves.length + selectedWfhRequests.length + selectedEvents.length !== 1 ? 's' : ''}</span>
        </div>
        {selectedBirthdays.length || selectedLeaves.length || selectedWfhRequests.length || selectedEvents.length ? <div className="relative grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {selectedBirthdays.map((employee) => <div key={`selected-birthday-${employee._id}`} className="flex items-center gap-4 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-500/10 p-4 backdrop-blur-sm"><EmployeeAvatar employee={employee} large /><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{displayName(employee)}</p><p className="mt-1 text-xs text-fuchsia-200"><Cake className="mr-1 inline h-3.5 w-3.5" />Birthday celebration</p></div></div>)}
          {selectedLeaves.map((leave) => <div key={`selected-leave-${leave._id}`} className={`flex items-center gap-4 rounded-2xl border p-4 backdrop-blur-sm ${leave.status === 'approved' ? 'border-amber-400/25 bg-amber-500/10' : 'border-sky-400/25 bg-sky-500/10'}`}><EmployeeAvatar employee={leave.employee} large /><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{displayName(leave.employee)}</p><p className="mt-1 text-xs capitalize text-slate-200">{leave.status} {leave.leaveType} leave</p></div></div>)}
          {selectedWfhRequests.map((request) => <div key={`selected-wfh-${request._id}`} className={`flex items-center gap-4 rounded-2xl border p-4 backdrop-blur-sm ${request.status === 'approved' ? 'border-cyan-400/25 bg-cyan-500/10' : 'border-violet-400/25 bg-violet-500/10'}`}><EmployeeAvatar employee={request.employee} large /><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{displayName(request.employee)}</p><p className="mt-1 text-xs capitalize text-slate-200"><Home className="mr-1 inline h-3.5 w-3.5" />{request.status} work from home</p></div></div>)}
          {selectedEvents.map((calendarEvent) => (
            <div key={`selected-event-${calendarEvent._id}`} className="relative rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4 backdrop-blur-sm">
              <p className="pr-14 text-sm font-semibold text-white">{calendarEvent.title}</p>
              <p className="mt-1 text-xs capitalize text-emerald-200">{calendarEvent.type?.replace(/_/g, ' ') || 'Company event'}</p>
              {calendarEvent.description && <p className="mt-2 text-xs text-slate-300">{calendarEvent.description}</p>}
              {!isEmployee && (
                <div className="absolute right-3 top-3 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEditForm(calendarEvent)}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label="Edit event"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingEventId(calendarEvent._id)}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-500/20 hover:text-red-300"
                    aria-label="Delete event"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div> : <p className="relative rounded-2xl border border-dashed border-white/15 bg-slate-950/15 py-7 text-center text-sm text-slate-400">No leave, or events on this date.</p>}
      </div>

      <div className="glass-card overflow-hidden shadow-xl shadow-slate-950/20">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-gradient-to-r from-primary-500/10 via-transparent to-accent-500/10 px-5 py-4">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-primary-500/15 p-2 text-primary-300"><CalendarDays className="h-5 w-5" /></div><div><p className="text-base font-semibold text-white">{currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p><p className="text-xs text-slate-400">Today: {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p></div></div>
          <div className="flex items-center gap-2"><input aria-label="Jump to date" type="date" value={selectedDate} onChange={(event) => selectDate(event.target.value)} className="input-field w-36 px-2 py-1.5 text-xs" /><button onClick={() => selectDate(dateKey(today))} className="btn-secondary px-3 py-2 text-xs">Today</button><button aria-label="Previous month" onClick={() => moveMonth(-1)} className="btn-secondary p-2"><ChevronLeft className="h-4 w-4" /></button><button aria-label="Next month" onClick={() => moveMonth(1)} className="btn-secondary p-2"><ChevronRight className="h-4 w-4" /></button></div>
        </div>

        <div className="grid grid-cols-7 border-b border-white/10 bg-slate-950/20">{WEEKDAYS.map((day) => <div key={day} className="px-2 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">{day}</div>)}</div>
        {loading ? <div className="flex h-96 items-center justify-center text-sm text-slate-400">Loading calendar...</div> : (
          <div className="grid grid-cols-7">
            {days.map((date) => {
              const key = dateKey(date);
              const birthdays = birthdaysByDate.get(key) || [];
              const dayLeaves = leavesByDate.get(key) || [];
              const dayWfhRequests = wfhByDate.get(key) || [];
              const dayEvents = eventsByDate.get(key) || [];
              const isToday = key === dateKey(today);
              return <button type="button" key={key} onClick={() => selectDate(key)} aria-label={`View ${key}`} className={`min-h-32 border-b border-r border-white/10 p-2 text-left transition-colors hover:bg-white/[0.045] ${date.getMonth() === currentMonth.getMonth() ? 'bg-surface-900/20' : 'bg-slate-950/35 opacity-45'} ${selectedDate === key ? 'ring-1 ring-inset ring-primary-400 bg-primary-500/10' : ''}`}>
                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${isToday ? 'bg-primary-600 text-white shadow-glow-primary' : 'text-slate-300'}`}>{date.getDate()}</span>
                <div className="mt-1 space-y-1 overflow-hidden">
                  {birthdays.map((employee) => <div key={`birthday-${employee._id}`} className="flex items-center gap-1 truncate rounded bg-fuchsia-500/15 px-1.5 py-1 text-[10px] text-fuchsia-200"><EmployeeAvatar employee={employee} /><span className="truncate">{displayName(employee)}</span></div>)}
                  {dayLeaves.map((leave) => <div key={`${leave._id}-${key}`} className={`flex items-center gap-1 truncate rounded px-1.5 py-1 text-[10px] ${leave.status === 'approved' ? 'bg-amber-500/15 text-amber-200' : 'bg-sky-500/15 text-sky-200'}`}><EmployeeAvatar employee={leave.employee} /><span className="truncate">{displayName(leave.employee)} - {leave.leaveType}</span></div>)}
                  {dayWfhRequests.map((request) => <div key={`${request._id}-${key}`} className={`flex items-center gap-1 truncate rounded px-1.5 py-1 text-[10px] ${request.status === 'approved' ? 'bg-cyan-500/15 text-cyan-200' : 'bg-violet-500/15 text-violet-200'}`}><EmployeeAvatar employee={request.employee} /><span className="truncate">{displayName(request.employee)} - WFH</span></div>)}
                  {dayEvents.map((calendarEvent) => <div key={calendarEvent._id} className="truncate rounded bg-emerald-500/15 px-1.5 py-1 text-[10px] text-emerald-200">{calendarEvent.title}</div>)}
                </div>
              </button>;
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-2 px-5 py-3 text-[11px] text-slate-400"><span><Cake className="mr-1 inline h-3.5 w-3.5 text-fuchsia-300" />Birthday</span><span><UserRound className="mr-1 inline h-3.5 w-3.5 text-amber-300" />Approved leave</span><span><UserRound className="mr-1 inline h-3.5 w-3.5 text-sky-300" />Pending leave</span><span><Home className="mr-1 inline h-3.5 w-3.5 text-cyan-300" />Approved WFH</span><span><Home className="mr-1 inline h-3.5 w-3.5 text-violet-300" />Pending WFH</span></div>
      </div>

      {/* Create Event Modal */}
      {showEventForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
          <form onSubmit={addEvent} className="glass-card w-full max-w-md p-5 shadow-2xl">
            <div className="mb-5 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-white">Add Company Event</h2><button type="button" onClick={() => setShowEventForm(false)} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button></div>
            <div className="space-y-4">
              <div><label className="input-label">Event name</label><input autoFocus value={eventForm.title} onChange={(event) => setEventForm({ ...eventForm, title: event.target.value })} className="input-field text-sm" placeholder="e.g. Independence Day" /></div>
              <div><label className="input-label">Event type</label><select value={eventForm.type} onChange={(event) => setEventForm({ ...eventForm, type: event.target.value })} className="input-field text-sm"><option value="public_holiday">Public holiday</option><option value="company_lunch">Company lunch</option><option value="announcement">Announcement</option><option value="other">Other</option></select></div>
              <div className="grid grid-cols-2 gap-3"><div><label className="input-label">From date</label><input type="date" value={eventForm.date} onChange={(event) => setEventForm({ ...eventForm, date: event.target.value, endDate: eventForm.endDate < event.target.value ? event.target.value : eventForm.endDate })} className="input-field text-sm" /></div><div><label className="input-label">End date</label><input type="date" min={eventForm.date} value={eventForm.endDate} onChange={(event) => setEventForm({ ...eventForm, endDate: event.target.value })} className="input-field text-sm" /></div></div>
              <div><label className="input-label">Description <span className="text-slate-500">(optional)</span></label><textarea rows={3} value={eventForm.description} onChange={(event) => setEventForm({ ...eventForm, description: event.target.value })} className="input-field resize-none text-sm" placeholder="Add details for employees" /></div>
            </div>
            <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setShowEventForm(false)} className="btn-secondary text-xs">Cancel</button><button type="submit" className="btn-primary text-xs">Publish Event</button></div>
          </form>
        </div>
      )}

      {/* Edit Event Modal */}
      {showEditForm && editingEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
          <form onSubmit={saveEditEvent} className="glass-card w-full max-w-md p-5 shadow-2xl">
            <div className="mb-5 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-white">Edit Event</h2><button type="button" onClick={() => { setShowEditForm(false); setEditingEvent(null); }} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button></div>
            <div className="space-y-4">
              <div><label className="input-label">Event name</label><input autoFocus value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className="input-field text-sm" placeholder="e.g. Independence Day" /></div>
              <div><label className="input-label">Event type</label><select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} className="input-field text-sm"><option value="public_holiday">Public holiday</option><option value="company_lunch">Company lunch</option><option value="announcement">Announcement</option><option value="other">Other</option></select></div>
              <div className="grid grid-cols-2 gap-3"><div><label className="input-label">From date</label><input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value, endDate: editForm.endDate < e.target.value ? e.target.value : editForm.endDate })} className="input-field text-sm" /></div><div><label className="input-label">End date</label><input type="date" min={editForm.date} value={editForm.endDate} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} className="input-field text-sm" /></div></div>
              <div><label className="input-label">Description <span className="text-slate-500">(optional)</span></label><textarea rows={3} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="input-field resize-none text-sm" placeholder="Add details for employees" /></div>
            </div>
            <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => { setShowEditForm(false); setEditingEvent(null); }} className="btn-secondary text-xs">Cancel</button><button type="submit" className="btn-primary text-xs">Save Changes</button></div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingEventId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
          <div className="glass-card w-full max-w-sm p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-white">Delete Event</h2><button type="button" onClick={() => setDeletingEventId(null)} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button></div>
            <p className="text-sm text-slate-300">Are you sure you want to delete this event? This action cannot be undone.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setDeletingEventId(null)} disabled={deleteLoading} className="btn-secondary text-xs">Cancel</button>
              <button type="button" onClick={confirmDelete} disabled={deleteLoading} className="btn-primary bg-red-600 text-xs hover:bg-red-500 focus-visible:ring-red-500">{deleteLoading ? 'Deleting…' : 'Delete Event'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
