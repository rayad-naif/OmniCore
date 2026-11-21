import { describe, expect, it } from 'vitest';

const agencies = require('./agencies.js');

describe('agency branding validation', () => {
  it('accepts valid branding and normalises booleans', () => {
    expect(
      agencies.cleanBranding({
        appName: 'Acme Desk',
        primaryColor: '#112233',
        logoUrl: 'https://cdn.acme.com/l.png',
        hidePoweredBy: 1,
      }),
    ).toEqual({
      appName: 'Acme Desk',
      primaryColor: '#112233',
      logoUrl: 'https://cdn.acme.com/l.png',
      hidePoweredBy: true,
    });
  });

  it('rejects unsafe or malformed values', () => {
    expect(() => agencies.cleanBranding({ primaryColor: 'red' })).toThrow(
      /hex/,
    );
    expect(() =>
      agencies.cleanBranding({ logoUrl: 'javascript:alert(1)' }),
    ).toThrow(/https/);
    expect(() =>
      agencies.cleanBranding({ logoUrl: 'http://x.com/a.png' }),
    ).toThrow(/https/);
    expect(() =>
      agencies.cleanBranding({
        customCss: '</style><script>alert(1)</script>',
      }),
    ).toThrow(/customCss/);
    expect(() =>
      agencies.cleanBranding({ customCss: '@import url(https://evil)' }),
    ).toThrow(/customCss/);
    expect(() => agencies.cleanBranding({ supportEmail: 'nope' })).toThrow(
      /email/,
    );
  });

  it('ignores unknown keys', () => {
    expect(agencies.cleanBranding({ appName: 'A', evil: 'x' })).toEqual({
      appName: 'A',
    });
  });
});

describe('custom domains', () => {
  it('validates hostnames', () => {
    expect(agencies.validateHostname('App.Acme.com.')).toBe('app.acme.com');
    expect(() => agencies.validateHostname('localhost')).toThrow();
    expect(() => agencies.validateHostname('http://acme.com')).toThrow();
    expect(() => agencies.validateHostname('a_b.acme.com')).toThrow();
  });

  it('gives CNAME and TXT instructions', () => {
    const dns = agencies.dnsInstructions({
      hostname: 'app.acme.com',
      verification_token: 'omnicore-verify=abc',
    });
    expect(dns.map((r: { type: string }) => r.type)).toEqual(['CNAME', 'TXT']);
    expect(dns[1].name).toBe('_omnicore.app.acme.com');
  });
});

describe('white-label text', () => {
  it('replaces the platform name and links', () => {
    const b = { appName: 'Acme Desk' };
    expect(
      agencies.rebrandText('Welcome to Atelier OmniCore and OmniCore', b),
    ).toBe('Welcome to Acme Desk and Acme Desk');
    expect(agencies.rebrandText('OmniCore', { appName: 'OmniCore' })).toBe(
      'OmniCore',
    );
    process.env.PUBLIC_APP_URL = 'https://omnicore.irofficial.com';
    expect(
      agencies.rebrandLinks(
        '<a href="https://omnicore.irofficial.com/dashboard/?x=1">',
        'https://help.acme.com',
      ),
    ).toBe('<a href="https://help.acme.com/dashboard/?x=1">');
  });
});
