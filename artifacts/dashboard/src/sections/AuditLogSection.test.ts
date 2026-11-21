import { describe, expect, it } from 'vitest';
import { buildAuditQuery } from './AuditLogSection';

const empty = {
  q: '',
  category: '',
  outcome: '',
  actorType: '',
  from: '',
  to: '',
  tenantId: '',
};

describe('audit log filters → API query', () => {
  it('sends only the filters that are set', () => {
    expect(buildAuditQuery(empty, 1)).toBe('page=1&limit=50');
    const qs = new URLSearchParams(
      buildAuditQuery(
        {
          ...empty,
          q: 'login',
          category: 'auth',
          outcome: 'failure',
          actorType: 'agent',
          tenantId: 't1',
        },
        3,
        100,
      ),
    );
    expect(Object.fromEntries(qs)).toEqual({
      q: 'login',
      category: 'auth',
      outcome: 'failure',
      actorType: 'agent',
      tenantId: 't1',
      page: '3',
      limit: '100',
    });
  });

  it('turns calendar days into inclusive local-day bounds', () => {
    const qs = new URLSearchParams(
      buildAuditQuery({ ...empty, from: '2026-11-01', to: '2026-11-02' }, 1),
    );
    const from = new Date(qs.get('from')!);
    const to = new Date(qs.get('to')!);
    expect(from.getHours()).toBe(0);
    expect(to.getHours()).toBe(23);
    expect(to.getTime() - from.getTime()).toBe(2 * 86400e3 - 1);
  });
});
