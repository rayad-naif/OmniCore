const mongoose = require('../core/mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      unique: true,
      sparse: true,
    },
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: false, trim: true, maxlength: 50 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Invalid email'],
    },
    password: { type: String, required: true, minlength: 8, select: false },
    role: {
      type: String,
      enum: ['super_admin', 'admin', 'senior_manager', 'hr_recruiter', 'employee'],
      default: 'employee',
    },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    position: { type: String, trim: true },
    phone: { type: String, trim: true },
    avatar: { type: String, default: null },
    dateOfBirth: { type: Date },
    dateOfJoining: { type: Date, default: Date.now },
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      zipCode: String,
    },
    bankDetails: {
      accountNumber: { type: String, select: false },
      bankName: String,
      ifscCode: String,
      accountHolderName: String,
    },
    emergencyContact: {
      name: String,
      relationship: String,
      phone: String,
    },
    salary: {
      basic: { type: Number, default: 0 },
      allowances: { type: Number, default: 0 },
      currency: { type: String, default: 'PKR' },
    },
    status: {
      type: String,
      enum: ['active', 'on_leave', 'probation', 'suspended', 'resigned', 'terminated'],
      default: 'active',
    },
    roles: [{ type: String }],
    permissions: [{ type: String }],
    reportingManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isActive: { type: Boolean, default: true },
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    lastLogin: { type: Date },
    refreshToken: { type: String, select: false },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },
    preferences: {
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      notifications: { type: Boolean, default: true },
      language: { type: String, default: 'en' },
    },
    skills: [{ type: String }],
    bio: { type: String, default: '', maxlength: 300 },
    documents: [
      {
        name: String,
        type: String,
        url: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual: isLocked
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Pre-save: hash password
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);

  // Auto-generate employeeId
  if (!this.employeeId) {
    const count = await mongoose.model('User').countDocuments();
    this.employeeId = `EMP${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

// Method: compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Method: increment login attempts
userSchema.methods.incLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 },
    });
  }
  const updates = { $inc: { loginAttempts: 1 } };
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
  }
  return this.updateOne(updates);
};

// Soft delete query middleware
userSchema.pre(/^find/, function (next) {
  if (!this.getOptions().includeDeleted) {
    this.find({ deletedAt: null });
  }
  next();
});

// Indexes
userSchema.index({ department: 1, role: 1 });
userSchema.index({ isActive: 1 });

module.exports = mongoose.model('User', userSchema);
