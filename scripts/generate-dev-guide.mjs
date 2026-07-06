import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../artifacts/api-server/package.json'));
const PDFDocument = require('pdfkit');
const fs = require('node:fs');

const C = {
  ink:    '#0f172a',
  body:   '#1e293b',
  muted:  '#64748b',
  gold:   '#C9A450',
  goldDk: '#8a6d20',
  sky:    '#0ea5e9',
  line:   '#e2e8f0',
  codeBg: '#0f172a',
  codeTx: '#7dd3fc',
  chip:   '#f1f5f9',
  red:    '#dc2626',
};

const outPath = path.join(__dirname, '../docs/OmniCore-Developer-Guide.pdf');
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 56, bottom: 48, left: 56, right: 56 },
  bufferPages: true,
  info: {
    Title: 'Atelier OmniCore — Developer Guide',
    Author: 'Atelier OmniCore',
    Subject: 'Complete codebase & architecture reference',
  },
});
doc.pipe(fs.createWriteStream(outPath));

const PAGE_W = doc.page.width;
const ML = doc.page.margins.left;
const CW = PAGE_W - ML - doc.page.margins.right;

const toc = [];
function tocAdd(title, level) { toc.push({ title, level, page: doc.bufferedPageRange().count }); }
function gap(h = 6) { doc.y += h; }

function h1(text, opts = {}) {
  if (opts.toc !== false) tocAdd(text, 1);
  gap(10);
  doc.rect(ML, doc.y, 3, 22).fill(C.gold);
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(20)
     .text(text, ML + 12, doc.y + 1);
  gap(5);
  doc.moveTo(ML, doc.y).lineTo(ML + CW, doc.y).lineWidth(0.8).strokeColor(C.line).stroke();
  gap(10);
}

function h2(text) {
  tocAdd(text, 2);
  gap(8);
  doc.fillColor(C.goldDk).font('Helvetica-Bold').fontSize(13).text(text, ML);
  gap(5);
}

function h3(text) {
  gap(6);
  doc.fillColor(C.sky).font('Helvetica-Bold').fontSize(10.5).text(text, ML);
  gap(3);
}

function para(text, opts = {}) {
  doc.fillColor(opts.color || C.body).font(opts.font || 'Helvetica')
     .fontSize(opts.size || 9.5)
     .text(text, ML, doc.y, { width: CW, align: 'left', lineGap: 2 });
  gap(5);
}

function bullet(text, opts = {}) {
  const x = ML + (opts.indent || 0);
  const startY = doc.y;
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(9.5).text('•', x, startY, { width: 10 });
  doc.fillColor(C.body).font('Helvetica').fontSize(9)
     .text(text, x + 12, startY, { width: CW - 12 - (opts.indent || 0), lineGap: 1.5 });
  gap(3);
}

function kv(key, value) {
  const startY = doc.y;
  doc.fillColor(C.goldDk).font('Helvetica-Bold').fontSize(9).text(key, ML, startY, { width: 140 });
  doc.fillColor(C.body).font('Helvetica').fontSize(9)
     .text(value, ML + 145, startY, { width: CW - 145, lineGap: 1.5 });
  gap(3);
}

function code(lines) {
  const text = Array.isArray(lines) ? lines.join('\n') : lines;
  const h = doc.heightOfString(text, { width: CW - 20, lineGap: 1.5 }) + 14;
  const y = doc.y;
  doc.roundedRect(ML, y, CW, h, 4).fill(C.codeBg);
  doc.fillColor(C.codeTx).font('Courier').fontSize(8)
     .text(text, ML + 10, y + 7, { width: CW - 20, lineGap: 1.5 });
  doc.y = y + h;
  gap(6);
}

function table(columns, rows) {
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  const scale = CW / totalW;
  const cols = columns.map(c => ({ ...c, w: c.width * scale }));

  const hdrH = 18;
  const rowPad = 5;

  // Pre-calculate row heights
  let rowHs = [];
  for (const row of rows) {
    let maxH = 10;
    for (let i = 0; i < cols.length; i++) {
      const hh = doc.heightOfString(String(row[i] ?? ''), { width: cols[i].w - 10, lineGap: 1 });
      maxH = Math.max(maxH, hh);
    }
    rowHs.push(maxH + rowPad * 2);
  }

  const BOTTOM = doc.page.height - doc.page.margins.bottom;

  function drawHeader() {
    const y = doc.y;
    doc.roundedRect(ML, y, CW, hdrH, 3).fill(C.ink);
    let x = ML;
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
    for (const c of cols) {
      doc.text(c.header, x + 5, y + 5, { width: c.w - 10 });
      x += c.w;
    }
    doc.y = y + hdrH;
    doc.moveTo(ML, doc.y).lineTo(ML + CW, doc.y).lineWidth(0.5).strokeColor(C.line).stroke();
  }

  drawHeader();

  doc.font('Helvetica').fontSize(7.5);
  let zebra = false;
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const rowH = rowHs[ri];
    if (doc.y + rowH > BOTTOM) {
      doc.addPage();
      drawHeader();
      doc.font('Helvetica').fontSize(7.5);
    }
    const y = doc.y;
    if (zebra) doc.rect(ML, y, CW, rowH).fill(C.chip);
    zebra = !zebra;
    let x = ML;
    for (let i = 0; i < cols.length; i++) {
      doc.fillColor(i === 0 ? C.goldDk : C.body)
         .font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5)
         .text(String(row[i] ?? ''), x + 5, y + rowPad, { width: cols[i].w - 10, lineGap: 1 });
      x += cols[i].w;
    }
    doc.y = y + rowH;
    doc.moveTo(ML, doc.y).lineTo(ML + CW, doc.y).lineWidth(0.5).strokeColor(C.line).stroke();
  }
  gap(8);
}

function callout(title, text, color = C.gold) {
  doc.font('Helvetica').fontSize(9);
  const bodyH = doc.heightOfString(text, { width: CW - 32, lineGap: 1.5 });
  const h = bodyH + 26;
  const y = doc.y;
  doc.roundedRect(ML, y, CW, h, 4).fillOpacity(0.07).fill(color).fillOpacity(1);
  doc.rect(ML, y, 3, h).fill(color);
  doc.fillColor(color).font('Helvetica-Bold').fontSize(9).text(title, ML + 12, y + 7);
  doc.fillColor(C.body).font('Helvetica').fontSize(9)
     .text(text, ML + 12, doc.y + 1, { width: CW - 24, lineGap: 1.5 });
  doc.y = y + h;
  gap(8);
}

// ═══ COVER ═══════════════════════════════════════════════════════════════════════
doc.rect(0, 0, PAGE_W, doc.page.height).fill('#F5EDE0');
doc.rect(0, 0, PAGE_W, 6).fill(C.gold);
doc.rect(0, doc.page.height - 6, PAGE_W, 6).fill(C.gold);

doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(12)
   .text('ATELIER', ML, 140, { characterSpacing: 3 });
doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(48)
   .text('OmniCore', ML, 158);
doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(26)
   .text('Developer Guide', ML, 220);
doc.fillColor(C.muted).font('Helvetica').fontSize(11)
   .text('The complete architecture & codebase reference — every file, section,\nfunction, table, endpoint and webhook a developer needs to own this code.',
     ML, 262, { lineGap: 3 });

doc.moveTo(ML, 330).lineTo(ML + 180, 330).lineWidth(1.5).strokeColor(C.gold).stroke();

const coverFacts = [
  'Product      Multi-tenant SaaS omnichannel helpdesk & AI support platform',
  'Repository   pnpm monorepo (artifacts + shared libs)',
  'Runtime      Node.js 24 · TypeScript 5.9',
  'Backend      Express 5 · Socket.io · PostgreSQL',
  'Frontend     React 19 · Vite · Tailwind v4',
  'Billing      Stripe + Paddle (dual-provider)',
];
let cy = 350;
for (const f of coverFacts) { doc.font('Courier').fontSize(9).fillColor(C.body).text(f, ML, cy); cy += 16; }

doc.fillColor(C.muted).font('Helvetica').fontSize(8)
   .text('Generated ' + new Date().toISOString().slice(0, 10) + '  ·  Confidential — internal engineering document',
     ML, doc.page.height - 80);

// ═══ TOC ═══════════════════════════════════════════════════════════════════════════
doc.addPage();

doc.rect(ML, doc.y, 3, 22).fill(C.gold);
doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(20).text('Contents', ML + 12, doc.y + 1);
gap(8);
doc.moveTo(ML, doc.y).lineTo(ML + CW, doc.y).lineWidth(0.8).strokeColor(C.line).stroke();
gap(10);

// 1. INTRODUCTION ─────────────────────────────────────────────────────────
h1('1 · Introduction & Mental Model');
para('Atelier OmniCore is a multi-tenant SaaS omnichannel helpdesk. Businesses (tenants) sign up, create brands, invite support agents, and handle customer conversations from a real-time dashboard. Their customers (visitors) chat through an embeddable JavaScript widget, over email, or via API. An AI layer (Google Gemini) can auto-answer using a per-brand knowledge base.');
para('Read this section first — once the four moving parts below click, every file in the repo has an obvious home.');

h2('The four runtime pieces');
bullet('API Server (artifacts/api-server) — Express 5 + Socket.io. The brain. Owns the database, auth, billing, AI, webhooks, and serves the embeddable widget. Written in TypeScript with CommonJS controllers.');
bullet('Dashboard (artifacts/dashboard) — React 19 + Vite SPA. What agents log into. Talks to the API over REST + Socket.io.');
bullet('Marketing Site (artifacts/marketing-site) — React + Vite with SSR/prerender. Public site: home, pricing, checkout, help, legal.');
bullet('Embeddable Widget — a vanilla-JS bundle the API server ships to any customer website. The floating chat bubble visitors use.');

h2('The core data hierarchy');
para('Almost everything hangs off this chain. Memorise it and the database makes sense:');
code('tenant  →  brand  →  visitor  →  conversation  →  message\n   │         │\n   │         └── knowledge_articles (AI answers)\n   └── agents (support staff, scoped to brands)');
callout('The golden rule of multi-tenancy',
  'Nearly every table carries a tenant_id column. Every query is scoped by it. When you add a feature or a table, you MUST carry tenant_id through or you will leak one customer\'s data into another\'s. This is the single most important invariant in the codebase.',
  C.red);

// 2. TECH STACK & LANGUAGES ─────────────────────────────────────────────────
h1('2 · Languages & Tech Stack — What Is Used Where');
para('One repo, a few languages. Here is exactly which language governs which surface, so you always know what you are editing.');

table(
  [{ header: 'Area / File', width: 30 }, { header: 'Language', width: 22 }, { header: 'Framework / Tooling', width: 48 }],
  [
    ['api-server/src/**.ts', 'TypeScript', 'Express 5, bundled with esbuild → dist/index.mjs'],
    ['api-server controllers (.js)', 'JavaScript (CJS)', 'require()-based; interop shim at bundle time'],
    ['api-server/schema.sql', 'SQL', 'PostgreSQL DDL (applied manually)'],
    ['dashboard/src/App.tsx', 'TypeScript + JSX', 'React 19, Tailwind v4, Socket.io-client, Tiptap'],
    ['dashboard AuthContext.jsx', 'JavaScript + JSX', 'Kept as JSX (allowJs: true in tsconfig)'],
    ['marketing-site/src/**', 'TypeScript + JSX', 'React, Wouter router, Vite SSR, Radix UI'],
    ['Embeddable widget', 'Vanilla JS (IIFE)', 'No build step — plain browser JS'],
    ['Styling everywhere', 'CSS (Tailwind)', 'Utility classes; Tailwind v4'],
  ]
);

callout('Why controllers are .js but the entrypoint is .ts',
  'The API server entrypoint and infrastructure (app.ts, index.ts, routes/index.ts, middleware) are TypeScript. The individual controllers are CommonJS .js files loaded via require(). esbuild handles the CJS↔ESM interop at bundle time via a require shim in the banner. This is intentional — do not "fix" it by converting everything to ESM imports.');

h2('Shared workspace libraries (lib/)');
bullet('@workspace/db — database client / Drizzle helpers shared across artifacts.');
bullet('@workspace/api-zod — generated Zod schemas from the OpenAPI spec (contract-first).');
para('Regenerate contract helpers with: pnpm --filter @workspace/api-spec run codegen');

// 3. MONOREPO STRUCTURE ─────────────────────────────────────────────────────
h1('3 · Monorepo Structure & How to Run It');
para('This is a pnpm workspace. Each deployable app is an "artifact"; shared code lives in lib/. Apps never import each other directly — shared logic must go through a lib.');

code([
  'atelier-omnicore/',
  '├── artifacts/',
  '│   ├── api-server/        Express + Socket.io backend (the brain)',
  '│   ├── dashboard/         React agent dashboard (SPA)',
  '│   ├── marketing-site/    Public React site (SSR/prerender)',
  '│   └── mockup-sandbox/    Component preview playground',
  '├── lib/                   Shared libraries (@workspace/*)',
  '├── scripts/               Utility scripts (@workspace/scripts)',
  '├── docs/                  ← this guide lives here',
  '├── pnpm-workspace.yaml    Package discovery + dependency catalog',
  '└── replit.md              Project README & conventions',
]);

h2('Running & operating');
kv('API server', 'pnpm --filter @workspace/api-server run dev   (port 8080)');
kv('Dashboard', 'pnpm --filter @workspace/dashboard run dev   (port 5174)');
kv('Marketing site', 'pnpm --filter @workspace/marketing-site run dev');
kv('Full typecheck', 'pnpm run typecheck   (run before shipping)');
kv('Per-app typecheck', 'pnpm --filter @workspace/<name> run typecheck');
callout('Do not run pnpm dev at the repo root',
  'Apps run via Replit workflows, which inject PORT and BASE_PATH env vars. The root has no dev script by design. To run or restart an app, use its workflow — not a root-level shell command. Verify apps with typecheck, not build (build needs the workflow-provided env vars).');

h2('Service routing (the proxy)');
para('A global reverse proxy routes traffic by URL path to each artifact. The API server owns /api. Paths are NOT rewritten — services handle their full base path. For ad-hoc curl, always go through the proxy at localhost:80, never the service port directly.');
code([
  'localhost:80/api/healthz      → api-server (port 8080)   ✓ correct',
  'localhost:8080/api/healthz    → bypasses proxy            ✗ wrong',
]);

// 4. API SERVER ─────────────────────────────────────────────────────────────
h1('4 · API Server — Deep Dive');
para('Path: artifacts/api-server/src/. This is the largest and most important surface. Below is every meaningful file, what it does, and where to change things.');

h2('4.1 Server core & the middleware chain');
kv('src/index.ts', 'Process entrypoint. Calls verifyEnv(), initialises Stripe sync, starts HTTP server.');
kv('src/app.ts', 'Builds the Express app & middleware chain. Mounts Stripe + Paddle webhooks here (they need the RAW body for signature verification, so they sit BEFORE express.json).');
kv('src/routes/index.ts', 'Central router. Maps every sub-router to its base path (/auth, /tenants, /conversations, /widget, /billing, /ai, …).');
kv('src/lib/env.js', 'verifyEnv() hard-exits if DATABASE_URL, JWT_SECRET or GEMINI_API_KEY are missing. publicAppUrl() resolves the canonical public origin for links & redirects.');
h3('Middleware order (src/app.ts)');
para('helmet → cors → pino-http (logging) → [raw-body webhook routes] → express.json → cookieParser → attachDb (injects the Postgres pool as req.db) → routes.');

h2('4.2 Authentication & JWT');
para('File: src/controllers/auth.controller.js. Middleware: src/middleware/auth.js.');
table(
  [{ header: 'Endpoint', width: 34 }, { header: 'Lines', width: 12 }, { header: 'What it does', width: 54 }],
  [
    ['POST /auth/login', 'L82–112', 'Validate credentials → issue 15-min access JWT + 7-day refresh cookie (httpOnly)'],
    ['POST /auth/refresh', 'L115–152', 'Rotate tokens using the refresh cookie'],
    ['POST /auth/logout', '—', 'Clear the refresh cookie'],
    ['POST /auth/forgot-password', 'L165–223', 'Generate 1-hour reset token; send via SMTP or return in dev'],
  ]
);
h3('How auth is enforced');
bullet('requireAuth — verifies the Bearer JWT with JWT_SECRET, attaches req.agent (id, tenantId, role, permissions).');
bullet('requireRole(...) — gate by role string: admin / agent / supervisor / superadmin.');
bullet('requirePermission(feature) — granular gating by feature key: inbox, billing, knowledge_base, etc.');
bullet('applyWorkspaceOverride — lets a superadmin "view as" a tenant by sending the X-Workspace-Id header.');
h3('JWT payload shape');
code('{ sub: <agentId>, tenantId, role, permissions_json }');
callout('Access tokens live in memory, not localStorage',
  'The dashboard keeps the access token in React state (XSS-resistant) and relies on the httpOnly refresh cookie for silent renewal. Never move the access token into localStorage.');

h2('4.3 Controllers & the full endpoint map');
para('Each controller is an Express Router mounted at a base path in routes/index.ts. Change a feature by editing its controller.');
table(
  [{ header: 'Controller file', width: 34 }, { header: 'Base path', width: 22 }, { header: 'Owns', width: 44 }],
  [
    ['auth.controller.js', '/auth', 'Login, refresh, logout, password reset'],
    ['signup.controller.js', '/auth/signup', 'Public self-serve tenant signup'],
    ['tenant.controller.js', '/tenants', 'Workspace provisioning, brands, settings (SMTP/IMAP/webhooks)'],
    ['conversations.controller.js', '/conversations', 'Inbox: list, messages, status, priority, ticket conversion'],
    ['agents.controller.js', '/agents', 'Invite agents, roles, set-password tokens'],
    ['widget.controller.js', '/widget', 'Visitor sessions, widget.js bundle, demo page, CSAT'],
    ['super-admin.controller.js', '/super-admin', 'Platform-wide: tenants, limits, plans, billing overrides'],
    ['contacts.controller.js', '/contacts', 'CRM view of visitors & history'],
    ['canned-responses.controller.js', '/canned-responses', 'Reusable reply snippets/shortcuts'],
    ['email.webhook.controller.js', '/webhooks/inbound-mail', 'Inbound email → conversation threading'],
    ['ai.router.js', '/ai', 'Rephrase, summarise, knowledge-base crawl/upload, auto-reply'],
    ['billing.router.js', '/billing', 'Checkout, subscription state, plans'],
  ]
);
h3('Key conversation endpoints (conversations.controller.js)');
table(
  [{ header: 'Endpoint', width: 38 }, { header: 'Lines', width: 12 }, { header: 'Notes', width: 50 }],
  [
    ['GET /conversations', 'L155–221', 'Paginated + filtered list (status, brand, agent, search)'],
    ['PATCH /conversations/:id', 'L246–366', 'Update status/priority; converting to ticket sets is_ticket=true and moves to email channel'],
    ['POST /conversations/:id/messages', 'L394–445', 'Agent sends message → socket broadcast + email notify'],
  ]
);

h2('4.4 Real-time engine (Socket.io)');
kv('File', 'src/services/socket.service.js');
kv('Path', '/api/socket.io  (NOT the default /socket.io — see gotchas)');
h3('Rooms');
bullet('tenant:{id} — inbox-wide updates for all of a tenant\'s agents.');
bullet('conv:{id} — everyone currently viewing one conversation.');
bullet('vis:{id} — a direct channel to a single visitor.');
h3('Key events');
bullet('client:send_message — visitor/agent sends a message.');
bullet('agent:is_typing / visitor:is_typing — typing indicators + collision detection.');
bullet('client:page_view / visitor:page_change — visitor telemetry (what URL they are on).');
bullet('visitor:online / visitor:offline — presence.');
bullet('server:new_message, conversation:created — server → dashboard pushes.');
para('AI auto-reply: for conversations in ai_handling status, the socket layer calls maybeAutoReply() which asks Gemini for a response.');

h2('4.5 AI layer');
kv('File', 'src/services/ai.service.js  (Google Gemini)');
kv('Routes', 'src/routes/ai.router.js');
bullet('POST /ai/rephrase (L54–68) — agent copilot: rewrite a draft reply.');
bullet('POST /ai/knowledge-base/crawl (L216–270) — scrape a URL into knowledge articles.');
bullet('POST /ai/knowledge-base/upload-pdf — ingest a PDF into the KB.');
para('RAG note: the ai_embeddings table (pgvector, VECTOR(1536)) is designed for semantic search but pgvector is NOT available on Replit Postgres, so that table is excluded from the applied schema. AI answers currently work without vector search.');

h2('4.6 Billing — dual provider (Stripe + Paddle)');
kv('Core file', 'src/lib/billingProvider.js');
kv('Controller', 'src/controllers/billing.controller.js');
kv('Plans repo', 'src/lib/plansRepo.js  (billing_plans table = local source of truth)');
h3('How the provider is chosen');
bullet('New signups → the BILLING_PROVIDER env var (stripe default, or paddle).');
bullet('Existing customers → routed to whichever provider they already have (stripe_customer_id vs paddle_customer_id on the tenants row).');
h3('Checkout flow');
para('1. Visitor picks a plan on the marketing site /checkout and enters details. 2. billing.controller.js → createPublicCheckout() calls the provider. 3. Stripe: Checkout Session with a 14-day trial in subscription_data. Paddle: a transaction built from a priceId (seeded by seed-paddle-products.ts). 4. User is redirected to the hosted checkout, then back to /checkout/success.');
callout('Paddle customer-conflict handling',
  'When Paddle rejects "email conflicts with customer of id ctm_xxx", _paddleTenantCheckout extracts the existing customer id from the error message (falling back to a GET /customers?email lookup) and reuses it instead of failing. Keep this behaviour if you touch checkout.');
h3('Subscription state & the lock/grace mechanism');
para('getSubscription() (billing.controller.js, L188–295) computes a lockState. When trial_ends_at passes, a grace period begins; after grace expires the tenant is locked. The dashboard renders TrialGateway.jsx as a blocking overlay. Superadmins can adjust trial_ends_at, grace_period_ends_at and reset lock_notified_at.');

h2('4.7 Webhooks');
table(
  [{ header: 'Webhook', width: 26 }, { header: 'Where', width: 30 }, { header: 'Purpose', width: 44 }],
  [
    ['Stripe', 'app.ts L69–100', 'stripe-replit-sync mirrors Stripe → local "stripe" schema; provisionTenantFromEvent reconciles tenant status'],
    ['Paddle', 'app.ts L344–412', 'Verifies Paddle-Signature; public checkout provisions a tenant from scratch on purchase'],
    ['Inbound email', 'email.webhook.controller.js L249–437', 'POST /api/webhooks/inbound-mail — turns emails into conversations'],
  ]
);
h3('Inbound email threading (email.webhook.controller.js)');
bullet('Normalises payloads from SendGrid, Resend, and Mailgun into one shape.');
bullet('Threads replies via reply+conv_<id>@ addresses (parseConvIdFromReplyTo) or the In-Reply-To header.');
bullet('stripQuotes (L50–56) removes quoted reply chains so only the new text is saved.');
callout('Why webhooks are mounted before express.json',
  'Stripe and Paddle sign the RAW request body. If express.json parses it first, the signature check fails. That is why these routes use express.raw and are registered early in app.ts. Never move them below the JSON parser.');

// 5. DATABASE ────────────────────────────────────────────────────────────────
h1('5 · Database — Schema, Tables & Relationships');
para('PostgreSQL (Replit-managed). Baseline DDL is artifacts/api-server/schema.sql, applied MANUALLY (no Drizzle migrations). Several tables/columns are added at runtime by "self-healing" migrations that run when a controller/service boots.');

h2('5.1 The multi-tenant model');
para('Logical isolation via tenant_id. The top-level entity is tenants; nearly every other row references it. A tenant has many brands; agents belong to a tenant and can be restricted to specific brands via the brand_access_array (a UUID[] — there is no join table).');

h2('5.2 Core tables (schema.sql)');
table(
  [{ header: 'Table', width: 20 }, { header: 'Key columns', width: 56 }, { header: 'Relations', width: 24 }],
  [
    ['tenants', 'id(PK), company_name, subscription_status, stripe_/paddle_/lemon_squeezy_ ids, grace_period_ends_at, created_at', 'root entity'],
    ['brands', 'id(PK), tenant_id(FK), brand_name, widget_config_json, allowed_domains_array, inbound_email_prefix(UNIQUE), ai_system_prompt, ai_confidence_threshold', 'tenant 1-N'],
    ['agents', 'id(PK), tenant_id(FK), name, email, password_hash, role, brand_access_array(UUID[]), personal_settings_json, is_active', 'tenant 1-N'],
    ['visitors', 'id(PK), tenant_id(FK), brand_id(FK), session_token(UNIQUE), email, display_name, ip_address, location_city, last_seen_at', 'brand 1-N'],
    ['conversations', 'id(PK), tenant_id, brand_id, visitor_id, assigned_agent_id, status, priority, csat_score, sla_breach_at, subject, channel', 'visitor 1-N'],
    ['messages', 'id(PK), conversation_id(FK), sender_type, sender_id, message_body, is_internal_note, attachments_json, created_at', 'conversation 1-N'],
    ['knowledge_articles', 'id(PK), tenant_id, brand_id, title, public_html_content, plain_text_content, is_public, author_agent_id', 'brand 1-N'],
    ['password_reset_tokens', 'id(PK), agent_id(FK), token(UNIQUE), expires_at, used_at', 'agent 1-N'],
    ['ai_embeddings', 'id(PK), article_id(FK), tenant_id, brand_id, embedding_vector VECTOR(1536)  — EXCLUDED (no pgvector)', 'article 1-N'],
  ]
);

h2('5.3 Runtime-created tables');
para('These are created lazily by controller/service boot migrations — you will not find them in schema.sql:');
table(
  [{ header: 'Table', width: 24 }, { header: 'Created by', width: 34 }, { header: 'Purpose', width: 42 }],
  [
    ['billing_plans', 'lib/plansRepo.js', 'Local plan catalog (slug, amount_cents, limits, paddle_product/price_id)'],
    ['super_admin_emails', 'super-admin.controller.js', 'Who has platform superadmin access'],
    ['upgrade_requests', 'super-admin.controller.js', 'Tenant plan-upgrade requests (status: pending)'],
    ['platform_settings', 'super-admin.controller.js', 'Singleton (id=1) — platform SMTP config JSON'],
    ['canned_responses', 'canned-responses.controller.js', 'tenant_id, name, body, shortcut'],
  ]
);

h2('5.4 Columns added to tenants at runtime');
para('billing.controller.js and super-admin.controller.js ALTER the tenants table to add: account_status, plan, max_brands_allowed, max_agents_allowed, conversation_limit, ai_feature_enabled, smtp_feature_enabled, trial_ends_at, lock_notified_at, paddle_customer_id, paddle_subscription_id.');
callout('Schema quirks you must respect',
  'visitors uses display_name (not name) — queries COALESCE(v.display_name, v.email, \'Visitor\'). messages uses sender_id (not sender_agent_id). Both bit earlier developers; keep to these names.');

// 6. DASHBOARD ───────────────────────────────────────────────────────────────────────────
h1('6 · Dashboard Frontend — Deep Dive');
para('Path: artifacts/dashboard/src/. React 19 + Vite + Tailwind v4 + TypeScript. Almost the entire app lives in a single large file, App.tsx (~5300 lines). Auth lives in context/AuthContext.jsx.');

h2('6.1 App.tsx component map');
para('Use this table to jump straight to the feature you need. Line ranges are approximate — search the component name to confirm.');
table(
  [{ header: 'Section / Component', width: 32 }, { header: 'Lines', width: 16 }, { header: 'What it renders', width: 52 }],
  [
    ['Auth pages', '630–866', 'Login, Signup, Forgot/Reset password'],
    ['useApi (API client)', '176–433', 'Every REST call as a method (listConversations, sendMessage, …)'],
    ['ConversationsList + EmptyChat', '867–1577', 'Inbox sidebar: filters, search, conversation rows'],
    ['ChatPanel', '1578–1881', 'Message history, internal notes, attachments, send box'],
    ['Brands', '1882–1979', 'Brand identities, widget config, embed snippet, domains'],
    ['Billing', '1980–2138', 'Plan selection, subscription state'],
    ['CSAT', '2139–2309', 'Satisfaction scores + agent performance'],
    ['Settings', '2310–2591', 'Profile + tenant-level config'],
    ['Team', '2592–2796', 'Agents, roles, permissions'],
    ['SuperAdmin', '2797–3681', 'Tenant provisioning, global billing, plans, limits'],
    ['AI Training', '3702–4112', 'Knowledge base editor + brand AI prompts'],
    ['SMTP', '4113–4273', 'Outbound mail server config'],
    ['Tickets', '4274–4415', 'Long-running tickets converted from chats'],
    ['Contacts', '4416–4692', 'Visitor CRM + history'],
    ['Canned Responses', '4693–4799', 'Snippet/shortcut manager'],
    ['Sidebar (nav)', '4800–4934', 'Global nav, unread counts, recent activity'],
    ['Dashboard (main)', '4935–5321', 'State orchestration, Socket.io lifecycle, section switch'],
    ['Root App', '5322–end', 'Auth gate + view routing'],
  ]
);
callout('Where to change things',
  'Want to edit the inbox? ConversationsList / ChatPanel. Billing UI? the Billing + SuperAdmin sections. A new API call? add a method to useApi (L176–433) then call it. Channel icons (incl. WhatsApp)? the ChannelIcon component. Navigation items? the items array in Sidebar.');

h2('6.2 The API client (useApi hook)');
para('Rather than a separate library, App.tsx defines a useApi() hook (L176–433) returning an object of methods for every backend call. Each uses authFetch from AuthContext so requests are always authenticated. To add an endpoint: add a method here, then call it from the component.');

h2('6.3 Authentication (context/AuthContext.jsx)');
bullet('Access token kept in memory (React state) — XSS-resistant.');
bullet('Refresh token in an httpOnly cookie; access token silently refreshed ~60s before expiry.');
bullet('authFetch — wrapper that injects the Authorization header and retries once on 401.');
bullet('Workspace override — superadmins inject X-Workspace-Id to act inside a tenant.');
bullet('can(feature, level) — frontend RBAC helper mirroring the server permissions.');
callout('AuthContext stays .jsx on purpose',
  'It is JavaScript+JSX (not TSX). The dashboard tsconfig sets allowJs: true specifically for it. Do not rename it to .tsx without updating config and typing everything.');

h2('6.4 Real-time on the client');
para('Socket connectivity is set up in the Dashboard component (~L5002–5107). It handles server:new_message, visitor:is_typing, visitor:page_change, visitor:online/offline, and conversation:created. Agents join a conversation room via join:conversation. Includes browser Notification support and an incoming-message chime.');

h2('6.5 Routing');
para('State-based, not URL-based. A single section state (~L4948) decides which section component renders (~L5273–5297); the Sidebar calls setSection. Only minimal URL params are honoured (e.g. reset_token). Session persistence is via React state + the refresh cookie.');

// 7. MARKETING + WIDGET ─────────────────────────────────────────────────────
h1('7 · Marketing Site & Embeddable Widget');
h2('7.1 Marketing site (artifacts/marketing-site)');
kv('Stack', 'React + TypeScript, Vite, Wouter routing, Tailwind, Radix UI, react-query');
kv('SSR', 'Custom Vite SSR; prerender.mjs renders routes to static HTML at build for SEO');
kv('Entry', 'main.tsx (client) + entry-server.tsx (SSR)');
kv('Layout', 'src/components/layout.tsx wraps every page (nav, footer, floating WhatsApp button)');
kv('SEO', 'src/lib/seo.ts + <Seo /> updates meta tags per route');
h3('Routes');
bullet('/ home · /pricing · /checkout · /checkout/success');
bullet('/help + /help/* setup guides (Google Workspace, Microsoft 365, AI bot)');
bullet('/terms · /privacy · /refunds legal');

h2('7.2 Embeddable widget');
para('Served by the API server as a self-contained IIFE at /api/widget/widget.js. Embedded on any customer site:');
code('<script src="https://<your-domain>/api/widget/widget.js"\n        data-brand-id="<BRAND_UUID>" defer></script>');
bullet('On load it starts/restores a session via POST /api/widget/session (returns/verifies a sessionToken UUID; dedupes visitors by email).');
bullet('Messaging over Socket.io (client:send_message) with a REST fallback POST /api/widget/message for attachments.');
bullet('If the tenant has AI auto-reply on, conversations start in ai_handling and Gemini answers via maybeAutoReply.');
bullet('On close, an optional 1–5 star CSAT survey posts to /api/widget/csat.');
callout('Widget CORS is intentionally wide open',
  'widget.controller.js sets Access-Control-Allow-Origin: * and Cross-Origin-Resource-Policy: cross-origin (overriding Helmet) because the widget must load on ANY customer domain. The /api/widget/session endpoint is deliberately unauthenticated — it is visitor-facing. Keep widget responses shape-tolerant: the widget.js is cached on third-party sites and old versions stay in the wild.');

// 8. ENV VARS ────────────────────────────────────────────────────────────────
h1('8 · Environment Variables Reference');
para('Manage these through Replit secrets — never hard-code them. The server hard-exits on boot if a REQUIRED var is missing (see lib/env.js).');
h2('Required (server will not start without these)');
table(
  [{ header: 'Variable', width: 30 }, { header: 'Used for', width: 70 }],
  [
    ['DATABASE_URL', 'PostgreSQL connection (also used by stripe-replit-sync)'],
    ['JWT_SECRET', 'Signing/verifying access + refresh JWTs'],
    ['GEMINI_API_KEY', 'Google Gemini AI (auto-reply, rephrase, summarise)'],
  ]
);
h2('Feature / integration vars');
table(
  [{ header: 'Variable', width: 32 }, { header: 'Used for', width: 68 }],
  [
    ['BILLING_PROVIDER', 'stripe (default) or paddle — provider for new signups'],
    ['PUBLIC_APP_URL', 'Canonical public origin for checkout redirects & email links (must match provider-approved domain)'],
    ['PADDLE_API_KEY', 'Paddle API auth (or via Replit Connector)'],
    ['PADDLE_ENVIRONMENT', 'sandbox or production'],
    ['PADDLE_WEBHOOK_SECRET', 'Verifies inbound Paddle-Signature'],
    ['PADDLE_<PLAN>_PRICE_ID', 'Per-plan Paddle price ids'],
    ['Stripe (Replit integration)', 'Stripe keys provided via the Replit Stripe integration'],
    ['R2_* / S3 creds', 'Cloudflare R2 / S3 for conversation export bundles'],
    ['SMTP / platform mail', 'Outbound email (invites, password resets, notifications)'],
  ]
);

// 9. COMMON TASKS ───────────────────────────────────────────────────────────────
h1('9 · Recipes — "Where Do I Change X?"');
para('A quick lookup from feature → files to edit. Follow the golden rule (carry tenant_id) on anything data-related.');
table(
  [{ header: 'I want to…', width: 40 }, { header: 'Edit these', width: 60 }],
  [
    ['Add a new REST endpoint', 'controllers/<x>.controller.js (route) → mount in routes/index.ts → add a useApi method in dashboard App.tsx → call it'],
    ['Add a DB column/table', 'schema.sql (baseline) AND the boot migration in the owning controller; carry tenant_id; then read/write it in the controller'],
    ['Change inbox behaviour', 'conversations.controller.js (server) + ConversationsList / ChatPanel in App.tsx (client)'],
    ['Change billing / plans', 'lib/billingProvider.js, billing.controller.js, lib/plansRepo.js (+ seed-paddle-products.ts) + Billing/SuperAdmin sections'],
    ['Adjust trial / lock logic', 'billing.controller.js getSubscription (lockState) + TrialGateway.jsx overlay + super-admin.controller.js overrides'],
    ['Tune the AI', 'services/ai.service.js + per-brand ai_system_prompt (Brands / AI Training) + ai.router.js'],
    ['Add a real-time event', 'services/socket.service.js (server) + Dashboard socket handlers in App.tsx (client)'],
    ['Change the widget', 'widget.controller.js + the widget JS bundle; keep responses backward-compatible'],
    ['Add a channel icon', 'ChannelIcon in App.tsx + the Channel union type'],
    ['Add a marketing page', 'new component in marketing-site/src/pages + a <Route> in App.tsx + nav in layout.tsx'],
  ]
);

// 10. GOTCHAS ────────────────────────────────────────────────────────────────
h1('10 · Gotchas & Hard-Won Lessons');
bullet('Socket.io path is /api/socket.io (not the default /socket.io) so the path-prefix proxy routes it to port 8080. Both server and client must agree.');
bullet('Always restart the api-server after env var changes — JWT_SECRET must be present at boot or login throws.');
bullet('After adding a dashboard dependency, run pnpm --filter @workspace/dashboard install.');
bullet('pgvector is not available on Replit Postgres — the ai_embeddings table is excluded from the applied schema.');
bullet('visitors.display_name (not name) and messages.sender_id (not sender_agent_id). COALESCE display_name → email → \'Visitor\'.');
bullet('Webhooks (Stripe/Paddle) must stay mounted before express.json — they need the raw body for signature verification.');
bullet('Controllers are CommonJS .js loaded via require(); the entrypoint/infra is .ts. Interop is handled by esbuild — do not convert wholesale to ESM.');
bullet('Static web artifacts publish with serve = "static"; a custom npx serve run command fails to open a port on publish.');
bullet('Widget.js is cached on third-party sites — keep widget endpoint responses shape-tolerant for old embedded versions.');
bullet('Verify apps with typecheck, not build — build needs workflow-provided PORT and BASE_PATH.');

callout('Demo credentials (development)',
  'admin@omnicore.test / Admin123!   ·   sara@omnicore.test / Agent123!');

// ═══ FOOTERS (post-render via switchToPage) ═════════════════════════════════════════════════════─══════════════════════════
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  if (i === 0) continue; // cover has no footer
  doc.switchToPage(i);
  const fy = doc.page.height - 38;
  doc.moveTo(ML, fy).lineTo(ML + CW, fy).lineWidth(0.5).strokeColor(C.line).stroke();
  doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
     .text('Atelier OmniCore — Developer Guide', ML, fy + 6, { width: CW / 2, align: 'left' });
  doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
     .text('Page ' + i, ML + CW / 2, fy + 6, { width: CW / 2, align: 'right' });
}

doc.end();
console.log('PDF written to ' + outPath);
