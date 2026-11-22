// White-label branding: the same settings OmniCore uses (agency branding on a
// custom domain, otherwise the platform's), loaded before the app renders.

import { companyName } from './workspace';

const state = {
  appName: 'OmniCore',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: null,
  hidePoweredBy: false,
  agencyId: null,
};

export async function loadBrand() {
  try {
    const res = await fetch('/api/branding', { credentials: 'same-origin' });
    if (res.ok) Object.assign(state, await res.json());
  } catch {
    /* keep defaults */
  }
  document.title = productName();
  // Only agency brands recolour the HR app; the platform default keeps indigo.
  if (state.agencyId) applyPalette(state.primaryColor);
  if (state.faviconUrl) {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = state.faviconUrl;
  }
  return state;
}

export const brand = () => state;
/** e.g. "OmniCore HR", or "<Agency app name> HR" on an agency domain. */
export const productName = () => `${state.appName || 'OmniCore'} HR`;
/** The employer's name when signed in, otherwise the product name. */
export const displayName = () => companyName() || productName();
export const logoUrl = () => state.logoUrl || null;
export const initials = (name = displayName()) =>
  String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || 'HR';

// ── Brand colour → primary palette (CSS variables used by tailwind.config.js) ──
const SHADES = { 50: 0.92, 100: 0.84, 200: 0.68, 300: 0.48, 400: 0.24, 500: 0, 600: -0.12, 700: -0.28, 800: -0.42, 900: -0.54, 950: -0.7 };

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function applyPalette(hex = state.primaryColor) {
  const base = hexToRgb(hex);
  if (!base) return false;
  const root = document.documentElement.style;
  for (const [shade, amount] of Object.entries(SHADES)) {
    const mix = base.map((c) =>
      Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)),
    );
    root.setProperty(`--hr-primary-${shade}`, mix.join(' '));
  }
  return true;
}
