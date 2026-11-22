import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Edit3, DollarSign, TrendingDown, TrendingUp,
  Users, Zap, Lock, RefreshCw, X, ChevronDown, Calculator,
  Tag, ToggleLeft, ToggleRight, Pin, Settings2, Check, Repeat, AlertCircle,
  Landmark,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts';
import { expenseAPI, earningAPI, financeAPI, expenseCategoryAPI, fixedExpenseAPI, employeeAPI } from '@/services/api';

// ─── Constants ────────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CURRENT_MONTH = new Date().getMonth() + 1;
const CURRENT_YEAR  = new Date().getFullYear();

// ─── Built-in categories (always present, not deletable) ──────────────────────
const BUILT_IN_CATEGORIES = [
  { key: 'variable_expense', label: 'Variable Expense', color: '#f59e0b', icon: 'Zap',  builtIn: true },
  { key: 'fixed_expense',    label: 'Fixed Expense',    color: '#6366f1', icon: 'Lock', builtIn: true },
  { key: 'employee_salary',  label: 'Employee Salary',  color: '#10b981', icon: 'Users',builtIn: true },
];

// Palette for custom categories (cycles if more than 8)
const CUSTOM_COLORS = ['#ec4899','#f97316','#14b8a6','#8b5cf6','#06b6d4','#84cc16','#f43f5e','#a78bfa'];

// ─── Persistence note ──────────────────────────────────────────────────────
// Custom categories and fixed expenses are now persisted in MongoDB via
// expenseCategoryAPI / fixedExpenseAPI (see below) instead of localStorage.

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt    = (n) => new Intl.NumberFormat('en-PK').format(Math.round(n || 0));
const fmtUSD = (n) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0)}`;
const fadeUp = (d = 0) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay: d } });
const uid    = () => Math.random().toString(36).slice(2, 9);

// ─── Category icon resolver ───────────────────────────────────────────────────
function CatIcon({ name, ...props }) {
  const icons = { Zap, Lock, Users, Tag };
  const I = icons[name] || Tag;
  return <I {...props} />;
}

// ─── Toggle switch ────────────────────────────────────────────────────────────
function Toggle({ on, onChange, size = 'md' }) {
  const w = size === 'sm' ? 'w-7 h-3.5' : 'w-9 h-5';
  const dot = size === 'sm' ? 'w-2.5 h-2.5 top-0.5' : 'w-4 h-4 top-0.5';
  const tr = size === 'sm' ? (on ? 'translate-x-3.5' : 'translate-x-0.5') : (on ? 'translate-x-4' : 'translate-x-0.5');
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      className={`${w} rounded-full relative transition-colors flex-shrink-0 ${on ? 'bg-primary-500' : 'bg-white/15'}`}
    >
      <div className={`absolute ${dot} ${tr} rounded-full bg-white transition-transform shadow`} />
    </button>
  );
}

// ─── Mini stat card ───────────────────────────────────────────────────────────
function MiniStat({ label, pkr, usd, color, iconName, bg, text }) {
  return (
    <div className="glass-card p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${bg}`}>
        <CatIcon name={iconName} className={`w-4 h-4 ${text}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-slate-500 mb-0.5">{label}</p>
        <p className="text-lg font-bold text-white leading-tight">₨ {fmt(pkr)}</p>
        <p className="text-[11px] text-slate-400 mt-0.5">{fmtUSD(usd)}</p>
      </div>
    </div>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-800 border border-white/10 rounded-xl px-4 py-3 shadow-xl text-xs">
      <p className="text-slate-400 mb-2">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name}: ₨ {fmt(p.value)}
        </p>
      ))}
    </div>
  );
};

// ─── Modal ────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, maxW = 'max-w-lg' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={`bg-surface-800 border border-white/10 rounded-2xl w-full ${maxW} shadow-2xl`}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <h3 className="font-semibold text-white text-sm">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5 transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RETURN CONFIRM MODAL
// Shown when marking a "needs return" expense as paid back — captures how and
// any note, then hands off to the dedicated /return-status endpoint.
// ─────────────────────────────────────────────────────────────────────────────
const RETURN_METHODS = ['Cash', 'Bank Transfer', 'Adjustment', 'Other'];

function ReturnConfirmModal({ expense, onConfirm, onClose, saving }) {
  const [method, setMethod] = useState(RETURN_METHODS[0]);
  const [note,   setNote]   = useState('');

  return (
    <Modal title="Confirm Payback" onClose={onClose}>
      <div className="space-y-4">
        <div className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/5">
          <p className="text-xs text-slate-400">
            Confirming that <strong className="text-white">{expense.paidBy?.name}</strong> has been paid back
          </p>
          <p className="text-sm font-bold text-white mt-1">₨ {fmt(expense.amountPKR)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{expense.title}</p>
        </div>

        <div>
          <label className="text-[11px] text-slate-400 mb-1 block">Paid back via</label>
          <div className="relative">
            <select
              value={method}
              onChange={e => setMethod(e.target.value)}
              className="input-field w-full text-sm appearance-none pr-8"
            >
              {RETURN_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>
        </div>

        <div>
          <label className="text-[11px] text-slate-400 mb-1 block">Note (optional)</label>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Paid via JazzCash, ref #1234…"
            className="input-field w-full text-sm"
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="btn-ghost flex-1 text-sm py-2">Cancel</button>
          <button
            onClick={() => onConfirm({ returnMethod: method, returnNote: note })}
            disabled={saving}
            className="btn-primary flex-1 text-sm py-2 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Confirm Returned'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXED EXPENSES PANEL
// Stored in localStorage; toggled items are summed and passed down as an offset
// to the expense summary so the totals reflect recurring fixed costs.
// ─────────────────────────────────────────────────────────────────────────────
function FixedExpensesPanel({ usdRate, month, year, persons, categories, onPosted }) {
  const [items,    setItems]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [modal,    setModal]    = useState(null); // null | 'add' | item
  const [posting,  setPosting]  = useState(false);
  const [posted,   setPosted]   = useState(false); // success flash
  const [saving,   setSaving]   = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fixedExpenseAPI.getAll();
      setItems(res.data.data);
    } catch (err) {
      console.error('Failed to load fixed expenses:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  const handleSave = async (item) => {
    setSaving(true);
    try {
      if (item._id) {
        await fixedExpenseAPI.update(item._id, item);
      } else {
        await fixedExpenseAPI.create(item);
      }
      await loadItems();
      setModal(null);
    } catch (err) {
      console.error('Failed to save fixed expense:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await fixedExpenseAPI.delete(id);
      setItems(prev => prev.filter(i => i._id !== id));
    } catch (err) {
      console.error('Failed to delete fixed expense:', err);
    }
  };

  const handleToggle = async (id, val) => {
    // Optimistic update for snappy UI
    setItems(prev => prev.map(i => i._id === id ? { ...i, enabled: val } : i));
    try {
      await fixedExpenseAPI.toggle(id, val);
    } catch (err) {
      console.error('Failed to toggle fixed expense:', err);
      loadItems(); // revert on failure
    }
  };

  const handleToggleAll = async (val) => {
    setItems(prev => prev.map(i => ({ ...i, enabled: val })));
    try {
      await Promise.all(items.map(i => fixedExpenseAPI.toggle(i._id, val)));
    } catch (err) {
      console.error('Failed to toggle all fixed expenses:', err);
      loadItems();
    }
  };

  const selectedItems  = items.filter(i => i.enabled);
  const selectedTotal  = selectedItems.reduce((s, i) => s + Number(i.amountPKR), 0);
  const defaultPaidBy  = persons?.[0]?.name || '';

  // Post each toggled-on item as its own separate expense record so they are
  // individually visible in the All Expenses table with their own title/amount.
  const handlePost = async () => {
    if (!selectedItems.length) return;
    setPosting(true);
    try {
      await Promise.all(
        selectedItems.map(item =>
          expenseAPI.create({
            title:          item.title,
            description:    item.description || '',
            category:       'fixed_expense',
            amountPKR:      Number(item.amountPKR),
            usdRateAtEntry: usdRate,
            paidBy:         { name: item.paidBy || 'Fixed', userId: null },
            month,
            year,
          })
        )
      );

      setPosted(true);
      setTimeout(() => setPosted(false), 3000);

      // Refresh both the Fixed panel and the parent expense table
      if (onPosted) onPosted();
    } catch (error) {
      console.error("Failed to post fixed expenses:", error);
    } finally {
      setPosting(false);
    }
  };

  return (
    <>
    <div className="glass-card border border-indigo-500/20">
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-indigo-500/10">
            <Pin className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-white">Fixed Expenses</p>
            <p className="text-[11px] text-slate-500">
              Toggle to select · post to {MONTHS[month - 1]} {year} when ready
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {selectedItems.length > 0 && (
            <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full">
              {selectedItems.length} selected · ₨ {fmt(selectedTotal)}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2 border-t border-white/5 pt-3">
              {loading ? (
                <p className="text-xs text-slate-500 text-center py-4">Loading…</p>
              ) : items.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">
                  No fixed expenses defined. Add recurring items like rent, internet, subscriptions…
                </p>
              ) : (
                <>
                  {/* Select-all / deselect-all row */}
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">
                      Toggle which to post this month
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleToggleAll(true)}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        Select all
                      </button>
                      <span className="text-slate-600">·</span>
                      <button
                        onClick={() => handleToggleAll(false)}
                        className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        Deselect all
                      </button>
                    </div>
                  </div>

                  {items.map(item => (
                    <div
                      key={item._id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                        item.enabled
                          ? 'bg-indigo-500/8 border-indigo-500/30'
                          : 'bg-white/3 border-white/5 opacity-50'
                      }`}
                    >
                      {/* Toggle */}
                      <Toggle on={item.enabled} onChange={(v) => handleToggle(item._id, v)} size="sm" />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-200 truncate">{item.title}</p>
                        {item.description && (
                          <p className="text-[10px] text-slate-500 truncate">{item.description}</p>
                        )}
                        {item.paidBy && (
                          <p className="text-[10px] text-indigo-400/70 mt-0.5">Paid by: {item.paidBy}</p>
                        )}
                      </div>

                      {/* Amount */}
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-bold text-white">₨ {fmt(item.amountPKR)}</p>
                        {usdRate && (
                          <p className="text-[10px] text-slate-500">{fmtUSD(item.amountPKR / usdRate)}</p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => setModal(item)}
                          className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-white transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(item._id)}
                          className="p-1 rounded hover:bg-danger-500/10 text-slate-500 hover:text-danger-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Footer: Add button + Post button */}
              <div className="flex items-center justify-between pt-2 gap-3">
                <button
                  onClick={() => setModal('add')}
                  className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex-shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" /> Add fixed expense
                </button>

                {items.length > 0 && (
                  <button
                    onClick={handlePost}
                    disabled={posting || selectedItems.length === 0}
                    className={`flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      posted
                        ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
                        : 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30'
                    }`}
                  >
                    {posted ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Posted to {MONTHS[month - 1]}!
                      </>
                    ) : posting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Posting…
                      </>
                    ) : (
                      <>
                        <Repeat className="w-3.5 h-3.5" />
                        Post {selectedItems.length > 0 ? `${selectedItems.length} ` : ''}to {MONTHS[month - 1]} {year}
                        {selectedTotal > 0 && (
                          <span className="text-[10px] text-indigo-400/70 font-normal">· ₨ {fmt(selectedTotal)}</span>
                        )}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>

    {/* Add/Edit Fixed Expense Modal — outside the card so it is never clipped */}
    <AnimatePresence>
      {modal && (
        <Modal
          title={modal === 'add' ? 'Add Fixed Expense' : 'Edit Fixed Expense'}
          onClose={() => setModal(null)}
        >
          <FixedExpenseForm
            initial={modal !== 'add' ? modal : null}
            usdRate={usdRate}
            persons={persons}
            saving={saving}
            onSave={handleSave}
            onClose={() => setModal(null)}
          />
        </Modal>
      )}
    </AnimatePresence>
    </>
  );
}

function FixedExpenseForm({ initial, usdRate, persons, saving, onSave, onClose }) {
  const [form, setForm] = useState({
    title:       initial?.title       || '',
    description: initial?.description || '',
    amountPKR:   initial?.amountPKR   || '',
    paidBy:      initial?.paidBy      || (persons?.[0]?.name || ''),
    enabled:     initial?.enabled     ?? true,
    _id:         initial?._id         || null,
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const estimatedUSD = form.amountPKR && usdRate ? (Number(form.amountPKR) / usdRate).toFixed(2) : null;

  return (
    <div className="space-y-4">
      <div>
        <label className="text-[11px] text-slate-400 mb-1 block">Title *</label>
        <input
          value={form.title}
          onChange={e => set('title', e.target.value)}
          placeholder="e.g. Office Rent, Internet Bill, Cloud Subscription…"
          className="input-field w-full text-sm"
        />
      </div>
      <div>
        <label className="text-[11px] text-slate-400 mb-1 block">Amount (PKR) *</label>
        <input
          type="number"
          value={form.amountPKR}
          onChange={e => set('amountPKR', e.target.value)}
          placeholder="0"
          className="input-field w-full text-sm"
        />
        {estimatedUSD && (
          <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
            <DollarSign className="w-3 h-3" /> ≈ {fmtUSD(estimatedUSD)} at rate {fmt(usdRate)}
          </p>
        )}
      </div>
      {persons?.length > 0 && (
        <div>
          <label className="text-[11px] text-slate-400 mb-1 block">Paid By</label>
          <div className="relative">
            <select
              value={form.paidBy}
              onChange={e => set('paidBy', e.target.value)}
              className="input-field w-full text-sm appearance-none pr-8"
            >
              <option value="">Select person</option>
              {persons.map(p => <option key={p._id} value={p.name}>{p.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>
        </div>
      )}
      <div>
        <label className="text-[11px] text-slate-400 mb-1 block">Notes</label>
        <input
          value={form.description}
          onChange={e => set('description', e.target.value)}
          placeholder="Optional description…"
          className="input-field w-full text-sm"
        />
      </div>
      <div className="flex gap-3 pt-1">
        <button onClick={onClose} className="btn-ghost flex-1 text-sm py-2">Cancel</button>
        <button
          onClick={() => form.title && form.amountPKR && onSave(form)}
          disabled={!form.title || !form.amountPKR || saving}
          className="btn-primary flex-1 text-sm py-2 disabled:opacity-40"
        >
          {saving ? 'Saving…' : initial ? 'Update' : 'Add'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MANAGE CATEGORIES MODAL
// ─────────────────────────────────────────────────────────────────────────────
function ManageCategoriesModal({ categories, onAdd, onEdit, onDelete, onClose }) {
  const [editingId, setEditingId]   = useState(null);
  const [newCat,    setNewCat]      = useState({ label: '', color: '' });
  const [editForm,  setEditForm]    = useState({});
  const [busy,      setBusy]        = useState(false);

  const customCats = categories.filter(c => !c.builtIn);
  const nextColor  = CUSTOM_COLORS[customCats.length % CUSTOM_COLORS.length];

  const handleAdd = async () => {
    if (!newCat.label.trim() || busy) return;
    const key = `custom_${newCat.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}_${uid()}`;
    const color = newCat.color || nextColor;
    setBusy(true);
    try {
      await onAdd({ key, label: newCat.label.trim(), color, icon: 'Tag' });
      setNewCat({ label: '', color: '' });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (key) => {
    if (busy) return;
    setBusy(true);
    try { await onDelete(key); } finally { setBusy(false); }
  };

  const handleEdit = (cat) => {
    setEditingId(cat.key);
    setEditForm({ label: cat.label, color: cat.color });
  };

  const handleEditSave = async (key) => {
    if (busy) return;
    setBusy(true);
    try {
      await onEdit(key, editForm);
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Built-in (read-only) */}
      <div>
        <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide mb-2">Categories</p>
        <div className="space-y-1.5">
          {categories.filter(c => c.builtIn).map(c => (
            <div key={c.key} className="flex items-center gap-3 px-3 py-2 bg-white/5 rounded-lg">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
              <span className="text-xs text-slate-300 flex-1">{c.label}</span>
              <span className="text-[10px] text-slate-600 italic">built-in</span>
            </div>
          ))}
        </div>
      </div>

      {/* Custom categories */}
      <div>
        <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide mb-2">Sub Categories</p>
        {customCats.length === 0 && (
          <p className="text-xs text-slate-600 text-center py-3">No sub categories yet.</p>
        )}
        <div className="space-y-1.5">
          {customCats.map(c => (
            <div key={c.key}>
              {editingId === c.key ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-white/8 rounded-lg border border-white/10">
                  <input
                    type="color"
                    value={editForm.color}
                    onChange={e => setEditForm(f => ({ ...f, color: e.target.value }))}
                    className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <input
                    value={editForm.label}
                    onChange={e => setEditForm(f => ({ ...f, label: e.target.value }))}
                    className="input-field flex-1 text-xs py-1"
                    autoFocus
                  />
                  <button onClick={() => handleEditSave(c.key)} className="p-1 text-accent-400 hover:text-accent-300">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-1 text-slate-500 hover:text-slate-300">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-3 py-2 bg-white/5 rounded-lg group">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
                  <span className="text-xs text-slate-300 flex-1">{c.label}</span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleEdit(c)} className="p-1 text-slate-500 hover:text-white">
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button onClick={() => handleDelete(c.key)} className="p-1 text-slate-500 hover:text-danger-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add new */}
      <div className="border-t border-white/5 pt-4 space-y-3">
        <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Add Category</p>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={newCat.color || nextColor}
            onChange={e => setNewCat(p => ({ ...p, color: e.target.value }))}
            className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent flex-shrink-0"
            title="Pick color"
          />
          <input
            value={newCat.label}
            onChange={e => setNewCat(p => ({ ...p, label: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="Category name (e.g. Marketing, Travel…)"
            className="input-field flex-1 text-sm"
          />
          <button
            onClick={handleAdd}
            disabled={!newCat.label.trim() || busy}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-40 flex-shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="pt-1">
        <button onClick={onClose} className="btn-ghost w-full text-sm py-2">Done</button>
      </div>
    </div>
  );
}

// ─── Expense Form ─────────────────────────────────────────────────────────────
function ExpenseForm({ onSave, onClose, persons, usdRate, initial, categories }) {
  const [form, setForm] = useState({
    title:       initial?.title             || '',
    description: initial?.description       || '',
    notes:       initial?.notes             || '',
    category:    initial?.category          || categories[0]?.key || 'variable_expense',
    amountPKR:   initial?.amountPKR         || '',
    paidBy:      { name: initial?.paidBy?.name || '', userId: null },
    date:        initial?.date ? new Date(initial.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    needsReturn: initial?.needsReturn       || false,
    useCurrentRate: true,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (!form.title || !form.amountPKR || !form.paidBy.name) return;
    setSaving(true);
    try {
      // The API derives the report month and year from the selected date.
      const payload = { ...form, usdRateAtEntry: usdRate };
      if (initial?._id) await expenseAPI.update(initial._id, payload);
      else              await expenseAPI.create(payload);
      onSave();
    } finally {
      setSaving(false);
    }
  };

  const estimatedUSD = form.amountPKR && usdRate
    ? (Number(form.amountPKR) / usdRate).toFixed(2) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-[11px] text-slate-400 mb-1 block">Title *</label>
          <input
            value={form.title}
            onChange={e => set('title', e.target.value)}
            placeholder="e.g. Office rent, Server bill…"
            className="input-field w-full text-sm"
          />
        </div>

        {/* Category — grouped: Fixed/Salary built-ins then Variable subcategories */}
        <div>
          <label className="text-[11px] text-slate-400 mb-1 block">Date *</label>
          <input
            type="date"
            value={form.date}
            onChange={e => set('date', e.target.value)}
            className="input-field w-full text-sm"
          />
        </div>

        <div>
          <label className="text-[11px] text-slate-400 mb-1 block">Category *</label>
          <div className="relative">
            <select
              value={form.category}
              onChange={e => set('category', e.target.value)}
              className="input-field w-full text-sm appearance-none pr-8"
            >
              <optgroup label="Fixed / Other">
                {categories.filter(c => c.builtIn && c.key !== 'variable_expense').map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </optgroup>
              <optgroup label="Variable Expense (subcategories)">
                {categories.filter(c => c.key === 'variable_expense' || !c.builtIn).map(c => (
                  <option key={c.key} value={c.key}>
                    {c.key === 'variable_expense' ? 'General / Uncategorised' : c.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>
        </div>

        {/* Paid By */}
        <div>
          <label className="text-[11px] text-slate-400 mb-1 block">Paid By *</label>
          <div className="relative">
            <select
              value={form.paidBy.name}
              onChange={e => set('paidBy', { name: e.target.value, userId: null })}
              className="input-field w-full text-sm appearance-none pr-8"
            >
              <option value="">Select person</option>
              {persons.map(p => <option key={p._id} value={p.name}>{p.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>
        </div>

        {/* Amount PKR */}
        <div>
          <label className="text-[11px] text-slate-400 mb-1 block">Amount (PKR) *</label>
          <input
            type="number"
            value={form.amountPKR}
            onChange={e => set('amountPKR', e.target.value)}
            placeholder="0"
            className="input-field w-full text-sm"
          />
          {estimatedUSD && (
            <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
              <DollarSign className="w-3 h-3" /> ≈ {fmtUSD(estimatedUSD)} at rate {fmt(usdRate)}
            </p>
          )}
        </div>

        {/* Needs Return */}
        <div className="col-span-2 flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/5">
          <div>
            <p className="text-xs font-medium text-slate-200">This payment needs to be returned</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Flag this if {form.paidBy.name || 'the payer'} is owed this amount back later
            </p>
          </div>
          <Toggle on={form.needsReturn} onChange={v => set('needsReturn', v)} />
        </div>

        {/* Description */}
        <div className="col-span-2">
          <label className="text-[11px] text-slate-400 mb-1 block">Description</label>
          <textarea
            value={form.description}
            onChange={e => set('description', e.target.value)}
            rows={2}
            className="input-field w-full text-sm resize-none"
            placeholder="Describe this expense…"
          />
        </div>

        <div className="col-span-2">
          <label className="text-[11px] text-slate-400 mb-1 block">Notes</label>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            rows={2}
            className="input-field w-full text-sm resize-none"
            placeholder="Optional additional notes…"
          />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-ghost flex-1 text-sm py-2">Cancel</button>
        <button
          onClick={handleSubmit}
          disabled={saving || !form.title || !form.amountPKR || !form.paidBy.name}
          className="btn-primary flex-1 text-sm py-2 disabled:opacity-40"
        >
          {saving ? 'Saving…' : initial ? 'Update' : 'Add Expense'}
        </button>
      </div>
    </div>
  );
}

// ─── Earning Form ─────────────────────────────────────────────────────────────
function EarningForm({ onSave, onClose, persons, usdRate, initial }) {
  const BUSINESS_EARNING_SHARE = 0.30;
  const [form, setForm] = useState({
    title:             initial?.title              || '',
    description:       initial?.description        || '',
    notes:             initial?.notes              || '',
    person:            { name: initial?.person?.name || '', userId: null },
    amountUSD:         initial?.grossAmountPKR && initial?.usdRateAtEntry
      ? (Number(initial.grossAmountPKR) / Number(initial.usdRateAtEntry)).toFixed(2)
      : initial?.amountUSD || '',
    date:              initial?.date ? new Date(initial.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);
  const [liveRate, setLiveRate] = useState(Number(initial?.usdRateAtEntry || usdRate) || 278);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // (A live USD→PKR refresh effect in the original was never started and
  // referenced undefined state; removed. The saved finance rate is used.)

  const rateIsValid = Number.isFinite(Number(liveRate)) && Number(liveRate) > 0;
  // Commission mode: amount = base × percent (same formula as the earnings API).
  const autoAmount =
    form.useCommission && Number(form.baseAmountPKR) > 0 && Number(form.commissionPercent) > 0
      ? Number(((Number(form.baseAmountPKR) * Number(form.commissionPercent)) / 100).toFixed(2))
      : null;
  const grossAmountPKR = form.amountUSD && Number.isFinite(Number(form.amountUSD)) && rateIsValid
    ? Number(form.amountUSD) * Number(liveRate)
    : '';
  const earnedAmountPKR = grossAmountPKR === '' ? '' : (grossAmountPKR * BUSINESS_EARNING_SHARE).toFixed(2);
  const personAmountPKR = grossAmountPKR === '' ? '' : (grossAmountPKR - Number(earnedAmountPKR)).toFixed(2);

  const handleSubmit = async () => {
    if (!form.title || !form.person.name) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        grossAmountPKR,
        usdRateAtEntry: Number(liveRate),
      };
      delete payload.amountUSD;
      if (initial?._id) await earningAPI.update(initial._id, payload);
      else              await earningAPI.create(payload);
      onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-[11px] text-slate-400 mb-1 block">Title *</label>
          <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Project Alpha revenue…" className="input-field w-full text-sm" />
        </div>
        <div className="col-span-2">
          <label className="text-[11px] text-slate-400 mb-1 block">Earned By *</label>
          <div className="relative">
            <select value={form.person.name} onChange={e => set('person', { name: e.target.value, userId: null })} className="input-field w-full text-sm appearance-none pr-8">
              <option value="">Select person</option>
              {persons.map(p => <option key={p._id} value={p.name}>{p.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>
        </div>
        {form.useCommission ? (
          <>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">Base Amount (PKR)</label>
              <input type="number" value={form.baseAmountPKR} onChange={e => set('baseAmountPKR', e.target.value)} placeholder="Total project value" className="input-field w-full text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">Commission %</label>
              <input type="number" value={form.commissionPercent} onChange={e => set('commissionPercent', e.target.value)} placeholder="e.g. 10" max="100" className="input-field w-full text-sm" />
            </div>
            {autoAmount && (
              <div className="col-span-2 bg-accent-500/10 border border-accent-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
                <Calculator className="w-3.5 h-3.5 text-accent-400" />
                <span className="text-xs text-accent-400">
                  Calculated: <strong>₨ {fmt(autoAmount)}</strong>
                  {usdRate && <span className="text-slate-500 ml-1">({fmtUSD(autoAmount / usdRate)})</span>}
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">Total Amount (USD) *</label>
              <input type="number" min="0" step="0.01" value={form.amountUSD} onChange={e => set('amountUSD', e.target.value)} placeholder="0.00" className="input-field w-full text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">Earned Amount (PKR)</label>
              <input type="text" value={earnedAmountPKR ? `PKR ${fmt(earnedAmountPKR)}` : ''} readOnly placeholder="30% added to earnings" className="input-field w-full text-sm text-accent-300" />
            </div>
            {earnedAmountPKR && (
              <div className="col-span-2 bg-accent-500/10 border border-accent-500/20 rounded-lg px-3 py-2 text-xs text-accent-400">
                Earned amount (30%): <strong>PKR {fmt(earnedAmountPKR)}</strong> · Person amount (70%, record only): <strong>PKR {fmt(personAmountPKR)}</strong>
              </div>
            )}
            <div className="col-span-2">
              <label className="text-[11px] text-slate-400 mb-1 block">USD to PKR Rate *</label>
              <input
                type="number"
                min="0.0001"
                step="0.0001"
                value={liveRate}
                onChange={e => setLiveRate(e.target.value)}
                placeholder="e.g. 278"
                className="input-field w-full text-sm"
              />
              <p className="text-[10px] text-slate-500 mt-1">This rate is entered manually and saved with the earning.</p>
            </div>
          </>
        )}
        <div className="hidden grid grid-cols-2 gap-2 col-span-2">
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">Month</label>
            <div className="relative">
              <select value={form.month} onChange={e => set('month', Number(e.target.value))} className="input-field w-full text-sm appearance-none pr-6">
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">Year</label>
            <input type="number" value={form.year} onChange={e => set('year', Number(e.target.value))} className="input-field w-full text-sm" />
          </div>
        </div>
        <div className="col-span-2">
          <label className="text-[11px] text-slate-400 mb-1 block">Date *</label>
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className="input-field w-full text-sm" />
        </div>
        <div className="col-span-2">
          <label className="text-[11px] text-slate-400 mb-1 block">Description</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} placeholder="Describe this earning…" className="input-field w-full text-sm resize-none" />
        </div>
        <div className="col-span-2">
          <label className="text-[11px] text-slate-400 mb-1 block">Notes</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Optional additional notes…" className="input-field w-full text-sm resize-none" />
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-ghost flex-1 text-sm py-2">Cancel</button>
        <button onClick={handleSubmit} disabled={saving || !form.title || !form.person.name || !earnedAmountPKR || !rateIsValid} className="btn-primary flex-1 text-sm py-2 disabled:opacity-40">
          {saving ? 'Saving…' : initial ? 'Update' : 'Add Earning'}
        </button>
      </div>
    </div>
  );
}

function VariableCategoriesPanel({ categories, expenses, usdRate, month, year, onAdd }) {
  const [expanded, setExpanded] = useState(true);
  const variableCategories = [
    { key: 'variable_expense', label: 'General / Uncategorised', color: '#f59e0b' },
    ...categories.filter(c => !c.builtIn),
  ];
  const variableExpenses = expenses.filter(expense => variableCategories.some(category => category.key === expense.category));
  const variableTotal = variableExpenses.reduce((sum, expense) => sum + Number(expense.amountPKR || 0), 0);

  return (
    <div className="glass-card border border-amber-500/20">
      <button onClick={() => setExpanded(value => !value)} className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-amber-500/10"><Zap className="w-4 h-4 text-amber-400" /></div>
          <div className="text-left"><p className="text-sm font-semibold text-white">Variable Categories</p><p className="text-[11px] text-slate-500">Add and review variable expenses for {MONTHS[month - 1]} {year}</p></div>
        </div>
        <div className="flex items-center gap-3">
          {variableExpenses.length > 0 && (
            <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
              {variableExpenses.length} expense{variableExpenses.length === 1 ? '' : 's'} · ₨ {fmt(variableTotal)}
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 border-t border-white/5">
              {variableCategories.map(category => {
                const entries = expenses.filter(expense => expense.category === category.key);
                const total = entries.reduce((sum, expense) => sum + Number(expense.amountPKR || 0), 0);
                return <div key={category.key} className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0"><span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: category.color }} /><div className="min-w-0"><p className="text-xs font-semibold text-slate-200 truncate">{category.label}</p><p className="text-[10px] text-slate-500">{entries.length} expense{entries.length === 1 ? '' : 's'}</p></div></div>
                    <div className="text-right flex-shrink-0"><p className="text-xs font-bold text-white">₨ {fmt(total)}</p>{usdRate && <p className="text-[10px] text-slate-500">{fmtUSD(total / usdRate)}</p>}</div>
                  </div>
                  {entries.length > 0 && <div className="mt-2 pt-2 border-t border-white/5 space-y-1">{entries.slice(0, 3).map(expense => <div key={expense._id} className="flex items-center justify-between gap-2 text-[10px]"><span className="text-slate-500 truncate">{expense.title}</span><span className="text-slate-300 flex-shrink-0">₨ {fmt(expense.amountPKR)}</span></div>)}{entries.length > 3 && <p className="text-[10px] text-slate-600">+{entries.length - 3} more in All Expenses</p>}</div>}
                  <button onClick={() => onAdd(category.key)} className="mt-3 text-[11px] text-amber-400 hover:text-amber-300 transition-colors"><Plus className="w-3 h-3 inline mr-1" /> Add expense</button>
                </div>;
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Expenses Tab ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// LIABILITIES OVERVIEW
// Company-wide "who is currently owed money back" — NOT scoped to the
// selected month/year, since an unreturned payment from an earlier month is
// still owed today. Refetches whenever refreshKey changes.
// ─────────────────────────────────────────────────────────────────────────────
function LiabilitiesOverview({ refreshKey }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await expenseAPI.getLiabilities({ status: 'pending' });
      setData(res.data.data);
    } catch (err) {
      console.error('Failed to load liabilities:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (loading && !data) return null;
  if (!data || data.totalOutstandingPKR <= 0) return null;

  return (
    <div className="glass-card border border-danger-500/20 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-danger-500/10">
            <Landmark className="w-4 h-4 text-danger-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-white">Company Owes (Outstanding)</p>
            <p className="text-[11px] text-slate-500">
              {data.byPerson.length} {data.byPerson.length === 1 ? 'person' : 'people'} owed · across all months
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-danger-400">₨ {fmt(data.totalOutstandingPKR)}</span>
          <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2 border-t border-white/5 pt-3">
              {data.byPerson.map(p => {
                const pct = data.totalOutstandingPKR ? ((p.totalOwedPKR / data.totalOutstandingPKR) * 100).toFixed(1) : 0;
                return (
                  <div key={p._id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-slate-300">{p._id || 'Unassigned'}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500">{p.count} pending</span>
                        <span className="text-xs font-medium text-white">₨ {fmt(p.totalOwedPKR)}</span>
                      </div>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-danger-500 transition-all duration-700" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ExpensesTab({ month, year, persons, usdRate, onRefresh, categories, fixedTotal }) {
  const [expenses, setExpenses] = useState([]);
  const [summary,  setSummary]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null);
  const [addCategory, setAddCategory] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [updatingReturn, setUpdatingReturn] = useState(null);
  const [returnModalFor, setReturnModalFor] = useState(null); // expense pending "mark returned" confirmation
  const [liabilityRefresh, setLiabilityRefresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [expRes, sumRes] = await Promise.all([
        expenseAPI.getAll({ month, year }),
        expenseAPI.getSummary({ month, year }),
      ]);
      setExpenses(expRes.data.data);
      setSummary(sumRes.data.data);
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    setDeleting(id);
    try { await expenseAPI.delete(id); load(); onRefresh(); setLiabilityRefresh(r => r + 1); }
    finally { setDeleting(null); }
  };

  // Marking as returned needs confirmation (who/how it was paid back) — opens the modal.
  // Un-marking (accidental click) needs no extra detail, so it fires immediately.
  const handleToggleReturn = (expense) => {
    if (expense.isReturned) {
      submitReturnStatus(expense, { isReturned: false });
    } else {
      setReturnModalFor(expense);
    }
  };

  const submitReturnStatus = async (expense, payload) => {
    setUpdatingReturn(expense._id);
    try {
      await expenseAPI.updateReturnStatus(expense._id, payload);
      setReturnModalFor(null);
      load();
      onRefresh();
      setLiabilityRefresh(r => r + 1);
    } catch (err) {
      console.error('Failed to update return status:', err);
    } finally {
      setUpdatingReturn(null);
    }
  };

  // Build pie data from ALL categories (built-in + custom)
 // Build pie data from ALL categories (built-in + custom)
const PIE_DATA = summary
  ? (() => {
      // Fixed and Salary remain separate
      const fixedValue = summary.categorySummary['fixed_expense']?.totalPKR || 0;
      const salaryValue = summary.categorySummary['employee_salary']?.totalPKR || 0;

      const builtInData = [
        { name: categories.find(c => c.key === 'fixed_expense')?.label || 'Fixed Expense', value: fixedValue, color: categories.find(c => c.key === 'fixed_expense')?.color || '#6366f1' },
        { name: categories.find(c => c.key === 'employee_salary')?.label || 'Employee Salary', value: salaryValue, color: categories.find(c => c.key === 'employee_salary')?.color || '#10b981' },
      ];

      // Everything else gets itemized or mapped cleanly. 
      // Sum from expenses list for anything that isn't fixed or salary
      const variableOrCustomData = categories
        .filter(c => c.key !== 'fixed_expense' && c.key !== 'employee_salary')
        .map(c => {
          const total = expenses.filter(e => e.category === c.key).reduce((s, e) => s + e.amountPKR, 0);
          return { name: c.label, value: total, color: c.color };
        });

      return [...builtInData, ...variableOrCustomData].filter(d => d.value > 0);
    })()
  : [];

  const grandTotalPKR = (summary?.grandTotal?.totalPKR || 0) + fixedTotal;

  const pendingReturns    = expenses.filter(e => e.needsReturn && !e.isReturned);
  const pendingReturnPKR  = pendingReturns.reduce((s, e) => s + e.amountPKR, 0);

  return (
    <div className="space-y-5">
      {/* Company-wide outstanding liabilities — not scoped to the selected month */}
      <LiabilitiesOverview refreshKey={liabilityRefresh} />

      {/* Summary row — built-in categories */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {categories.filter(c => c.builtIn).map(c => (
            <MiniStat
              key={c.key}
              label={c.label}
              pkr={summary.categorySummary[c.key]?.totalPKR || 0}
              usd={summary.categorySummary[c.key]?.totalUSD || 0}
              iconName={c.icon}
              bg={`bg-[${c.color}]/10`}
              text={`text-[${c.color}]`}
              color={c.color}
            />
          ))}
        </div>
      )}

      {/* Variable Expense subcategory breakdown */}
      {(() => {
        const customCats = categories.filter(c => !c.builtIn);
        if (!customCats.length || !expenses.length) return null;
        const rows = [
          // General bucket: expenses tagged as variable_expense (no custom sub)
          { key: 'variable_expense', label: 'General / Uncategorised', color: '#f59e0b',
            total: expenses.filter(e => e.category === 'variable_expense').reduce((s, e) => s + e.amountPKR, 0) },
          // Each custom subcategory
          ...customCats.map(c => ({
            key: c.key, label: c.label, color: c.color,
            total: expenses.filter(e => e.category === c.key).reduce((s, e) => s + e.amountPKR, 0),
          })),
        ].filter(r => r.total > 0);
        if (!rows.length) return null;
        const variableTotal = rows.reduce((s, r) => s + r.total, 0);
        return (
          <div className="glass-card p-4 border border-amber-500/15">
            <p className="text-[11px] text-amber-400/80 font-medium uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Zap className="w-3 h-3" /> Variable Expense Breakdown
            </p>
            <div className="space-y-2">
              {rows.map(r => {
                const pct = variableTotal ? ((r.total / variableTotal) * 100).toFixed(1) : 0;
                return (
                  <div key={r.key}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }} />
                        <span className="text-xs text-slate-300">{r.label}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-slate-500">{pct}%</span>
                        <span className="text-xs font-medium text-white">₨ {fmt(r.total)}</span>
                      </div>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: r.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-white/5 mt-3 pt-2.5 flex justify-between">
              <span className="text-[11px] text-slate-500">Total Variable</span>
              <span className="text-xs font-bold text-white">₨ {fmt(variableTotal)}</span>
            </div>
          </div>
        );
      })()}

      {/* Fixed Expenses banner when active */}
      {fixedTotal > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-500/8 border border-indigo-500/25 rounded-xl">
          <Repeat className="w-4 h-4 text-indigo-400 flex-shrink-0" />
          <div className="flex-1 text-xs text-indigo-300">
            Fixed expenses of <strong className="text-white">₨ {fmt(fixedTotal)}</strong> are included in the total.
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500">Grand Total</p>
            <p className="text-sm font-bold text-white">₨ {fmt(grandTotalPKR)}</p>
          </div>
        </div>
      )}

      {/* Pending Returns banner */}
      {pendingReturns.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-danger-500/8 border border-danger-500/25 rounded-xl">
          <AlertCircle className="w-4 h-4 text-danger-400 flex-shrink-0" />
          <div className="flex-1 text-xs text-danger-300">
            <strong className="text-white">{pendingReturns.length}</strong> payment{pendingReturns.length > 1 ? 's' : ''} still {pendingReturns.length > 1 ? 'need' : 'needs'} to be returned to the payer.
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500">Owed Back</p>
            <p className="text-sm font-bold text-danger-400">₨ {fmt(pendingReturnPKR)}</p>
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* By Person bar */}
        <div className="xl:col-span-2 glass-card p-5">
          <h4 className="text-sm font-semibold text-white mb-4">Paid By Person</h4>
          {summary?.byPerson?.length ? (
            <div className="space-y-2.5">
              {summary.byPerson.map((p) => {
                const pct = grandTotalPKR ? ((p.totalPKR / grandTotalPKR) * 100).toFixed(1) : 0;
                return (
                  <div key={p._id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-slate-300">{p._id}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-slate-500">{fmtUSD(p.totalUSD)}</span>
                        <span className="text-xs font-medium text-white">₨ {fmt(p.totalPKR)}</span>
                        <span className="text-[10px] text-slate-500 w-8 text-right">{pct}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-primary-500 transition-all duration-700" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="border-t border-white/5 pt-2.5 flex justify-between">
                <span className="text-xs text-slate-400">Total Expenses {fixedTotal > 0 ? '(incl. fixed)' : ''}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-slate-500">{fmtUSD(grandTotalPKR / usdRate)}</span>
                  <span className="text-sm font-bold text-white">₨ {fmt(grandTotalPKR)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-24 flex items-center justify-center text-slate-500 text-sm">No expenses this month</div>
          )}
        </div>

        {/* Pie */}
        <div className="glass-card p-5">
          <h4 className="text-sm font-semibold text-white mb-4">By Category</h4>
          {PIE_DATA.length ? (
            <>
              <ResponsiveContainer width="100%" height={130}>
                <PieChart>
                  <Pie data={PIE_DATA} cx="50%" cy="50%" innerRadius={38} outerRadius={58} paddingAngle={3} dataKey="value">
                    {PIE_DATA.map((e, i) => <Cell key={i} fill={e.color} stroke="transparent" />)}
                  </Pie>
                  <Tooltip formatter={(v) => `₨ ${fmt(v)}`} contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {PIE_DATA.map(d => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    <span className="text-[10px] text-slate-400 flex-1 truncate">{d.name}</span>
                    <span className="text-[10px] text-slate-300 font-medium">₨ {fmt(d.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-24 flex items-center justify-center text-slate-500 text-sm">No data</div>
          )}
        </div>
      </div>

      <VariableCategoriesPanel
        categories={categories}
        expenses={expenses}
        usdRate={usdRate}
        month={month}
        year={year}
        onAdd={(category) => { setAddCategory(category); setModal('add'); }}
      />

      {/* Fixed Expenses Panel */}
      <FixedExpensesPanel 
        usdRate={usdRate} 
        month={month}
        year={year}
        persons={persons}
        categories={categories}
        onPosted={() => { load(); onRefresh(); }} // This triggers the immediate table refresh!
      />

      {/* All Expenses Table */}
      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-white">All Expenses</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">{MONTHS[month - 1]} {year}</p>
          </div>
          <button onClick={() => { setAddCategory(null); setModal('add'); }} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add Expense
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-500 text-sm">Loading…</div>
        ) : expenses.length === 0 ? (
          <div className="py-12 text-center">
            <TrendingDown className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">No expenses recorded for this month.</p>
            <button onClick={() => { setAddCategory(null); setModal('add'); }} className="mt-3 text-xs text-primary-400 hover:underline">Add first expense →</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Paid By</th>
                  <th>Amount (PKR)</th>
                  <th>Amount (USD)</th>
                  <th>USD Rate</th>
                  <th>Date</th>
                  <th>Return</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(e => {
                  const cat  = categories.find(c => c.key === e.category) || categories[0];
                  return (
                    <tr key={e._id}>
                      <td>
                        <div>
                          <p className="text-xs font-medium text-slate-200">{e.title}</p>
                          {e.description && <p className="text-[10px] text-slate-500 mt-0.5">{e.description}</p>}
                          {e.notes && <p className="text-[10px] text-slate-600 mt-0.5">Notes: {e.notes}</p>}
                        </div>
                      </td>
                      <td>
                        <span className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color: cat?.color || '#94a3b8' }}>
                          <CatIcon name={cat?.icon || 'Tag'} className="w-3 h-3" />
                          {cat?.label || e.category}
                        </span>
                      </td>
                      <td className="text-xs text-slate-300">{e.paidBy?.name}</td>
                      <td className="text-xs font-medium text-white">₨ {fmt(e.amountPKR)}</td>
                      <td className="text-xs text-slate-400">{e.amountUSD ? fmtUSD(e.amountUSD) : '—'}</td>
                      <td className="text-[11px] text-slate-500">{e.usdRateAtEntry ? fmt(e.usdRateAtEntry) : '—'}</td>
                      <td className="text-[11px] text-slate-500">{new Date(e.date).toLocaleDateString()}</td>
                      <td>
                        {e.needsReturn ? (
                          e.isReturned ? (
                            <button
                              onClick={() => handleToggleReturn(e)}
                              disabled={updatingReturn === e._id}
                              title="Click to mark as not yet returned"
                              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                            >
                              <Check className="w-3 h-3" />
                              {updatingReturn === e._id ? 'Updating…' : 'Returned'}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleToggleReturn(e)}
                              disabled={updatingReturn === e._id}
                              title="Click once the payment has been paid back"
                              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full bg-danger-500/10 text-danger-400 hover:bg-danger-500/20 transition-colors disabled:opacity-50"
                            >
                              <AlertCircle className="w-3 h-3" />
                              {updatingReturn === e._id ? 'Updating…' : 'Needs Return'}
                            </button>
                          )
                        ) : (
                          <span className="text-[10px] text-slate-600">—</span>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setModal(e)} className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-white transition-colors">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(e._id)}
                            disabled={deleting === e._id}
                            className="p-1 rounded hover:bg-danger-500/10 text-slate-500 hover:text-danger-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {modal && (
          <Modal title={modal === 'add' ? 'Add Expense' : 'Edit Expense'} onClose={() => { setModal(null); setAddCategory(null); }}>
            <ExpenseForm
              persons={persons}
              usdRate={usdRate}
              initial={modal === 'add' ? (addCategory ? { category: addCategory } : null) : modal}
              onClose={() => { setModal(null); setAddCategory(null); }}
              onSave={() => { setModal(null); setAddCategory(null); load(); onRefresh(); setLiabilityRefresh(r => r + 1); }}
              categories={categories}
            />
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {returnModalFor && (
          <ReturnConfirmModal
            expense={returnModalFor}
            saving={updatingReturn === returnModalFor._id}
            onClose={() => setReturnModalFor(null)}
            onConfirm={({ returnMethod, returnNote }) =>
              submitReturnStatus(returnModalFor, { isReturned: true, returnMethod, returnNote })
            }
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Earnings Tab ─────────────────────────────────────────────────────────────
function EarningsTab({ month, year, persons, usdRate, onRefresh }) {
  const [earnings, setEarnings] = useState([]);
  const [summary,  setSummary]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eRes, sRes] = await Promise.all([
        earningAPI.getAll({ month, year }),
        earningAPI.getSummary({ month, year }),
      ]);
      setEarnings(eRes.data.data);
      setSummary(sRes.data.data);
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    setDeleting(id);
    try { await earningAPI.delete(id); load(); onRefresh(); }
    finally { setDeleting(null); }
  };

  return (
    <div className="space-y-5">
      {summary && (
        <div className="glass-card p-5 border border-accent-500/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] text-slate-500 mb-1">Total Revenue · {MONTHS[month - 1]} {year}</p>
              <p className="text-3xl font-bold text-white">₨ {fmt(summary.grandTotal.totalPKR)}</p>
              <p className="text-sm text-slate-400 mt-0.5">{fmtUSD(summary.grandTotal.totalUSD)}</p>
            </div>
            <TrendingUp className="w-10 h-10 text-accent-400 opacity-30" />
          </div>
        </div>
      )}
      {summary?.byPerson?.length > 0 && (
        <div className="glass-card p-5">
          <h4 className="text-sm font-semibold text-white mb-4">Earned by Person</h4>
          <div className="space-y-3">
            {summary.byPerson.map(p => {
              const pct = summary.grandTotal.totalPKR ? ((p.totalPKR / summary.grandTotal.totalPKR) * 100).toFixed(1) : 0;
              return (
                <div key={p._id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-accent-500/20 flex items-center justify-center text-[10px] font-bold text-accent-400">{p._id.charAt(0)}</div>
                      <span className="text-xs text-slate-300">{p._id}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-500">{fmtUSD(p.totalUSD)}</span>
                      <span className="text-xs font-semibold text-white">₨ {fmt(p.totalPKR)}</span>
                      <span className="text-[10px] text-accent-400 font-medium">{pct}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-accent-500 transition-all duration-700" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-white">All Earnings</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">{MONTHS[month - 1]} {year}</p>
          </div>
          <button onClick={() => setModal('add')} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add Earning
          </button>
        </div>
        {loading ? (
          <div className="py-12 text-center text-slate-500 text-sm">Loading…</div>
        ) : earnings.length === 0 ? (
          <div className="py-12 text-center">
            <TrendingUp className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">No earnings recorded.</p>
            <button onClick={() => setModal('add')} className="mt-3 text-xs text-accent-400 hover:underline">Add first earning →</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Title</th><th>Person</th><th>Earned Amount (PKR)</th><th>Person Amount (PKR)</th><th>Amount (USD)</th><th>Commission</th><th>Date</th><th></th></tr>
              </thead>
              <tbody>
                {earnings.map(e => (
                  <tr key={e._id}>
                    <td><div><p className="text-xs font-medium text-slate-200">{e.title}</p>{e.description && <p className="text-[10px] text-slate-500 mt-0.5">{e.description}</p>}{e.notes && <p className="text-[10px] text-slate-600 mt-0.5">Notes: {e.notes}</p>}</div></td>
                    <td><div className="flex items-center gap-2"><div className="w-5 h-5 rounded-full bg-accent-500/20 flex items-center justify-center text-[9px] font-bold text-accent-400">{e.person?.name?.charAt(0)}</div><span className="text-xs text-slate-300">{e.person?.name}</span></div></td>
                    <td className="text-xs font-medium text-white">₨ {fmt(e.amountPKR)}</td>
                    <td className="text-xs text-slate-300">{e.personAmountPKR != null ? `PKR ${fmt(e.personAmountPKR)}` : '—'}</td>
                    <td className="text-xs text-slate-400">{e.amountUSD ? fmtUSD(e.amountUSD) : '—'}</td>
                    <td className="text-[11px] text-slate-500">{e.commissionPercent ? <span className="text-accent-400">{e.commissionPercent}% of ₨ {fmt(e.baseAmountPKR)}</span> : '—'}</td>
                    <td className="text-[11px] text-slate-500">{new Date(e.date).toLocaleDateString()}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setModal(e)} className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-white transition-colors"><Edit3 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleDelete(e._id)} disabled={deleting === e._id} className="p-1 rounded hover:bg-danger-500/10 text-slate-500 hover:text-danger-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <AnimatePresence>
        {modal && (
          <Modal title={modal === 'add' ? 'Add Earning' : 'Edit Earning'} onClose={() => setModal(null)}>
            <EarningForm persons={persons} usdRate={usdRate} initial={modal !== 'add' ? modal : null} onClose={() => setModal(null)} onSave={() => { setModal(null); load(); onRefresh(); }} />
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ExpensesPage() {
  const [tab,          setTab]          = useState('expenses');
  const [month,        setMonth]        = useState(CURRENT_MONTH);
  const [year,         setYear]         = useState(CURRENT_YEAR);
  const [settings,     setSettings]     = useState(null);
  const [rateEdit,     setRateEdit]     = useState(false);
  const [newRate,      setNewRate]      = useState('');
  const [savingRate,   setSavingRate]   = useState(false);
  const [refresh,      setRefresh]      = useState(0);
  const [personModal,  setPersonModal]  = useState(false);
  const [newPerson,    setNewPerson]    = useState({ name: '', role: '' });
  const [activeEmployees, setActiveEmployees] = useState([]);
  const [catModal,     setCatModal]     = useState(false);
  const [fixedTotal,   setFixedTotal]   = useState(0);

  // Categories = built-ins (hard-coded) + custom (persisted in MongoDB)
  const [customCategories, setCustomCategories] = useState([]);
  const allCategories = [...BUILT_IN_CATEGORIES, ...customCategories];

  const loadCategories = useCallback(async () => {
    try {
      const res = await expenseCategoryAPI.getAll();
      setCustomCategories(res.data.data.map(c => ({ ...c, builtIn: false })));
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const handleAddCategory = async (cat) => {
    await expenseCategoryAPI.create(cat);
    await loadCategories();
  };

  const handleEditCategory = async (key, patch) => {
    const target = customCategories.find(c => c.key === key);
    if (!target?._id) return;
    await expenseCategoryAPI.update(target._id, patch);
    await loadCategories();
  };

  const handleDeleteCategory = async (key) => {
    const target = customCategories.find(c => c.key === key);
    if (!target?._id) return;
    await expenseCategoryAPI.delete(target._id);
    await loadCategories();
  };

  const managedPersons = settings?.persons?.filter(p => p.isActive) || [];
  const persons = [
    ...activeEmployees,
    ...managedPersons.filter(person => !activeEmployees.some(employee => employee.name.toLowerCase() === person.name.toLowerCase())),
  ];
  const usdRate = settings?.usdToPkrRate || 278;

  useEffect(() => {
    financeAPI.getSettings().then(r => setSettings(r.data.data)).catch(() => {});
  }, [refresh]);

  useEffect(() => {
    employeeAPI.getAll({ limit: 1000 })
      .then(response => {
        const employees = response.data.data || [];
        setActiveEmployees(employees
          .filter(employee => employee.isActive && employee.status === 'active')
          .map(employee => ({
            _id: employee._id,
            userId: employee._id,
            name: [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim(),
            role: employee.position || employee.role,
            source: 'employee',
          }))
          .filter(employee => employee.name));
      })
      .catch(error => console.error('Failed to load active employees:', error));
  }, []);

  const handleRateSave = async () => {
    if (!newRate) return;
    setSavingRate(true);
    try {
      await financeAPI.updateRate({ usdToPkrRate: Number(newRate) });
      setRateEdit(false);
      setRefresh(r => r + 1);
    } finally {
      setSavingRate(false);
    }
  };

  const handleAddPerson = async () => {
    if (!newPerson.name) return;
    await financeAPI.addPerson(newPerson);
    setNewPerson({ name: '', role: '' });
    setPersonModal(false);
    setRefresh(r => r + 1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div {...fadeUp(0)} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Expenses & Earnings</h1>
          <p className="text-slate-400 text-sm mt-1">Track company finances month by month</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* USD Rate */}
          {rateEdit ? (
            <div className="flex items-center gap-2">
              <input type="number" value={newRate} onChange={e => setNewRate(e.target.value)} placeholder={String(usdRate)} className="input-field text-xs py-1.5 w-24" />
              <button onClick={handleRateSave} disabled={savingRate} className="btn-primary text-xs px-3 py-1.5">{savingRate ? '…' : 'Save'}</button>
              <button onClick={() => setRateEdit(false)} className="btn-ghost text-xs px-2 py-1.5">✕</button>
            </div>
          ) : (
            <button
              onClick={() => { setRateEdit(true); setNewRate(String(usdRate)); }}
              className="flex items-center gap-1.5 text-xs text-warning-400 bg-warning-500/10 border border-warning-500/20 px-3 py-1.5 rounded-full hover:bg-warning-500/20 transition-colors"
            >
              <DollarSign className="w-3 h-3" />
              1 USD = ₨ {fmt(usdRate)}
              <RefreshCw className="w-3 h-3" />
            </button>
          )}

          {/* Manage Categories button */}
          <button
            onClick={() => setCatModal(true)}
            className="flex items-center gap-1.5 text-xs text-slate-400 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full hover:bg-white/10 transition-colors"
          >
            <Settings2 className="w-3 h-3" /> Manage Categories
            {customCategories.length > 0 && (
              <span className="bg-primary-500/30 text-primary-300 text-[10px] px-1.5 py-0.5 rounded-full">{customCategories.length}</span>
            )}
          </button>


          {/* Manage Persons button */}
          <button
            onClick={() => setPersonModal(true)}
            className="flex items-center gap-1.5 text-xs text-slate-400 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full hover:bg-white/10 transition-colors"
          >
            <Users className="w-3 h-3" /> Manage Persons
          </button>
        </div>
      </motion.div>

      {/* Month / Year selector + Tabs */}
      <motion.div {...fadeUp(0.05)} className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <select value={month} onChange={e => setMonth(Number(e.target.value))} className="input-field text-sm appearance-none pr-7 py-1.5">
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="input-field text-sm py-1.5 w-24" />
        </div>
        <div className="flex items-center bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
          {[
            { key: 'expenses', label: 'Expenses', icon: TrendingDown },
            { key: 'earnings', label: 'Earnings', icon: TrendingUp },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === t.key ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Content */}
      <motion.div {...fadeUp(0.1)} key={`${tab}-${month}-${year}`}>
        {tab === 'expenses' ? (
          <ExpensesTab
            month={month} year={year} persons={persons} usdRate={usdRate}
            onRefresh={() => setRefresh(r => r + 1)}
            categories={allCategories}
            fixedTotal={fixedTotal}
          />
        ) : (
          <EarningsTab month={month} year={year} persons={persons} usdRate={usdRate} onRefresh={() => setRefresh(r => r + 1)} />
        )}
      </motion.div>

      {/* Manage Categories Modal */}
      <AnimatePresence>
        {catModal && (
          <Modal title="Manage Expense Categories" onClose={() => setCatModal(false)} maxW="max-w-md">
            <ManageCategoriesModal
              categories={allCategories}
              onAdd={handleAddCategory}
              onEdit={handleEditCategory}
              onDelete={handleDeleteCategory}
              onClose={() => setCatModal(false)}
            />
          </Modal>
        )}
      </AnimatePresence>

      {/* Manage Persons Modal */}
      <AnimatePresence>
        {personModal && (
          <Modal title="Manage Persons" onClose={() => setPersonModal(false)}>
            <div className="space-y-4">
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {persons.length === 0 && <p className="text-xs text-slate-500 text-center py-4">No active employees or persons available yet.</p>}
                {persons.map(p => (
                  <div key={p._id} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg">
                    <div>
                      <p className="text-xs font-medium text-slate-200">{p.name}</p>
                      <p className="text-[10px] text-slate-500">{p.role || (p.source === 'employee' ? 'Active employee' : 'Person')}</p>
                    </div>
                    {p.source === 'employee' ? (
                      <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">Active employee</span>
                    ) : (
                      <button onClick={async () => { await financeAPI.removePerson(p._id); setRefresh(r => r + 1); }} className="p-1 text-slate-500 hover:text-danger-400 transition-colors" title="Remove manually added person">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t border-white/5 pt-4 space-y-3">
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Add Person</p>
                <input value={newPerson.name} onChange={e => setNewPerson(p => ({ ...p, name: e.target.value }))} placeholder="Full name" className="input-field w-full text-sm" />
                <input value={newPerson.role} onChange={e => setNewPerson(p => ({ ...p, role: e.target.value }))} placeholder="Role (optional, e.g. Owner, Manager)" className="input-field w-full text-sm" />
                <button onClick={handleAddPerson} disabled={!newPerson.name} className="btn-primary w-full text-sm py-2 disabled:opacity-40">
                  <Plus className="w-3.5 h-3.5 inline mr-1" /> Add Person
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}