const mongoose = require('../core/mongoose');

const performanceReviewSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reviewCycle: {
      type: {
        type: String,
        enum: ['monthly', 'quarterly', 'half_yearly', 'annual'],
        default: 'quarterly',
      },
      period: String, // e.g. "Q1 2024"
      startDate: Date,
      endDate: Date,
    },
    ratings: {
      technical: { score: { type: Number, min: 1, max: 5 }, comments: String },
      communication: {
        score: { type: Number, min: 1, max: 5 },
        comments: String,
      },
      teamwork: { score: { type: Number, min: 1, max: 5 }, comments: String },
      leadership: { score: { type: Number, min: 1, max: 5 }, comments: String },
      productivity: {
        score: { type: Number, min: 1, max: 5 },
        comments: String,
      },
      innovation: { score: { type: Number, min: 1, max: 5 }, comments: String },
      punctuality: {
        score: { type: Number, min: 1, max: 5 },
        comments: String,
      },
    },
    overallRating: { type: Number, min: 1, max: 5 },
    goalsAchievement: [
      {
        goal: String,
        targetScore: Number,
        achievedScore: Number,
        comments: String,
      },
    ],
    strengths: [String],
    areasOfImprovement: [String],
    managerComments: String,
    employeeComments: String,
    developmentPlan: String,
    promotionRecommended: { type: Boolean, default: false },
    incrementPercentage: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'acknowledged', 'completed'],
      default: 'draft',
    },
    submittedAt: Date,
    acknowledgedAt: Date,
    aiInsights: {
      summary: String,
      predictions: [String],
      recommendations: [String],
      riskFlags: [String],
      generatedAt: Date,
    },
    selfAssessment: {
      submitted: { type: Boolean, default: false },
      ratings: {
        technical: Number,
        communication: Number,
        teamwork: Number,
        leadership: Number,
        productivity: Number,
      },
      comments: String,
      submittedAt: Date,
    },
    feedbacks: [
      {
        from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        type: { type: String, enum: ['peer', '360', 'upward'] },
        rating: { type: Number, min: 1, max: 5 },
        comments: String,
        submittedAt: Date,
        isAnonymous: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true },
);

performanceReviewSchema.index({ employee: 1, 'reviewCycle.period': 1 });
performanceReviewSchema.index({ reviewer: 1 });

module.exports = mongoose.model('PerformanceReview', performanceReviewSchema);
