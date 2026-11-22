import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Plus, Edit, Trash2, Loader2, X, AlertCircle, Users } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { departmentAPI } from '@/services/api';

const COLORS = [
  '#6366f1','#10b981','#f59e0b','#8b5cf6',
  '#ef4444','#06b6d4','#f97316','#84cc16',
  '#ec4899','#14b8a6',
];
const getColor = (i) => COLORS[i % COLORS.length];

// ── Field row ─────────────────────────────────────────────────────────────────
function Field({ label, value }) {
  return (
    <div className="flex-between py-2 border-b border-white/5 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="text-white font-medium">{value || '—'}</span>
    </div>
  );
}

// ── Custom bar tooltip ────────────────────────────────────────────────────────
function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { name, employees } = payload[0].payload;
  return (
    <div className="bg-surface-800 border border-white/10 rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="text-white font-semibold mb-0.5">{name}</p>
      <p className="text-slate-400">{employees} employee{employees !== 1 ? 's' : ''}</p>
    </div>
  );
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────
function DeptModal({ dept, onClose, onSave }) {
  const isEdit = Boolean(dept?._id);
  const [form, setForm] = useState({
    name:        dept?.name        || '',
    code:        dept?.code        || '',
    description: dept?.description || '',
    location:    dept?.location    || '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      setError('Name and Code are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isEdit) await departmentAPI.update(dept._id, form);
      else        await departmentAPI.create(form);
      onSave();
    } catch (err) {
      setError(err?.response?.data?.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-between mb-5">
          <h3 className="font-display font-bold text-white">
            {isEdit ? 'Edit Department' : 'Add Department'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          {[
            { label: 'Department Name *', key: 'name',        placeholder: 'e.g. Engineering' },
            { label: 'Code *',            key: 'code',        placeholder: 'e.g. ENG' },
            { label: 'Location',          key: 'location',    placeholder: 'e.g. Floor 3' },
            { label: 'Description',       key: 'description', placeholder: 'Short description…' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="text-xs text-slate-400 mb-1 block">{label}</label>
              <input
                value={form[key]}
                onChange={set(key)}
                placeholder={placeholder}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 mt-3 text-red-400 text-xs">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{error}
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary text-xs flex-1 justify-center">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="btn-primary text-xs flex-1 justify-center">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isEdit ? 'Save Changes' : 'Create'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────
function DetailModal({ dept, color, onClose, onEdit, onDelete, deleting }) {
  const headName = dept.head
    ? typeof dept.head === 'object'
      ? `${dept.head.firstName ?? ''} ${dept.head.lastName ?? ''}`.trim() || '—'
      : dept.head
    : '—';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex-center"
              style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
              <Building2 className="w-4 h-4" style={{ color }} />
            </div>
            <h3 className="font-display font-bold text-white">{dept.name}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-0">
          <Field label="Code"        value={dept.code} />
          <Field label="Head"        value={headName} />
          <Field label="Location"    value={dept.location} />
          <Field label="Employees"   value={dept.employeeCount ?? '—'} />
          <Field label="Description" value={dept.description} />
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onEdit} className="btn-secondary text-xs flex-1 justify-center">
            <Edit className="w-3.5 h-3.5" />Edit
          </button>
          <button onClick={onDelete} disabled={deleting} className="btn-danger text-xs flex-1 justify-center">
            {deleting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <><Trash2 className="w-3.5 h-3.5" />Delete</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DepartmentManagement() {
  const [departments, setDepartments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [fetchError,  setFetchError]  = useState('');
  const [selected,    setSelected]    = useState(null);
  const [editing,     setEditing]     = useState(null);
  const [deleting,    setDeleting]    = useState(false);

  const fetchDepts = async () => {
    setLoading(true);
    setFetchError('');
    try {
      const res = await departmentAPI.getAll();
      setDepartments(res.data?.data || []);
    } catch {
      setFetchError('Failed to load departments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDepts(); }, []);

  const handleDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      await departmentAPI.delete(selected._id);
      setSelected(null);
      fetchDepts();
    } catch {
      // surface if needed
    } finally {
      setDeleting(false);
    }
  };

  const handleSaved = () => {
    setEditing(null);
    setSelected(null);
    fetchDepts();
  };

  const selectedColor = selected
    ? getColor(departments.findIndex((d) => d._id === selected._id))
    : '#6366f1';

  // bar chart data
  const chartData = departments.map((d, i) => ({
    name:      d.code || d.name,
    fullName:  d.name,
    employees: d.employeeCount || 0,
    color:     getColor(i),
  }));

  const totalEmployees = departments.reduce((s, d) => s + (d.employeeCount || 0), 0);

  if (loading) {
    return (
      <div className="flex-center h-64 text-slate-400 gap-3">
        <Loader2 className="w-5 h-5 animate-spin" />Loading departments…
      </div>
    );
  }
  if (fetchError) {
    return (
      <div className="flex-center h-64 text-red-400 gap-3">
        <AlertCircle className="w-5 h-5" />{fetchError}
        <button onClick={fetchDepts} className="btn-secondary text-xs ml-2">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="flex-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Department Management</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {departments.length} department{departments.length !== 1 ? 's' : ''}
            {totalEmployees > 0 && ` · ${totalEmployees} total employees`}
          </p>
        </div>
        <button onClick={() => setEditing({})} className="btn-primary text-xs">
          <Plus className="w-3.5 h-3.5" />Add Department
        </button>
      </motion.div>

      {/* ── Department cards grid ── */}
      {departments.length === 0 ? (
        <div className="flex-center h-48 text-slate-500 text-sm flex-col gap-3">
          <Building2 className="w-8 h-8 opacity-30" />
          No departments yet.
          <button onClick={() => setEditing({})} className="btn-primary text-xs">
            <Plus className="w-3.5 h-3.5" />Add First Department
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {departments.map((dept, i) => {
            const color = getColor(i);
            const headName = dept.head
              ? typeof dept.head === 'object'
                ? `${dept.head.firstName ?? ''} ${dept.head.lastName ?? ''}`.trim() || '—'
                : String(dept.head)
              : '—';

            return (
              <motion.div key={dept._id}
                initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 + i * 0.04 }}
                className="glass-card-hover p-4 cursor-pointer"
                onClick={() => setSelected(dept)}
              >
                <div className="flex-between mb-3">
                  <div className="w-10 h-10 rounded-xl flex-center"
                    style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
                    <Building2 className="w-5 h-5" style={{ color }} />
                  </div>
                  <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-1 rounded-full">
                    {dept.code || '—'}
                  </span>
                </div>

                <h4 className="font-semibold text-white text-sm mb-0.5">{dept.name}</h4>
                {dept.location && (
                  <p className="text-[10px] text-slate-500 mb-1">{dept.location}</p>
                )}
                {dept.description && (
                  <p className="text-[10px] text-slate-500 mb-2 line-clamp-2">{dept.description}</p>
                )}

                <div className="flex items-center justify-between mt-2">
                  <p className="text-[10px] text-slate-500">
                    Head: <span className="text-slate-300">{headName}</span>
                  </p>
                  {dept.employeeCount !== undefined && (
                    <div className="flex items-center gap-1 text-[10px] text-slate-400">
                      <Users className="w-3 h-3" />
                      <span>{dept.employeeCount}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Employees by Department bar chart ── */}
      {departments.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-card p-5">
          <div className="flex-between mb-4">
            <div>
              <h3 className="font-semibold text-white text-sm">Employees by Department</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">{totalEmployees} total across {departments.length} departments</p>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="employees" radius={[6, 6, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-white/5">
            {departments.map((d, i) => (
              <div key={d._id} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: getColor(i) }} />
                <span className="text-[10px] text-slate-400 truncate">{d.name}</span>
                <span className="text-[10px] text-slate-600 ml-auto font-medium">{d.employeeCount || 0}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Detail modal ── */}
      <AnimatePresence>
        {selected && !editing && (
          <DetailModal
            dept={selected}
            color={selectedColor}
            onClose={() => setSelected(null)}
            onEdit={() => setEditing(selected)}
            onDelete={handleDelete}
            deleting={deleting}
          />
        )}
      </AnimatePresence>

      {/* ── Add / Edit modal ── */}
      <AnimatePresence>
        {editing && (
          <DeptModal
            dept={editing?._id ? editing : null}
            onClose={() => setEditing(null)}
            onSave={handleSaved}
          />
        )}
      </AnimatePresence>
    </div>
  );
}