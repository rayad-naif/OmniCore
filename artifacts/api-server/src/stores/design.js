'use strict';

/**
 * stores/design.js — store templates and content.
 *
 * A template is a curated palette, type pairing, homepage layout and starter
 * catalog. Content (tagline, homepage copy, About/FAQ/policies, categories and
 * starter products) is written by the workspace's AI when the plan includes AI,
 * otherwise from the template's own copy. buildSpec() turns template + content
 * into the spec the store agent applies (Storefront theme colours, CSS, pages,
 * menus, catalog).
 */

const FONTS = {
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif:
    "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
  rounded:
    "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

const TEMPLATES = {
  boutique: {
    name: 'Boutique',
    description:
      'Fashion, apparel and accessories. Elegant serif headings, charcoal and rose.',
    palette: {
      primary: '#be185d',
      accent: '#be185d',
      hero: '#1f2937',
      headerBg: '#111827',
      headerText: '#f9fafb',
      footerBg: '#111827',
      footerText: '#e5e7eb',
      heading: '#111827',
      text: '#374151',
      background: '#ffffff',
    },
    fonts: { heading: 'serif', body: 'sans' },
    radius: '2px',
    sections: ['categories', 'recent', 'featured'],
    sample: {
      categories: ['New arrivals', 'Dresses', 'Accessories'],
      products: [
        ['Linen wrap dress', 49, 'Dresses'],
        ['Silk scarf', 19, 'Accessories'],
        ['Everyday tote', 29, 'Accessories'],
        ['Pleated midi skirt', 39, 'New arrivals'],
        ['Cotton shirt dress', 45, 'Dresses'],
        ['Leather belt', 22, 'Accessories'],
      ],
    },
  },
  fresh: {
    name: 'Fresh market',
    description:
      'Food, grocery, bakery and cafés. Friendly rounded type, greens and cream.',
    palette: {
      primary: '#15803d',
      accent: '#ca8a04',
      hero: '#14532d',
      headerBg: '#f0fdf4',
      headerText: '#14532d',
      footerBg: '#14532d',
      footerText: '#dcfce7',
      heading: '#14532d',
      text: '#3f3f46',
      background: '#fffdf7',
    },
    fonts: { heading: 'rounded', body: 'rounded' },
    radius: '12px',
    sections: ['categories', 'featured', 'on_sale'],
    sample: {
      categories: ['Bakery', 'Fruit & veg', 'Pantry'],
      products: [
        ['Sourdough loaf', 6, 'Bakery'],
        ['Seasonal fruit box', 24, 'Fruit & veg'],
        ['Raw wildflower honey', 12, 'Pantry'],
        ['Butter croissants (4)', 9, 'Bakery'],
        ['Organic salad mix', 5, 'Fruit & veg'],
        ['Cold-pressed olive oil', 16, 'Pantry'],
      ],
    },
  },
  tech: {
    name: 'Tech',
    description:
      'Electronics, gadgets and accessories. Sharp sans-serif, navy and electric blue.',
    palette: {
      primary: '#2563eb',
      accent: '#2563eb',
      hero: '#0f172a',
      headerBg: '#0f172a',
      headerText: '#e2e8f0',
      footerBg: '#020617',
      footerText: '#cbd5e1',
      heading: '#0f172a',
      text: '#334155',
      background: '#f8fafc',
    },
    fonts: { heading: 'sans', body: 'sans' },
    radius: '8px',
    sections: ['featured', 'recent', 'best_selling'],
    sample: {
      categories: ['Audio', 'Chargers & cables', 'Accessories'],
      products: [
        ['Wireless earbuds', 59, 'Audio'],
        ['65W USB-C charger', 35, 'Chargers & cables'],
        ['Braided USB-C cable', 12, 'Chargers & cables'],
        ['Bluetooth speaker', 79, 'Audio'],
        ['Laptop stand', 39, 'Accessories'],
        ['Wireless mouse', 25, 'Accessories'],
      ],
    },
  },
  beauty: {
    name: 'Beauty',
    description:
      'Beauty, skincare and wellness. Soft blush tones with plum accents.',
    palette: {
      primary: '#9d174d',
      accent: '#db2777',
      hero: '#831843',
      headerBg: '#fdf2f8',
      headerText: '#831843',
      footerBg: '#500724',
      footerText: '#fce7f3',
      heading: '#500724',
      text: '#4b5563',
      background: '#fffafc',
    },
    fonts: { heading: 'serif', body: 'sans' },
    radius: '24px',
    sections: ['featured', 'categories', 'recent'],
    sample: {
      categories: ['Skincare', 'Body', 'Gift sets'],
      products: [
        ['Hydrating face serum', 32, 'Skincare'],
        ['Gentle cleansing gel', 18, 'Skincare'],
        ['Shea body butter', 21, 'Body'],
        ['Rose hand cream', 14, 'Body'],
        ['Night repair cream', 38, 'Skincare'],
        ['Self-care gift set', 55, 'Gift sets'],
      ],
    },
  },
  home: {
    name: 'Home & living',
    description:
      'Home decor, furniture and handmade goods. Warm sand and terracotta.',
    palette: {
      primary: '#c2410c',
      accent: '#c2410c',
      hero: '#7c2d12',
      headerBg: '#fffbeb',
      headerText: '#431407',
      footerBg: '#431407',
      footerText: '#fed7aa',
      heading: '#431407',
      text: '#57534e',
      background: '#fffcf5',
    },
    fonts: { heading: 'serif', body: 'sans' },
    radius: '6px',
    sections: ['categories', 'featured', 'recent'],
    sample: {
      categories: ['Living room', 'Kitchen', 'Textiles'],
      products: [
        ['Stoneware vase', 34, 'Living room'],
        ['Linen cushion cover', 24, 'Textiles'],
        ['Ceramic mug set', 28, 'Kitchen'],
        ['Woven throw', 59, 'Textiles'],
        ['Oak serving board', 32, 'Kitchen'],
        ['Scented candle', 18, 'Living room'],
      ],
    },
  },
  minimal: {
    name: 'Minimal',
    description:
      'Any kind of shop. Clean black and white that lets products stand out.',
    palette: {
      primary: '#111827',
      accent: '#111827',
      hero: '#111827',
      headerBg: '#ffffff',
      headerText: '#111827',
      footerBg: '#f3f4f6',
      footerText: '#374151',
      heading: '#111827',
      text: '#4b5563',
      background: '#ffffff',
    },
    fonts: { heading: 'sans', body: 'sans' },
    radius: '0px',
    sections: ['recent', 'featured', 'categories'],
    sample: {
      categories: ['Featured', 'Best sellers', 'Essentials'],
      products: [
        ['Signature product', 29, 'Featured'],
        ['Best seller', 39, 'Best sellers'],
        ['Everyday essential', 15, 'Essentials'],
        ['Gift card', 25, 'Featured'],
        ['Starter bundle', 49, 'Best sellers'],
        ['Refill pack', 12, 'Essentials'],
      ],
    },
  },
};

const ZERO_DECIMAL = new Set([
  'jpy',
  'krw',
  'vnd',
  'clp',
  'isk',
  'ugx',
  'xaf',
  'xof',
  'pyg',
]);
// Rough multipliers so the template's sample prices look sensible in other currencies.
const PRICE_FACTOR = {
  usd: 1,
  eur: 0.95,
  gbp: 0.8,
  cad: 1.35,
  aud: 1.5,
  pkr: 280,
  inr: 85,
  aed: 3.7,
  sar: 3.75,
  ngn: 1500,
  jpy: 150,
  bdt: 120,
  egp: 50,
  try: 34,
  zar: 18,
  myr: 4.5,
  idr: 16000,
  php: 58,
};

function catalogTemplates() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({
    key,
    name: t.name,
    description: t.description,
    colors: [
      t.palette.hero,
      t.palette.primary,
      t.palette.headerBg,
      t.palette.background,
    ],
  }));
}

function niceprice(v, currency) {
  const factor = PRICE_FACTOR[currency] || 1;
  let n = v * factor;
  if (n >= 1000) n = Math.round(n / 50) * 50;
  else if (n >= 100) n = Math.round(n / 5) * 5;
  else n = Math.round(n) - 0.01;
  return ZERO_DECIMAL.has(currency) || n >= 100
    ? String(Math.max(1, Math.round(n)))
    : n.toFixed(2);
}

const clip = (s, n) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));

/** Template copy, used when AI is unavailable or fails. */
function fallbackContent(t, { name, description, city, email, currency }) {
  const where = city ? ` in ${city}` : '';
  return {
    tagline: clip(description || t.description.split('.')[0], 90),
    hero: {
      heading: `Welcome to ${name}`,
      text:
        clip(description, 200) ||
        `Quality products, friendly service and fast delivery${where}.`,
      button_label: 'Shop now',
    },
    intro: [
      { type: 'heading', text: `Why shop with ${name}` },
      {
        type: 'list',
        items: [
          'Carefully chosen products',
          'Secure checkout',
          `Fast delivery${where}`,
          'Friendly support when you need it',
        ],
      },
    ],
    about: [
      `${name} started with a simple idea: offer products we love, with the kind of service we would want ourselves.`,
      clip(description, 400) ||
        'Every item in our shop is chosen with care, and we stand behind everything we sell.',
      `Questions? We are happy to help${email ? ` at ${email}` : ''}.`,
    ],
    faq: [
      {
        q: 'How long does delivery take?',
        a: `Most orders are dispatched within 1–2 business days${where ? ` and arrive soon after` : ''}. You will receive an email when your order ships.`,
      },
      {
        q: 'How can I pay?',
        a: 'You can pay online at checkout. Depending on your location, card, PayPal, bank transfer or cash on delivery are available.',
      },
      {
        q: 'Can I return an item?',
        a: 'Yes. Unused items in their original packaging can be returned within 14 days. See our Shipping & returns page for details.',
      },
      {
        q: 'How do I contact you?',
        a: `Use the contact page${email ? ` or email ${email}` : ''} and we will reply within one business day.`,
      },
    ],
    categories: t.sample.categories,
    products: t.sample.products.map(([pname, price, category]) => ({
      name: pname,
      price: niceprice(price, currency),
      category,
      short_description: `${pname} from ${name}.`,
      description: `${pname}. Chosen for quality and everyday use. Contact us if you have any questions about this product.`,
    })),
  };
}

function parseJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The AI did not return JSON');
  return JSON.parse(s.slice(start, end + 1));
}

/** Validates and clamps AI output into the content shape (missing parts come from the fallback). */
function cleanContent(raw, fallback, currency) {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  if (raw.tagline) out.tagline = clip(raw.tagline, 90);
  if (raw.hero && raw.hero.heading) {
    out.hero = {
      heading: clip(raw.hero.heading, 80),
      text: clip(raw.hero.text, 220),
      button_label: clip(raw.hero.button_label || 'Shop now', 30),
    };
  }
  if (Array.isArray(raw.highlights) && raw.highlights.length) {
    out.intro = [
      {
        type: 'heading',
        text: clip(raw.highlights_title || fallback.intro[0].text, 80),
      },
      {
        type: 'list',
        items: raw.highlights
          .slice(0, 5)
          .map((h) => clip(h, 120))
          .filter(Boolean),
      },
    ];
  }
  if (Array.isArray(raw.about) && raw.about.length)
    out.about = raw.about
      .slice(0, 5)
      .map((p) => clip(p, 600))
      .filter(Boolean);
  if (Array.isArray(raw.faq) && raw.faq.length)
    out.faq = raw.faq
      .slice(0, 8)
      .filter((f) => f && f.q && f.a)
      .map((f) => ({ q: clip(f.q, 160), a: clip(f.a, 500) }));
  if (Array.isArray(raw.categories) && raw.categories.length)
    out.categories = [
      ...new Set(raw.categories.map((c) => clip(c, 40)).filter(Boolean)),
    ].slice(0, 6);
  if (Array.isArray(raw.products) && raw.products.length) {
    const decimals = ZERO_DECIMAL.has(currency) ? 0 : 2;
    const products = raw.products
      .slice(0, 12)
      .filter((p) => p && p.name && Number(p.price) > 0)
      .map((p) => ({
        name: clip(p.name, 80),
        price: Number(p.price).toFixed(decimals),
        category: out.categories.includes(clip(p.category, 40))
          ? clip(p.category, 40)
          : out.categories[0],
        short_description: clip(p.short_description, 200),
        description: clip(p.description, 1200),
      }));
    if (products.length >= 3) out.products = products;
  }
  return out;
}

/**
 * Writes store content with the workspace's AI provider (agency key or the platform
 * key). Returns { content, source: 'ai' | 'template', warning? }.
 */
async function generateContent({
  tenantId,
  aiEnabled,
  template,
  name,
  description,
  city,
  email,
  currency,
}) {
  const t = TEMPLATES[template] || TEMPLATES.minimal;
  const fallback = fallbackContent(t, {
    name,
    description,
    city,
    email,
    currency,
  });
  if (!aiEnabled || !description)
    return { content: fallback, source: 'template' };
  try {
    const { resolveAiConfig, getProvider } = require('../lib/ai/providers');
    const cfg = await resolveAiConfig(tenantId);
    if (!cfg.apiKey)
      return {
        content: fallback,
        source: 'template',
        warning: 'AI is not configured on this platform.',
      };
    const provider = getProvider(cfg.provider);
    const prompt = `You write the launch content for a small online shop. Use plain, warm, specific language. No markdown, no emojis, no invented awards, reviews or statistics.
Shop name: ${clip(name, 80)}
What the shop sells and who for: ${clip(description, 800)}
Location: ${clip(city, 60) || 'not given'}
Currency: ${String(currency).toUpperCase()} (give realistic prices in this currency as plain numbers)
Template style: ${t.name} (${t.description})

Return ONLY a JSON object with exactly these keys:
{"tagline": "max 8 words",
 "hero": {"heading": "max 8 words", "text": "one or two sentences", "button_label": "2-3 words"},
 "highlights_title": "short heading", "highlights": ["4 short selling points"],
 "about": ["3 short paragraphs about the shop"],
 "faq": [{"q": "...", "a": "..."}] (5 questions about delivery, payment, returns, products, contact),
 "categories": ["3 to 5 product categories"],
 "products": [{"name": "...", "price": 0, "category": "one of categories", "short_description": "one sentence", "description": "two or three sentences"}] (8 starter products)}`;
    const result = await provider.turn({
      apiKey: cfg.apiKey,
      model: cfg.model,
      system:
        'You are a careful e-commerce copywriter. You answer with JSON only.',
      messages: [provider.userMessage(prompt)],
      tools: [],
    });
    return {
      content: cleanContent(parseJson(result.text), fallback, currency),
      source: 'ai',
    };
  } catch (err) {
    return {
      content: fallback,
      source: 'template',
      warning: `AI content failed (${String(err.message).slice(0, 160)}); template copy was used.`,
    };
  }
}

function policyPages(name, email, city) {
  const contact = email ? `email us at ${email}` : 'use our contact page';
  return [
    {
      slug: 'shipping-returns',
      title: 'Shipping & returns',
      blocks: [
        { type: 'heading', text: 'Shipping' },
        {
          type: 'paragraph',
          text: `Orders are usually dispatched within 1–2 business days${city ? ` from ${city}` : ''}. Delivery times and costs are shown at checkout.`,
        },
        { type: 'heading', text: 'Returns' },
        {
          type: 'paragraph',
          text: `If you are not happy with your order, you can return unused items in their original packaging within 14 days of delivery. To start a return, ${contact} with your order number.`,
        },
        {
          type: 'paragraph',
          text: 'Refunds are issued to the original payment method once we receive the item.',
        },
      ],
    },
    {
      slug: 'privacy-policy',
      title: 'Privacy policy',
      blocks: [
        {
          type: 'paragraph',
          text: `${name} collects the information needed to process your orders: your name, contact details, delivery address and order history. Payments are handled by our payment providers; we do not store card numbers.`,
        },
        {
          type: 'paragraph',
          text: 'We use your details only to fulfil orders, provide support and, if you agree, to send you updates. You can ask us to see, correct or delete your data at any time.',
        },
        { type: 'paragraph', text: `For privacy questions, ${contact}.` },
      ],
    },
    {
      slug: 'terms',
      title: 'Terms & conditions',
      blocks: [
        {
          type: 'paragraph',
          text: `These terms apply to purchases from ${name}. Prices are shown at checkout and include applicable taxes unless stated otherwise.`,
        },
        {
          type: 'paragraph',
          text: 'An order is accepted when we confirm it by email. We may cancel an order if a product is unavailable, in which case you receive a full refund.',
        },
        {
          type: 'paragraph',
          text: `Questions about these terms? ${contact.charAt(0).toUpperCase()}${contact.slice(1)}.`,
        },
      ],
    },
  ];
}

/**
 * Builds the agent spec: Storefront theme colours, CSS, homepage, pages, menus and catalog.
 * `brandColor` (optional, #rrggbb) replaces the template's primary and accent colours.
 */
function buildSpec({
  template,
  brandColor,
  content,
  name,
  email,
  city,
  phone,
}) {
  const t = TEMPLATES[template] || TEMPLATES.minimal;
  const p = { ...t.palette };
  if (isHex(brandColor)) {
    p.primary = brandColor;
    p.accent = brandColor;
  }
  const theme_mods = {
    storefront_header_background_color: p.headerBg,
    storefront_header_text_color: p.headerText,
    storefront_header_link_color: p.headerText,
    storefront_heading_color: p.heading,
    storefront_text_color: p.text,
    storefront_accent_color: p.accent,
    storefront_button_background_color: p.primary,
    storefront_button_text_color: '#ffffff',
    storefront_button_alt_background_color: p.accent,
    storefront_button_alt_text_color: '#ffffff',
    storefront_footer_background_color: p.footerBg,
    storefront_footer_heading_color: p.footerText,
    storefront_footer_text_color: p.footerText,
    storefront_footer_link_color: p.footerText,
    background_color: p.background.replace('#', ''),
  };
  const heading = FONTS[t.fonts.heading] || FONTS.sans;
  const body = FONTS[t.fonts.body] || FONTS.sans;
  const custom_css = [
    `body,button,input,select,textarea{font-family:${body}}`,
    `h1,h2,h3,h4,h5,h6,.site-title,.site-title a,.wc-block-components-title{font-family:${heading};letter-spacing:-0.01em}`,
    `body{background-color:${p.background}}`,
    `.home.page-template-template-homepage .site-header{margin-bottom:0}`,
    `.page-template-template-homepage .entry-header{display:none}`,
    // Storefront pads the homepage (.page-template-template-homepage:not(.has-post-thumbnail) .site-main).
    `.page-template-template-homepage .type-page,.page-template-template-homepage .site-main{padding-top:0!important;margin-top:0}`,
    `.page-template-template-homepage .entry-content ul{list-style:none;margin:0 auto 2em;display:flex;flex-wrap:wrap;justify-content:center;gap:.6em 1.6em;max-width:48rem}`,
    `.page-template-template-homepage .entry-content ul li::before{content:'✓';color:${p.primary};font-weight:700;margin-right:.45em}`,
    `.page-template-template-homepage .wp-block-cover.alignfull{width:100vw;max-width:100vw;margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);margin-bottom:3em;padding:4em 1.5em}`,
    `.wp-block-cover .wp-block-cover__inner-container h1,.wp-block-cover .wp-block-cover__inner-container p{color:#fff!important}`,
    `.wp-block-cover h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.1;margin-bottom:.5em}`,
    `.wp-block-cover p{font-size:1.15rem;opacity:.92;max-width:36rem;margin-left:auto;margin-right:auto}`,
    `.wp-block-cover .wp-block-button__link{background:#fff;color:${p.hero};font-weight:600;padding:.8em 1.8em}`,
    `.button,button,input[type=submit],.wp-block-button__link,.wc-block-components-button{border-radius:${t.radius}}`,
    `ul.products li.product img,.wc-block-grid__product-image img,.storefront-product-section img{border-radius:${t.radius}}`,
    `.storefront-product-section .section-title{font-family:${heading}}`,
    `.site-info{font-size:.85em}`,
  ].join('\n');

  const faqBlocks = content.faq.flatMap((f) => [
    { type: 'heading', text: f.q },
    { type: 'paragraph', text: f.a },
  ]);
  const contactLines = [
    email && `Email: ${email}`,
    phone && `Phone: ${phone}`,
    city && `Location: ${city}`,
  ].filter(Boolean);

  return {
    site_title: clip(name, 120),
    tagline: content.tagline,
    design: {
      theme_mods,
      custom_css,
      swatch: [p.primary, p.hero === p.primary ? p.headerBg : p.hero],
      home_sections: t.sections,
      home: {
        title: 'Home',
        heading: content.hero.heading,
        text: content.hero.text,
        button_label: content.hero.button_label,
        button_url: '/shop/',
        background: p.hero,
        blocks: content.intro,
      },
      pages: [
        {
          slug: 'about',
          title: 'About us',
          blocks: content.about.map((text) => ({ type: 'paragraph', text })),
        },
        {
          slug: 'contact',
          title: 'Contact',
          blocks: [
            {
              type: 'paragraph',
              text: `We would love to hear from you. Get in touch and we will reply within one business day.`,
            },
            ...(contactLines.length
              ? [{ type: 'list', items: contactLines }]
              : []),
          ],
        },
        { slug: 'faq', title: 'FAQ', blocks: faqBlocks },
        ...policyPages(name, email, city),
      ],
      menu: ['home', 'shop', 'about', 'faq', 'contact'],
      footer_menu: ['shipping-returns', 'privacy-policy', 'terms'],
    },
    catalog: { categories: content.categories, products: content.products },
  };
}

module.exports = {
  TEMPLATES,
  catalogTemplates,
  generateContent,
  fallbackContent,
  cleanContent,
  buildSpec,
  parseJson,
  niceprice,
};
