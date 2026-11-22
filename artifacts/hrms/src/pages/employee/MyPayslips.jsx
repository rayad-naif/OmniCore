import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DollarSign, Download, Eye, FileText, Clock,
  Loader2, AlertCircle, X, Sparkles,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { payrollAPI } from '../../services/api';
import jsPDF from 'jspdf';
import { logoUrl, displayName } from '../../services/brand';

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt   = (n = 0) => `PKR ${Number(n).toLocaleString()}`;
const fmtK  = (v)    => `${(v / 1000).toFixed(0)}k`;
const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
async function fetchLogoBase64(url) {
  try {
    const res  = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror  = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
// ─── PDF Generator ────────────────────────────────────────────────────────────
async function generatePayslipPDF(payslip, employee) {
  // Employer name and logo come from the workspace / white-label branding.
  const company = displayName();
  const LOGO_URL = logoUrl();
  const logoData = LOGO_URL ? await fetchLogoBase64(LOGO_URL) : null;
 
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
 
  // ── Brand colours (RGB) ──
  const INDIGO  = [36, 174, 96];    // #24AE60 — primary green
  const DARK    = [0,   0,   0];    // #000000 — page background
  const SURFACE = [33,  33,  33];   // #212121 — card/band backgrounds
  const MUTED   = [175, 175, 175];  // #AFAFAF — muted/secondary text
  const WHITE   = [255, 255, 255];
  const GREEN   = [36, 174, 96];    // #24AE60 — gross earnings total
  const RED     = [239, 68, 68];
 
  // ── Header band ──
  doc.setFillColor(...DARK);
  doc.rect(0, 0, W, H, 'F');
 
  doc.setFillColor(...INDIGO);
  doc.roundedRect(0, 0, W, 46, 0, 0, 'F');
 
  // ── Logo + Company name (left side) ──
  const LOGO_SIZE = 14; // mm — square logo box
  const LOGO_X    = 12;
  const LOGO_Y    = 8;
 
  if (logoData) {
    // White rounded-rect backdrop so logo pops on indigo
    doc.setFillColor(0, 0, 0);
    doc.roundedRect(LOGO_X - 1, LOGO_Y - 1, LOGO_SIZE + 2, LOGO_SIZE + 2, 2, 2, 'F');
    doc.addImage(logoData, 'PNG', LOGO_X, LOGO_Y, LOGO_SIZE, LOGO_SIZE);
  }
 
  const textX = logoData ? LOGO_X + LOGO_SIZE + 4 : 14;
 
  // Company name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...WHITE);
  doc.text(company, textX, 17);
 
  // Tag line
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('Payslip', textX, 24);
 
  // PAYSLIP label (right)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...WHITE);
  doc.text('PAYSLIP', W - 14, 17, { align: 'right' });
 
  // Period
  const mon  = MONTH_NAMES[payslip.payPeriod?.month] || '';
  const yr   = payslip.payPeriod?.year || '';
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`Pay Period: ${mon} ${yr}`, W - 14, 25, { align: 'right' });
 
  // ── Employee info band ──
  doc.setFillColor(...SURFACE);
  doc.roundedRect(10, 52, W - 20, 28, 3, 3, 'F');
 
  const empName = employee
    ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim()
    : 'Employee';
  const empId   = employee?.employeeId || '—';
  const dept    = employee?.department?.name || employee?.department || '—';
  const pos     = employee?.position || '—';
 
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...WHITE);
  doc.text(empName, 16, 63);
 
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(`ID: ${empId}`, 16, 70);
  doc.text(`Department: ${dept}`, 16, 75);
 
  doc.setTextColor(...MUTED);
  doc.text(`Position: ${pos}`, W / 2, 63);
  doc.text(`Status: ${(payslip.status || 'draft').toUpperCase()}`, W / 2, 70);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-PK')}`, W / 2, 75);
 
  // ── Sections start ──
  let y = 88;
  const sectionGap = 6;
 
  const drawSection = (title, rows, totLabel, totVal, totColor) => {
    // Section title
    doc.setFillColor(...INDIGO);
    doc.roundedRect(10, y, W - 20, 7, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...WHITE);
    doc.text(title.toUpperCase(), 14, y + 4.8);
    y += 10;
 
    rows.forEach(([label, val], idx) => {
      if (idx % 2 === 0) {
        doc.setFillColor(18, 18, 18);
        doc.rect(10, y - 1, W - 20, 6.5, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...MUTED);
      doc.text(label, 16, y + 4);
      doc.setTextColor(...WHITE);
      doc.text(val, W - 16, y + 4, { align: 'right' });
      y += 6.5;
    });
 
    // Total row
    doc.setFillColor(...SURFACE);
    doc.roundedRect(10, y, W - 20, 8, 0, 0, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...WHITE);
    doc.text(totLabel, 16, y + 5.5);
    doc.setTextColor(...totColor);
    doc.text(totVal, W - 16, y + 5.5, { align: 'right' });
    y += 8 + sectionGap;
  };
 
  // ── EARNINGS ──
  const e = payslip.earnings || {};
  const earningRows = [
    ['Basic Salary',           fmt(e.basicSalary)],
    ['House Rent Allowance',   fmt(e.houseRentAllowance)],
    ['Conveyance Allowance',   fmt(e.conveyanceAllowance)],
    ['Medical Allowance',      fmt(e.medicalAllowance)],
    ['Special Allowance',      fmt(e.specialAllowance)],
    ['Overtime Pay',           fmt(e.overtimePay)],
    ['Performance Bonus',      fmt(e.performanceBonus)],
    ['Other Earnings',         fmt(e.otherEarnings)],
  ].filter(([, v]) => v !== fmt(0));
 
  drawSection('Earnings', earningRows, 'Gross Earnings', fmt(payslip.grossEarnings), GREEN);
 
  // ── DEDUCTIONS ──
  const d = payslip.deductions || {};
  const deductRows = [
    ['Provident Fund',         fmt(d.providentFund)],
    ['Income Tax',             fmt(d.incomeTax)],
    ['Professional Tax',       fmt(d.professionalTax)],
    ['Employee State Insurance', fmt(d.employeeStateInsurance)],
    ['Loan Deduction',         fmt(d.loanDeductions)],
    ['Absent Deductions',      fmt(d.absentDeductions)],
    ['Other Deductions',       fmt(d.otherDeductions)],
  ].filter(([, v]) => v !== fmt(0));
 
  drawSection('Deductions', deductRows, 'Total Deductions', `- ${fmt(payslip.totalDeductions)}`, RED);
 
  // ── NET PAY highlight ──
  doc.setFillColor(...INDIGO);
  doc.roundedRect(10, y, W - 20, 16, 4, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...WHITE);
  doc.text('NET PAY (Take Home)', 16, y + 10);
  doc.setFontSize(14);
  doc.setTextColor(...WHITE);
  doc.text(fmt(payslip.netSalary), W - 16, y + 10, { align: 'right' });
  y += 20;
 
  // ── Attendance summary ──
  const att = payslip.attendanceSummary || {};
  if (att.totalWorkingDays) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    const attStr = `Working Days: ${att.totalWorkingDays}  |  Present: ${att.presentDays}  |  Absent: ${att.absentDays}  |  Leave: ${att.leaveDays}  |  OT Hours: ${att.overtimeHours}`;
    doc.text(attStr, W / 2, y + 4, { align: 'center' });
    y += 10;
  }
 
  // ── Footer ──
  doc.setFillColor(...SURFACE);
  doc.rect(0, H - 16, W, 16, 'F');
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text('This is a computer-generated payslip and does not require a signature.', W / 2, H - 9, { align: 'center' });
  doc.text(company, W / 2, H - 4, { align: 'center' });
 
  doc.save(`${company.replace(/[^A-Za-z0-9]+/g, '_')}_Payslip_${mon}_${yr}_${empId}.pdf`);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MyPayslips() {
  const [payslips, setPayslips]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [selected, setSelected]   = useState(null);
  const [downloading, setDownloading] = useState(null);

  // Fetch logged-in employee's payroll records
  const fetchPayslips = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await payrollAPI.getMine({ limit: 24 });
      const data = res.data?.data || [];
      // Sort newest first
      data.sort((a, b) => {
        if (b.payPeriod?.year !== a.payPeriod?.year) return b.payPeriod?.year - a.payPeriod?.year;
        return b.payPeriod?.month - a.payPeriod?.month;
      });
      setPayslips(data);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load payslips');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPayslips(); }, [fetchPayslips]);

  // ── Derived stats ──
  const latest       = payslips[0];
  const monthlyGross = latest?.grossEarnings    || 0;
  const monthlyNet   = latest?.netSalary        || 0;
  const annualGross  = payslips.reduce((s, p) => s + (p.grossEarnings || 0), 0);

  const basicSalary  = latest?.earnings?.basicSalary || 0;
  const annualSalary = basicSalary * 12;

  // 6-month chart data (last 6, oldest→newest)
  const chartData = payslips.slice(0, 6).reverse().map(p => ({
    month: MONTH_NAMES[p.payPeriod?.month] || '?',
    gross: p.grossEarnings || 0,
    net:   p.netSalary     || 0,
  }));

  // ── Download handler ──
  const handleDownload = async (payslip) => {
    setDownloading(payslip._id);
    try {
      // employee info is nested in payslip.employee (populated)
      const employee = payslip.employee || {};
      generatePayslipPDF(payslip, employee);
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setTimeout(() => setDownloading(null), 800);
    }
  };

  // ── Month label helper ──
  const monthLabel = (p) => {
    const m = MONTH_NAMES[p.payPeriod?.month] || '';
    const y = p.payPeriod?.year || '';
    return `${m} ${y}`;
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex-center h-64">
      <Loader2 className="w-6 h-6 text-primary-400 animate-spin" />
    </div>
  );

  if (error) return (
    <div className="flex-center h-64 flex-col gap-3">
      <AlertCircle className="w-8 h-8 text-danger-400" />
      <p className="text-slate-400 text-sm">{error}</p>
      <button onClick={fetchPayslips} className="btn-ghost text-xs">Retry</button>
    </div>
  );

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-display text-2xl font-bold text-white">My Payslips</h1>
        <p className="text-slate-400 text-sm mt-0.5">Salary history and payment details</p>
      </motion.div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Monthly CTC',    value: fmt(monthlyGross), color: 'text-primary-400', bg: 'bg-primary-500/10' },
          { label: 'In-Hand Salary', value: fmt(monthlyNet),   color: 'text-accent-400',  bg: 'bg-accent-500/10'  },
          { label: 'Annual Salary',     value: `PKR ${(annualSalary / 1000).toFixed(1)}k`, color: 'text-warning-400', bg: 'bg-warning-500/10' },
          { label: 'Total Tax YTD',  value: null /* coming soon */, color: 'text-danger-400',  bg: 'bg-danger-500/10'  },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
            className="stat-card relative overflow-hidden"
          >
            <div className={`w-8 h-8 rounded-lg flex-center ${s.bg}`}>
              {s.value === null
                ? <Sparkles className={`w-4 h-4 ${s.color}`} />
                : <DollarSign className={`w-4 h-4 ${s.color}`} />
              }
            </div>
            <div>
              {s.value === null ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-full bg-danger-500/15 text-danger-400 border border-danger-500/25">
                      <Clock className="w-2.5 h-2.5" /> Coming Soon
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
                </>
              ) : (
                <>
                  <p className="text-xl font-display font-bold text-white">{s.value}</p>
                  <p className="text-[10px] text-slate-500">{s.label}</p>
                </>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── Chart ── */}
      {chartData.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="glass-card p-5">
          <h3 className="font-semibold text-white text-sm mb-4">6-Month Salary Trend</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtK} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(v) => [fmt(v)]}
                contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '11px' }}
              />
              <Bar dataKey="gross" name="Gross" fill="rgba(99,102,241,0.35)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="net"   name="Net"   fill="#6366f1"               radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      {/* ── Payslip list ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/5">
          <h3 className="font-semibold text-white text-sm">Payslip History</h3>
        </div>

        {payslips.length === 0 ? (
          <div className="flex-center flex-col gap-2 py-14">
            <FileText className="w-8 h-8 text-slate-600" />
            <p className="text-slate-500 text-sm">No payslips found</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {payslips.map((p, i) => (
              <div
                key={p._id || i}
                className="flex items-center gap-4 px-4 py-3.5 hover:bg-white/5 transition-colors group"
              >
                <div className="w-9 h-9 rounded-xl bg-primary-500/10 flex-center flex-shrink-0">
                  <FileText className="w-4 h-4 text-primary-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{monthLabel(p)}</p>
                  <p className="text-xs text-slate-500">
                    Gross: {fmt(p.grossEarnings)} · Deductions: {fmt(p.totalDeductions)}
                  </p>
                </div>
                <div className="text-right mr-4">
                  <p className="text-sm font-bold text-accent-400">{fmt(p.netSalary)}</p>
                  <span className={`badge text-[10px] ${p.status === 'paid' ? 'badge-success' : p.status === 'approved' ? 'badge-warning' : 'badge-info'}`}>
                    {p.status}
                  </span>
                </div>
                <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setSelected(p)} className="btn-ghost p-1.5" title="View">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDownload(p)}
                    className="btn-ghost p-1.5"
                    title="Download PDF"
                    disabled={downloading === p._id}
                  >
                    {downloading === p._id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Download className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* ── Detail modal ── */}
      <AnimatePresence>
        {selected && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex-center p-4"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex-between mb-5">
                <div>
                  <h3 className="font-display font-bold text-white">Payslip</h3>
                  <p className="text-xs text-slate-400">{monthLabel(selected)}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Earnings */}
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Earnings</p>
              <div className="space-y-0 mb-4">
                {[
                  ['Basic Salary',         selected.earnings?.basicSalary],
                  ['House Rent Allowance', selected.earnings?.houseRentAllowance],
                  ['Conveyance Allowance', selected.earnings?.conveyanceAllowance],
                  ['Medical Allowance',    selected.earnings?.medicalAllowance],
                  ['Special Allowance',    selected.earnings?.specialAllowance],
                  ['Overtime Pay',         selected.earnings?.overtimePay],
                  ['Performance Bonus',    selected.earnings?.performanceBonus],
                  ['Other Earnings',       selected.earnings?.otherEarnings],
                ].filter(([, v]) => v > 0).map(([l, v]) => (
                  <div key={l} className="flex-between text-xs py-1.5 border-b border-white/5">
                    <span className="text-slate-400">{l}</span>
                    <span className="text-slate-200">{fmt(v)}</span>
                  </div>
                ))}
                <div className="flex-between py-2 text-xs font-bold">
                  <span className="text-white">Gross Earnings</span>
                  <span className="text-primary-400">{fmt(selected.grossEarnings)}</span>
                </div>
              </div>

              {/* Deductions */}
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Deductions</p>
              <div className="space-y-0 mb-4">
                {[
                  ['Provident Fund',         selected.deductions?.providentFund],
                  ['Income Tax',             selected.deductions?.incomeTax],
                  ['Professional Tax',       selected.deductions?.professionalTax],
                  ['ESI',                    selected.deductions?.employeeStateInsurance],
                  ['Loan Deduction',         selected.deductions?.loanDeductions],
                  ['Absent Deductions',      selected.deductions?.absentDeductions],
                  ['Other Deductions',       selected.deductions?.otherDeductions],
                ].filter(([, v]) => v > 0).map(([l, v]) => (
                  <div key={l} className="flex-between text-xs py-1.5 border-b border-white/5">
                    <span className="text-slate-400">{l}</span>
                    <span className="text-danger-400">- {fmt(v)}</span>
                  </div>
                ))}
              </div>

              {/* Net Pay */}
              <div className="flex-between p-3 bg-accent-500/10 border border-accent-500/20 rounded-xl mb-5">
                <span className="text-sm font-bold text-white">Net Pay</span>
                <span className="text-xl font-display font-bold text-accent-400">{fmt(selected.netSalary)}</span>
              </div>

              <button
                onClick={() => handleDownload(selected)}
                disabled={downloading === selected._id}
                className="btn-primary w-full justify-center text-xs"
              >
                {downloading === selected._id
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Download className="w-3.5 h-3.5" />
                }
                Download PDF
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}