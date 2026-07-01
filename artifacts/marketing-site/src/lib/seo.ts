// Single source of truth for per-route SEO metadata.
//
// Used in two places:
//   1. Build-time prerender (`prerender.mjs` via `entry-server`) — `renderHead`
//      emits the full <head> tag string baked into each route's static HTML so
//      non-JavaScript crawlers receive route-correct metadata + structured data.
//   2. Client runtime (`applyMeta`) — keeps the document head in sync as the SPA
//      navigates between routes so Google's render pass and the browser tab match.

export const SITE_URL = "https://omnicore.irofficial.com";
export const OG_IMAGE = `${SITE_URL}/opengraph.png`;

export interface RouteMeta {
  /** Canonical path, always starting with "/". */
  path: string;
  title: string;
  description: string;
  ogType: string;
  /** JSON-LD structured data for this route, or null for none. */
  jsonLd: unknown | null;
  /** When true, emit `noindex` and omit the canonical link (e.g. the 404 page). */
  noindex?: boolean;
}

const ORGANIZATION = {
  "@type": "Organization",
  name: "Atelier OmniCore",
  legalName: "IR Atelier (Idylle Radieuse)",
  url: SITE_URL,
  description:
    "Multi-tenant omnichannel helpdesk and AI customer support platform.",
  address: {
    "@type": "PostalAddress",
    addressLocality: "Multan",
    addressRegion: "Punjab",
    addressCountry: "PK",
  },
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    telephone: "+923294816780",
    email: "atelier@irofficial.com",
  },
};

const HOME_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    ORGANIZATION,
    {
      "@type": "SoftwareApplication",
      name: "Atelier OmniCore",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: `${SITE_URL}/`,
      description:
        "Premium multi-tenant SaaS platform that unifies email, chat, and social conversations in one AI-powered omnichannel helpdesk.",
      publisher: ORGANIZATION,
    },
  ],
};

const PRICING_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "OmniCore Pricing",
  url: `${SITE_URL}/pricing`,
  description:
    "Transparent pricing for OmniCore omnichannel helpdesk. All plans include a 14-day free trial. Taxes may apply and will be calculated at checkout.",
  mainEntity: {
    "@type": "ItemList",
    name: "OmniCore Subscription Plans",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        item: {
          "@type": "Product",
          name: "OmniCore Starter",
          description:
            "For small teams. Up to 3 agents, 1 brand, live chat widget, email integration, basic reporting, 500 conversations per month. 14-day free trial, then $29.00 per month. Cancel anytime.",
          brand: { "@type": "Brand", name: "Atelier OmniCore" },
          offers: {
            "@type": "Offer",
            price: "29.00",
            priceCurrency: "USD",
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: "29.00",
              priceCurrency: "USD",
              billingIncrement: 1,
              unitCode: "MON",
              referenceQuantity: {
                "@type": "QuantitativeValue",
                value: 1,
                unitCode: "MON",
              },
            },
            availability: "https://schema.org/InStock",
            url: `${SITE_URL}/checkout?plan=starter`,
            description:
              "14-day free trial, then $29.00 per month. Taxes may apply and will be calculated at checkout.",
          },
        },
      },
      {
        "@type": "ListItem",
        position: 2,
        item: {
          "@type": "Product",
          name: "OmniCore Growth",
          description:
            "For scaling teams. Unlimited agents, up to 10 brands, AI bot deflection, advanced reporting, SMTP, 10,000 conversations per month. 14-day free trial, then $79.00 per month. Cancel anytime.",
          brand: { "@type": "Brand", name: "Atelier OmniCore" },
          offers: {
            "@type": "Offer",
            price: "79.00",
            priceCurrency: "USD",
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: "79.00",
              priceCurrency: "USD",
              billingIncrement: 1,
              unitCode: "MON",
              referenceQuantity: {
                "@type": "QuantitativeValue",
                value: 1,
                unitCode: "MON",
              },
            },
            availability: "https://schema.org/InStock",
            url: `${SITE_URL}/checkout?plan=growth`,
            description:
              "14-day free trial, then $79.00 per month. Taxes may apply and will be calculated at checkout.",
          },
        },
      },
    ],
  },
};

function webPage(name: string, path: string, description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name,
    url: `${SITE_URL}${path}`,
    description,
    isPartOf: {
      "@type": "WebSite",
      name: "Atelier OmniCore",
      url: SITE_URL,
    },
    publisher: ORGANIZATION,
  };
}

export const routeMeta: RouteMeta[] = [
  {
    path: "/",
    title: "Atelier OmniCore — AI-Powered Omnichannel Helpdesk Software",
    description:
      "Atelier OmniCore is a premium multi-tenant SaaS platform that unifies email, chat, and social conversations in one AI-powered omnichannel helpdesk. 14-day free trial.",
    ogType: "website",
    jsonLd: HOME_JSON_LD,
  },
  {
    path: "/pricing",
    title: "Pricing — Atelier OmniCore | Plans from $29/month",
    description:
      "OmniCore pricing: Starter $29/month, Growth $79/month. Every plan includes a 14-day free trial. Taxes may apply and will be calculated at checkout.",
    ogType: "website",
    jsonLd: PRICING_JSON_LD,
  },
  {
    path: "/contact",
    title: "Contact — Atelier OmniCore",
    description:
      "Get in touch with the Atelier OmniCore team. Contact sales about Enterprise plans, ask about onboarding, or reach support for your omnichannel helpdesk.",
    ogType: "website",
    jsonLd: webPage(
      "Contact Atelier OmniCore",
      "/contact",
      "Contact the Atelier OmniCore sales and support team.",
    ),
  },
  {
    path: "/help",
    title: "Help Center — Atelier OmniCore",
    description:
      "Atelier OmniCore Help Center. Guides for setting up your omnichannel helpdesk, live chat widget, email integration, and AI bot deflection.",
    ogType: "website",
    jsonLd: webPage(
      "Atelier OmniCore Help Center",
      "/help",
      "Documentation and guides for the Atelier OmniCore omnichannel helpdesk.",
    ),
  },
  {
    path: "/help/google-workspace-forwarding",
    title: "Google Workspace Email Forwarding — Atelier OmniCore Help",
    description:
      "Step-by-step guide to forwarding email from your Google Workspace (G Suite) mailbox to Atelier OmniCore so inbound messages become support conversations automatically.",
    ogType: "article",
    jsonLd: webPage(
      "Google Workspace Email Forwarding",
      "/help/google-workspace-forwarding",
      "Forward Google Workspace email to OmniCore to automatically create support conversations.",
    ),
  },
  {
    path: "/help/microsoft-365-email-setup",
    title: "Microsoft 365 Email Setup — Atelier OmniCore Help",
    description:
      "Configure Microsoft 365 / Exchange Online mail flow rules to route your support mailbox into OmniCore. Covers per-mailbox forwarding and Exchange transport rules.",
    ogType: "article",
    jsonLd: webPage(
      "Microsoft 365 Email Setup",
      "/help/microsoft-365-email-setup",
      "Route Microsoft 365 support email to OmniCore using mail flow rules.",
    ),
  },
  {
    path: "/help/ai-bot-setup",
    title: "AI Bot Setup & Configuration — Atelier OmniCore Help",
    description:
      "Enable and configure the OmniCore AI bot: set bot persona, build your knowledge base, define handoff rules, and review deflection performance.",
    ogType: "article",
    jsonLd: webPage(
      "AI Bot Setup & Configuration",
      "/help/ai-bot-setup",
      "Configure OmniCore's AI bot for automated deflection, handoff rules, and knowledge base management.",
    ),
  },
  {
    path: "/terms",
    title: "Terms of Service — Atelier OmniCore",
    description:
      "Read the Terms of Service for Atelier OmniCore, the multi-tenant omnichannel helpdesk platform. Subscription terms, billing, trials, and acceptable use.",
    ogType: "website",
    jsonLd: webPage(
      "Terms of Service",
      "/terms",
      "The terms governing use of the Atelier OmniCore platform.",
    ),
  },
  {
    path: "/privacy",
    title: "Privacy Policy — Atelier OmniCore",
    description:
      "Atelier OmniCore Privacy Policy. How we collect, use, and protect your data across our omnichannel helpdesk and customer support platform.",
    ogType: "website",
    jsonLd: webPage(
      "Privacy Policy",
      "/privacy",
      "How Atelier OmniCore collects, uses, and protects your data.",
    ),
  },
  {
    path: "/refunds",
    title: "Refund Policy — Atelier OmniCore",
    description:
      "Atelier OmniCore Refund Policy. New subscribers can request a full refund within 30 days. Learn how cancellations, trials, and refunds work.",
    ogType: "website",
    jsonLd: webPage(
      "Refund Policy",
      "/refunds",
      "Atelier OmniCore's refund, cancellation, and trial terms.",
    ),
  },
];

/**
 * Metadata for unmatched paths. Rendered into 404.html at build time and applied
 * on the client for any route that matches no page, so JS-rendering crawlers keep
 * the `noindex` signal instead of inheriting the home page's index directive.
 */
export const NOT_FOUND_META: RouteMeta = {
  path: "/404",
  title: "Page Not Found — Atelier OmniCore",
  description: "Sorry, the page you were looking for could not be found.",
  ogType: "website",
  jsonLd: null,
  noindex: true,
};

/** Normalize an incoming pathname to a canonical route key. */
function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  // Strip query/hash and a single trailing slash (except root).
  let p = pathname.split(/[?#]/)[0];
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

/** Metadata for a path; falls back to the home entry for unknown routes. */
export function metaForPath(pathname: string): RouteMeta {
  const p = normalizePath(pathname);
  return routeMeta.find((m) => m.path === p) ?? NOT_FOUND_META;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function canonicalUrl(path: string): string {
  return path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}

/**
 * Build the full <head> metadata block for a route as an HTML string.
 * Consumed only at build time by the prerender step.
 */
export function renderHead(meta: RouteMeta): string {
  const canonical = canonicalUrl(meta.path);
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  const tags = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<meta name="robots" content="${meta.noindex ? "noindex, follow" : "index, follow"}" />`,
    meta.noindex ? "" : `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:type" content="${escapeHtml(meta.ogType)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(OG_IMAGE)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${escapeHtml(OG_IMAGE)}" />`,
  ];
  if (meta.jsonLd) {
    // Escape "<" to avoid breaking out of the <script> element.
    const json = JSON.stringify(meta.jsonLd).replace(/</g, "\\u003c");
    tags.push(`<script type="application/ld+json">${json}</script>`);
  }
  return tags.filter(Boolean).join("\n    ");
}

/**
 * Sync the live document head with a route's metadata. Client-only.
 * Mirrors `renderHead` so SPA navigation keeps head tags route-correct.
 */
export function applyMeta(meta: RouteMeta): void {
  if (typeof document === "undefined") return;
  const canonical = canonicalUrl(meta.path);

  document.title = meta.title;

  const setMeta = (
    selectorAttr: "name" | "property",
    key: string,
    content: string,
  ) => {
    let el = document.head.querySelector<HTMLMetaElement>(
      `meta[${selectorAttr}="${key}"]`,
    );
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(selectorAttr, key);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  };

  setMeta("name", "description", meta.description);
  setMeta("name", "robots", meta.noindex ? "noindex, follow" : "index, follow");
  setMeta("property", "og:title", meta.title);
  setMeta("property", "og:description", meta.description);
  setMeta("property", "og:type", meta.ogType);
  setMeta("property", "og:url", canonical);
  setMeta("property", "og:image", OG_IMAGE);
  setMeta("name", "twitter:card", "summary_large_image");
  setMeta("name", "twitter:title", meta.title);
  setMeta("name", "twitter:description", meta.description);
  setMeta("name", "twitter:image", OG_IMAGE);

  let link = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (meta.noindex) {
    if (link) link.remove();
  } else {
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", canonical);
  }

  const existing = document.getElementById("route-jsonld");
  if (existing) existing.remove();
  if (meta.jsonLd) {
    const script = document.createElement("script");
    script.id = "route-jsonld";
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(meta.jsonLd);
    document.head.appendChild(script);
  }
}
