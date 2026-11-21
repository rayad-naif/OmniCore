import { describe, expect, it } from 'vitest';

const { sslFor } = require('./dbSsl.js');
const prod = { NODE_ENV: 'production' };

describe('database TLS policy', () => {
  it('skips TLS for local and private-network hosts', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      'postgres',
      'dpg-abc123-a',
      '10.0.1.5',
      '172.20.0.2',
      '192.168.1.9',
    ]) {
      expect(sslFor(`postgres://u:p@${host}:5432/db`, prod)).toBe(false);
    }
  });
  it('verifies TLS for public hosts in production only', () => {
    expect(sslFor('postgres://u:p@db.example.com/db', prod)).toEqual({
      rejectUnauthorized: true,
    });
    expect(
      sslFor('postgres://u:p@db.example.com/db', { NODE_ENV: 'development' }),
    ).toBe(false);
  });
  it('honours DATABASE_SSL and sslmode overrides', () => {
    expect(
      sslFor('postgres://u:p@db.example.com/db', {
        ...prod,
        DATABASE_SSL: 'no-verify',
      }),
    ).toEqual({ rejectUnauthorized: false });
    expect(
      sslFor('postgres://u:p@localhost/db', {
        ...prod,
        DATABASE_SSL: 'verify',
      }),
    ).toEqual({ rejectUnauthorized: true });
    expect(
      sslFor('postgres://u:p@db.example.com/db', {
        ...prod,
        DATABASE_SSL: 'disable',
      }),
    ).toBe(false);
    expect(
      sslFor('postgres://u:p@db.example.com/db?sslmode=require', prod),
    ).toBeUndefined();
  });
});
