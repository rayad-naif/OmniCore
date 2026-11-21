import { describe, expect, it } from 'vitest';

const { redact, describeRoute, buildQuery } = require('./audit.js');

describe('audit redaction', () => {
  it('removes secrets at any depth and trims large values', () => {
    const out = redact({
      email: 'a@b.c',
      password: 'hunter2',
      nested: { apiKey: 'k', smtp_pass: 'p', ok: 'keep', refresh_token: 't' },
      data: 'x'.repeat(5000),
      list: Array.from({ length: 30 }, (_, i) => i),
      long: 'y'.repeat(900),
    });
    expect(out.email).toBe('a@b.c');
    expect(out.password).toBe('[redacted]');
    expect(out.nested).toEqual({
      apiKey: '[redacted]',
      smtp_pass: '[redacted]',
      ok: 'keep',
      refresh_token: '[redacted]',
    });
    expect(out.data).toBe('[file 5000 chars]');
    expect(out.list).toHaveLength(21);
    expect(out.long).toMatch(/…\[900 chars\]$/);
  });
});

describe('audit action naming', () => {
  it('derives stable action names from route templates', () => {
    expect(describeRoute('POST', '/api/conversations/:id/messages')).toEqual({
      action: 'conversations.messages.create',
      resourceType: 'conversation',
    });
    expect(describeRoute('DELETE', '/api/agents/:id').action).toBe(
      'agents.delete',
    );
    expect(describeRoute('GET', '/api/contacts/export').action).toBe(
      'contacts.export',
    );
    expect(
      describeRoute('PATCH', '/api/super-admin/tenants/:id/limits'),
    ).toEqual({
      action: 'super_admin.tenants.limits.update',
      resourceType: 'tenant',
    });
  });

  it('normalises raw ids from unmatched routes', () => {
    expect(
      describeRoute(
        'POST',
        '/api/v1/conversations/eed97fa4-8a9a-401b-9b94-cb95225c837c/messages',
      ),
    ).toEqual({
      action: 'v1.conversations.messages.create',
      resourceType: 'conversation',
    });
  });
});

describe('audit query builder', () => {
  it('always enforces the workspace scope and parameterises input', () => {
    const { where, params } = buildQuery(
      { tenantId: 'other', q: "x' OR 1=1 --", outcome: 'failure' },
      { tenantId: 'mine' },
    );
    expect(params).toContain('mine');
    expect(params).not.toContain('other');
    expect(params).toContain("%x' OR 1=1 --%");
    expect(where).not.toContain('OR 1=1');
  });
});
