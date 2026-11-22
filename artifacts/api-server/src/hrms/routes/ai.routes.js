const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const { currentTenantId } = require('../core/context');
const { workspaceInfo } = require('../core/tenants');
const {
  chatWithHR,
  generatePerformanceInsights,
  optimizePayroll,
  generateJobDescription,
} = require('../services/ai/ai.service');

// POST  /api/v1/ai/chat  — ARIA HR Chatbot
router.post(
  '/chat',
  protect,
  asyncHandler(async (req, res) => {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: 'messages array required' });
    }
    const context = {
      role: req.user.role,
      name: req.user.firstName,
      department: req.user.department?.name || 'Unknown',
      userId: req.user._id,
    };
    const response = await chatWithHR(messages, context);
    res.json({ success: true, data: { message: response, role: 'assistant' } });
  }),
);

// POST  /api/v1/ai/performance-insights
router.post(
  '/performance-insights',
  protect,
  asyncHandler(async (req, res) => {
    const { employeeData, reviewData } = req.body;
    const insights = await generatePerformanceInsights(
      employeeData,
      reviewData,
    );
    res.json({ success: true, data: insights });
  }),
);

// POST  /api/v1/ai/payroll-optimize
router.post(
  '/payroll-optimize',
  protect,
  asyncHandler(async (req, res) => {
    const { payrollData } = req.body;
    const employeeData = {
      name: `${req.user.firstName} ${req.user.lastName}`,
      taxRegime: 'new',
      location: req.user.address?.city || 'India',
    };
    const suggestions = await optimizePayroll(payrollData, employeeData);
    res.json({ success: true, data: suggestions });
  }),
);

// POST  /api/v1/ai/generate-jd  — AI Job Description Generator
router.post(
  '/generate-jd',
  protect,
  asyncHandler(async (req, res) => {
    const { jobTitle, department, requirements } = req.body;
    if (!jobTitle)
      return res
        .status(400)
        .json({ success: false, message: 'jobTitle required' });
    const jd = await generateJobDescription(
      jobTitle,
      department || '',
      requirements || '',
    );
    res.json({ success: true, data: jd });
  }),
);

// GET   /api/v1/ai/status
router.get(
  '/status',
  protect,
  asyncHandler(async (_req, res) => {
    const ws = await workspaceInfo(currentTenantId());
    res.json({
      success: true,
      data: {
        aiEnabled: !!process.env.GEMINI_API_KEY && !!ws?.aiEnabled,
        provider: 'Google Gemini',
        model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
        features: {
          resumeScreening: true,
          hrChat: true,
          interviewAnalysis: true,
          performanceInsights: true,
          payrollOptimization: true,
          jobDescriptionGen: true,
          voiceInteraction: true,
        },
      },
    });
  }),
);

module.exports = router;
