'use strict';

/**
 * HR module authentication (ported from the HRMS auth controller).
 *
 * Differences from the single-company original:
 *   - Every token is bound to one OmniCore workspace (`tid`), and the user is
 *     looked up in that workspace's own database.
 *   - Login finds the employee's workspace from the email (hrms_directory);
 *     when the same email exists in several workspaces the client is asked to
 *     choose (409 choose_workspace).
 *   - Public self-registration is off: HR admins add employees.
 *   - Refresh tokens live on the user document (no Redis needed).
 *   - Single sign-on from the OmniCore dashboard via one-time codes.
 */

const crypto = require('node:crypto');
const User = require('../models/User.model');
const Employee = require('../models/Employee.model');
const logger = require('../utils/logger');
const { sendEmail } = require('../services/notification/email.service');
const { AppError, asyncHandler } = require('../utils/errorUtils');
const tokens = require('../core/tokens');
const tenants = require('../core/tenants');
const { runAsTenant, currentTenantId } = require('../core/context');
const { hrmsAppUrl } = require('../core/config');
const { tzOffsetMinutes } = require('../core/time');

const REFRESH_COOKIE = 'hrms_refresh';
const MAX_SCAN_WORKSPACES = 50;

function cookieOptions() {
  const secure =
    process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE === 'true'
      : process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/hrms',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

async function workspaceSummary(tenantId) {
  const ws = await tenants.workspaceInfo(tenantId);
  if (!ws) return null;
  return {
    id: ws.id,
    name: ws.name,
    timezone: ws.timezone,
    tzOffsetMinutes: tzOffsetMinutes(new Date(), ws.timezone),
    aiEnabled: ws.aiEnabled,
  };
}

// Must run inside the user's workspace context.
const sendTokenResponse = async (user, statusCode, res) => {
  const tenantId = currentTenantId();
  const accessToken = tokens.signAccess(user, tenantId);
  const refreshToken = tokens.signRefresh(user, tenantId);

  await User.findByIdAndUpdate(user._id, {
    refreshToken,
    lastLogin: new Date(),
    loginAttempts: 0,
    $unset: { lockUntil: 1 },
  });
  await tenants.recordUser(user.email, tenantId).catch(() => {});

  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());

  const userObj = user.toObject();
  delete userObj.password;
  delete userObj.refreshToken;
  res.req.auditTenantId = tenantId;

  res.status(statusCode).json({
    success: true,
    accessToken,
    expiresIn: tokens.ACCESS_TTL(),
    user: userObj,
    workspace: await workspaceSummary(tenantId),
  });
};

/** Workspaces where this email has an HR account (directory, then a scan). */
async function candidateWorkspaces(email, requested) {
  if (requested) {
    if (!UUID_RE.test(String(requested))) return [];
    const ws = await tenants.workspaceInfo(requested).catch(() => null);
    return ws && ws.enabled ? [{ id: ws.id, name: ws.name }] : [];
  }
  const found = await tenants.tenantsForEmail(email);
  if (found.length) return found;

  // First login after an import/upgrade: look through enabled workspaces.
  const ids = (await tenants.enabledWorkspaceIds()).slice(0, MAX_SCAN_WORKSPACES);
  const hits = [];
  for (const id of ids) {
    const exists = await runAsTenant(id, () =>
      User.exists({ email, isActive: true }),
    ).catch(() => null);
    if (exists) {
      await tenants.recordUser(email, id).catch(() => {});
      const ws = await tenants.workspaceInfo(id);
      hits.push({ id, name: ws?.name || 'Workspace' });
    }
  }
  return hits;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function withWorkspace(tenantId, fn) {
  if (!UUID_RE.test(String(tenantId || ''))) {
    throw new AppError('Unknown workspace.', 400);
  }
  const ws = await tenants.workspaceInfo(tenantId);
  if (!ws || !ws.enabled) throw new AppError('The HR module is not enabled for this workspace.', 403);
  return runAsTenant(tenantId, fn, { timezone: ws.timezone });
}

// @route   POST /api/hrms/v1/auth/login   { email, password, workspace? }
exports.login = asyncHandler(async (req, res, next) => {
  const email = tenants.normEmail(req.body.email);
  const { password } = req.body;
  const requested = req.body.workspace || req.query.w || null;
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  const workspaces = await candidateWorkspaces(email, requested);
  const matches = [];
  let locked = false;

  for (const ws of workspaces) {
    await withWorkspace(ws.id, async () => {
      const user = await User.findOne({ email, isActive: true }).select(
        '+password +loginAttempts +lockUntil',
      );
      if (!user) return;
      if (user.isLocked) {
        locked = true;
        return;
      }
      if (await user.comparePassword(password)) {
        matches.push({ ws, user });
      } else {
        await user.incLoginAttempts();
      }
    }).catch((err) => {
      if (err.statusCode !== 403) throw err;
    });
  }

  if (!matches.length) {
    if (locked) {
      return next(
        new AppError('Account locked due to too many failed attempts. Try again in 2 hours.', 423),
      );
    }
    return next(new AppError('Invalid credentials', 401));
  }
  if (matches.length > 1) {
    return res.status(409).json({
      success: false,
      code: 'choose_workspace',
      message: 'This email belongs to more than one company. Choose one.',
      workspaces: matches.map((m) => ({ id: m.ws.id, name: m.ws.name })),
    });
  }

  const { ws, user } = matches[0];
  logger.info(`HR user logged in: ${user.email} [${user.role}] workspace=${ws.id}`);
  await withWorkspace(ws.id, () => sendTokenResponse(user, 200, res));
});

// @route   POST /api/hrms/v1/auth/register  (disabled: HR admins add employees)
exports.register = asyncHandler(async (_req, _res, next) => {
  next(
    new AppError(
      'Self-registration is turned off. Ask your HR administrator to add you as an employee.',
      403,
    ),
  );
});

// @route   POST /api/hrms/v1/auth/sso   { code }  (one-time code from the OmniCore dashboard)
exports.sso = asyncHandler(async (req, res, next) => {
  const grant = await tenants.consumeSsoCode(req.body.code);
  if (!grant) return next(new AppError('This sign-in link has expired. Open HR again from the dashboard.', 401));

  await withWorkspace(grant.tenantId, async () => {
    const email = tenants.normEmail(grant.email);
    let user = await User.findOne({ email }).select('+isActive');

    if (!user) {
      if (!grant.provisionRole) {
        throw new AppError(
          'You do not have an HR account in this workspace. Ask your HR administrator to add you.',
          403,
        );
      }
      const [firstName, ...rest] = String(grant.name || email.split('@')[0]).trim().split(/\s+/);
      user = await User.create({
        firstName: (firstName || 'Admin').slice(0, 50),
        lastName: rest.join(' ').slice(0, 50),
        email,
        password: crypto.randomBytes(24).toString('base64url') + 'aA1!',
        role: grant.provisionRole,
        position: grant.support ? 'Platform support' : 'Workspace administrator',
        isEmailVerified: true,
      });
      await Employee.create({ user: user._id }).catch(() => {});
      logger.info(`HR account provisioned by single sign-on: ${email} [${user.role}]`);
    } else if (!user.isActive) {
      throw new AppError('Your HR account has been deactivated.', 403);
    } else if (
      grant.provisionRole === 'super_admin' &&
      !['super_admin'].includes(user.role)
    ) {
      // Workspace owners always keep full HR access.
      user.role = 'super_admin';
      await user.save({ validateBeforeSave: false });
    }

    req.auditActor = {
      type: grant.support ? 'super_admin' : 'agent',
      id: grant.omnicoreUserId || null,
      email,
      name: grant.name || null,
    };
    await sendTokenResponse(user, 200, res);
  });
});

// @route   POST /api/hrms/v1/auth/refresh-token
exports.refreshToken = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
  if (!token) return next(new AppError('No refresh token', 401));

  let decoded;
  try {
    decoded = tokens.verifyRefresh(token);
  } catch {
    return next(new AppError('Invalid refresh token', 401));
  }

  await withWorkspace(decoded.tid, async () => {
    const user = await User.findById(decoded.id).select('+refreshToken +isActive');
    if (!user || !user.isActive) throw new AppError('User not found or inactive', 401);
    if (!user.refreshToken || user.refreshToken !== token) {
      throw new AppError('Refresh token expired or revoked', 401);
    }
    await sendTokenResponse(user, 200, res);
  });
});

// @route   POST /api/hrms/v1/auth/logout
exports.logout = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: 1 } });
  if (req.hrmsToken) await tenants.revokeToken(req.hrmsToken, req.hrmsTokenExp);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/hrms' });
  res.json({ success: true, message: 'Logged out successfully' });
});

// @route   GET /api/hrms/v1/auth/me
exports.getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).populate('department', 'name code');
  res.json({
    success: true,
    data: user,
    workspace: await workspaceSummary(currentTenantId()),
  });
});

// @route   PUT /api/hrms/v1/auth/change-password
exports.changePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 8) {
    return next(new AppError('The new password must be at least 8 characters', 400));
  }

  const user = await User.findById(req.user.id).select('+password');
  if (!user) return next(new AppError('User not found', 404));

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) return next(new AppError('Current password is incorrect', 400));

  user.password = newPassword;
  await user.save();
  if (req.hrmsToken) await tenants.revokeToken(req.hrmsToken, req.hrmsTokenExp);

  await sendTokenResponse(user, 200, res);
});

// @route   POST /api/hrms/v1/auth/forgot-password   { email, workspace? }
// Always answers the same way so the endpoint cannot be used to discover accounts.
exports.forgotPassword = asyncHandler(async (req, res) => {
  const email = tenants.normEmail(req.body.email);
  const requested = req.body.workspace || null;
  if (email) {
    const workspaces = await candidateWorkspaces(email, requested).catch(() => []);
    for (const ws of workspaces) {
      await withWorkspace(ws.id, async () => {
        const user = await User.findOne({ email, isActive: true });
        if (!user) return;
        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        await User.findByIdAndUpdate(user._id, {
          passwordResetToken: hashedToken,
          passwordResetExpires: Date.now() + 30 * 60 * 1000,
        });
        const resetUrl = `${hrmsAppUrl()}/reset-password?token=${resetToken}&w=${ws.id}`;
        await sendEmail({
          to: user.email,
          subject: 'Password reset request',
          template: 'resetPassword',
          data: { name: user.firstName, resetUrl },
        }).catch((err) => logger.error(`Reset email failed: ${err.message}`));
      }).catch(() => {});
    }
  }
  res.json({
    success: true,
    message: 'If that email has an HR account, a password reset link is on its way.',
  });
});

// @route   POST /api/hrms/v1/auth/reset-password   { token, password, workspace }
exports.resetPassword = asyncHandler(async (req, res, next) => {
  const workspace = req.body.workspace || req.query.w;
  if (!workspace) return next(new AppError('Invalid or expired reset link', 400));
  if (!req.body.token || !req.body.password || String(req.body.password).length < 8) {
    return next(new AppError('A token and a password of at least 8 characters are required', 400));
  }
  const hashedToken = crypto.createHash('sha256').update(String(req.body.token)).digest('hex');

  await withWorkspace(workspace, async () => {
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    }).select('+passwordResetToken +passwordResetExpires');
    if (!user) throw new AppError('Invalid or expired reset token', 400);

    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.refreshToken = undefined;
    await user.save();
  });

  res.json({ success: true, message: 'Password reset successful' });
});

exports.REFRESH_COOKIE = REFRESH_COOKIE;
exports.withWorkspace = withWorkspace;
