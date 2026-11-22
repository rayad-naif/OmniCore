const User = require('../models/User.model');
const tokens = require('../core/tokens');
const tenants = require('../core/tenants');
const { currentTenantId } = require('../core/context');
const { AppError, asyncHandler } = require('../utils/errorUtils');

// Protect routes - verify the HR access token. The workspace context was set
// from the same token by the HR router (hrms/index.js); the user is loaded from
// that workspace's database.
exports.protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) return next(new AppError('Not authenticated. Please log in.', 401));

  let decoded;
  try {
    decoded = tokens.verifyAccess(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Session expired. Please log in again.', 401));
    }
    return next(new AppError('Invalid token.', 401));
  }

  const tenantId = currentTenantId();
  if (!tenantId || decoded.tid !== tenantId) {
    return next(new AppError('Invalid token.', 401));
  }

  if (await tenants.isTokenRevoked(token)) {
    return next(new AppError('Token has been invalidated. Please log in again.', 401));
  }

  const user = await User.findById(decoded.id).select('+isActive');
  if (!user) return next(new AppError('User no longer exists.', 401));
  if (!user.isActive) return next(new AppError('Account has been deactivated.', 403));

  req.user = user;
  req.hrmsToken = token;
  req.hrmsTokenExp = decoded.exp;
  // Picked up by OmniCore's audit log.
  req.auditTenantId = tenantId;
  req.auditActor = req.auditActor || {
    type: 'hrms_user',
    id: String(user._id),
    email: user.email,
    name: [user.firstName, user.lastName].filter(Boolean).join(' '),
    role: user.role,
  };
  next();
});

// Authorize roles
exports.authorize = (...roles) => {
  return (req, _res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new AppError(`Role '${req.user.role}' is not authorized for this action.`, 403));
    }
    next();
  };
};

// Role hierarchy check (admin can access all lower-role routes)
exports.authorizeOrSelf = (...roles) => {
  return (req, _res, next) => {
    const targetId = req.params.id || req.params.employeeId;
    const isSelf = targetId && targetId.toString() === req.user._id.toString();
    const hasRole = roles.includes(req.user.role);

    if (!isSelf && !hasRole) {
      return next(new AppError('Access denied.', 403));
    }
    next();
  };
};

// Admin-only shorthand
exports.adminOnly = exports.authorize('super_admin', 'admin');

// Management-level access
exports.managementOnly = exports.authorize('super_admin', 'admin', 'senior_manager');

// HR and above
exports.hrAndAbove = exports.authorize('super_admin', 'admin', 'senior_manager', 'hr_recruiter');
exports.employeeonly = exports.authorize('employee');