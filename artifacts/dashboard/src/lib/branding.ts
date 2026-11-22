import { useSyncExternalStore } from 'react';

/**
 * White-label branding for the dashboard. Loaded from /api/branding (resolved
 * by the request host, i.e. the agency's custom domain) before first render.
 * Applies title, favicon, brand colour (by re-pointing Tailwind's sky palette
 * CSS variables) and the agency's custom CSS.
 */
export interface Branding {
  appName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  loginTitle: string | null;
  loginSubtitle: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
  customCss: string;
  hidePoweredBy: boolean;
  emailFromName?: string | null;
  customLinks?: { label: string; url: string; openIn: 'embed' | 'tab' }[];
  agencyId: string | null;
}

export const DEFAULT_BRANDING: Branding = {
  appName: 'OmniCore',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#0284c7',
  accentColor: '#C9A450',
  loginTitle: null,
  loginSubtitle: null,
  supportEmail: null,
  supportUrl: null,
  customCss: '',
  hidePoweredBy: false,
  agencyId: null,
};

let current: Branding = DEFAULT_BRANDING;
const listeners = new Set<() => void>();

/** CSS that maps Tailwind's sky-* scale onto the brand colour. */
export function paletteCss(hex: string): string {
  const mix = (pct: number, to: 'white' | 'black') =>
    `color-mix(in oklab, ${hex} ${pct}%, ${to})`;
  return `:root{
  --color-sky-50:${mix(8, 'white')};--color-sky-100:${mix(14, 'white')};--color-sky-200:${mix(28, 'white')};
  --color-sky-300:${mix(48, 'white')};--color-sky-400:${mix(72, 'white')};--color-sky-500:${mix(88, 'white')};
  --color-sky-600:${hex};--color-sky-700:${mix(85, 'black')};--color-sky-800:${mix(70, 'black')};--color-sky-900:${mix(55, 'black')};
}`;
}

function styleTag(id: string, css: string) {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export function applyBranding(b: Branding) {
  current = b;
  document.title = b.appName;
  if (b.faviconUrl) {
    document
      .querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
      .forEach((l) => (l.href = b.faviconUrl!));
  }
  if (
    b.primaryColor &&
    b.primaryColor.toLowerCase() !== DEFAULT_BRANDING.primaryColor
  ) {
    styleTag('omni-brand-palette', paletteCss(b.primaryColor));
  }
  if (b.customCss) styleTag('omni-brand-custom', b.customCss);
  listeners.forEach((l) => l());
}

export async function loadBranding(timeoutMs = 1500): Promise<Branding> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(
      `/api/branding?host=${encodeURIComponent(window.location.hostname)}`,
      { signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!r.ok) return DEFAULT_BRANDING;
    const b = { ...DEFAULT_BRANDING, ...(await r.json()) } as Branding;
    applyBranding(b);
    return b;
  } catch {
    return DEFAULT_BRANDING;
  }
}

/** After sign-in: apply the user's agency brand (if any) even on the platform domain. */
export async function loadBrandingForUser(
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>,
) {
  try {
    const r = await authFetch('/api/branding/me');
    if (!r.ok) return;
    const b = (await r.json()) as Partial<Branding>;
    if (b.agencyId && b.agencyId !== current.agencyId)
      applyBranding({ ...DEFAULT_BRANDING, ...b } as Branding);
  } catch {
    /* keep host branding */
  }
}

export function getBranding(): Branding {
  return current;
}

export function useBranding(): Branding {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
}
