import { describe, expect, it } from 'vitest';
import { DEFAULT_BRANDING, getBranding, paletteCss } from './branding';

describe('white-label theme', () => {
  it('maps the brand colour onto the whole sky palette', () => {
    const css = paletteCss('#7c3aed');
    expect(css).toContain('--color-sky-600:#7c3aed');
    for (const step of [50, 100, 200, 300, 400, 500, 700, 800, 900])
      expect(css).toContain(`--color-sky-${step}:color-mix(in oklab, #7c3aed`);
    expect(css).toContain('white)');
    expect(css).toContain('black)');
  });

  it('starts from the platform brand', () => {
    expect(getBranding()).toEqual(DEFAULT_BRANDING);
    expect(DEFAULT_BRANDING.appName).toBe('OmniCore');
  });
});
