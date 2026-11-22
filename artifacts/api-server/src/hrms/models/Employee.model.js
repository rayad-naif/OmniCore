const mongoose = require('../core/mongoose');

const employeeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    employeeType: {
      type: String,
      enum: ['full_time', 'part_time', 'contract', 'intern', 'consultant'],
      default: 'full_time',
    },
    workLocation: {
      type: String,
      enum: ['office', 'remote', 'hybrid'],
      default: 'office',
    },
    shift: {
      type: { type: String, enum: ['morning', 'evening', 'night', 'flexible'], default: 'morning' },
      startTime: { type: String, default: '09:00' },
      endTime: { type: String, default: '18:00' },
      crossDay: { type: Boolean, default: false }, // ◄◄ ADD THIS FIELD HERE
      workMode: { type: String, enum: ['office', 'remote', 'hybrid'], default: 'office' },
      breakEnabled: { type: Boolean, default: true },
      breakDurationMinutes: { type: Number, default: 60 },
    },
    salaryHold: {
      amount: { type: Number, default: 0 },
      status: { type: String, enum: ['clear', 'not_clear'], default: 'not_clear' },
      // Purely informational: when the admin placed this hold from the
      // Employee Management "Hold Salary" panel. Distinct from the
      // separate SalaryHold collection's own `holdDate`, which drives
      // actual payroll deductions — this one never affects payroll.
      holdDate: { type: Date, default: null },
      reason: { type: String, default: '' },
    },
    freelanceCredentials: [
      {
        application: String,
        loginUrl: String,
        usernameOrEmail: String,
        password: String,
        twoFactorAuthentication: String,
        securityQa: String,
        notes: String,
        addedAt: { type: Date, default: Date.now },
      },
    ],
    signedAgreement: {
      url: String,
      filename: String,
      uploadedAt: Date,
    },
    cnicImages: {
      front: {
        url: String,
        publicId: String,
        originalName: String,
        uploadedAt: Date,
      },
      back: {
        url: String,
        publicId: String,
        originalName: String,
        uploadedAt: Date,
      },
    },
    probationEndDate: { type: Date },
    confirmationDate: { type: Date },
    noticePeriod: { type: Number, default: 30 }, // days
    status: {
      type: String,
      enum: ['active', 'on_leave', 'probation', 'suspended', 'resigned', 'terminated'],
      default: 'active',
    },
    offboardingDate: { type: Date },
    offboardingReason: { type: String },
    education: [
      {
        degree: String,
        institution: String,
        year: Number,
        grade: String,
      },
    ],
    experience: [
      {
        company: String,
        position: String,
        startDate: Date,
        endDate: Date,
        responsibilities: String,
      },
    ],
    certifications: [
      {
        name: String,
        issuer: String,
        date: Date,
        expiryDate: Date,
        credentialId: String,
      },
    ],
    performanceRating: { type: Number, min: 0, max: 5, default: 0 },
    leaveBalance: {
      annual: { type: Number, default: 21 },
      sick: { type: Number, default: 10 },
      casual: { type: Number, default: 7 },
      maternity: { type: Number, default: 180 },
      paternity: { type: Number, default: 15 },
      unpaid: { type: Number, default: 0 },
    },
    payrollDetails: {
      ctc: { type: Number, default: 0 },
      inHandSalary: { type: Number, default: 0 },
      pfNumber: String,
      esiNumber: String,
      panNumber: String,
      taxRegime: { type: String, enum: ['old', 'new'], default: 'new' },
    },
    assets: [
      {
        assetType: String,
        assetId: String,
        assignedDate: Date,
        returnDate: Date,
        condition: String,
      },
    ],
    onboardingChecklist: [
      {
        task: String,
        completed: { type: Boolean, default: false },
        completedAt: Date,
      },
    ],
    goals: [
      {
        title: String,
        description: String,
        targetDate: Date,
        status: { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
        progress: { type: Number, min: 0, max: 100, default: 0 },
      },
      
    ],
    reason: { type: String, default: '' },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

employeeSchema.index({ status: 1 });

module.exports = mongoose.model('Employee', employeeSchema);
