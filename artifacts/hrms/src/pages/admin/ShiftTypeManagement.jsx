import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Edit, Trash2, Loader2, X } from 'lucide-react'; // Kept UI controls
import { shiftTypeAPI } from '@/services/api';
import StatusModal from '@/pages/shared/StatusModal'; // ◄◄ Imported your new shared modal
import { SHIFT_ICONS, MotionMorning, MotionDay, MotionEvening, MotionNight, MotionCrossDay } from '@/pages/shared/ShiftIcons';
import toast from 'react-hot-toast';

const WORK_MODE_LABELS = {
  office: 'Office',
  remote: 'Remote',
  hybrid: 'Hybrid',
};

function ShiftTypeModal({ item, onClose, onSave }) {
  const isEdit = Boolean(item?._id);
  const [form, setForm] = useState({
    name: item?.name || '',
    description: item?.description || '',
    startTime: item?.startTime || '09:00',
    endTime: item?.endTime || '18:00',
    crossDay: item?.crossDay ?? false,
    workMode: item?.workMode || 'office',
    breakEnabled: item?.breakEnabled ?? true,
    breakDurationMinutes: item?.breakDurationMinutes ?? 60,
    isActive: item?.isActive ?? true,
    iconKey: item?.iconKey || 'day', 
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (key) => (event) => {
    const { type, value, checked } = event.target;
    setForm((prev) => ({
      ...prev,
      [key]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.startTime || !form.endTime) {
      setError('Name, start time and end time are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await shiftTypeAPI.update(item._id, form);
        onSave('edit'); // Pass context back to management
      } else {
        await shiftTypeAPI.create(form);
        onSave('create'); // Pass context back to management
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to save shift type.');
      setSaving(false);
    }
  };

  return (
  <div className="fixed inset-0 bg-black/60 z-50 flex-center p-4" onClick={onClose}>
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-xl p-6"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex-between mb-5">
        <h3 className="font-display font-bold text-white">
          {isEdit ? 'Edit Shift Type' : 'Add Shift Type'}
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="input-label">Name *</label>
          <input
            className="input-field"
            value={form.name}
            onChange={handleChange('name')}
            placeholder="e.g. Morning Shift"
          />
        </div>
        <div>
          <label className="input-label">Work Mode</label>
          <select className="input-field" value={form.workMode} onChange={handleChange('workMode')}>
            {Object.entries(WORK_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="input-label">Start Time *</label>
          <input type="time" className="input-field" value={form.startTime} onChange={handleChange('startTime')} />
        </div>
        
        {/* End Time Input Fix Applied Here */}
        <div>
          <label className="input-label">End Time *</label>
          <input type="time" className="input-field" value={form.endTime} onChange={handleChange('endTime')} />
        </div>
                        {/* ─── DYNAMIC SHIFT ANIMATION BLUEPRINT SELECTOR ─── */}
            <div className="col-span-2 rounded-2xl bg-white/5 border border-white/5 p-4">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-3">
                Visual Card Icon Blueprint
              </label>
              
              <div className="grid grid-cols-5 gap-2">
                {[
                  { key: 'morning',   label: 'Morning',   Comp: MotionMorning },
                  { key: 'day',       label: 'Day',       Comp: MotionDay },
                  { key: 'evening',   label: 'Evening',   Comp: MotionEvening },
                  { key: 'night',     label: 'Night',     Comp: MotionNight },
                  { key: 'cross_day', label: 'Cross Day', Comp: MotionCrossDay },
                ].map((opt) => {
                  const TargetIcon = opt.Comp;
                  const isSelected = form.iconKey === opt.key;
                  
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setForm(prev => ({ ...prev, iconKey: opt.key }))}
                      className={`flex flex-col items-center justify-center p-3 rounded-2xl border transition-all duration-200 ${
                        isSelected 
                          ? 'bg-primary-500/10 border-primary-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.15)]' 
                          : 'bg-white/5 border-transparent text-slate-400 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {/* Always render the preview icon with 'active' forced to true for previewing motion */}
                      <div className="mb-1.5 transform scale-110">
                        <TargetIcon active={true} />
                      </div>
                      <span className="text-[10px] font-medium tracking-wide">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
        <div className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 mt-3">
          <div>
            <p className="text-sm font-medium text-white">Cross-Day Shift</p>
            <p className="text-xs text-slate-400">Enable if shift schedule runs past midnight into the next day (e.g. Night Shifts).</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={form.crossDay}
              onChange={handleChange('crossDay')}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
          </label>
        </div>
        <div className="md:col-span-2">
          <label className="input-label">Description</label>
          <textarea
            className="input-field min-h-[100px]"
            value={form.description}
            onChange={handleChange('description')}
            placeholder="Optional details about the shift"
          />
        </div>
        <div className="flex items-center gap-3">
          <input
            id="breakEnabled"
            type="checkbox"
            checked={form.breakEnabled}
            onChange={handleChange('breakEnabled')}
            className="form-checkbox"
          />
          <label htmlFor="breakEnabled" className="text-sm text-slate-300">Break enabled</label>
        </div>
        <div>
          <label className="input-label">Break Duration</label>
          <input
            type="number"
            min="0"
            className="input-field"
            value={form.breakDurationMinutes}
            onChange={handleChange('breakDurationMinutes')}
          />
        </div>
        <div className="flex items-center gap-3">
          <input
            id="isActive"
            type="checkbox"
            checked={form.isActive}
            onChange={handleChange('isActive')}
            className="form-checkbox"
          />
          <label htmlFor="isActive" className="text-sm text-slate-300">Active</label>
        </div>
      </div>

      {error && <div className="text-red-400 text-xs mt-4">{error}</div>}

      <div className="flex gap-3 mt-6">
        <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button onClick={handleSubmit} disabled={saving} className="btn-primary flex-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? 'Save Shift' : 'Create Shift'}
        </button>
      </div>
    </motion.div>
  </div>
);
}

export default function ShiftTypeManagement() {
  const [shiftTypes, setShiftTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeItem, setActiveItem] = useState(null);
  const [showModal, setShowModal] = useState(false);
  
  // ─── STATUS MODALS STATE MANAGEMENT ───
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [successConfig, setSuccessConfig] = useState({ isOpen: false, title: '', message: '' });

  const fetchShiftTypes = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await shiftTypeAPI.getAll();
      setShiftTypes(res.data?.data || []);
    } catch (err) {
      setError('Unable to load shift types.');
    } finally {
      setLoading(false);
    }
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await shiftTypeAPI.delete(deleteTarget._id);
      setDeleteTarget(null);
      toast.success('Shift type successfully deleted.');
      fetchShiftTypes();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Unable to delete shift type.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveSuccess = (actionType) => {
    closeModal();
    fetchShiftTypes();
    
    // Open professional Success status window prompt feedback
    setSuccessConfig({
      isOpen: true,
      title: actionType === 'create' ? 'Shift Profile Created' : 'Shift Profile Updated',
      message: actionType === 'create' 
        ? 'The reusable corporate schedule configuration profile has been added to rosters.' 
        : 'The configuration parameters changes have been successfully written to active records.'
    });
  };

  const openModal = (item = null) => {
    setActiveItem(item);
    setShowModal(true);
  };

  const closeModal = () => {
    setActiveItem(null);
    setShowModal(false);
  };

  useEffect(() => { fetchShiftTypes(); }, []);
// const AnimatedIconComponent = SHIFT_ICONS[shift.iconKey] || SHIFT_ICONS['day'];
  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Shift Type Management</h1>
          <p className="text-slate-400 text-sm mt-0.5">Manage reusable work shift definitions for employees and schedules.</p>
        </div>
        <button onClick={() => openModal()} className="btn-primary text-xs inline-flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" /> New Shift Type
        </button>
      </motion.div>

      {loading ? (
        <div className="flex-center h-64 text-slate-400 gap-3">
          <Loader2 className="w-5 h-5 animate-spin" />Loading shift types…
        </div>
      ) : error ? (
        <div className="flex-center h-64 text-red-400 gap-3">
          <Trash2 className="w-5 h-5" />{error}
          <button onClick={fetchShiftTypes} className="btn-secondary text-xs ml-2">Retry</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {shiftTypes.map((shift) => {
  // 1. Resolve the dynamic motion icon component, fallback safely to 'day'
              const DynamicIconComponent = SHIFT_ICONS[shift.iconKey] || SHIFT_ICONS['day'];
              
              return (
                <div key={shift._id} className="rounded-3xl border border-white/10 bg-surface-900 p-5 shadow-sm">
                  <div className="flex-between gap-3 mb-4">
                    {/* Added an icon preview container next to your text details */}
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 p-2 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center">
                        {/* Force active to true so they animate softly on your management grid */}
                        <DynamicIconComponent active={true} />
                      </div>
                      <div>
                        <p className="text-white font-semibold">{shift.name}</p>
                        <p className="text-slate-500 text-sm mt-1">{shift.description || 'No description'}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button onClick={() => openModal(shift)} className="btn-secondary btn-icon" title="Edit">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(shift)}
                        className="btn-danger btn-icon"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm text-slate-400">
                    <div className="rounded-2xl bg-white/5 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] mb-1">Time</p>
                      <p className="text-white">{shift.startTime} → {shift.endTime}</p>
                    </div>
                    <div className="rounded-2xl bg-white/5 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] mb-1">Mode</p>
                      <p className="text-white">{WORK_MODE_LABELS[shift.workMode] || shift.workMode}</p>
                    </div>
                    <div className="rounded-2xl bg-white/5 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] mb-1">Break</p>
                      <p className="text-white">{shift.breakEnabled ? `${shift.breakDurationMinutes} min` : 'Disabled'}</p>
                    </div>
                    <div className="rounded-2xl bg-white/5 p-3 flex items-center justify-between">
                      <p className="text-xs uppercase tracking-[0.18em]">Status</p>
                      <span className="text-sm text-slate-200">{shift.isActive ? 'Active' : 'Inactive'}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          {shiftTypes.length === 0 && (
            <div className="col-span-full rounded-3xl border border-white/10 bg-surface-900 p-5 text-slate-400 text-center">
              No shift types defined yet. Create one to start assigning employee schedules.
            </div>
          )}
        </div>
      )}

      {showModal && (
        <ShiftTypeModal
          item={activeItem}
          onClose={closeModal}
          onSave={handleSaveSuccess}
        />
      )}

      {/* ─── SHARED ACTION DELETE MODAL TARGET CONTAINER ─── */}
      <StatusModal
        isOpen={Boolean(deleteTarget)}
        type="delete"
        title="Delete Shift Configuration Profile"
        message="Are you sure you want to remove this shift type? Employees assigned to this shift blueprint layout profile might experience scheduling disconnects."
        isLoading={isDeleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={executeDelete}
      >
        <div className="flex justify-between">
          <span className="text-slate-400">Profile Name:</span>
          <span className="text-white font-medium">{deleteTarget?.name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Standard Timeline:</span>
          <span className="text-white font-medium">{deleteTarget?.startTime} - {deleteTarget?.endTime}</span>
        </div>
      </StatusModal>

      {/* ─── SHARED ACTION SUCCESS MODAL TARGET CONTAINER ─── */}
      <StatusModal
        isOpen={successConfig.isOpen}
        type="success"
        title={successConfig.title}
        message={successConfig.message}
        onClose={() => setSuccessConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}