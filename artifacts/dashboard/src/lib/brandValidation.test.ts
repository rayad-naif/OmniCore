import { describe, expect, it } from 'vitest';
import { isValidHex, isValidOrigin } from './brandValidation';

describe('brand settings validation', () => {
  it('accepts three- and six-digit hex colors', () => {
    expect(isValidHex('#fff')).toBe(true);
    expect(isValidHex('#6366f1')).toBe(true);
    expect(isValidHex('6366f1')).toBe(false);
    expect(isValidHex('#12345')).toBe(false);
  });

  it('accepts only HTTP(S) origins', () => {
    expect(isValidOrigin(' https://example.com ')).toBe(true);
    expect(isValidOrigin('http://localhost:3000')).toBe(true);
    expect(isValidOrigin('example.com')).toBe(false);
    expect(isValidOrigin('javascript:alert(1)')).toBe(false);
  });
});
