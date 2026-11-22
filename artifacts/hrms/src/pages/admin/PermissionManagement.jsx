import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Edit, Trash2, Loader2, X, Target } from 'lucide-react';
import { permissionAPI } from '@/services/api';
import toast from 'react-hot-toast';

function PermissionModal({ item, onClose, onSave }) {
  const isEdit = Boolean(item?._id);
  const [form, setForm] = useState({
    name: item?.name || '',
    group: item?.group || '',
    description: item?.description || '',
    isActive: item?.isActive ?? true,
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
    if (!form.name.trim()) {
      setError('Permission name is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isEdit) await permissionAPI.update(item._id, form);
      else await permissionAPI.create(form);
      toast.success(`Permission ${isEdit ? 'updated' : 'created'}.`);
      onSave();
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to save permission.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-between mb-5">
          <h3 className="font-display font-bold text-white">
            {isEdit ? 'Edit Permission' : 'Add Permission'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="input-label">Permission Name *</label>
            <input
              className="input-field"
              value={form.name}
              onChange={handleChange('name')}
              placeholder="e.g. view_reports"
            />
          </div>
          <div>
            <label className="input-label">Permission Group</label>
            <input
              className="input-field"
              value={form.group}
              onChange={handleChange('group')}
              placeholder="e.g. attendance, payroll"
            />
          </div>
          <div>
            <label className="input-label">Description</label>
            <textarea
              className="input-field min-h-[100px]"
              value={form.description}
              onChange={handleChange('description')}
              placeholder="Optional description for this permission"
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              id="permissionActive"
              type="checkbox"
              checked={form.isActive}
              onChange={handleChange('isActive')}
              className="form-checkbox"
            />
            <label htmlFor="permissionActive" className="text-sm text-slate-300">Active</label>
          </div>
        </div>

        {error && <div className="text-red-400 text-xs mt-3">{error}</div>}

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="btn-primary flex-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? 'Save Permission' : 'Create Permission'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function PermissionManagement() {
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeItem, setActiveItem] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fetchPermissions = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await permissionAPI.getAll();
      setPermissions(res.data?.data || []);
    } catch (err) {
      setError('Unable to load permissions.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await permissionAPI.delete(id);
      toast.success('Permission deleted.');
      fetchPermissions();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Unable to delete permission.');
    } finally {
      setDeletingId(null);
    }
  };

  const openModal = (item = null) => {
    setActiveItem(item);
    setShowModal(true);
  };

  const closeModal = () => {
    setActiveItem(null);
    setShowModal(false);
  };

  useEffect(() => { fetchPermissions(); }, []);

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Permission Management</h1>
          <p className="text-slate-400 text-sm mt-0.5">Create and manage permission names used for role assignment and feature access.</p>
        </div>
        <button onClick={() => openModal()} className="btn-primary text-xs inline-flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" /> New Permission
        </button>
      </motion.div>

      {loading ? (
        <div className="flex-center h-64 text-slate-400 gap-3">
          <Loader2 className="w-5 h-5 animate-spin" />Loading permissions…
        </div>
      ) : error ? (
        <div className="flex-center h-64 text-red-400 gap-3">
          <Target className="w-5 h-5" />{error}
          <button onClick={fetchPermissions} className="btn-secondary text-xs ml-2">Retry</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {permissions.map((permission) => (
            <div key={permission._id} className="rounded-3xl border border-white/10 bg-surface-900 p-5 shadow-sm">
              <div className="flex-between gap-3 mb-4">
                <div>
                  <p className="text-white font-semibold">{permission.name}</p>
                  <p className="text-slate-500 text-sm mt-1">{permission.group || 'General'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => openModal(permission)} className="btn-secondary btn-icon" title="Edit">
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(permission._id)}
                    disabled={deletingId === permission._id}
                    className="btn-danger btn-icon"
                  >
                    {deletingId === permission._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm text-slate-400">
                <div className="rounded-2xl bg-white/5 p-3">
                  <p className="text-xs uppercase tracking-[0.18em] mb-1">Description</p>
                  <p className="text-white">{permission.description || 'No description'}</p>
                </div>
                <div className="rounded-2xl bg-white/5 p-3 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.18em]">Status</p>
                  <span className="text-sm text-slate-200">{permission.isActive ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
            </div>
          ))}
          {permissions.length === 0 && (
            <div className="col-span-full rounded-3xl border border-white/10 bg-surface-900 p-5 text-slate-400 text-center">
              No permissions defined yet. Add a new permission to support role-based access control.
            </div>
          )}
        </div>
      )}

      {showModal && (
        <PermissionModal item={activeItem} onClose={closeModal} onSave={() => { closeModal(); fetchPermissions(); }} />
      )}
    </div>
  );
}
