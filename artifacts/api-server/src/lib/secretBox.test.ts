import { describe, expect, it } from 'vitest';

describe('secretBox', () => {
  it('round-trips and detects tampering', () => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'a'.repeat(64);
    const { seal, open, sealJson, openJson, mask } = require('./secretBox.js');
    const s = seal('xoxb-secret');
    expect(s.startsWith('v1:')).toBe(true);
    expect(s).not.toContain('xoxb');
    expect(open(s)).toBe('xoxb-secret');
    expect(openJson(sealJson({ a: 1 }))).toEqual({ a: 1 });
    const parts = s.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => open(parts.join(':'))).toThrow();
    expect(mask('https://hooks.slack.com/services/abc123', 6)).toBe(
      '••••abc123',
    );
  });
});
