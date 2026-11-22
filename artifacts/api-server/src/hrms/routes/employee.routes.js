const express = require('express');
const { hrmsAppUrl } = require('../core/config');
const { currentTenantId } = require('../core/context');
const mongoose = require('../core/mongoose');
const router = express.Router();
const {
  protect,
  adminOnly,
  hrAndAbove,
} = require('../middleware/auth.middleware');
const { asyncHandler, AppError } = require('../utils/errorUtils');
const { sendEmail } = require('../services/notification/email.service');
const logger = require('../utils/logger');
const User = require('../models/User.model');
const Employee = require('../models/Employee.model');
const SalaryHold = require('../models/Salaryhold.model');
const Payroll = require('../models/Payroll.model');

const multer = require('multer');
const path = require('path');
const cloudinary = require('../core/cloudinaryShim').v2;
const { CloudinaryStorage } = require('../core/cloudinaryShim');

const PROCESSING_PAYROLL_STATUSES = ['draft', 'pending_approval'];
function currentPayPeriod() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}
// Avatar: stored on Cloudinary (same pattern as signed agreements below),
// so it survives Vercel's ephemeral filesystem and is served from a CDN URL.
const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, _file) => ({
    folder: 'gg-hrms/avatars',
    resource_type: 'image',
    public_id: `avatar-${req.params.id}-${Date.now()}`,
    // Center-crop/pad to a square thumbnail server-side as a safety net,
    // even though the client already crops before upload.
    transformation: [
      { width: 512, height: 512, crop: 'fill', gravity: 'face' },
    ],
    tags: ['avatar', `employee-${req.params.id}`],
  }),
});

const agreementStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const ext = path.extname(file.originalname); // e.g. ".pdf", ".docx", ".jpg"
    return {
      folder: 'gg-hrms/agreements',
      resource_type: 'raw', // explicit is safer than 'auto' for mixed doc types
      public_id: `agreement-${req.params.id}-${Date.now()}${ext}`,
      tags: ['agreement', `employee-${req.params.id}`],
    };
  },
});

const cnicStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'gg-hrms/cnic',
    resource_type: 'image',
    public_id: `cnic-${file.fieldname}-${req.params.id}-${Date.now()}`,
    tags: ['cnic', file.fieldname, `employee-${req.params.id}`],
  }),
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
});
const agreementUpload = multer({
  storage: agreementStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
});
const cnicUpload = multer({
  storage: cnicStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

router.get('/directory', protect, async (req, res) => {
  try {
    const { department, excludeSelf } = req.query;

    // Base filter: exclude deleted accounts and admin/super_admin roles so
    // employees only see other regular employees in the dropdown.
    const filter = {
      deletedAt: null,
      role: { $nin: ['admin', 'super_admin'] },
    };

    // If a department ID is provided, restrict to that department only.
    if (department) {
      filter.department = department;
    }

    let employees = await User.find(
      filter,
      'firstName lastName employeeId role department',
    )
      .populate('department', 'name code')
      .sort({ firstName: 1 })
      .lean();

    // Optionally exclude the requesting user themselves from the list.
    if (excludeSelf === 'true') {
      const currentUserId = String(req.user?._id || req.user?.id || '');
      employees = employees.filter((e) => String(e._id) !== currentUserId);
    }

    res.json({ data: employees });
  } catch (err) {
    res
      .status(500)
      .json({ message: err.message || 'Unable to load employee directory.' });
  }
});

// Birthday calendar data is deliberately limited to basic identity fields so
// every authenticated user can celebrate colleagues without receiving profiles.
router.get(
  '/birthdays',
  protect,
  asyncHandler(async (req, res) => {
    const employees = await User.find(
      {
        deletedAt: null,
        isActive: true,
        role: { $nin: ['admin', 'super_admin'] },
        dateOfBirth: { $ne: null },
      },
      'firstName lastName email avatar dateOfBirth',
    )
      .sort({ firstName: 1, lastName: 1 })
      .lean();
    res.json({ success: true, data: employees });
  }),
);

// GET all employees
router.get(
  '/',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const { search, role, department, page = 1, limit = 12 } = req.query;

    // 1. Initialize the query object and exclude admin & super_admin by default
    const query = {
      deletedAt: null,
      role: { $nin: ['admin', 'super_admin'] },
    };

    // 2. If a specific role filter is requested, override or refine it safely
    if (role) {
      if (['admin', 'super_admin'].includes(role)) {
        // If someone tries to explicitly search for an admin role, force empty results
        query.role = null;
      } else {
        query.role = role;
      }
    }

    if (department) query.department = department;

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
      ];
    }

    // Active employees float to the top, terminated/resigned sink to the
    // bottom — applied to the FULL matching set before pagination, so the
    // ordering holds across page boundaries (not just within one page).
    // The sort is stable, so within each status group employees stay in
    // newest-first order.
    const STATUS_SORT_ORDER = {
      active: 0,
      probation: 1,
      on_leave: 2,
      resigned: 3,
      terminated: 4,
    };

    const allMatchingEmployees = await User.find(query)
      .populate('department', 'name code')
      .sort({ createdAt: -1 })
      .lean();

    const sortedEmployees = allMatchingEmployees.sort(
      (a, b) =>
        (STATUS_SORT_ORDER[a.status] ?? 1) - (STATUS_SORT_ORDER[b.status] ?? 1),
    );

    const total = sortedEmployees.length;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 12;
    const startIdx = (pageNum - 1) * limitNum;
    const employees = sortedEmployees.slice(startIdx, startIdx + limitNum);

    // ── Attach live "Salary Hold" status ────────────────────────────────────
    // This reflects the simple, manually-toggled flag on the Employee profile
    // (Employee.salaryHold), which is what the Employee Management "Hold
    // Salary" panel reads and writes. It is intentionally independent from
    // the installment-based SalaryHold collection that Payroll's "Hold
    // Salary" (amount + time period) uses to actually deduct from paychecks —
    // toggling this flag never creates, cancels, or affects a payroll
    // deduction.
    const employeeIds = employees.map((e) => e._id);
    const employeeProfiles = await Employee.find({ user: { $in: employeeIds } })
      .select('user salaryHold')
      .lean();
    const flagByUser = {};
    const profileIdByUser = {};
    employeeProfiles.forEach((p) => {
      flagByUser[p.user.toString()] = p.salaryHold || {
        amount: 0,
        status: 'clear',
      };
      profileIdByUser[p.user.toString()] = p._id;
    });
    // Which of these employees have a salary hold currently being pulled by
    // this month's (not-yet-finalized) payroll run.
    const { month: currentMonth, year: currentYear } = currentPayPeriod();
    const processingPayrolls = await Payroll.find({
      employee: { $in: employeeIds },
      'payPeriod.month': currentMonth,
      'payPeriod.year': currentYear,
      status: { $in: PROCESSING_PAYROLL_STATUSES },
      'salaryHoldSnapshot.0': { $exists: true },
    })
      .select('employee')
      .lean();
    const processingEmployeeIds = new Set(
      processingPayrolls.map((p) => p.employee.toString()),
    );
    const employeesWithHoldStatus = employees.map((e) => {
      const flag = flagByUser[e._id.toString()] || {
        amount: 0,
        status: 'clear',
      };
      // Employee.salaryHold.status is stored as 'clear' | 'not_clear' — the API
      // response keeps using 'on_hold' here for the frontend's on/off checks.
      const isOnHold = flag.status === 'not_clear';
      const isProcessing =
        isOnHold && processingEmployeeIds.has(e._id.toString());
      return {
        ...e,
        // Station.assignedEmployees (and other station-related flows) reference
        // the Employee profile _id, not the User _id — expose it here so the
        // frontend can assign employees to a PC/station using the right ID.
        employeeProfileId: profileIdByUser[e._id.toString()] || null,
        salaryHoldStatus: isProcessing
          ? 'processing'
          : isOnHold
            ? 'on_hold'
            : 'clear',
        salaryHoldRemaining: isOnHold ? flag.amount || 0 : 0,
        salaryHoldDate: isOnHold ? flag.holdDate || null : null,
        salaryHoldReason: flag.reason || '',
      };
    });

    res.json({
      success: true,
      data: employeesWithHoldStatus,
      total,
      page: pageNum,
    });
  }),
);
// GET single employee
router.get(
  '/:id',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)
      .populate('department')
      .populate('reportingManager', 'firstName lastName email');
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: 'Employee not found' });

    const employee = await Employee.findOne({ user: req.params.id });
    res.json({
      success: true,
      data: { ...user.toObject(), employeeProfile: employee },
    });
  }),
);

// POST create employee
router.post(
  '/',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    // No shared default password: a random one is generated and sent in the welcome email.
    const {
      password = `${require('crypto').randomBytes(9).toString('base64url')}aA1!`,
      shift,
      roles,
      permissions,
      refreshToken: _refreshToken,
      passwordResetToken: _passwordResetToken,
      passwordResetExpires: _passwordResetExpires,
      ...rest
    } = req.body;
    const userPayload = { ...rest, password };
    if (roles)
      userPayload.roles = Array.isArray(roles)
        ? roles
        : roles
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean);
    if (permissions)
      userPayload.permissions = Array.isArray(permissions)
        ? permissions
        : permissions
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);

    const user = await User.create(userPayload);
    const employeePayload = {
      user: user._id,
      shift: {
        type: shift?.type || 'morning',
        startTime: shift?.startTime || '09:00',
        endTime: shift?.endTime || '18:00',
        workMode: shift?.workMode || 'office',
        breakEnabled:
          shift?.breakEnabled !== undefined ? shift.breakEnabled : true,
        breakDurationMinutes: Number(shift?.breakDurationMinutes || 60),
      },
      salaryHold: req.body.salaryHold || undefined,
      freelanceCredentials: req.body.freelanceCredentials || [],
    };
    await Employee.create(employeePayload);

    await user.populate('department', 'name');
    const plainPassword = password;
    const joiningDate = user.dateOfJoining
      ? new Date(user.dateOfJoining).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null;

    sendEmail({
      to: user.email,
      template: 'newEmployee',
      data: {
        name: `${user.firstName} ${user.lastName}`,
        employeeId: user.employeeId || '—',
        email: user.email,
        password: plainPassword,
        department: user.department?.name || null,
        position: user.position || null,
        dateOfJoining: joiningDate,
        loginUrl: `${hrmsAppUrl()}/login?w=${currentTenantId()}`,
      },
    }).catch((err) => {
      logger.warn(`Welcome email failed for ${user.email}: ${err.message}`);
    });

    res.status(201).json({
      success: true,
      data: user,
      message: 'Employee created successfully',
    });
  }),
);

// PUT update employee
router.put(
  '/:id',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const {
      password,
      shift,
      salaryHold,
      freelanceCredentials,
      roles,
      permissions,
      reason,
      ...updateData
    } = req.body;
    const userPayload = { ...updateData };
    if (roles !== undefined) {
      userPayload.roles = Array.isArray(roles)
        ? roles
        : roles
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean);
    }
    if (permissions !== undefined) {
      userPayload.permissions = Array.isArray(permissions)
        ? permissions
        : permissions
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);
    }

    const user = await User.findByIdAndUpdate(req.params.id, userPayload, {
      new: true,
      runValidators: true,
    });
    if (!user) throw new AppError('Employee not found.', 404);

    const employeeUpdate = {
      ...(shift
        ? {
            'shift.type': shift.type || 'morning',
            'shift.startTime': shift.startTime || '09:00',
            'shift.endTime': shift.endTime || '18:00',
            'shift.workMode': shift.workMode || 'office',
            'shift.breakEnabled':
              shift.breakEnabled !== undefined ? shift.breakEnabled : true,
            'shift.breakDurationMinutes': Number(
              shift.breakDurationMinutes || 60,
            ),
          }
        : {}),
      ...(salaryHold !== undefined
        ? {
            'salaryHold.amount': Number(salaryHold.amount || 0),
            'salaryHold.status': salaryHold.status || 'clear',
          }
        : {}),
      // The Edit Employee modal exposes a plain "Reason" field that's really
      // the reason behind the employee's current salary-hold flag — it doesn't
      // touch amount/status, so it's handled independently of `salaryHold` above.
      ...(reason !== undefined ? { 'salaryHold.reason': reason } : {}),
      ...(freelanceCredentials !== undefined ? { freelanceCredentials } : {}),
    };

    await Employee.findOneAndUpdate(
      { user: req.params.id },
      { $set: employeeUpdate },
      { new: true, upsert: true, runValidators: true },
    );

    res.json({ success: true, data: user });
  }),
);

router.patch(
  '/:id/status',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!status) throw new AppError('Status is required.', 400);
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true },
    );
    if (!user) throw new AppError('Employee not found.', 404);
    res.json({ success: true, data: user });
  }),
);

router.patch(
  '/:id/salary-hold',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const { amount, status } = req.body;
    if (amount === undefined || !status)
      throw new AppError('Salary hold amount and status are required.', 400);
    const employee = await Employee.findOneAndUpdate(
      { user: req.params.id },
      {
        $set: {
          'salaryHold.amount': Number(amount),
          'salaryHold.status': status,
        },
      },
      { new: true, upsert: true, runValidators: true },
    );
    if (!employee) throw new AppError('Employee profile not found.', 404);
    res.json({ success: true, data: employee });
  }),
);

// ─── Installment-based salary holds (new) ──────────────────────────────────
// These are separate, time-bound deductions that payroll/run pulls from
// automatically each month, distinct from the single 'salaryHold' flag above.

// GET all salary holds for one employee (active + history)
// GET all salary holds for one employee (active + history)
router.get(
  '/:id/salary-holds',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const holds = await SalaryHold.find({ employee: req.params.id }).sort({
      createdAt: -1,
    });

    // Flag any hold that this month's (not-yet-finalized) payroll run has
    // already pulled a deduction from — these are locked from editing/
    // cancelling until that run is approved.
    const { month: currentMonth, year: currentYear } = currentPayPeriod();
    const processingPayroll = await Payroll.findOne({
      employee: req.params.id,
      'payPeriod.month': currentMonth,
      'payPeriod.year': currentYear,
      status: { $in: PROCESSING_PAYROLL_STATUSES },
    })
      .select('salaryHoldSnapshot')
      .lean();

    const processingHoldIds = new Set(
      (processingPayroll?.salaryHoldSnapshot || []).map((s) =>
        s.holdId?.toString(),
      ),
    );

    const holdsWithProcessing = holds.map((h) => {
      const obj = h.toObject();
      obj.isProcessing =
        h.status === 'active' && processingHoldIds.has(h._id.toString());
      return obj;
    });

    res.json({ success: true, data: holdsWithProcessing });
  }),
);

// Calculate how many whole months a hold period spans. Partial trailing
// days count as one additional month, and every hold spans at least 1 month.
// e.g. Jan 10 -> Mar 5   = 2 months (Jan 10-Feb 10, Feb 10-Mar 5 partial -> rounds up)
//      Jan 10 -> Mar 10  = 2 months (exact)
function calculateHoldDurationMonths(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  let months =
    (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (e.getDate() > s.getDate()) months += 1;
  return Math.max(1, months);
}

// POST create a new salary hold
router.post(
  '/:id/salary-holds',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { amount, startDate, endDate, reason } = req.body;

    if (amount === undefined || amount === null || Number(amount) <= 0) {
      throw new AppError('A valid hold amount is required.', 400);
    }
    if (!startDate || !endDate) {
      throw new AppError('A start date and end date are required.', 400);
    }

    const startDateTime = new Date(startDate);
    const endDateTime = new Date(endDate);
    if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
      throw new AppError('Invalid start or end date.', 400);
    }
    if (endDateTime <= startDateTime) {
      throw new AppError('End date must be after the start date.', 400);
    }

    const user = await User.findById(req.params.id);
    if (!user) throw new AppError('Employee not found.', 404);

    const basicSalary = user.salary?.basic || 0;
    if (basicSalary <= 0) {
      throw new AppError(
        'This employee has no basic salary configured; cannot place a hold.',
        400,
      );
    }

    const holdAmount = Number(amount);

    // Hard rule: a hold can never exceed the employee's basic salary
    if (holdAmount > basicSalary) {
      throw new AppError(
        `Hold amount (${holdAmount}) cannot exceed the employee's basic salary (${basicSalary}).`,
        400,
      );
    }

    // Also guard against stacking holds beyond the basic salary, in case
    // another hold is already active for this employee
    const existingActive = await SalaryHold.find({
      employee: req.params.id,
      status: 'active',
    });
    const alreadyHeld = existingActive.reduce(
      (sum, h) => sum + (h.remainingBalance || 0),
      0,
    );
    if (alreadyHeld + holdAmount > basicSalary) {
      throw new AppError(
        `Combined active holds (${alreadyHeld + holdAmount}) would exceed basic salary (${basicSalary}).`,
        400,
      );
    }

    // Duration and monthly installment are derived from the selected date range,
    // not entered manually by the admin.
    const duration = calculateHoldDurationMonths(startDateTime, endDateTime);
    const monthlyDeduction = Math.round((holdAmount / duration) * 100) / 100;

    const hold = await SalaryHold.create({
      employee: req.params.id,
      amount: holdAmount,
      holdDate: startDateTime,
      endDate: endDateTime,
      durationMonths: duration,
      monthlyDeduction,
      remainingBalance: holdAmount,
      reason: reason || '',
      status: 'active',
      createdBy: req.user._id,
    });

    // Sync the simple Employee.salaryHold flag so Employee Management
    // immediately reflects this payroll hold in the list view, detail view,
    // and Hold Status / Salary Hold columns without needing a separate sync.
    // Re-query all active holds after insert so the synced amount is the
    // true aggregate remaining balance (handles multiple holds correctly).
    const allActiveHolds = await SalaryHold.find({
      employee: req.params.id,
      status: 'active',
    });
    const aggregateRemaining = allActiveHolds.reduce(
      (sum, h) => sum + (h.remainingBalance || 0),
      0,
    );
    await Employee.findOneAndUpdate(
      { user: req.params.id },
      {
        $set: {
          'salaryHold.amount': aggregateRemaining,
          'salaryHold.status': 'not_clear',
          'salaryHold.holdDate': startDateTime,
          'salaryHold.reason': reason || '',
        },
      },
      { new: true, upsert: true },
    );

    res.status(201).json({
      success: true,
      data: hold,
      message: 'Salary hold created successfully',
    });
  }),
);

// PATCH mark an employee's salary as CLEAR (toggle in the Employee
// Management Hold Salary panel)
router.patch(
  '/:id/salary-holds/clear',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError('Employee not found.', 404);

    const employee = await Employee.findOneAndUpdate(
      { user: req.params.id },
      {
        $set: {
          'salaryHold.amount': 0,
          'salaryHold.status': 'clear',
          'salaryHold.holdDate': null,
          'salaryHold.reason': '',
        },
      },
      { new: true, upsert: true, runValidators: true },
    );

    res.json({
      success: true,
      data: { salaryHold: employee.salaryHold },
      message: 'Salary marked as clear',
    });
  }),
);

// PATCH mark an employee's salary as NOT CLEAR / on hold (toggle in the
// Employee Management Hold Salary panel)
router.patch(
  '/:id/salary-holds/hold',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError('Employee not found.', 404);

    const existingProfile = await Employee.findOne({
      user: req.params.id,
    }).select('salaryHold');
    const fallbackAmount =
      existingProfile?.salaryHold?.amount || user.salary?.basic || 0;
    const amount =
      req.body.amount !== undefined ? Number(req.body.amount) : fallbackAmount;

    if (!amount || isNaN(amount) || amount <= 0) {
      throw new AppError('A valid hold amount is required.', 400);
    }

    const holdDate = req.body.holdDate
      ? new Date(req.body.holdDate)
      : new Date();

    const employee = await Employee.findOneAndUpdate(
      { user: req.params.id },
      {
        $set: {
          'salaryHold.amount': amount,
          'salaryHold.status': 'not_clear',
          'salaryHold.holdDate': holdDate,
          'salaryHold.reason': req.body.reason || '',
        },
      },
      { new: true, upsert: true, runValidators: true },
    );

    res.json({
      success: true,
      data: { salaryHold: employee.salaryHold },
      message: 'Salary marked as not clear',
    });
  }),
);

// PATCH edit an active salary hold's amount / end date / reason.
// Duration and monthly installment are re-derived from the (possibly new)
// end date. The amount can't be dropped below what has already been
// deducted, and the remaining balance is recalculated from it so future
// payroll runs pull the right monthly figure.
router.patch(
  '/:id/salary-holds/:holdId',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.holdId)) {
      throw new AppError('Invalid salary hold ID.', 400);
    }

    const { amount, endDate, reason } = req.body;

    const hold = await SalaryHold.findOne({
      _id: req.params.holdId,
      employee: req.params.id,
    });
    if (!hold) throw new AppError('Salary hold not found.', 404);
    if (hold.status !== 'active')
      throw new AppError(
        `Only active holds can be edited (this one is ${hold.status}).`,
        400,
      );

    const { month: currentMonth, year: currentYear } = currentPayPeriod();
    const processingPayroll = await Payroll.findOne({
      employee: req.params.id,
      'payPeriod.month': currentMonth,
      'payPeriod.year': currentYear,
      status: { $in: PROCESSING_PAYROLL_STATUSES },
      'salaryHoldSnapshot.holdId': hold._id,
    });
    if (processingPayroll) {
      throw new AppError(
        "This salary hold is currently being processed in this month's payroll run and cannot be edited until that run is approved.",
        400,
      );
    }

    const user = await User.findById(req.params.id);
    if (!user) throw new AppError('Employee not found.', 404);
    const basicSalary = user.salary?.basic || 0;

    const alreadyDeducted =
      Math.round(((hold.amount || 0) - (hold.remainingBalance || 0)) * 100) /
      100;

    let newAmount = hold.amount;
    if (amount !== undefined && amount !== null && amount !== '') {
      newAmount = Number(amount);
      if (isNaN(newAmount) || newAmount <= 0)
        throw new AppError('Hold amount must be greater than 0.', 400);
      if (newAmount < alreadyDeducted) {
        throw new AppError(
          `Amount cannot be less than what has already been deducted (${alreadyDeducted}).`,
          400,
        );
      }
      if (basicSalary > 0 && newAmount > basicSalary) {
        throw new AppError(
          `Hold amount cannot exceed the employee's basic salary (${basicSalary}).`,
          400,
        );
      }
      // Also guard against stacking with any other active holds
      const otherActive = await SalaryHold.find({
        employee: req.params.id,
        status: 'active',
        _id: { $ne: hold._id },
      });
      const otherRemaining = otherActive.reduce(
        (sum, h) => sum + (h.remainingBalance || 0),
        0,
      );
      if (basicSalary > 0 && otherRemaining + newAmount > basicSalary) {
        throw new AppError(
          `Combined active holds (${otherRemaining + newAmount}) would exceed basic salary (${basicSalary}).`,
          400,
        );
      }
    }

    let newEndDate = hold.endDate;
    if (endDate) {
      newEndDate = new Date(endDate);
      if (isNaN(newEndDate.getTime()))
        throw new AppError('Invalid end date.', 400);
      if (newEndDate <= new Date(hold.holdDate))
        throw new AppError('End date must be after the start date.', 400);
    }

    const duration = calculateHoldDurationMonths(hold.holdDate, newEndDate);
    const remainingBalance =
      Math.round((newAmount - alreadyDeducted) * 100) / 100;
    const monthlyDeduction =
      Math.round((remainingBalance / duration) * 100) / 100;

    hold.amount = newAmount;
    hold.endDate = newEndDate;
    hold.durationMonths = duration;
    hold.monthlyDeduction = monthlyDeduction;
    hold.remainingBalance = remainingBalance;
    if (reason !== undefined) hold.reason = reason;
    hold.updatedBy = req.user._id;
    await hold.save();

    // Re-sync the simple Employee.salaryHold flag from the fresh aggregate
    const allActiveHolds = await SalaryHold.find({
      employee: req.params.id,
      status: 'active',
    });
    const aggregateRemaining = allActiveHolds.reduce(
      (sum, h) => sum + (h.remainingBalance || 0),
      0,
    );
    await Employee.findOneAndUpdate(
      { user: req.params.id },
      {
        $set: {
          'salaryHold.amount': aggregateRemaining,
          'salaryHold.status': aggregateRemaining > 0 ? 'not_clear' : 'clear',
        },
      },
    );

    res.json({
      success: true,
      data: hold,
      message: 'Salary hold updated successfully',
    });
  }),
);

// PATCH cancel an active salary hold (stops future deductions; past deductions stand)
router.patch(
  '/:id/salary-holds/:holdId/cancel',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.holdId)) {
      throw new AppError('Invalid salary hold ID.', 400);
    }

    const hold = await SalaryHold.findOne({
      _id: req.params.holdId,
      employee: req.params.id,
    });
    if (!hold) throw new AppError('Salary hold not found.', 404);
    if (hold.status !== 'active')
      throw new AppError(`Hold is already ${hold.status}.`, 400);

    const { month: currentMonth, year: currentYear } = currentPayPeriod();
    const processingPayroll = await Payroll.findOne({
      employee: req.params.id,
      'payPeriod.month': currentMonth,
      'payPeriod.year': currentYear,
      status: { $in: PROCESSING_PAYROLL_STATUSES },
      'salaryHoldSnapshot.holdId': hold._id,
    });
    if (processingPayroll) {
      throw new AppError(
        "This salary hold is currently being processed in this month's payroll run and cannot be cancelled until that run is approved.",
        400,
      );
    }

    hold.status = 'cancelled';
    hold.cancelledBy = req.user._id;
    hold.cancelledAt = new Date();
    await hold.save();

    hold.status = 'cancelled';
    hold.cancelledBy = req.user._id;
    hold.cancelledAt = new Date();
    await hold.save();

    // Re-sync the simple Employee.salaryHold flag — if no other active holds
    // remain, this drops the employee back to "clear" in Employee Management.
    const allActiveHolds = await SalaryHold.find({
      employee: req.params.id,
      status: 'active',
    });
    const aggregateRemaining = allActiveHolds.reduce(
      (sum, h) => sum + (h.remainingBalance || 0),
      0,
    );
    await Employee.findOneAndUpdate(
      { user: req.params.id },
      {
        $set: {
          'salaryHold.amount': aggregateRemaining,
          'salaryHold.status': aggregateRemaining > 0 ? 'not_clear' : 'clear',
        },
      },
    );

    res.json({ success: true, data: hold, message: 'Salary hold cancelled' });
  }),
);

router.patch(
  '/:id/credentials',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const {
      application,
      loginUrl,
      usernameOrEmail,
      password,
      twoFactorAuthentication,
      securityQa,
      notes,
    } = req.body;
    if (!application || !usernameOrEmail || !password) {
      throw new AppError(
        'Application, username or email, and password are required.',
        400,
      );
    }
    const employee = await Employee.findOneAndUpdate(
      { user: req.params.id },
      {
        $push: {
          freelanceCredentials: {
            application,
            loginUrl,
            usernameOrEmail,
            password,
            twoFactorAuthentication,
            securityQa,
            notes,
          },
        },
      },
      { new: true, upsert: true, runValidators: true },
    );
    res.json({ success: true, data: employee });
  }),
);

router.delete(
  '/:id/credentials/:credId',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const employee = await Employee.findOneAndUpdate(
      { user: req.params.id },
      { $pull: { freelanceCredentials: { _id: req.params.credId } } },
      { new: true },
    );
    if (!employee) throw new AppError('Employee profile not found.', 404);
    res.json({ success: true, data: employee });
  }),
);

router.post(
  '/:id/agreement',
  protect,
  hrAndAbove,
  (req, res, next) => {
    agreementUpload.single('agreement')(req, res, (err) => {
      if (err) {
        console.error('MULTER/CLOUDINARY ERROR:', err);
        return res.status(500).json({ success: false, message: err.message });
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file)
      throw new AppError('Signed agreement file is required.', 400);
    const fileRecord = {
      url: req.file.path,
      publicId: req.file.filename,
      originalName: req.file.originalname,
      uploadedAt: new Date(),
    };
    const employee = await Employee.findOneAndUpdate(
      { user: req.params.id },
      { $set: { signedAgreement: fileRecord } },
      { new: true, upsert: true },
    );
    res.json({ success: true, data: employee });
  }),
);

router.post(
  '/:id/cnic',
  protect,
  hrAndAbove,
  (req, res, next) => {
    cnicUpload.fields([
      { name: 'cnicFront', maxCount: 1 },
      { name: 'cnicBack', maxCount: 1 },
    ])(req, res, (err) => {
      if (err) {
        console.error('CNIC UPLOAD ERROR:', err);
        return res.status(500).json({ success: false, message: err.message });
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const front = req.files?.cnicFront?.[0];
    const back = req.files?.cnicBack?.[0];
    if (!front || !back)
      throw new AppError('Both CNIC front and back images are required.', 400);

    const fileRecord = (file) => ({
      url: file.path,
      publicId: file.filename,
      originalName: file.originalname,
      uploadedAt: new Date(),
    });
    const employee = await Employee.findOneAndUpdate(
      { user: req.params.id },
      {
        $set: {
          cnicImages: { front: fileRecord(front), back: fileRecord(back) },
        },
      },
      { new: true, upsert: true, runValidators: true },
    );
    res.json({ success: true, data: employee });
  }),
);

router.patch(
  '/:id/roles',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { roles } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        roles: Array.isArray(roles)
          ? roles
          : (roles || '')
              .split(',')
              .map((r) => r.trim())
              .filter(Boolean),
      },
      { new: true, runValidators: true },
    );
    if (!user) throw new AppError('Employee not found.', 404);
    res.json({ success: true, data: user });
  }),
);

router.patch(
  '/:id/permissions',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { permissions } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        permissions: Array.isArray(permissions)
          ? permissions
          : (permissions || '')
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean),
      },
      { new: true, runValidators: true },
    );
    if (!user) throw new AppError('Employee not found.', 404);
    res.json({ success: true, data: user });
  }),
);

// DELETE (soft) employee
router.delete(
  '/:id',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, {
      isActive: false,
      deletedAt: new Date(),
    });
    res.json({ success: true, message: 'Employee deactivated' });
  }),
);

// POST upload avatar
router.post(
  '/:id/avatar',
  protect,
  (req, res, next) => {
    avatarUpload.single('avatar')(req, res, (err) => {
      if (err) {
        console.error('AVATAR UPLOAD ERROR:', err);
        return res.status(500).json({ success: false, message: err.message });
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Profile picture file is required.', 400);
    // req.file.path is the secure Cloudinary URL when using CloudinaryStorage
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { avatar: req.file.path },
      { new: true },
    );
    if (!user) throw new AppError('Employee not found.', 404);
    res.json({ success: true, data: { avatar: user.avatar } });
  }),
);

router.patch(
  '/:id/clear-salary-hold',
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    // Find any ongoing active salary hold record for this employee
    const activeHold = await SalaryHold.findOne({
      employee: req.params.id,
      status: 'active',
    });

    if (!activeHold) {
      return res.status(404).json({
        success: false,
        message: 'No active salary hold record found for this employee.',
      });
    }

    // Manually update status to completed and clear remaining balances
    activeHold.status = 'completed';
    activeHold.remainingBalance = 0;
    await activeHold.save();

    res.json({
      success: true,
      message: 'Salary hold status updated to Clear successfully.',
    });
  }),
);
// GET current logged-in user's own profile
router.get(
  '/me/profile',
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)
      .populate('department')
      .populate('reportingManager', 'firstName lastName email');
    if (!user) throw new AppError('User not found.', 404);

    const employee = await Employee.findOne({ user: req.user._id });
    res.json({
      success: true,
      data: { ...user.toObject(), employeeProfile: employee },
    });
  }),
);

// PUT update own PERSONAL info only — never employment/role/salary fields
router.put(
  '/me/profile',
  protect,
  asyncHandler(async (req, res) => {
    const ALLOWED_FIELDS = ['firstName', 'lastName', 'phone', 'bio'];
    const updateData = {};
    ALLOWED_FIELDS.forEach((field) => {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    });
    if (req.body.address !== undefined) {
      updateData['address.city'] = req.body.address;
    }
    if (req.body.dateOfBirth !== undefined) {
      updateData.dateOfBirth = req.body.dateOfBirth || null;
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateData },
      { new: true, runValidators: true },
    )
      .populate('department')
      .populate('reportingManager', 'firstName lastName email');

    if (!user) throw new AppError('User not found.', 404);
    res.json({
      success: true,
      data: user,
      message: 'Profile updated successfully',
    });
  }),
);

module.exports = router;
