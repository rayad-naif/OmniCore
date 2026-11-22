// White-label branding: the same settings OmniCore uses (agency branding on a
// custom domain, otherwise the platform's), loaded before the app renders.

import { companyName } from './workspace';

const state = {
  appName: 'OmniCore',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: null,
  hidePoweredBy: false,
};

export async function loadBrand() {
  try {
    const res = await fetch('/api/branding', { credentials: 'same-origin' });
    if (res.ok) Object.assign(state, await res.json());
  } catch {
    /* keep defaults */
  }
  document.title = productName();
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
