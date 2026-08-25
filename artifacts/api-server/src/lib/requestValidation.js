'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateLoginInput(body) {
  const email =
    typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password)
    return { ok: false, error: 'email and password are required' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'email must be valid' };
  return { ok: true, value: { email, password } };
}

function validateTenantProvisionInput(body) {
  const companyName =
    typeof body?.company_name === 'string' ? body.company_name.trim() : '';
  const adminName =
    typeof body?.admin_name === 'string' ? body.admin_name.trim() : '';
  const adminEmail =
    typeof body?.admin_email === 'string'
      ? body.admin_email.trim().toLowerCase()
      : '';
  const adminPassword =
    typeof body?.admin_password === 'string' ? body.admin_password : '';
  if (!companyName) return { ok: false, error: 'company_name is required' };
  if (!adminName) return { ok: false, error: 'admin_name is required' };
  if (!EMAIL_RE.test(adminEmail))
    return { ok: false, error: 'admin_email must be valid' };
  if (adminPassword.length < 12) {
    return {
      ok: false,
      error: 'admin_password must be at least 12 characters',
    };
  }
  return {
    ok: true,
    value: { companyName, adminName, adminEmail, adminPassword },
  };
}

function validateWidgetSessionInput(body) {
  const brandId = typeof body?.brandId === 'string' ? body.brandId.trim() : '';
  if (!brandId) return { ok: false, error: 'brandId is required' };
  return { ok: true, value: { brandId } };
}

module.exports = {
  validateLoginInput,
  validateTenantProvisionInput,
  validateWidgetSessionInput,
};
