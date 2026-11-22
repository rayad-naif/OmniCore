const express = require('express');
const payrollRouter = express.Router();
const {
  protect,
  adminOnly,
  hrAndAbove,
} = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const Payroll = require('../models/Payroll.model');
const User = require('../models/User.model');
const Advance = require('../models/Advance.model');
const Loan = require('../models/Loan.model');
const SalaryHold = require('../models/Salaryhold.model');
const PerformanceBonus = require('../models/PerformanceBonus.model');

const MONTHS = [
  '',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
// ─── Helper: count Mon–Sat working days in a month ────────────────────────────
function getWorkingDays(year, month) {
  // month is 1-indexed
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (day !== 0) count++; // exclude Sunday only (Mon–Sat = 6-day week)
  }
  return count;
}
// ─── GET /payroll — list with filters (active employees only) ─────────────────
payrollRouter.get(
  '/',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const {
      month,
      year,
      employeeId,
      status,
      page = 1,
      limit = 100,
    } = req.query;
    const query = {};

    if (month) query['payPeriod.month'] = parseInt(month);
    if (year) query['payPeriod.year'] = parseInt(year);
    if (status) query.status = status;

    if (req.user.role === 'employee') {
      query.employee = req.user._id;
    } else if (employeeId) {
      query.employee = employeeId;
    } else {
      // ✅ Only return payroll for ACTIVE employees — get their IDs first
      const activeUsers = await User.find({
        isActive: true,
        deletedAt: null,
      }).select('_id');
      query.employee = { $in: activeUsers.map((u) => u._id) };
    }

    const [records, _total] = await Promise.all([
      Payroll.find(query)
        .populate({
          path: 'employee',
          select:
            'firstName lastName employeeId department position isActive deletedAt',
          populate: { path: 'department', select: 'name' },
        })
        .sort({ 'payPeriod.year': -1, 'payPeriod.month': -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit)),
      Payroll.countDocuments(query),
    ]);

    // Extra safety — filter out any records where employee got deactivated after payroll was run
    const active = records.filter(
      (r) => r.employee?.isActive !== false && !r.employee?.deletedAt,
    );

    res.json({ success: true, data: active, total: active.length });
  }),
);

// ─── GET /payroll/trend ───────────────────────────────────────────────────────
payrollRouter.get(
  '/trend',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const now = new Date();
    const results = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();

      const agg = await Payroll.aggregate([
        {
          $match: {
            'payPeriod.month': m,
            'payPeriod.year': y,
            status: { $in: ['approved', 'processed', 'paid'] },
          },
        },
        {
          $group: {
            _id: null,
            gross: { $sum: '$grossEarnings' },
            net: { $sum: '$netSalary' },
            employees: { $sum: 1 },
          },
        },
      ]);

      results.push({
        month: MONTHS[m],
        gross: agg[0]?.gross ?? 0,
        net: agg[0]?.net ?? 0,
        employees: agg[0]?.employees ?? 0,
      });
    }

    res.json({ success: true, data: results });
  }),
);

// ─── GET /payroll/eligible — active employees with salary info ────────────────
// Used by "Run Payroll" modal to show who can be included
payrollRouter.get(
  '/eligible',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const { month, year } = req.query;

    // All employees still on the roster — explicitly exclude terminated and
    // resigned employees by status (rather than relying on the separate
    // isActive flag, which isn't guaranteed to be kept in sync with status).
    // Also exclude admin / super_admin accounts — they're not on payroll and
    // shouldn't show up in Run Payroll, Advance Salary, or Performance Bonus.
    const activeUsers = await User.find({
      deletedAt: null,
      status: { $nin: ['terminated', 'resigned'] },
      role: { $nin: ['admin', 'super_admin'] },
    })
      .populate('department', 'name')
      .select(
        'firstName lastName employeeId department position salary status',
      );

    // Which ones already have a payroll record this month
    const existing = await Payroll.find({
      'payPeriod.month': parseInt(month),
      'payPeriod.year': parseInt(year),
      employee: { $in: activeUsers.map((u) => u._id) },
    }).select('employee status');

    const existingMap = {};
    existing.forEach((p) => {
      existingMap[p.employee.toString()] = p.status;
    });

    const employees = activeUsers.map((u) => ({
      _id: u._id,
      name: `${u.firstName} ${u.lastName}`,
      employeeId: u.employeeId,
      dept: u.department?.name || '—',
      position: u.position || '—',
      basicSalary: u.salary?.basic || 0,
      existingStatus: existingMap[u._id.toString()] || null, // null = not yet processed
    }));

    res.json({ success: true, data: employees });
  }),
);

// ─── POST /payroll/run — calculate + save payroll for selected employees ───────
payrollRouter.post(
  '/run',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { employeeIds, month, year } = req.body;

    if (!employeeIds?.length || !month || !year) {
      return res.status(400).json({
        success: false,
        message: 'employeeIds, month, and year are required',
      });
    }

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const workingDays = getWorkingDays(parseInt(year), parseInt(month));
    const results = { created: [], updated: [], errors: [] };

    for (const empId of employeeIds) {
      try {
        const user = await User.findOne({
          _id: empId,
          deletedAt: null,
          status: { $nin: ['terminated', 'resigned'] },
          role: { $nin: ['admin', 'super_admin'] },
        }).populate('department', 'name');

        if (!user) {
          results.errors.push({
            empId,
            reason:
              'Employee not found, terminated, resigned, or not eligible for payroll (admin/super_admin)',
          });
          continue;
        }

        const basic = user.salary?.basic || 0;
        if (basic === 0) {
          results.errors.push({
            empId,
            reason: `No salary configured for ${user.firstName} ${user.lastName}`,
          });
          continue;
        }

        // ── 1. CALC PERFORMANCE BONUSES ────────────────────────────────────────
        const bonusRecords = await PerformanceBonus.find({
          employee: user._id,
          month: parseInt(month),
          year: parseInt(year),
          isProcessed: false,
        });

        const regularBonusRecords = bonusRecords.filter(
          (b) => b.bonusType !== 'released_hold',
        );
        const releasedHoldBonusRecords = bonusRecords.filter(
          (b) => b.bonusType === 'released_hold',
        );

        const totalPerformanceBonus = regularBonusRecords.reduce(
          (sum, b) => sum + b.amount,
          0,
        );
        const totalReleasedHoldAmount = releasedHoldBonusRecords.reduce(
          (sum, b) => sum + b.amount,
          0,
        );

        // ── 2. CALC LOAN DEDUCTIONS & EMI TRACKING ──────────────────────────────
        const activeLoan = await Loan.findOne({
          employee: user._id,
          status: 'active',
        });

        let monthlyLoanDeduction = 0;
        if (activeLoan) {
          monthlyLoanDeduction = Math.min(
            activeLoan.monthlyEMI || activeLoan.monthlyInstallment,
            activeLoan.remainingBalance || activeLoan.remainingAmount,
          );
        }

        // ── 2a. CALC ADVANCE SALARY DEDUCTIONS ──────────────────────────────────
        const approvedAdvances = await Advance.find({
          employee: user._id,
          status: 'approved',
        });

        let totalAdvanceDeduction = 0;
        const advanceDeductionPlan = [];
        for (const advance of approvedAdvances) {
          const deduction = advance.amount || 0;
          if (deduction <= 0) continue;
          totalAdvanceDeduction += deduction;
          advanceDeductionPlan.push({ advance, amount: deduction });
        }

        // ── 2b. CALC SALARY HOLD DEDUCTIONS ─────────────────────────────────────
        const activeSalaryHolds = await SalaryHold.find({
          employee: user._id,
          status: 'active',
          holdDate: { $lte: endDate },
          $or: [
            { endDate: { $exists: false } },
            { endDate: null },
            { endDate: { $gte: startDate } },
          ],
        });

        let totalSalaryHoldDeduction = 0;
        const salaryHoldDeductionPlan = [];
        for (const hold of activeSalaryHolds) {
          const deduction = Math.min(
            hold.monthlyDeduction,
            hold.remainingBalance,
          );
          if (deduction <= 0) continue;
          totalSalaryHoldDeduction += deduction;
          salaryHoldDeductionPlan.push({ hold, amount: deduction });
        }

        // ── 3. Unpaid leave deduction ──────────────────────────────────────────
        const Leave = require('../models/Leave.model');
        const unpaidLeaves = await Leave.find({
          employee: user._id,
          status: 'approved',
          leaveType: 'unpaid',
          startDate: { $lte: endDate },
          endDate: { $gte: startDate },
        });

        let unpaidLeaveDays = 0;
        for (const leave of unpaidLeaves) {
          const from =
            leave.startDate < startDate ? startDate : leave.startDate;
          const to = leave.endDate > endDate ? endDate : leave.endDate;
          for (
            let d = new Date(from);
            d <= to;
            d.setUTCDate(d.getUTCDate() + 1)
          ) {
            if (d.getUTCDay() !== 0) unpaidLeaveDays++;
          }
        }

        const perDaySalary = workingDays > 0 ? basic / workingDays : 0;
        const absentDeduction = Math.round(perDaySalary * unpaidLeaveDays);

        // ── 4. Build complete payroll record ──────────────────────────────────
        const payrollData = {
          employee: user._id,
          payPeriod: {
            month: parseInt(month),
            year: parseInt(year),
            startDate,
            endDate,
          },
          earnings: {
            basicSalary: basic,
            performanceBonus: totalPerformanceBonus,
            releasedHoldAmount: totalReleasedHoldAmount,
            otherEarnings: 0,
            houseRentAllowance: 0,
            conveyanceAllowance: 0,
            medicalAllowance: 0,
            overtimePay: 0,
            specialAllowance: 0,
          },
          deductions: {
            loanDeductions: monthlyLoanDeduction,
            advanceDeductions: totalAdvanceDeduction,
            salaryHoldDeduction: totalSalaryHoldDeduction,
            absentDeductions: absentDeduction,
            otherDeductions: 0,
            providentFund: 0,
            employeeStateInsurance: 0,
            professionalTax: 0,
            incomeTax: 0,
          },
          attendanceSummary: {
            totalWorkingDays: workingDays,
            presentDays: 0,
            absentDays: unpaidLeaveDays,
            leaveDays: unpaidLeaveDays,
            overtimeHours: 0,
            lateMarkings: 0,
          },
          status: 'draft',
          processedBy: req.user._id,
          loanSnapshot: activeLoan
            ? {
                loanAmount: activeLoan.loanAmount,
                interestPercentage: activeLoan.interestPercentage,
                remainingBalance: activeLoan.remainingBalance,
                tenureMonths: activeLoan.tenureMonths,
              }
            : undefined,
          advanceSnapshot: advanceDeductionPlan.map(({ advance, amount }) => ({
            advanceId: advance._id,
            amountDeducted: amount,
            reason: advance.reason || '',
            requestedAt: advance.requestedAt,
          })),
          salaryHoldSnapshot: salaryHoldDeductionPlan.map(
            ({ hold, amount }) => ({
              holdId: hold._id,
              amountDeducted: amount,
              totalHoldAmount: hold.amount,
              remainingAfter:
                Math.round((hold.remainingBalance - amount) * 100) / 100,
              reason: hold.reason || '',
            }),
          ),
        };

        // ── Upsert Check ───────────────────────────────────────────────────────
        const existing = await Payroll.findOne({
          employee: user._id,
          'payPeriod.month': parseInt(month),
          'payPeriod.year': parseInt(year),
        });

        let savedRecord;
        if (existing) {
          if (['approved', 'paid', 'processed'].includes(existing.status)) {
            results.errors.push({
              empId,
              reason: `${user.firstName} ${user.lastName}'s payroll is already ${existing.status} — skipped`,
            });
            continue;
          }
          Object.assign(existing, payrollData);
          savedRecord = await existing.save();
          results.updated.push(savedRecord);
        } else {
          const newRecord = new Payroll(payrollData);
          savedRecord = await newRecord.save();
          results.created.push(savedRecord);
        }

        // ── 5. POST-CALCULATION MUTATIONS ──────────────────────────────────────
        if (activeLoan && monthlyLoanDeduction > 0) {
          if (activeLoan.remainingBalance !== undefined) {
            activeLoan.remainingBalance -= monthlyLoanDeduction;
          } else {
            activeLoan.remainingAmount -= monthlyLoanDeduction;
          }

          if (activeLoan.deductionHistory) {
            activeLoan.deductionHistory.push({
              payrollId: savedRecord._id,
              amountDeducted: monthlyLoanDeduction,
              month: parseInt(month),
              year: parseInt(year),
            });
          }

          const currentBalance =
            activeLoan.remainingBalance !== undefined
              ? activeLoan.remainingBalance
              : activeLoan.remainingAmount;
          if (currentBalance <= 0) {
            activeLoan.status = 'fully_paid';
          }

          await activeLoan.save();
        }

        for (const { advance } of advanceDeductionPlan) {
          advance.status = 'deducted';
          advance.deductedIn = { month: parseInt(month), year: parseInt(year) };
          advance.payrollId = savedRecord._id;
          await advance.save();
        }

        for (const { hold, amount } of salaryHoldDeductionPlan) {
          hold.remainingBalance =
            Math.round((hold.remainingBalance - amount) * 100) / 100;
          hold.deductionHistory.push({
            payrollId: savedRecord._id,
            amountDeducted: amount,
            month: parseInt(month),
            year: parseInt(year),
          });
          if (hold.remainingBalance <= 0) {
            hold.remainingBalance = 0;
            hold.status = 'completed';
          }
          await hold.save();
        }

        if (salaryHoldDeductionPlan.length > 0) {
          const stillHasActiveHold = await SalaryHold.exists({
            employee: user._id,
            status: 'active',
          });
          if (!stillHasActiveHold) {
            if (user.salaryHold) {
              user.salaryHold.status = 'clear';
            } else if (user.employeeProfile?.salaryHold) {
              user.employeeProfile.salaryHold.status = 'clear';
            } else {
              user.salaryHold = { amount: 0, status: 'clear' };
            }
            await user.save();
          }
        }

        if (bonusRecords.length > 0) {
          await PerformanceBonus.updateMany(
            { _id: { $in: bonusRecords.map((b) => b._id) } },
            { isProcessed: true },
          );
        }
      } catch (err) {
        console.error(`[Payroll] Error processing ${empId}:`, err.message);
        results.errors.push({ empId, reason: err.message });
      }
    }

    res.status(201).json({
      success: true,
      data: results,
      message: `Payroll run complete — ${results.created.length} created, ${results.updated.length} updated, ${results.errors.length} errors`,
    });
  }),
);

payrollRouter.get(
  '/mine',
  protect,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 24 } = req.query;

    const records = await Payroll.find({ employee: req.user._id })
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeId department position',
        populate: { path: 'department', select: 'name' },
      })
      .sort({ 'payPeriod.year': -1, 'payPeriod.month': -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ success: true, data: records, total: records.length });
  }),
);

// ─── PATCH /payroll/:id/approve ───────────────────────────────────────────────
payrollRouter.patch(
  '/:id/approve',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const Expense = require('../models/Expense');
    const FinanceSetting = require('../models/FinanceSetting');

    const record = await Payroll.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', approvedBy: req.user._id, approvedAt: new Date() },
      { new: true },
    ).populate('employee', 'firstName lastName');

    if (!record)
      return res
        .status(404)
        .json({ success: false, message: 'Record not found' });

    // ── Auto-create / update an Employee Salary expense entry ──────────────────
    // When a payroll is approved, we upsert a single `employee_salary` expense
    // for that employee + month + year so the Finance > Expenses page reflects
    // the approved net salary without any manual entry.
    try {
      const { month, year } = record.payPeriod;
      const netAmount = record.netSalary || 0;
      const empName = record.employee
        ? `${record.employee.firstName} ${record.employee.lastName}`.trim()
        : 'Employee';

      // Fetch current USD rate from settings (best-effort; non-blocking)
      let usdRate = 0;
      try {
        const settings = await FinanceSetting.getSingleton();
        usdRate = settings.usdToPkrRate || 0;
      } catch (_) {
        /* silently ignore — rate is optional */
      }

      // Upsert: one salary expense per employee per month/year
      const existing = await Expense.findOne({
        category: 'employee_salary',
        month,
        year,
        linkedEmployee: record.employee?._id ?? null,
        isActive: true,
      });

      if (existing) {
        // Update in case the payroll figures changed before final approval
        existing.amountPKR = netAmount;
        existing.usdRateAtEntry = usdRate;
        existing.title = `Salary – ${empName}`;
        existing.description = `Auto-updated from approved payroll (${month}/${year})`;
        await existing.save();
      } else {
        await Expense.create({
          title: `Salary – ${empName}`,
          description: `Auto-created from approved payroll (${month}/${year})`,
          category: 'employee_salary',
          amountPKR: netAmount,
          usdRateAtEntry: usdRate,
          paidBy: { name: 'Payroll', userId: req.user._id },
          linkedEmployee: record.employee?._id ?? null,
          month,
          year,
          date: new Date(Date.UTC(year, month - 1, 1)),
          createdBy: req.user._id,
          needsReturn: false,
          isReturned: false,
          returnedAt: null,
          isActive: true,
        });
      }
    } catch (expErr) {
      // Approval itself already succeeded — log the expense error but don't
      // roll back or return 500; the payroll status is what the user cares about.
      console.error(
        '[Payroll Approve] Failed to auto-create salary expense:',
        expErr.message,
      );
    }

    res.json({ success: true, data: record });
  }),
);

// ─── PATCH /payroll/:id — update earnings/deductions manually ─────────────────
payrollRouter.patch(
  '/:id',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const { earnings, deductions, remarks, status } = req.body;

    const record = await Payroll.findById(req.params.id);
    if (!record)
      return res
        .status(404)
        .json({ success: false, message: 'Record not found' });

    if (earnings) Object.assign(record.earnings, earnings);
    if (deductions) Object.assign(record.deductions, deductions);
    if (remarks !== undefined) record.remarks = remarks;
    if (status) record.status = status;

    const saved = await record.save();
    res.json({ success: true, data: saved });
  }),
);

// ─── DELETE /payroll/:id — remove a payroll record ────────────────────────────
payrollRouter.delete(
  '/:id',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const record = await Payroll.findByIdAndDelete(req.params.id);
    if (!record)
      return res
        .status(404)
        .json({ success: false, message: 'Record not found' });
    res.json({
      success: true,
      message: 'Payroll record deleted',
      data: { _id: record._id },
    });
  }),
);

module.exports = payrollRouter;
