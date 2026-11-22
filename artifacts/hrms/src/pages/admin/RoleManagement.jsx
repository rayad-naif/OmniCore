import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Edit, Trash2, Loader2, X, Shield } from 'lucide-react';
import { roleAPI } from '@/services/api';
import toast from 'react-hot-toast';

function RoleModal({ item, onClose, onSave }) {
  const isEdit = Boolean(item?._id);
  const [form, setForm] = useState({
    name: item?.name || '',
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
      setError('Role name is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isEdit) await roleAPI.update(item._id, form);
      else await roleAPI.create(form);
      toast.success(`Role ${isEdit ? 'updated' : 'created'}.`);
      onSave();
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to save role.');
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
            {isEdit ? 'Edit Role' : 'Add Role'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="input-label">Role Name *</label>
            <input
              className="input-field"
              value={form.name}
              onChange={handleChange('name')}
              placeholder="e.g. HR Recruiter"
            />
          </div>
          <div>
            <label className="input-label">Description</label>
            <textarea
              className="input-field min-h-[100px]"
              value={form.description}
              onChange={handleChange('description')}
              placeholder="Optional description for this role"
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              id="roleActive"
              type="checkbox"
              checked={form.isActive}
              onChange={handleChange('isActive')}
              className="form-checkbox"
            />
            <label htmlFor="roleActive" className="text-sm text-slate-300">Active</label>
          </div>
        </div>

        {error && <div className="text-red-400 text-xs mt-3">{error}</div>}

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="btn-primary flex-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? 'Save Role' : 'Create Role'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function RoleManagement() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeItem, setActiveItem] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fetchRoles = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await roleAPI.getAll();
      setRoles(res.data?.data || []);
    } catch (err) {
      setError('Unable to load roles.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await roleAPI.delete(id);
      toast.success('Role deleted.');
      fetchRoles();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Unable to delete role.');
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

  useEffect(() => { fetchRoles(); }, []);

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Role Management</h1>
          <p className="text-slate-400 text-sm mt-0.5">Define and manage system role names and active role definitions.</p>
        </div>
        <button onClick={() => openModal()} className="btn-primary text-xs inline-flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" /> New Role
        </button>
      </motion.div>

      {loading ? (
        <div className="flex-center h-64 text-slate-400 gap-3">
          <Loader2 className="w-5 h-5 animate-spin" />Loading roles…
        </div>
      ) : error ? (
        <div className="flex-center h-64 text-red-400 gap-3">
          <Shield className="w-5 h-5" />{error}
          <button onClick={fetchRoles} className="btn-secondary text-xs ml-2">Retry</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {roles.map((role) => (
            <div key={role._id} className="rounded-3xl border border-white/10 bg-surface-900 p-5 shadow-sm">
              <div className="flex-between gap-3 mb-4">
                <div>
                  <p className="text-white font-semibold">{role.name}</p>
                  <p className="text-slate-500 text-sm mt-1">{role.description || 'No description'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => openModal(role)} className="btn-secondary btn-icon" title="Edit">
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(role._id)}
                    disabled={deletingId === role._id}
                    className="btn-danger btn-icon"
                  >
                    {deletingId === role._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm text-slate-400">
                <div className="rounded-2xl bg-white/5 p-3">
                  <p className="text-xs uppercase tracking-[0.18em] mb-1">Status</p>
                  <p className="text-white">{role.isActive ? 'Active' : 'Inactive'}</p>
                </div>
                <div className="rounded-2xl bg-white/5 p-3 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.18em]">Created</p>
                  <span className="text-sm text-slate-200">{new Date(role.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))}
          {roles.length === 0 && (
            <div className="col-span-full rounded-3xl border border-white/10 bg-surface-900 p-5 text-slate-400 text-center">
              No roles defined yet. Add a new role to manage system permission groups.
            </div>
          )}
        </div>
      )}

      {showModal && (
        <RoleModal item={activeItem} onClose={closeModal} onSave={() => { closeModal(); fetchRoles(); }} />
      )}
    </div>
  );
}
