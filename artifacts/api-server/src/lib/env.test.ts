import { afterEach, describe, expect, it } from 'vitest';

const { publicAppUrl } = require('./env.js');
const originalPublicAppUrl = process.env.PUBLIC_APP_URL;
const originalReplitDomains = process.env.REPLIT_DOMAINS;

afterEach(() => {
  for (const [key, value] of [
    ['PUBLIC_APP_URL', originalPublicAppUrl],
    ['REPLIT_DOMAINS', originalReplitDomains],
  ] as Array<[string, string | undefined]>) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('public application URL resolution', () => {
  it('uses a trimmed explicit URL before every other source', () => {
    process.env.PUBLIC_APP_URL = ' https://app.example.test/// ';
    process.env.REPLIT_DOMAINS = 'replit.example.test';

    expect(
      publicAppUrl({
        protocol: 'http',
        headers: { host: 'request.example.test' },
      }),
    ).toBe('https://app.example.test');
  });

  it('uses the first Replit domain when no explicit URL is set', () => {
    delete process.env.PUBLIC_APP_URL;
    process.env.REPLIT_DOMAINS = ' first.example.test , second.example.test ';

    expect(publicAppUrl()).toBe('https://first.example.test');
  });

  it('uses forwarded protocol and request host only as a final fallback', () => {
    delete process.env.PUBLIC_APP_URL;
    delete process.env.REPLIT_DOMAINS;

    expect(
      publicAppUrl({
        headers: {
          'x-forwarded-proto': 'https',
          host: 'workspace.example.test',
        },
      }),
    ).toBe('https://workspace.example.test');
    expect(publicAppUrl()).toBe('');
  });
});
