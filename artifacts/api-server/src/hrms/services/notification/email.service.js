const logger = require('../../utils/logger');
const { currentTenantId } = require('../../core/context');
const { workspaceInfo } = require('../../core/tenants');

// Lazy: OmniCore's email service pulls in the shared Postgres pool.
const omnicoreEmail = () => require('../../../services/email.service');

const TEMPLATES = {
  checkInConfirmation: (data) => ({
    subject: `✓ Check-in Recorded – ${data.date}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:16px">
        <div style="text-align:center;margin-bottom:28px">
          <h1 style="color:#6366f1;font-size:26px;margin:0">GlitchGone HRMS</h1>
          <p style="color:#64748b;margin-top:6px;font-size:13px">Attendance Notification</p>
        </div>

        <h2 style="color:#f1f5f9;margin-bottom:4px">Hi ${data.name}, you're checked in! ✅</h2>
        <p style="color:#94a3b8;line-height:1.7;margin-top:0">
          Your check-in has been successfully recorded.
        </p>

        <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin:24px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0;width:140px">Date</td>
              <td style="color:#f1f5f9;font-weight:600;font-size:13px">${data.date}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0">Check-in Time</td>
              <td style="color:#f1f5f9;font-weight:600;font-size:13px">${data.time}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0">Status</td>
              <td style="color:${data.status === 'late' ? '#ef4444' : '#22c55e'};font-weight:700;font-size:13px;text-transform:capitalize">${data.status}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0">Method</td>
              <td style="color:#f1f5f9;font-size:13px;text-transform:capitalize">${data.method}</td>
            </tr>
          </table>
        </div>

        <p style="color:#475569;font-size:11px;margin-top:28px;border-top:1px solid #1e293b;padding-top:16px">
          If this wasn't you, please contact your HR administrator immediately.<br/>
          © 2026 GlitchGone HRMS. This is an automated message, please do not reply.
        </p>
      </div>`,
  }),
  newEmployee: (data) => ({
    subject: `Welcome to GlitchGone HRMS – Your Account is Ready`,
    html: `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:16px">
      <div style="text-align:center;margin-bottom:28px">
        <h1 style="color:#6366f1;font-size:26px;margin:0">GlitchGone HRMS</h1>
        <p style="color:#64748b;margin-top:6px;font-size:13px">AI-Powered HR Platform</p>
      </div>
 
      <h2 style="color:#f1f5f9;margin-bottom:4px">Welcome aboard, ${data.name}! 🎉</h2>
      <p style="color:#94a3b8;line-height:1.7;margin-top:0">
        Your employee account has been created. Here are your login credentials:
      </p>
 
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin:24px 0">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="color:#64748b;font-size:12px;padding:6px 0;width:140px">Employee ID</td>
            <td style="color:#f1f5f9;font-weight:600;font-size:13px">${data.employeeId}</td>
          </tr>
          <tr>
            <td style="color:#64748b;font-size:12px;padding:6px 0">Email</td>
            <td style="color:#f1f5f9;font-weight:600;font-size:13px">${data.email}</td>
          </tr>
          <tr>
            <td style="color:#64748b;font-size:12px;padding:6px 0">Temporary Password</td>
            <td style="color:#6366f1;font-weight:700;font-size:13px;letter-spacing:0.5px">${data.password}</td>
          </tr>
          ${
            data.department
              ? `
          <tr>
            <td style="color:#64748b;font-size:12px;padding:6px 0">Department</td>
            <td style="color:#f1f5f9;font-size:13px">${data.department}</td>
          </tr>`
              : ''
          }
          ${
            data.position
              ? `
          <tr>
            <td style="color:#64748b;font-size:12px;padding:6px 0">Position</td>
            <td style="color:#f1f5f9;font-size:13px">${data.position}</td>
          </tr>`
              : ''
          }
          ${
            data.dateOfJoining
              ? `
          <tr>
            <td style="color:#64748b;font-size:12px;padding:6px 0">Date of Joining</td>
            <td style="color:#f1f5f9;font-size:13px">${data.dateOfJoining}</td>
          </tr>`
              : ''
          }
        </table>
      </div>
 
      <a href="${data.loginUrl}"
        style="display:inline-block;padding:13px 28px;background:#6366f1;color:#fff;text-decoration:none;border-radius:12px;font-weight:600;font-size:14px">
        Login to HRMS →
      </a>
 
      <p style="color:#ef4444;font-size:12px;margin-top:24px;background:#ef444415;border:1px solid #ef444430;padding:12px 16px;border-radius:8px">
        ⚠️ Please change your password immediately after your first login.
      </p>
 
      <p style="color:#475569;font-size:11px;margin-top:28px;border-top:1px solid #1e293b;padding-top:16px">
        If you have any issues logging in, contact your HR administrator.<br/>
        © 2026 GlitchGone HRMS. This is an automated message, please do not reply.
      </p>
    </div>`,
  }),
  welcome: (data) => ({
    subject: `Welcome to GlitchGone HRMS, ${data.name}!`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:16px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="color:#6366f1;font-size:28px;margin:0">GlitchGone HRMS</h1>
          <p style="color:#64748b;margin-top:8px">AI-Powered HR Platform</p>
        </div>
        <h2 style="color:#f1f5f9">Welcome, ${data.name}! 👋</h2>
        <p style="color:#94a3b8;line-height:1.6">Your account has been created successfully. You can now access the platform.</p>
        <a href="${data.verifyUrl}" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#6366f1;color:#fff;text-decoration:none;border-radius:12px;font-weight:600">
          Verify Email Address
        </a>
        <p style="color:#475569;font-size:12px;margin-top:32px">This link expires in 24 hours.</p>
      </div>`,
  }),
  resetPassword: (data) => ({
    subject: 'GlitchGone HRMS – Password Reset',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:16px">
        <h2>Password Reset Request</h2>
        <p style="color:#94a3b8">Hi ${data.name}, click below to reset your password. This link expires in 10 minutes.</p>
        <a href="${data.resetUrl}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#ef4444;color:#fff;text-decoration:none;border-radius:12px;font-weight:600">
          Reset Password
        </a>
        <p style="color:#475569;font-size:12px;margin-top:24px">If you didn't request this, please ignore this email.</p>
      </div>`,
  }),
  leaveApproved: (data) => ({
    subject: 'Leave Request Approved',
    html: `<div style="font-family:sans-serif;padding:24px"><h3>Hi ${data.name},</h3><p>Your leave request from <strong>${data.from}</strong> to <strong>${data.to}</strong> has been approved.</p></div>`,
  }),
  leaveSubmitted: (data) => ({
    subject: `New Leave Request – ${data.employeeName} (${data.leaveType})`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:16px">
        <div style="text-align:center;margin-bottom:28px">
          <h1 style="color:#6366f1;font-size:26px;margin:0"><span style="color:#22A55D">GlitchGone</span> HRMS</h1>
          <p style="color:#64748b;margin-top:6px;font-size:13px">Leave Request Notification</p>
        </div>

        <h2 style="color:#f1f5f9;margin-bottom:4px">New leave request pending review</h2>
        <p style="color:#94a3b8;line-height:1.7;margin-top:0">
          ${data.employeeName} has submitted a leave request that requires your approval.
        </p>

        <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin:24px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0;width:140px">Employee</td>
              <td style="color:#f1f5f9;font-weight:600;font-size:13px">${data.employeeName}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0">Leave Type</td>
              <td style="color:#f1f5f9;font-weight:600;font-size:13px;text-transform:capitalize">${data.leaveType}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0">Dates</td>
              <td style="color:#f1f5f9;font-size:13px">${data.from} → ${data.to} (${data.totalDays} day${data.totalDays > 1 ? 's' : ''})</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0">Reason</td>
              <td style="color:#f1f5f9;font-size:13px">${data.reason}</td>
            </tr>
            <tr>
            <td style="color:#64748b;font-size:12px;padding:6px 0">Leave URL</td>
            <td style="color:#f1f5f9;font-size:13px"><a href="${data.reviewUrl}" style="color:#6366f1;text-decoration:underline">Review Leave Request</a></td>
            </tr>
          </table>
        </div>
        <p style="color:#475569;font-size:11px;margin-top:28px;border-top:1px solid #1e293b;padding-top:16px">
          © 2026 GlitchGone HRMS. This is an automated message, please do not reply.
        </p>
      </div>`,
  }),
  shiftSwapSubmitted: (data) => ({
    subject: `New Shift Swap Request – ${data.requesterName}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:16px">
        <div style="text-align:center;margin-bottom:28px">
          <h1 style="color:#6366f1;font-size:26px;margin:0">GlitchGone HRMS</h1>
          <p style="color:#64748b;margin-top:6px;font-size:13px">Shift Swap Notification</p>
        </div>

        <h2 style="color:#f1f5f9;margin-bottom:4px">New shift swap request pending review</h2>
        <p style="color:#94a3b8;line-height:1.7;margin-top:0">
          ${data.requesterName} has requested to swap shifts with ${data.targetEmployeeName} and it requires your approval.
        </p>

        <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin:24px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0;width:140px">Requested By</td>
              <td style="color:#f1f5f9;font-weight:600;font-size:13px">${data.requesterName}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0">Swap With</td>
              <td style="color:#f1f5f9;font-weight:600;font-size:13px">${data.targetEmployeeName}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0">Requested Date</td>
              <td style="color:#f1f5f9;font-size:13px">${data.requestedDate}</td>
            </tr>
            ${
              data.reason
                ? `
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0">Reason</td>
              <td style="color:#f1f5f9;font-size:13px">${data.reason}</td>
            </tr>`
                : ''
            }
          </table>
        </div>

        <a href="${data.reviewUrl}"
          style="display:inline-block;padding:13px 28px;background:#6366f1;color:#fff;text-decoration:none;border-radius:12px;font-weight:600;font-size:14px">
          Review Request →
        </a>

        <p style="color:#475569;font-size:11px;margin-top:28px;border-top:1px solid #1e293b;padding-top:16px">
          © 2026 GlitchGone HRMS. This is an automated message, please do not reply.
        </p>
      </div>`,
  }),
  lateRequestSubmitted: (data) => ({
    subject: `New Late Request – ${data.employeeName}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:16px">
        <div style="text-align:center;margin-bottom:28px">
          <h1 style="color:#6366f1;font-size:26px;margin:0">GlitchGone HRMS</h1>
          <p style="color:#64748b;margin-top:6px;font-size:13px">Late Request Notification</p>
        </div>

        <h2 style="color:#f1f5f9;margin-bottom:4px">New late request pending review</h2>
        <p style="color:#94a3b8;line-height:1.7;margin-top:0">
          ${data.employeeName} has submitted a late request that requires your approval.
        </p>

        <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin:24px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0;width:140px">Employee</td>
              <td style="color:#f1f5f9;font-weight:600;font-size:13px">${data.employeeName}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0">Date</td>
              <td style="color:#f1f5f9;font-size:13px">${data.date}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0">Late Window</td>
              <td style="color:#f1f5f9;font-size:13px">${data.lateFrom} → ${data.lateTo}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:12px;padding:6px 0">Reason</td>
              <td style="color:#f1f5f9;font-size:13px">${data.reason}</td>
            </tr>
          </table>
        </div>

        <a href="${data.reviewUrl}"
          style="display:inline-block;padding:13px 28px;background:#6366f1;color:#fff;text-decoration:none;border-radius:12px;font-weight:600;font-size:14px">
          Review Request →
        </a>

        <p style="color:#475569;font-size:11px;margin-top:28px;border-top:1px solid #1e293b;padding-top:16px">
          © 2026 GlitchGone HRMS. This is an automated message, please do not reply.
        </p>
      </div>`,
  }),
  payslipReady: (data) => ({
    subject: `Payslip Ready – ${data.month} ${data.year}`,
    html: `<div style="font-family:sans-serif;padding:24px"><h3>Hi ${data.name},</h3><p>Your payslip for ${data.month} ${data.year} is ready. Login to GlitchGone HRMS to view it.</p></div>`,
  }),
};

/**
 * Send email using template or raw content.
 * Mail goes out through the workspace's own SMTP server (Workspace settings →
 * Email / SMTP) or, if it has none, the platform SMTP server. The original
 * "GlitchGone HRMS" branding is replaced with the workspace's name.
 */
const sendEmail = async ({ to, subject, template, data, html, text }) => {
  const tenantId = currentTenantId();
  const ws = tenantId ? await workspaceInfo(tenantId).catch(() => null) : null;
  const company = ws?.name || 'Your company';
  const brand = `${company} HR`;
  const rebrand = (v) =>
    typeof v === 'string'
      ? v.replace(/GlitchGone HRMS/g, brand).replace(/GlitchGone/g, company)
      : v;

  const rendered =
    template && TEMPLATES[template]
      ? TEMPLATES[template](data || {})
      : { subject, html };

  try {
    const sent = await omnicoreEmail().sendWorkspaceEmail({
      tenantId,
      to,
      subject: rebrand(rendered.subject),
      html: rebrand(rendered.html),
      text,
      fromName: brand,
    });
    if (!sent) logger.warn(`Email to ${to} skipped: no SMTP server configured`);
    return { sent };
  } catch (error) {
    logger.error(`Email send failed to ${to}: ${error.message}`);
    throw error;
  }
};

module.exports = { sendEmail, TEMPLATES };
