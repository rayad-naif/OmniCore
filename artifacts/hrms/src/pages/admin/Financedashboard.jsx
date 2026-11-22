import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, TrendingDown, DollarSign, Users,
  Crown, Calendar, ArrowRight, ChevronDown,
  BarChart2, Wallet, Landmark,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from 'recharts';
import { financeAPI } from '@/services/api';

// ─── Constants ────────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CURRENT_MONTH = new Date().getMonth() + 1;
const CURRENT_YEAR  = new Date().getFullYear();

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt    = (n) => new Intl.NumberFormat('en-PK').format(Math.round(n || 0));
const fmtUSD = (n) => `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n || 0)}`;
const fadeUp = (d = 0) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay: d } });

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

// ─── Big P&L metric card ──────────────────────────────────────────────────────
function PnLCard({ label, pkr, usd, icon: Icon, color, bg, border, note }) {
  return (
    <div className={`glass-card p-5 border ${border}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${bg}`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        {note && (
          <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">{note}</span>
        )}
      </div>
      <p className="text-[11px] text-slate-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">₨ {fmt(pkr)}</p>
      <p className="text-sm text-slate-400 mt-0.5">{fmtUSD(usd)}</p>
    </div>
  );
}

// ─── Monthly P&L view ─────────────────────────────────────────────────────────
function MonthlyView() {
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [year,  setYear]  = useState(CURRENT_YEAR);
  const [data,  setData]  = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await financeAPI.getDashboard({ month, year });
      setData(res.data.data);
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  const isProfitable = (data?.profit?.pkr || 0) >= 0;

  // Bar chart data for expense breakdown (Variable now includes all custom categories)
  const expenseBreakdown = data ? [
    { name: 'Variable & Custom', value: data.expenses.variable.totalPKR, fill: '#f59e0b' },
    { name: 'Fixed',             value: data.expenses.fixed.totalPKR,    fill: '#6366f1' },
    { name: 'Salaries',          value: data.expenses.salaries.totalPKR, fill: '#10b981' },
  ] : [];

  return (
    <div className="space-y-5">
      {/* Month selector */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className="input-field text-sm appearance-none pr-7 py-1.5"
          >
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
        </div>
        <input
          type="number"
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="input-field text-sm py-1.5 w-24"
        />
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-500 text-sm">Loading…</div>
      ) : data ? (
        <>
          {/* 4-metric row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <PnLCard
              label="Total Expenses"
              pkr={data.expenses.totalPKR}
              usd={data.expenses.totalUSD}
              icon={TrendingDown}
              color="text-danger-400"
              bg="bg-danger-500/10"
              border="border-danger-500/20"
            />
            <PnLCard
              label="Total Revenue"
              pkr={data.earnings.totalPKR}
              usd={data.earnings.totalUSD}
              icon={TrendingUp}
              color="text-accent-400"
              bg="bg-accent-500/10"
              border="border-accent-500/20"
            />
            <PnLCard
              label={isProfitable ? 'Net Profit' : 'Net Loss'}
              pkr={Math.abs(data.profit.pkr)}
              usd={Math.abs(data.profit.usd)}
              icon={isProfitable ? Wallet : TrendingDown}
              color={isProfitable ? 'text-primary-400' : 'text-danger-400'}
              bg={isProfitable ? 'bg-primary-500/10' : 'bg-danger-500/10'}
              border={isProfitable ? 'border-primary-500/20' : 'border-danger-500/20'}
              note={isProfitable ? 'In surplus' : 'Running deficit'}
            />
            <PnLCard
              label={`Per Owner (÷${data.profit.ownerCount})`}
              pkr={Math.abs(data.profit.perOwnerPKR)}
              usd={Math.abs(data.profit.perOwnerUSD)}
              icon={Crown}
              color="text-warning-400"
              bg="bg-warning-500/10"
              border="border-warning-500/20"
              note={`${data.profit.ownerCount} owners`}
            />
          </div>

          {/* Outstanding liabilities — company-wide, not scoped to this month.
              Kept visually separate from Profit above: it's cash still owed to
              staff/payers, not a second deduction from P&L. */}
          {data.liabilities?.totalOutstandingPKR > 0 && (
            <div className="glass-card p-5 border border-danger-500/20">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-danger-400" />
                  <h4 className="text-sm font-semibold text-white">Outstanding to Payers</h4>
                </div>
                <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">
                  As of today · all months
                </span>
              </div>
              <div className="flex items-baseline gap-3 mb-4">
                <p className="text-2xl font-bold text-danger-400">₨ {fmt(data.liabilities.totalOutstandingPKR)}</p>
                <p className="text-sm text-slate-500">{fmtUSD(data.liabilities.totalOutstandingUSD)}</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {data.liabilities.byPerson.map((p, i) => {
                  const colors = ['#ef4444','#f97316','#f59e0b','#ec4899'];
                  const c = colors[i % colors.length];
                  return (
                    <div key={p._id} className="rounded-xl p-3 border" style={{ borderColor: c + '30', background: c + '0a' }}>
                      <p className="text-xs font-medium text-slate-200 truncate mb-1">{p._id || 'Unassigned'}</p>
                      <p className="text-sm font-bold text-white">₨ {fmt(p.totalOwedPKR)}</p>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-500 mt-3">
                Already reflected in the Total Expenses / Net Profit figures above — this is a cash reminder, not an additional cost.
              </p>
            </div>
          )}

          {/* Charts + breakdowns */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Expense breakdown bar */}
            <div className="glass-card p-5">
              <h4 className="text-sm font-semibold text-white mb-4">Expense Breakdown</h4>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={expenseBreakdown} layout="vertical" margin={{ left: 0 }}>
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `₨${fmt(v/1000)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} name="Amount">
                    {expenseBreakdown.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* Expense category detail */}
              <div className="space-y-2 mt-3 border-t border-white/5 pt-3">
                {[
                  { label: 'Variable & Custom', color: '#f59e0b', pkr: data.expenses.variable.totalPKR,  usd: data.expenses.variable.totalUSD  },
                  { label: 'Fixed',             color: '#6366f1', pkr: data.expenses.fixed.totalPKR,     usd: data.expenses.fixed.totalUSD     },
                  { label: 'Salaries',          color: '#10b981', pkr: data.expenses.salaries.totalPKR,  usd: data.expenses.salaries.totalUSD  },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: row.color }} />
                      <span className="text-xs text-slate-400">{row.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500">{fmtUSD(row.usd)}</span>
                      <span className="text-xs font-medium text-white">₨ {fmt(row.pkr)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Revenue by person */}
            <div className="glass-card p-5">
              <h4 className="text-sm font-semibold text-white mb-4">Revenue by Person</h4>
              {data.earnings.byPerson?.length ? (
                <div className="space-y-3">
                  {data.earnings.byPerson.map((p, i) => {
                    const pct = data.earnings.totalPKR
                      ? ((p.totalPKR / data.earnings.totalPKR) * 100).toFixed(1)
                      : 0;
                    const colors = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6'];
                    return (
                      <div key={p._id}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ background: colors[i % colors.length] + '33', color: colors[i % colors.length] }}>
                              {p._id?.charAt(0)}
                            </div>
                            <span className="text-xs text-slate-300 truncate max-w-[80px]">{p._id}</span>
                          </div>
                          <span className="text-xs font-semibold text-white">₨ {fmt(p.totalPKR)}</span>
                        </div>
                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: colors[i % colors.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-500 text-center py-8">No earnings recorded</p>
              )}
            </div>

            {/* Expense by payer */}
            <div className="glass-card p-5">
              <h4 className="text-sm font-semibold text-white mb-4">Expense by Payer</h4>
              {data.expenseByPayer?.length ? (
                <div className="space-y-3">
                  {data.expenseByPayer.map((p, i) => {
                    const pct = data.expenses.totalPKR
                      ? ((p.totalPKR / data.expenses.totalPKR) * 100).toFixed(1)
                      : 0;
                    return (
                      <div key={p._id}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-warning-500/20 flex items-center justify-center text-[9px] font-bold text-warning-400">
                              {p._id?.charAt(0)}
                            </div>
                            <span className="text-xs text-slate-300 truncate max-w-[80px]">{p._id}</span>
                          </div>
                          <span className="text-xs font-semibold text-white">₨ {fmt(p.totalPKR)}</span>
                        </div>
                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-warning-500 transition-all duration-700" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-500 text-center py-8">No expenses recorded</p>
              )}
            </div>
          </div>

          {/* Owner cards */}
          {data.profit.owners?.length > 0 && (
            <div className="glass-card p-5 border border-warning-500/20">
              <div className="flex items-center gap-2 mb-4">
                <Crown className="w-4 h-4 text-warning-400" />
                <h4 className="text-sm font-semibold text-white">Owner Profit Split</h4>
                <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full ml-auto">
                  Equal split · {MONTHS[month - 1]} {year}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {data.profit.owners.map(o => (
                  <div key={o._id} className="bg-warning-500/5 border border-warning-500/15 rounded-xl p-3 text-center">
                    <div className="w-8 h-8 rounded-full bg-warning-500/20 flex items-center justify-center text-sm font-bold text-warning-400 mx-auto mb-2">
                      {o.name.charAt(0)}
                    </div>
                    <p className="text-xs font-medium text-slate-200 mb-1">{o.name}</p>
                    <p className="text-sm font-bold text-white">₨ {fmt(data.profit.perOwnerPKR)}</p>
                    <p className="text-[10px] text-slate-500">{fmtUSD(data.profit.perOwnerUSD)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

// ─── Yearly Summary view ──────────────────────────────────────────────────────
function YearlyView() {
  const [year,       setYear]      = useState(CURRENT_YEAR);
  const [startMonth, setStartMonth]= useState(1);
  const [endMonth,   setEndMonth]  = useState(12);
  const [data,       setData]      = useState(null);
  const [loading,    setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await financeAPI.getYearlySummary({ year, startMonth, endMonth });
      setData(res.data.data);
    } finally {
      setLoading(false);
    }
  }, [year, startMonth, endMonth]);

  useEffect(() => { load(); }, [load]);

  const chartData = data?.months?.map(m => ({
    name: MONTHS[m.month - 1],
    Revenue: m.totalEarning,
    Expenses: m.totalExpense,
    Profit: m.profit,
  })) || [];

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="number"
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="input-field text-sm py-1.5 w-20"
          placeholder="Year"
        />
        <div className="relative">
          <select value={startMonth} onChange={e => setStartMonth(Number(e.target.value))} className="input-field text-sm appearance-none pr-7 py-1.5">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
        </div>
        <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
        <div className="relative">
          <select value={endMonth} onChange={e => setEndMonth(Number(e.target.value))} className="input-field text-sm appearance-none pr-7 py-1.5">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-500 text-sm">Loading…</div>
      ) : data ? (
        <>
          {/* Year totals */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              { label: 'Total Revenue',  pkr: data.yearTotals.totalEarning,  usd: data.yearTotals.totalEarningUSD,  color: 'text-accent-400',  bg: 'bg-accent-500/10',   border: 'border-accent-500/20',   icon: TrendingUp },
              { label: 'Total Expenses', pkr: data.yearTotals.totalExpense,  usd: data.yearTotals.totalExpenseUSD,  color: 'text-danger-400',  bg: 'bg-danger-500/10',   border: 'border-danger-500/20',   icon: TrendingDown },
              { label: 'Net Profit',     pkr: data.yearTotals.totalProfit,   usd: data.yearTotals.totalProfitUSD,  color: 'text-primary-400', bg: 'bg-primary-500/10',  border: 'border-primary-500/20',  icon: Wallet },
              { label: 'Per Owner',      pkr: data.yearTotals.perOwnerPKR,   usd: data.yearTotals.perOwnerUSD,     color: 'text-warning-400', bg: 'bg-warning-500/10',  border: 'border-warning-500/20',  icon: Crown },
            ].map(s => (
              <PnLCard key={s.label} {...s} />
            ))}
          </div>

          {/* Area chart */}
          <div className="glass-card p-5">
            <h4 className="text-sm font-semibold text-white mb-5">Revenue vs Expenses vs Profit</h4>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="gRev"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
                  <linearGradient id="gExp"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.2}/><stop offset="95%" stopColor="#ef4444" stopOpacity={0}/></linearGradient>
                  <linearGradient id="gProf" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.25}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${fmt(v/1000)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="Revenue"  stroke="#10b981" fill="url(#gRev)"  strokeWidth={2} name="Revenue"  />
                <Area type="monotone" dataKey="Expenses" stroke="#ef4444" fill="url(#gExp)"  strokeWidth={2} name="Expenses" />
                <Area type="monotone" dataKey="Profit"   stroke="#6366f1" fill="url(#gProf)" strokeWidth={2} name="Profit"   />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', color: '#94a3b8', paddingTop: '12px' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Month-by-month table */}
          <div className="glass-card overflow-hidden">
            <div className="p-4 border-b border-white/5">
              <h4 className="text-sm font-semibold text-white">Monthly Breakdown</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Revenue (PKR)</th>
                    <th>Expenses (PKR)</th>
                    <th>Variable & Custom</th>
                    <th>Fixed</th>
                    <th>Salaries</th>
                    <th>Profit (PKR)</th>
                    <th>Profit (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map(m => {
                    const profitable = m.profit >= 0;
                    return (
                      <tr key={m.month}>
                        <td className="font-medium text-slate-200 text-xs">{MONTHS[m.month - 1]}</td>
                        <td className="text-xs text-accent-400">₨ {fmt(m.totalEarning)}</td>
                        <td className="text-xs text-danger-400">₨ {fmt(m.totalExpense)}</td>
                        <td className="text-xs text-warning-400">₨ {fmt(m.variable)}</td>
                        <td className="text-xs text-primary-400">₨ {fmt(m.fixed)}</td>
                        <td className="text-xs text-slate-300">₨ {fmt(m.salaries)}</td>
                        <td className={`text-xs font-semibold ${profitable ? 'text-accent-400' : 'text-danger-400'}`}>
                          {profitable ? '+' : '-'}₨ {fmt(Math.abs(m.profit))}
                        </td>
                        <td className={`text-[11px] ${profitable ? 'text-accent-500' : 'text-danger-500'}`}>
                          {profitable ? '+' : '-'}{fmtUSD(Math.abs(m.profitUSD))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Totals row */}
                <tfoot>
                  <tr className="border-t-2 border-white/10">
                    <td className="text-xs font-bold text-white py-3 px-4">TOTAL</td>
                    <td className="text-xs font-bold text-accent-400 px-4">₨ {fmt(data.yearTotals.totalEarning)}</td>
                    <td className="text-xs font-bold text-danger-400 px-4">₨ {fmt(data.yearTotals.totalExpense)}</td>
                    <td colSpan={3} />
                    <td className={`text-sm font-bold px-4 ${data.yearTotals.totalProfit >= 0 ? 'text-accent-400' : 'text-danger-400'}`}>
                      ₨ {fmt(Math.abs(data.yearTotals.totalProfit))}
                    </td>
                    <td className={`text-xs font-bold px-4 ${data.yearTotals.totalProfit >= 0 ? 'text-accent-400' : 'text-danger-400'}`}>
                      {fmtUSD(Math.abs(data.yearTotals.totalProfitUSD))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Person-wise yearly earnings */}
          {data.earningByPerson?.length > 0 && (
            <div className="glass-card p-5">
              <h4 className="text-sm font-semibold text-white mb-4">Total Earned by Person · {year}</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {data.earningByPerson.map((p, i) => {
                  const colors = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];
                  const c = colors[i % colors.length];
                  return (
                    <div key={p.name} className="rounded-xl p-4 border" style={{ borderColor: c + '30', background: c + '0a' }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mb-2" style={{ background: c + '25', color: c }}>
                        {p.name.charAt(0)}
                      </div>
                      <p className="text-xs font-medium text-slate-200 mb-0.5 truncate">{p.name}</p>
                      <p className="text-base font-bold text-white">₨ {fmt(p.totalPKR)}</p>
                      <p className="text-[11px] text-slate-500">{fmtUSD(p.totalUSD)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Owner yearly share */}
          {data.yearTotals.owners?.length > 0 && (
            <div className="glass-card p-5 border border-warning-500/20">
              <div className="flex items-center gap-2 mb-4">
                <Crown className="w-4 h-4 text-warning-400" />
                <h4 className="text-sm font-semibold text-white">Owner Yearly Take-Home</h4>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {data.yearTotals.owners.map(o => (
                  <div key={o._id} className="bg-warning-500/5 border border-warning-500/20 rounded-xl p-4 text-center">
                    <div className="w-9 h-9 rounded-full bg-warning-500/20 flex items-center justify-center text-sm font-bold text-warning-400 mx-auto mb-2">
                      {o.name.charAt(0)}
                    </div>
                    <p className="text-xs font-medium text-slate-200 mb-1">{o.name}</p>
                    <p className="text-lg font-bold text-white">₨ {fmt(data.yearTotals.perOwnerPKR)}</p>
                    <p className="text-[11px] text-slate-500">{fmtUSD(data.yearTotals.perOwnerUSD)}</p>
                    <p className="text-[10px] text-warning-500 mt-1">Equal share of profit</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function FinanceDashboard() {
  const [view, setView] = useState('monthly');

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div {...fadeUp(0)} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Finance Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">P&L · Profit split · Owner summaries</p>
        </div>

        {/* View toggle */}
        <div className="flex items-center bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
          {[
            { key: 'monthly', label: 'Monthly',  icon: BarChart2  },
            { key: 'yearly',  label: 'Yearly',   icon: Calendar   },
          ].map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                view === v.key
                  ? 'bg-white/10 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <v.icon className="w-3.5 h-3.5" />
              {v.label}
            </button>
          ))}
        </div>
      </motion.div>

      <motion.div {...fadeUp(0.08)} key={view}>
        {view === 'monthly' ? <MonthlyView /> : <YearlyView />}
      </motion.div>
    </div>
  );
}