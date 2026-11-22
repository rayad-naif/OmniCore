const mongoose = require('../core/mongoose');

const jobSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
    },
    description: { type: String, required: true },
    requirements: [{ type: String }],
    responsibilities: [{ type: String }],
    skills: [{ type: String }],
    experience: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 10 },
      unit: { type: String, default: 'years' },
    },
    salary: {
      min: { type: Number },
      max: { type: Number },
      currency: { type: String, default: 'USD' },
      isConfidential: { type: Boolean, default: false },
    },
    location: { type: String },
    workType: {
      type: String,
      enum: ['full_time', 'part_time', 'contract', 'intern'],
      default: 'full_time',
    },
    workMode: {
      type: String,
      enum: ['office', 'remote', 'hybrid'],
      default: 'office',
    },
    openings: { type: Number, default: 1 },
    closingDate: { type: Date },
    status: {
      type: String,
      enum: ['draft', 'open', 'closed', 'on_hold'],
      default: 'draft',
    },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    aiScreeningEnabled: { type: Boolean, default: true },
    aiScreeningCriteria: {
      minScore: { type: Number, default: 70 },
      prioritySkills: [String],
      educationRequirements: String,
    },
    applicationCount: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    pipeline: [
      {
        stage: String,
        order: Number,
        autoAdvance: Boolean,
      },
    ],
    tags: [String],
  },
  { timestamps: true },
);

const applicationSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    candidate: {
      firstName: { type: String, required: true },
      lastName: { type: String, required: true },
      email: { type: String, required: true, lowercase: true },
      phone: String,
      currentLocation: String,
      currentCompany: String,
      currentPosition: String,
      currentSalary: Number,
      expectedSalary: Number,
      noticePeriod: Number,
      totalExperience: Number,
      linkedin: String,
      portfolio: String,
      referredBy: String,
    },
    resumeUrl: { type: String, required: true },
    coverLetter: String,
    stage: {
      type: String,
      enum: [
        'applied',
        'ai_screening',
        'shortlisted',
        'hr_interview',
        'technical_interview',
        'manager_interview',
        'offer_sent',
        'offer_accepted',
        'offer_rejected',
        'hired',
        'rejected',
        'on_hold',
        'withdrawn',
      ],
      default: 'applied',
    },
    aiScreening: {
      score: { type: Number, min: 0, max: 100 },
      summary: String,
      strengths: [String],
      weaknesses: [String],
      recommendation: {
        type: String,
        enum: ['strong_yes', 'yes', 'maybe', 'no'],
      },
      processedAt: Date,
      skillMatch: [{ skill: String, matched: Boolean, score: Number }],
    },
    interviews: [
      {
        type: {
          type: String,
          enum: ['hr', 'technical', 'managerial', 'cultural', 'final'],
        },
        scheduledAt: Date,
        conductedAt: Date,
        interviewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        mode: { type: String, enum: ['in_person', 'video', 'phone'] },
        meetingLink: String,
        feedback: String,
        rating: { type: Number, min: 1, max: 5 },
        result: { type: String, enum: ['pass', 'fail', 'on_hold', 'pending'] },
        voiceTranscript: String,
        aiInsights: String,
      },
    ],
    offer: {
      salary: Number,
      joiningDate: Date,
      offeredAt: Date,
      expiresAt: Date,
      acceptedAt: Date,
      rejectedAt: Date,
      rejectionReason: String,
      offerLetterUrl: String,
    },
    statusHistory: [
      {
        stage: String,
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        notes: String,
      },
    ],
    source: {
      type: String,
      enum: [
        'portal',
        'linkedin',
        'referral',
        'naukri',
        'direct',
        'agency',
        'other',
      ],
      default: 'portal',
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    tags: [String],
    notes: [
      {
        text: String,
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        addedAt: { type: Date, default: Date.now },
        isPrivate: { type: Boolean, default: false },
      },
    ],
    rating: { type: Number, min: 1, max: 5 },
  },
  { timestamps: true },
);

applicationSchema.index({ job: 1, 'candidate.email': 1 });
applicationSchema.index({ stage: 1 });
applicationSchema.index({ assignedTo: 1 });

const Job = mongoose.model('Job', jobSchema);
const Application = mongoose.model('Application', applicationSchema);

module.exports = { Job, Application };
