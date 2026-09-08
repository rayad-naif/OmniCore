import { describe, expect, it } from 'vitest';

const {
  FEATURES,
  defaultPermissionsForRole,
  effectivePermissions,
  normalizePermissions,
  permissionLevel,
} = require('./permissions.js');

describe('permission policy', () => {
  it('gives administrators edit access to every canonical feature', () => {
    expect(defaultPermissionsForRole('admin')).toEqual(
      Object.fromEntries(FEATURES.map((feature: string) => [feature, 'edit'])),
    );
    expect(
      permissionLevel(
        { role: 'admin', permissions: { inbox: 'none' } },
        'inbox',
      ),
    ).toBe(2);
  });

  it('uses the role defaults when a non-admin has no stored permissions', () => {
    expect(
      effectivePermissions({ role: 'supervisor', permissions: {} }),
    ).toMatchObject({
      inbox: 'edit',
      brands: 'read',
      billing: 'read',
    });
    expect(effectivePermissions({ role: 'agent' })).toMatchObject({
      inbox: 'edit',
      contacts: 'read',
      billing: 'none',
    });
  });

  it('normalizes stored maps without allowing unknown features or invalid levels', () => {
    const permissions = normalizePermissions(
      { inbox: 'read', billing: 'invalid', made_up_feature: 'edit' },
      'agent',
    );

    expect(permissions).toEqual(
      expect.objectContaining({ inbox: 'read', billing: 'none' }),
    );
    expect(permissions).not.toHaveProperty('made_up_feature');
    expect(Object.keys(permissions)).toEqual(FEATURES);
  });

  it('treats absent agents and unknown features as no access', () => {
    expect(permissionLevel(null, 'inbox')).toBe(0);
    expect(permissionLevel({ role: 'agent' }, 'unknown_feature')).toBe(0);
  });
});
