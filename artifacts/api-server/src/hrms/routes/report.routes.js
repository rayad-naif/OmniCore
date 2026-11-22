const express = require('express');
const router = express.Router();
const mongoose = require('../core/mongoose');
const { protect, managementOnly } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');

// ─── Lazy-load models (avoids circular deps) ─────────────────────────────────
const User        = () => mongoose.model('User');
const Attendance   = () => mongoose.model('Attendance');
const Payroll      = () => mongoose.model('Payroll');
const Leave        = () => mongoose.model('Leave');

// ─── Helper: parse & validate date range from query ──────────────────────────
const parseDateRange = (query) => {
  const { startDate, endDate } = query;
  const start = startDate ? new Date(startDate) : null;
  const end   = endDate   ? new Date(endDate)   : null;
  if (end) end.setHours(23, 59, 59, 999); // inclusive end
  return { start, end };
};

// ─── Helper: employee populate config ─────────────────────────────────────────
// `employee` on Attendance/Payroll/Leave/Advance/Loan all ref the `User` model.
// `department` on User is itself an ObjectId ref to `Department` — so it must
// be populated a second, nested level deep, or you just get the raw ObjectId
// back instead of a readable name.
const EMP_SELECT = 'firstName lastName department position';
const EMP_POPULATE = {
  path: 'employee',
  select: EMP_SELECT,
  populate: { path: 'department', select: 'name' },
};

// Reads a department name safely whether it populated correctly, came back
// as a raw id (population failed/missing), or is simply absent.
const deptName = (emp) => {
  if (!emp) return '—';
  const d = emp.department;
  if (!d) return '—';
  if (typeof d === 'object') return d.name || '—';
  return String(d); // fallback: raw id string, better than crashing
};

const empName = (emp) => (emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || '—' : '—');

// ─── GET /reports/summary  (charts on the Reports page) ──────────────────────
router.get(
  '/summary',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    // Headcount growth – last 6 months.
    // Previously this filtered on `createdAt` (when the DB record was
    // created — not when the person actually joined) and on *current*
    // status for every past month, which silently dropped anyone who has
    // since resigned/been terminated from ALL months, even the ones where
    // they were genuinely employed. Fixed to use `dateOfJoining` and to
    // treat someone as "present" in a given month if they'd joined by then
    // and hadn't been offboarded yet (via Employee.offboardingDate).
    const usersTimeline = await User().aggregate([
      { $match: { dateOfJoining: { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: 'employees',
          localField: '_id',
          foreignField: 'user',
          as: 'employeeInfo',
        },
      },
      {
        $project: {
          dateOfJoining: 1,
          offboardingDate: { $arrayElemAt: ['$employeeInfo.offboardingDate', 0] },
        },
      },
    ]);

    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i, 1);
      d.setHours(0, 0, 0, 0);
      const label = d.toLocaleString('default', { month: 'short' });
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

      const count = usersTimeline.filter(u => {
        const hadJoinedByThen = u.dateOfJoining && new Date(u.dateOfJoining) <= endOfMonth;
        const stillPresentThen = !u.offboardingDate || new Date(u.offboardingDate) > endOfMonth;
        return hadJoinedByThen && stillPresentThen;
      }).length;

      months.push({ month: label, employees: count });
    }

    // Department distribution
    const deptAgg = await User().aggregate([
      { $match: { status: 'active' } },
      {
        $lookup: {
          from: 'departments',
          localField: 'department',
          foreignField: '_id',
          as: 'deptInfo',
        },
      },
      {
        $group: {
          _id: { $ifNull: [{ $arrayElemAt: ['$deptInfo.name', 0] }, 'Unknown'] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const total = deptAgg.reduce((s, d) => s + d.count, 0) || 1;
    const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];
    const deptDist = deptAgg.map((d, i) => ({
      name: d._id || 'Unknown',
      value: Math.round((d.count / total) * 100),
      count: d.count,
      fill: COLORS[i % COLORS.length],
    }));

    res.json({ success: true, data: { growth: months, deptDist } });
  })
);

// ─── GET /reports/headcount ───────────────────────────────────────────────────
router.get(
  '/headcount',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    // NOTE: previously this queried the `Employee` model for firstName/email/
    // department/joiningDate — those fields don't exist on `Employee`, they
    // live on `User` (Employee only holds HR-extension fields like
    // employeeType/workLocation). Switched to User + populated department.
    const employees = await User()
      .find({ status: 'active' })
      .select('firstName lastName email department position dateOfJoining status')
      .populate('department', 'name')
      .lean();

    const rows = employees.map(e => ({
      Name:              `${e.firstName} ${e.lastName}`,
      Email:             e.email,
      Department:        deptName(e),
      Designation:       e.position || '—',
      'Joining Date':    e.dateOfJoining ? new Date(e.dateOfJoining).toISOString().split('T')[0] : '—',
      Status:            e.status,
    }));

    const summary = {
      total_employees: rows.length,
      departments: new Set(employees.map(e => deptName(e)).filter(d => d !== '—')).size,
    };

    res.json({ success: true, data: { rows, summary } });
  })
);

// ─── GET /reports/attendance?startDate=&endDate= ─────────────────────────────
router.get(
  '/attendance',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const { start, end } = parseDateRange(req.query);

    const filter = {};
    if (start || end) {
      filter.date = {};
      if (start) filter.date.$gte = start;
      if (end)   filter.date.$lte = end;
    }

    const records = await Attendance()
      .find(filter)
      .populate(EMP_POPULATE)
      .lean();

    const rows = records.map(r => ({
      Employee:       empName(r.employee),
      Department:     deptName(r.employee),
      Date:           r.date ? new Date(r.date).toISOString().split('T')[0] : '—',
      // checkIn/checkOut are objects ({ time, location, method }) on the
      // Attendance schema, not Date values themselves — read `.time`.
      'Check In':     r.checkIn?.time  ? new Date(r.checkIn.time).toLocaleTimeString()  : '—',
      'Check Out':    r.checkOut?.time ? new Date(r.checkOut.time).toLocaleTimeString() : '—',
      Status:         r.status || '—',
      'Hours Worked': r.totalHours != null ? `${r.totalHours}h` : '—',
    }));

    const present  = rows.filter(r => r.Status === 'present').length;
    const absent   = rows.filter(r => r.Status === 'absent').length;
    const late     = rows.filter(r => r.Status === 'late').length;

    const summary = {
      total_records: rows.length,
      present,
      absent,
      late,
    };

    res.json({ success: true, data: { rows, summary } });
  })
);

// ─── GET /reports/payroll?startDate=&endDate= ────────────────────────────────
router.get(
  '/payroll',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const { start, end } = parseDateRange(req.query);

    const filter = { status: { $in: ['approved', 'paid', 'processed'] } };
    if (start || end) {
      filter['payPeriod.startDate'] = {};
      if (start) filter['payPeriod.startDate'].$gte = start;
      if (end)   filter['payPeriod.startDate'].$lte = end;
    }

    const records = await Payroll()
      .find(filter)
      .populate(EMP_POPULATE)
      .lean();

    const rows = records.map(r => ({
      Employee:       empName(r.employee),
      Department:     deptName(r.employee),
      'Pay Period':   r.payPeriod?.startDate ? new Date(r.payPeriod.startDate).toISOString().split('T')[0] : '—',
      'Basic Salary': r.earnings?.basicSalary != null ? r.earnings.basicSalary : '—',
      'Gross Earnings': r.grossEarnings != null ? r.grossEarnings : '—',
      Deductions:     r.totalDeductions != null ? r.totalDeductions : '—',
      'Net Pay':      r.netSalary != null ? r.netSalary : '—',
      Status:         r.status || '—',
    }));

    const totalNet        = records.reduce((s, r) => s + (r.netSalary || 0), 0);
    const totalDeductions = records.reduce((s, r) => s + (r.totalDeductions || 0), 0);
    const totalGross      = records.reduce((s, r) => s + (r.grossEarnings || 0), 0);

    const summary = {
      total_records:      rows.length,
      total_net_pay:      `PKR ${totalNet.toLocaleString()}`,
      total_deductions:   `PKR ${totalDeductions.toLocaleString()}`,
      total_gross_earnings: `PKR ${totalGross.toLocaleString()}`,
    };

    res.json({ success: true, data: { rows, summary } });
  })
);

// ─── GET /reports/leave?startDate=&endDate= ──────────────────────────────────
router.get(
  '/leave',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const { start, end } = parseDateRange(req.query);

    const filter = {};
    if (start || end) {
      filter.startDate = {};
      if (start) filter.startDate.$gte = start;
      if (end)   filter.startDate.$lte = end;
    }

    const records = await Leave()
      .find(filter)
      .populate(EMP_POPULATE)
      .lean();

    const rows = records.map(r => ({
      Employee:     empName(r.employee),
      Department:   deptName(r.employee),
      'Leave Type': r.leaveType || '—',
      'Start Date': r.startDate ? new Date(r.startDate).toISOString().split('T')[0] : '—',
      'End Date':   r.endDate   ? new Date(r.endDate).toISOString().split('T')[0]   : '—',
      Days:         r.numberOfDays != null ? r.numberOfDays : '—',
      Status:       r.status || '—',
      Reason:       r.reason || '—',
    }));

    const approved = rows.filter(r => r.Status === 'approved').length;
    const pending  = rows.filter(r => r.Status === 'pending').length;
    const rejected = rows.filter(r => r.Status === 'rejected').length;
    const totalDays = records.reduce((s, r) => s + (r.numberOfDays || 0), 0);

    const summary = {
      total_applications: rows.length,
      approved,
      pending,
      rejected,
      total_days_taken: totalDays,
    };

    res.json({ success: true, data: { rows, summary } });
  })
);

// ─── GET /reports/advances?startDate=&endDate= ───────────────────────────────
router.get(
  '/advances',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const Advance = () => mongoose.model('Advance');
    const { start, end } = parseDateRange(req.query);

    const filter = {};
    if (start || end) {
      filter.requestedAt = {};
      if (start) filter.requestedAt.$gte = start;
      if (end)   filter.requestedAt.$lte = end;
    }

    const records = await Advance()
      .find(filter)
      .populate(EMP_POPULATE)
      .populate('approvedBy', 'firstName lastName')
      .lean();

    const rows = records.map(r => ({
      Employee:       empName(r.employee),
      Department:     deptName(r.employee),
      Amount:         r.amount != null ? r.amount : '—',
      Status:         r.status || '—',
      'Requested On': r.requestedAt ? new Date(r.requestedAt).toISOString().split('T')[0] : '—',
      'Approved By':  r.approvedBy ? empName(r.approvedBy) : '—',
      'Approved On':  r.approvedAt ? new Date(r.approvedAt).toISOString().split('T')[0] : '—',
      'Deducted In':  (r.deductedIn?.month && r.deductedIn?.year)
        ? `${r.deductedIn.month}/${r.deductedIn.year}`
        : '—',
      Reason:         r.reason || '—',
    }));

    const totalAmount = records.reduce((s, r) => s + (r.amount || 0), 0);

    const summary = {
      total_requests: rows.length,
      total_amount:   `PKR ${totalAmount.toLocaleString()}`,
      pending:        rows.filter(r => r.Status === 'pending').length,
      approved:       rows.filter(r => r.Status === 'approved').length,
      deducted:       rows.filter(r => r.Status === 'deducted').length,
      rejected:       rows.filter(r => r.Status === 'rejected').length,
    };

    res.json({ success: true, data: { rows, summary } });
  })
);

// ─── GET /reports/loans?startDate=&endDate= ──────────────────────────────────
router.get(
  '/loans',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const Loan = () => mongoose.model('Loan');
    const { start, end } = parseDateRange(req.query);

    // Loan schema has no explicit "issued date" field, so we filter on createdAt
    const filter = {};
    if (start || end) {
      filter.createdAt = {};
      if (start) filter.createdAt.$gte = start;
      if (end)   filter.createdAt.$lte = end;
    }

    const records = await Loan()
      .find(filter)
      .populate(EMP_POPULATE)
      .lean();

    const rows = records.map(r => {
      const amountPaid = (r.totalRepaymentAmount || 0) - (r.remainingBalance || 0);
      return {
        Employee:            empName(r.employee),
        Department:          deptName(r.employee),
        'Loan Amount':       r.loanAmount != null ? r.loanAmount : '—',
        'Interest %':        r.interestPercentage != null ? r.interestPercentage : 0,
        'Total Repayment':   r.totalRepaymentAmount != null ? r.totalRepaymentAmount : '—',
        'Tenure (Months)':   r.tenureMonths != null ? r.tenureMonths : '—',
        'Monthly EMI':       r.monthlyEMI != null ? r.monthlyEMI : '—',
        'Amount Paid':       amountPaid,
        'Remaining Balance': r.remainingBalance != null ? r.remainingBalance : '—',
        Status:              r.status || '—',
        'Issued On':         r.createdAt ? new Date(r.createdAt).toISOString().split('T')[0] : '—',
      };
    });

    const totalDisbursed   = records.reduce((s, r) => s + (r.loanAmount || 0), 0);
    const totalOutstanding = records.reduce((s, r) => s + (r.remainingBalance || 0), 0);

    const summary = {
      total_loans:       rows.length,
      total_disbursed:   `PKR ${totalDisbursed.toLocaleString()}`,
      total_outstanding: `PKR ${totalOutstanding.toLocaleString()}`,
      active:            rows.filter(r => r.Status === 'active').length,
      fully_paid:        rows.filter(r => r.Status === 'fully_paid').length,
    };

    res.json({ success: true, data: { rows, summary } });
  })
);

// ─── GET /reports/earnings?startDate=&endDate= ───────────────────────────────
// NOTE: "Earning" here is business revenue/commission income attributed to a
// person — NOT employee payroll earnings. Kept as a distinct report so it
// doesn't get confused with the Payroll Summary report.
router.get(
  '/earnings',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const Earning = () => mongoose.model('Earning');
    const { start, end } = parseDateRange(req.query);

    const filter = { isActive: true };
    if (start || end) {
      filter.date = {};
      if (start) filter.date.$gte = start;
      if (end)   filter.date.$lte = end;
    }

    const records = await Earning().find(filter).lean();

    const rows = records.map(r => ({
      Date:            r.date ? new Date(r.date).toISOString().split('T')[0] : '—',
      Title:           r.title || '—',
      Person:          r.person?.name || '—',
      'Amount (PKR)':  r.amountPKR != null ? r.amountPKR : '—',
      'Amount (USD)':  r.amountUSD != null ? r.amountUSD : '—',
      'Commission %':  r.commissionPercent != null ? r.commissionPercent : '—',
      Description:     r.description || '—',
    }));

    const totalPKR = records.reduce((s, r) => s + (r.amountPKR || 0), 0);
    const totalUSD = records.reduce((s, r) => s + (r.amountUSD || 0), 0);

    const summary = {
      total_entries:     rows.length,
      total_amount_pkr:  `PKR ${totalPKR.toLocaleString()}`,
      total_amount_usd:  totalUSD ? `$${totalUSD.toLocaleString()}` : '—',
    };

    res.json({ success: true, data: { rows, summary } });
  })
);

// ─── GET /reports/expenses?startDate=&endDate= ───────────────────────────────
router.get(
  '/expenses',
  protect,
  managementOnly,
  asyncHandler(async (req, res) => {
    const Expense = () => mongoose.model('Expense');
    const { start, end } = parseDateRange(req.query);

    const filter = { isActive: true };
    if (start || end) {
      filter.date = {};
      if (start) filter.date.$gte = start;
      if (end)   filter.date.$lte = end;
    }

    const records = await Expense()
      .find(filter)
      .populate({
        path: 'linkedEmployee',
        select: 'firstName lastName department',
        populate: { path: 'department', select: 'name' },
      })
      .lean();

    const rows = records.map(r => ({
      Date:              r.date ? new Date(r.date).toISOString().split('T')[0] : '—',
      Title:             r.title || '—',
      Category:          r.category || '—',
      'Amount (PKR)':    r.amountPKR != null ? r.amountPKR : '—',
      'Amount (USD)':    r.amountUSD != null ? r.amountUSD : '—',
      'Paid By':         r.paidBy?.name || '—',
      'Linked Employee': r.linkedEmployee ? empName(r.linkedEmployee) : '—',
      Description:       r.description || '—',
    }));

    const totalPKR = records.reduce((s, r) => s + (r.amountPKR || 0), 0);

    // Category-wise breakdown so the summary card surfaces the biggest spend area
    const byCategory = {};
    records.forEach(r => {
      byCategory[r.category] = (byCategory[r.category] || 0) + (r.amountPKR || 0);
    });
    const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

    const summary = {
      total_expenses:   rows.length,
      total_amount_pkr: `PKR ${totalPKR.toLocaleString()}`,
      top_category:     topCategory ? `${topCategory[0]} (PKR ${topCategory[1].toLocaleString()})` : '—',
    };

    res.json({ success: true, data: { rows, summary } });
  })
);

module.exports = router;