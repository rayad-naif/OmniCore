const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { protect, hrAndAbove, authorize } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const { Job, Application } = require('../models/Recruitment.model');
const { screenResume, extractResumeText, analyzeInterview } = require('../services/ai/ai.service');
const logger = require('../utils/logger');

// Resumes are stored in OmniCore file storage (R2 or local disk), per workspace.
// Public applications must name the workspace: POST /applications?w=<workspace id>.
const { CloudinaryStorage } = require('../core/cloudinaryShim');
const storage = new CloudinaryStorage({
  params: async (_req, file) => ({
    folder: 'resumes',
    resource_type: 'raw',
    public_id: `resume-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`,
  }),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only PDF and Word documents are allowed'));
  },
});

// ─── Job Routes ────────────────────────────────────────────

// GET all jobs
router.get('/jobs', protect, asyncHandler(async (req, res) => {
  const { status, department, search, page = 1, limit = 10 } = req.query;
  const query = {};
  if (status) query.status = status;
  if (department) query.department = department;
  if (search) query.$text = { $search: search };

  const jobs = await Job.find(query)
    .populate('department', 'name')
    .populate('postedBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Job.countDocuments(query);
  res.json({ success: true, data: jobs, total, page: parseInt(page), pages: Math.ceil(total / limit) });
}));

// POST create job
router.post('/jobs', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const job = await Job.create({ ...req.body, postedBy: req.user._id });
  res.status(201).json({ success: true, data: job });
}));

// PUT update job
router.put('/jobs/:id', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const job = await Job.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  res.json({ success: true, data: job });
}));

// DELETE job
router.delete('/jobs/:id', protect, authorize('super_admin', 'admin'), asyncHandler(async (req, res) => {
  await Job.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'Job deleted' });
}));

// ─── Application Routes ────────────────────────────────────

// POST submit application (with resume upload)
router.post('/applications', upload.single('resume'), asyncHandler(async (req, res) => {
  const { jobId, ...candidateData } = req.body;

  if (!req.file) return res.status(400).json({ success: false, message: 'Resume required' });

  const job = await Job.findById(jobId);
  if (!job || job.status !== 'open') {
    return res.status(400).json({ success: false, message: 'Job is not accepting applications' });
  }

  // Check duplicate application
  const existing = await Application.findOne({ job: jobId, 'candidate.email': candidateData.email });
  if (existing) return res.status(409).json({ success: false, message: 'Already applied for this position' });

  const application = await Application.create({
    job: jobId,
    candidate: JSON.parse(candidateData.candidate || '{}'),
    resumeUrl: req.file.path,
    coverLetter: candidateData.coverLetter,
    source: candidateData.source || 'portal',
    stage: 'ai_screening',
  });

  // Increment application count
  await Job.findByIdAndUpdate(jobId, { $inc: { applicationCount: 1 } });

  // Trigger AI screening async
  if (job.aiScreeningEnabled) {
    setImmediate(async () => {
      try {
        const resumeText = await extractResumeText(req.file.path);
        await screenResume(application._id, job, resumeText);
        logger.info(`AI screening queued for application ${application._id}`);
      } catch (err) {
        logger.error(`AI screening error: ${err.message}`);
      }
    });
  }

  res.status(201).json({
    success: true,
    message: 'Application submitted successfully. AI screening in progress.',
    data: { applicationId: application._id },
  });
}));

// GET applications for a job
router.get('/applications', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const { jobId, stage, assignedTo, page = 1, limit = 20 } = req.query;
  const query = {};
  if (jobId) query.job = jobId;
  if (stage) query.stage = stage;
  if (assignedTo) query.assignedTo = assignedTo;

  const applications = await Application.find(query)
    .populate('job', 'title department')
    .populate('assignedTo', 'firstName lastName')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Application.countDocuments(query);
  res.json({ success: true, data: applications, total });
}));

// GET single application
router.get('/applications/:id', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const app = await Application.findById(req.params.id)
    .populate('job')
    .populate('assignedTo', 'firstName lastName email');
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  res.json({ success: true, data: app });
}));

// PATCH update application stage
router.patch('/applications/:id/stage', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const { stage, notes } = req.body;
  const app = await Application.findByIdAndUpdate(
    req.params.id,
    {
      stage,
      $push: { statusHistory: { stage, changedBy: req.user._id, notes } },
    },
    { new: true }
  );
  res.json({ success: true, data: app });
}));

// POST analyze interview transcript with AI
router.post('/applications/:id/analyze-interview', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const { transcript, interviewIndex } = req.body;
  const app = await Application.findById(req.params.id).populate('job', 'title');

  const analysis = await analyzeInterview(
    transcript,
    app.job.title,
    `${app.candidate.firstName} ${app.candidate.lastName}`
  );

  // Update interview with AI insights
  if (interviewIndex !== undefined) {
    await Application.findByIdAndUpdate(req.params.id, {
      [`interviews.${interviewIndex}.aiInsights`]: JSON.stringify(analysis),
    });
  }

  res.json({ success: true, data: analysis });
}));

// GET recruitment pipeline stats
router.get('/pipeline/stats', protect, hrAndAbove, asyncHandler(async (req, res) => {
  const stats = await Application.aggregate([
    { $group: { _id: '$stage', count: { $sum: 1 }, avgScore: { $avg: '$aiScreening.score' } } },
    { $sort: { count: -1 } },
  ]);

  const jobStats = await Job.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 }, totalApplications: { $sum: '$applicationCount' } } },
  ]);

  res.json({ success: true, data: { pipelineStats: stats, jobStats } });
}));

module.exports = router;
