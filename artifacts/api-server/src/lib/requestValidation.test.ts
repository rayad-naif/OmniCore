import { describe, expect, it } from 'vitest';

const {
  validateLoginInput,
  validateTenantProvisionInput,
  validateWidgetSessionInput,
} = require('./requestValidation.js');

describe('API request validation', () => {
  it('normalizes valid login credentials', () => {
    expect(
      validateLoginInput({ email: ' Agent@Example.com ', password: 'secret' }),
    ).toEqual({
      ok: true,
      value: { email: 'agent@example.com', password: 'secret' },
    });
  });

  it('rejects missing or malformed login credentials', () => {
    expect(validateLoginInput({ email: '', password: '' }).ok).toBe(false);
    expect(
      validateLoginInput({ email: 'not-an-email', password: 'secret' }),
    ).toEqual({
      ok: false,
      error: 'email must be valid',
    });
  });

  it('does not coerce login credentials from non-string values', () => {
    expect(validateLoginInput({ email: 42, password: 'secret' })).toEqual({
      ok: false,
      error: 'email and password are required',
    });
    expect(
      validateLoginInput({ email: 'agent@example.com', password: 42 }),
    ).toEqual({
      ok: false,
      error: 'email and password are required',
    });
  });

  it('requires an explicit strong tenant admin password', () => {
    expect(
      validateTenantProvisionInput({
        company_name: 'Acme',
        admin_name: 'Jane',
        admin_email: 'jane@acme.test',
      }).ok,
    ).toBe(false);
    expect(
      validateTenantProvisionInput({
        company_name: 'Acme',
        admin_name: 'Jane',
        admin_email: 'jane@acme.test',
        admin_password: 'a sufficiently long password',
      }).ok,
    ).toBe(true);
  });

  it('normalizes tenant provisioning identity and enforces every required field', () => {
    expect(
      validateTenantProvisionInput({
        company_name: ' Acme ',
        admin_name: ' Jane ',
        admin_email: ' JANE@ACME.TEST ',
        admin_password: 'long-enough-password',
      }),
    ).toEqual({
      ok: true,
      value: {
        companyName: 'Acme',
        adminName: 'Jane',
        adminEmail: 'jane@acme.test',
        adminPassword: 'long-enough-password',
      },
    });
    expect(
      validateTenantProvisionInput({
        company_name: 'Acme',
        admin_name: 'Jane',
        admin_email: 'invalid',
        admin_password: 'long-enough-password',
      }),
    ).toEqual({ ok: false, error: 'admin_email must be valid' });
  });

  it('validates widget session input', () => {
    expect(validateWidgetSessionInput({}).error).toBe('brandId is required');
    expect(validateWidgetSessionInput({ brandId: 'brand-1' }).ok).toBe(true);
  });
});
