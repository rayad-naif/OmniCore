const express = require('express');
const router = express.Router();
const { protect, managementOnly } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const User = require('../models/User.model');
const PerformanceReview = require('../models/Performance.model');
const Attendance = require('../models/Attendance.model');
const Leave = require('../models/Leave.model');
const Payroll = require('../models/Payroll.model');

router.get('/admin', protect, managementOnly, asyncHandler(async (req, res) => {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  const activeFilter = {
    isActive: true,
    deletedAt: null,
    status: { $nin: ['terminated', 'resigned'] },
    role: { $nin: ['admin', 'super_admin'] },
  };

  const [totalEmployees, presentToday, employeesOnLeave, monthlyPayrollTotal, departmentDistribution] = await Promise.all([
    User.countDocuments(activeFilter),
    Attendance.countDocuments({
      date: { $gte: todayStart, $lte: todayEnd },
      status: { $in: ['present', 'late', 'working', 'work_from_home'] },
    }),
    Leave.countDocuments({
      employee: { $in: (await User.find(activeFilter).select('_id')).map(u => u._id) },
      status: 'approved',
      startDate: { $lte: todayEnd },
      endDate: { $gte: todayStart },
    }),
    Payroll.aggregate([
      {
        $match: {
          'payPeriod.month': todayStart.getMonth() + 1,
          'payPeriod.year': todayStart.getFullYear(),
          status: { $in: ['approved', 'processed', 'paid'] },
        },
      },
      { $group: { _id: null, net: { $sum: '$netSalary' } } },
    ]),
    User.aggregate([
      { $match: activeFilter },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $lookup: {
          from: 'departments',
          localField: '_id',
          foreignField: '_id',
          as: 'department',
        },
      },
      { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
      { $project: { name: { $ifNull: ['$department.name', 'Unassigned'] }, count: 1 } },
      { $sort: { count: -1, name: 1 } },
    ]),
  ]);

  const payrollTrend = [];
  const year = today.getFullYear();
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  for (let m = 1; m <= 12; m++) {
    const agg = await Payroll.aggregate([
      {
        $match: {
          'payPeriod.month': m,
          'payPeriod.year': year,
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

    payrollTrend.push({
      month: monthNames[m - 1],
      gross: agg[0]?.gross ?? 0,
      net: agg[0]?.net ?? 0,
      employees: agg[0]?.employees ?? 0,
    });
  }

  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#fb7185', '#f97316', '#38bdf8', '#a78bfa'];
  const departmentDistributionWithColors = departmentDistribution.map((d, index) => ({
    name: d.name,
    value: d.count,
    count: d.count,
    color: colors[index % colors.length],
  }));

  res.json({
    success: true,
    data: {
      totalEmployees,
      presentToday,
      activeJobs: 47,
      monthlyPayrollTotal: monthlyPayrollTotal[0]?.net || 0,
      employeesOnLeave,
      departmentDistribution: departmentDistributionWithColors,
      payrollTrend,
    },
  });
}));

router.get('/manager', protect, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { teamSize: 12, pendingLeaves: 3, upcomingReviews: 5 } });
}));

router.get('/employee', protect, asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  // Days present this month
  const daysPresent = await Attendance.countDocuments({
    employee: req.user._id,
    date: { $gte: startOfMonth, $lte: endOfMonth },
    status: { $in: ['present', 'late', 'work_from_home'] },
  });

  // Days absent this month (marked absent on working days)
  const daysAbsent = await Attendance.countDocuments({
    employee: req.user._id,
    date: { $gte: startOfMonth, $lte: endOfMonth },
    status: 'absent',
  });

  // ✅ Working days in month (Mon–SAT, 6-day week)
  let workingDays = 0;
  for (let d = new Date(startOfMonth); d <= now; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0) workingDays++; // exclude Sunday only
  }
  const attendancePercent = workingDays > 0
    ? Math.round((daysPresent / workingDays) * 100)
    : 0;

  // ✅ Casual leave balance — 10 quota minus approved/pending casual leaves this year
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd   = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

  const Leave = require('../models/Leave.model');
  const casualResult = await Leave.aggregate([
    {
      $match: {
        employee: req.user._id,
        leaveType: 'casual',
        status: { $in: ['pending', 'approved'] },
        startDate: { $gte: yearStart, $lte: yearEnd },
      },
    },
    { $group: { _id: null, total: { $sum: '$totalDays' } } },
  ]);
  const usedCasual   = casualResult[0]?.total || 0;
  const leaveBalance = Math.max(0, 10 - usedCasual);

  // Leave days taken this month
  const leaveDaysThisMonth = await Leave.aggregate([
    {
      $match: {
        employee: req.user._id,
        status: 'approved',
        startDate: { $lte: endOfMonth },
        endDate:   { $gte: startOfMonth },
      },
    },
    { $group: { _id: null, total: { $sum: '$totalDays' } } },
  ]);
  const leaveDays = leaveDaysThisMonth[0]?.total || 0;

  // Net salary from last payroll
  const Payroll = require('../models/Payroll.model');
  const lastPayroll = await Payroll.findOne(
    { employee: req.user._id, status: { $in: ['approved', 'paid', 'processed'] } }
  ).sort({ 'payPeriod.year': -1, 'payPeriod.month': -1 });
  const netSalary = lastPayroll?.netSalary ?? 0;

  // Latest performance score
  const latestReview = await PerformanceReview.findOne(
    { employee: req.user._id, status: 'completed' },
    { overallRating: 1 }
  ).sort({ createdAt: -1 });
  const performanceScore = latestReview?.overallRating ?? 0;

  res.json({
    success: true,
    data: {
      daysPresent,
      daysAbsent,
      leaveDays,
      attendancePercent,
      leaveBalance,
      usedCasual,
      performanceScore,
      netSalary,
      workingDays,
    },
  });
}));

module.exports = router;
