import { describe, expect, it } from 'vitest';

const { buildWhere, orderBy } = require('./store.js');

describe('voice store: Mongo-style filters → SQL', () => {
  it('binds every value as a parameter', () => {
    const params: unknown[] = ['calls'];
    const sql = buildWhere(
      {
        companyId: "x' OR 1=1 --",
        status: { $in: ['ringing', 'in-progress'] },
      },
      params,
    );
    expect(sql).not.toContain('OR 1=1');
    expect(params).toEqual([
      'calls',
      "x' OR 1=1 --",
      ['ringing', 'in-progress'],
    ]);
  });

  it('supports comparison, $ne, $exists, dotted paths and _id', () => {
    const params: unknown[] = [];
    const sql = buildWhere(
      {
        'sync.state': 'queued',
        attempts: { $lt: 3 },
        nextAt: { $lte: '2026-01-01' },
        leadId: { $exists: true },
        status: { $ne: 'removed' },
        _id: { $in: ['a', 'b'] },
      },
      params,
    );
    expect(sql).toContain(`doc #>> '{sync,state}' = $1`);
    expect(sql).toContain('::numeric < $2::numeric');
    expect(sql).toContain(`doc #> '{leadId}' IS NOT NULL`);
    expect(sql).toContain('id = ANY(');
    expect(params).toEqual(['queued', 3, '2026-01-01', 'removed', ['a', 'b']]);
  });

  it('treats empty $in as no match and rejects unsafe field paths', () => {
    expect(buildWhere({ status: { $in: [] } }, [])).toBe('FALSE');
    expect(() => buildWhere({ "a'); DROP TABLE x; --": 1 }, [])).toThrow(
      /Invalid field path/,
    );
    expect(() => buildWhere({ status: { $where: 'x' } }, [])).toThrow(
      /Unsupported operator/,
    );
  });

  it('orders numerically when values are numbers', () => {
    expect(orderBy({ createdAt: -1 })).toContain('DESC');
    expect(orderBy({ _id: 1 })).toBe('ORDER BY id ASC');
  });
});
