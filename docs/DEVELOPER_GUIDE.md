# OmniCore developer guide

How the app is built, where everything lives, and how to change it safely.
Deployment is in [DEPLOYMENT.md](DEPLOYMENT.md), configuration in
[ENVIRONMENT.md](ENVIRONMENT.md), integrations and the public API in
[API_AND_INTEGRATIONS.md](API_AND_INTEGRATIONS.md), end-user help in
[USER_GUIDE.md](USER_GUIDE.md).

---

## 1. Architecture

```
                         ┌───────────────────────── browser ─────────────────────────┐
                         │ marketing site (/)   dashboard (/dashboard/)   chat widget │
                         └──────────┬───────────────────┬──────────────────────┬──────┘
                                    │ HTTPS             │ REST + Socket.io     │ REST + Socket.io
                         ┌──────────▼───────────────────▼──────────────────────▼──────┐
                         │ nginx (OCI) / Cloudflare / Render proxy                      │
                         └──────────────────────────────┬──────────────────────────────┘
                                                        │ /api/*
┌───────────────────────────────────────────────────────▼───────────────────────────────────────────────┐
│ API server — artifacts/api-server (Express 5, Node 24)                                                 │
│  middleware: helmet → CORS → pino → raw-body webhooks → json → cookies → db → AUDIT → routes          │
│  routes/index.ts ─► controllers/*.js (domain)    routes/publicApi.js (/api/v1, API keys)               │
│  services: ai (Gemini RAG + copilot) · email (SMTP/IMAP) · socket (Socket.io) · ticket (unused)        │
│  lib: audit · integrations (outbox, dispatcher, GoHighLevel) · billing (Paddle) · permissions · r2     │
│  timers: auto-close idle chats · audit retention · integration workers                                 │
└───────────────┬───────────────────────┬─────────────────────────┬──────────────────────────────────────┘
                │                       │                         │
          PostgreSQL               Cloudflare R2            Gemini / Paddle / HighLevel / SMTP
   (+ triggers → integration_events outbox)
```

- **Multi-tenant:** every row is scoped by `tenant_id` (a _workspace_). Agents belong to one
  workspace; super admins can act inside any workspace with the `X-Workspace-Id` header
  ("View as workspace").
- **Brands:** a workspace has one or more brands. Each brand has its own widget, inbound email
  address, AI prompt, logo and colours.
- **Real time:** Socket.io at `/api/socket.io`. Rooms: `tenant:<id>`, `conv:<id>`, visitor rooms.
  Clients try WebSocket and fall back to long-polling.

## 2. Repository map

```
artifacts/
  api-server/            ← backend (Express)
    src/index.ts           boot: env check, HTTP server, Stripe/Paddle init, integration workers
    src/app.ts             middleware order, Paddle/Stripe/HighLevel raw-body webhooks, static mode, timers
    src/routes/index.ts    mounts every router under /api
    src/routes/publicApi.js        REST API v1 (API keys)
    src/routes/ai.router.js        knowledge base, crawler, PDF upload, rephrase
    src/routes/billing.router.js   plans, checkout, portal, usage, upgrade requests
    src/controllers/       one file per domain (auth, signup, tenant/brands, conversations, contacts,
                           agents, canned-responses, widget, email webhook, super-admin, audit, integrations)
    src/services/          ai, email, export (PDF), socket; ticket.service.js (SLA/escalation) is not wired up yet
    src/lib/               audit, permissions, billingProvider, paddleClient, plansRepo, r2, db, dbSsl,
                           env, secretBox (encryption), requestValidation, widgetSession
    src/lib/integrations/  schema (tables + triggers), dispatcher (events → deliveries), ghl (HighLevel)
    src/widget/            the embeddable chat widget (widgetScript.js) and its demo page
    src/workers/           website crawler (BullMQ when REDIS_URL is set)
    schema.sql             base schema (idempotent); newer tables are created at runtime
    scripts/migrate.mjs    extensions + schema.sql + first super admin (Render/Docker)
  dashboard/             ← agent/admin app (React 19 + Vite + Tailwind), served at /dashboard/
    src/App.tsx            the shell: login, sidebar, inbox, tickets, settings, super admin… (most UI)
    src/sections/          newer self-contained sections: Billing, CSAT, Integrations, AuditLog
    src/context/AuthContext.jsx   tokens, authFetch (auto refresh), permissions, workspace override
    src/lib/               types, helpers, Paddle.js loader, checkout logic (with tests)
    src/pages/, src/layouts/      legacy, not imported by App.tsx (safe to delete)
  hrms/                  ← HR app (React 18 + Vite + Tailwind 3, ported from GHL-HRMS), served at /hrms/
    src/App.jsx            routes per role (admin, manager, recruiter, employee)
    src/services/api.js    HR API client (/api/hrms/v1, token refresh)
    src/services/brand.js  white-label name, logo and colour (from /api/branding)
    src/services/workspace.js   the employer workspace (name, time zone) of the signed-in user
    src/pages/auth/SsoPage.jsx  "Open HR" single sign-on landing page
  marketing-site/        ← public site (React + Vite, prerendered to static HTML)
    src/pages/             home, features, pricing, checkout, help articles, legal pages
    src/lib/seo.ts         per-route titles, descriptions, JSON-LD (also drives prerendering)
    prerender.mjs          renders every route in seo.ts to static HTML
  mockup-sandbox/        ← UI prototyping playground (not deployed)
lib/                     ← shared packages (OpenAPI spec, generated Zod/React Query clients, Drizzle schema)
scripts/                 ← Stripe/Paddle seed scripts, guide generators, vercel-build.mjs
deploy.sh                ← OCI/VPS installer and updater
render.yaml, vercel.json, Dockerfile, docker-compose.yml
docs/                    ← you are here
```

## 3. Where to edit what

| I want to change…                         | Edit                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketing copy, pages, pricing table      | `artifacts/marketing-site/src/pages/*.tsx`; add new routes to `src/App.tsx` **and** `src/lib/seo.ts` (prerender + SEO) and `public/sitemap.xml`                                                                                                                                                                                                                                                                                                                   |
| Marketing colours, fonts, header/footer   | `artifacts/marketing-site/src/index.css`, `src/components/layout.tsx`                                                                                                                                                                                                                                                                                                                                                                                             |
| Dashboard sidebar items                   | `artifacts/dashboard/src/App.tsx` → `const items` in the sidebar; add the key to `Section` in `src/lib/dashboardTypes.ts` and render it near `section === '…'`                                                                                                                                                                                                                                                                                                    |
| A dashboard screen                        | Search `function <Name>Section` in `App.tsx`, or `src/sections/<Name>Section.tsx`                                                                                                                                                                                                                                                                                                                                                                                 |
| Super Admin tabs                          | `SuperAdminSection` in `App.tsx` (tab union, buttons, render switch)                                                                                                                                                                                                                                                                                                                                                                                              |
| Dashboard logo                            | `artifacts/dashboard/src/assets/omnicore-logo.png` and `OmniLogo` in `App.tsx`                                                                                                                                                                                                                                                                                                                                                                                    |
| Chat widget look and behaviour            | `artifacts/api-server/src/widget/widgetScript.js` (served at `/api/widget/widget.js`)                                                                                                                                                                                                                                                                                                                                                                             |
| An API endpoint                           | The matching `controllers/*.controller.js` (routes are declared at the top of each file)                                                                                                                                                                                                                                                                                                                                                                          |
| Who may do what                           | `src/lib/permissions.js` (features: inbox, contacts, knowledge_base, brands, analytics, billing, team, settings) and `requirePermission*` in routes                                                                                                                                                                                                                                                                                                               |
| AI prompts, handover rules, models        | `src/services/ai.service.js`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Plans, prices, limits                     | In the app: Super Admin → Billing (stored in `billing_plans`, synced to Paddle by `lib/plansRepo.js`)                                                                                                                                                                                                                                                                                                                                                             |
| Paddle checkout / portal / webhooks       | `lib/billingProvider.js`, `lib/paddleClient.js`, Paddle handler in `app.ts`                                                                                                                                                                                                                                                                                                                                                                                       |
| System emails (templates, SMTP)           | `src/services/email.service.js`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Audit coverage                            | Automatic for writes; add explicit events with `recordAudit()` from `lib/audit.js`                                                                                                                                                                                                                                                                                                                                                                                |
| Integration events                        | Triggers in `lib/integrations/schema.js`, payloads in `lib/integrations/dispatcher.js`                                                                                                                                                                                                                                                                                                                                                                            |
| HighLevel sync behaviour                  | `lib/integrations/ghl.js`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Public REST API                           | `src/routes/publicApi.js`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| nginx / server setup                      | `deploy.sh` (`write_nginx_site`, `cmd_vps_install`)                                                                                                                                                                                                                                                                                                                                                                                                               |
| AI assistant: knowledge, tools, providers | `src/lib/ai/appKnowledge.js` (what it knows), `src/lib/ai/copilotTools.js` (what it can do; `kind: 'write'` needs approval), `src/lib/ai/providers/*` (Gemini, OpenAI, Anthropic), dashboard `src/components/CopilotPanel.tsx`                                                                                                                                                                                                                                    |
| Agencies / white-label                    | `src/lib/agencies.js` (branding, domains, access), `controllers/agency.controller.js`; dashboard `src/lib/branding.ts` (theme), `src/sections/AgencySection.tsx`                                                                                                                                                                                                                                                                                                  |
| HR module (HRMS)                          | Server: `src/hrms/` — `index.js` (router, workspace resolution, plan gate), `admin.routes.js` (single sign-on, workspace keys, super admin console), `core/` (per-workspace MongoDB via `mongoose.js` + `context.js`, tokens, time zones, R2/disk storage, Socket.io namespace), `routes/`, `models/`, `controllers/`, `services/` (ported HRMS code). Front end: `artifacts/hrms/`. Dashboard: `src/sections/HrSection.tsx`, `src/sections/HrmsAdminPanel.tsx`   |
| Invoicing and payments                    | `src/payments/` — `service.js` (invoices, estimates, links, coupons, gift cards, payments), `money.js` (integer minor units, totals), `providers/` (one adapter per processor), `routes.js` (`/api/payments`, dashboard), `public.js` (`/api/pay` customer API, `/api/pay/webhooks/...`, `/pay/...` page), `page/assets.js` (the customer page), `schema.js` (`pay_*` tables); dashboard `src/sections/PaymentsSection.tsx`; REST API v1 in `routes/publicApi.js` |
| Reverse DNS tool                          | `src/rdns/` — `sources.js` (9 passive-DNS adapters), `scheduler.js` (24/7 loop + pacing), `crawler.js` (forms-only crawler, robots.txt, SSRF guard), `routes.js` (`/api/super-admin/rdns`), `schema.js` (`rdns_*` tables); dashboard `src/sections/RdnsPanel.tsx`                                                                                                                                                                                                 |
| AI Call Center (voice)                    | `src/voice/` — `routes.js` (API + Vapi/Twilio/lead webhooks), `context.js` (wiring onto OmniCore: accounts, GoHighLevel tokens, encryption, sweep worker), `store.js` (PostgreSQL document store), `services/*` (provisioning, live calls, QA grading + CRM sync, speed-to-lead, reports, agent prompts, industry templates — ported unchanged from the AI-Call-Center repo); dashboard `src/sections/VoiceSection.tsx`                                           |

## 4. Data model (main tables)

| Table                                     | Purpose                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `tenants`                                 | Workspaces: plan, subscription status, limits, Paddle/Stripe ids         |
| `agents`                                  | Users of a workspace: role (`admin`/`supervisor`/`agent`), permissions   |
| `super_admin_emails`                      | Additional super admins                                                  |
| `brands`                                  | Brand settings, widget config, AI prompt, SLA, inbound email prefix      |
| `visitors`                                | Contacts (widget visitors, email senders, API/HighLevel contacts)        |
| `conversations`                           | Chats and tickets: status, priority, channel, assignee, CSAT, ticket no. |
| `messages`                                | Messages and internal notes with attachments                             |
| `knowledge_articles`                      | Knowledge base used by the AI                                            |
| `canned_responses`                        | Saved replies with shortcuts                                             |
| `billing_plans`                           | Plan catalogue (source of truth, synced to Paddle)                       |
| `upgrade_requests`                        | Customer upgrade/enterprise requests                                     |
| `audit_logs`                              | Audit trail                                                              |
| `integration_events`                      | Outbox written by triggers                                               |
| `webhook_endpoints`, `webhook_deliveries` | Outgoing webhooks and their delivery attempts                            |
| `api_keys`                                | Hashed REST API keys                                                     |
| `tenant_integrations`                     | Slack / Discord / Teams connectors (encrypted config)                    |
| `ghl_connections`, `ghl_links`            | HighLevel installs (encrypted tokens) and id mapping                     |

**Migrations:** `schema.sql` is idempotent (`IF NOT EXISTS`). Newer tables are created by
the module that owns them on first use (`ensureAuditSchema`, `ensureIntegrationsSchema`,
`plansRepo`, router migrations). Make every schema change additive and idempotent.
`lib/db` contains a Drizzle schema used by the OpenAPI tooling; the runtime uses raw SQL.

## 5. Request lifecycle, auth and permissions

1. `requireAuth` validates the Bearer access token (15 min) and sets `req.agent`
   (`id, tenantId, role, email, permissions`). The dashboard's `authFetch` refreshes it
   silently through the httpOnly refresh cookie (`/api/auth/refresh`).
2. `applyWorkspaceOverride` lets super admins act in another workspace.
3. `requirePermission(feature, level)` / `requirePermissionByMethod(feature)` enforce
   per-feature `none | read | edit`. Admins pass everything.
4. **Always scope SQL by `req.agent.tenantId`.** Never trust a tenant id from the body.
5. Errors: throw or `next(err)` with `err.status`; the global handler returns JSON,
   maps malformed ids to 400 and hides internals for 500s in production.

## 6. Subsystems

**AI** (`services/ai.service.js`): Gemini. Inbound visitor messages go through
`maybeAutoReply` → full-text search over `knowledge_articles` for the brand → prompt with
the brand's system prompt → reply, or hand over to a human when the visitor asks for one
or the model emits the handover marker. Agents get `rephrase` and thread summaries.

**Email** (`services/email.service.js`, `controllers/email.webhook.controller.js`):
platform SMTP for system mail, per-workspace SMTP for replies, inbound mail via webhook
to the brand's forwarding address.

**Billing:** `billing_plans` is the source of truth. Saving a paid plan creates or updates
the Paddle product and price. Checkout opens Paddle.js with a server-created transaction.
Webhooks (`/api/paddle/webhook`, HMAC-verified with a 5-minute replay window) provision or
update workspaces. Grace periods and locks: `TrialGateway` (dashboard) and
`billing.controller.js`.

**Audit** (`lib/audit.js`): middleware records every POST/PUT/PATCH/DELETE under `/api`
plus exports after the response finishes: actor, workspace, action (derived from the route
template, e.g. `conversations.messages.create`), resource, outcome, status, IP, user agent,
duration and a **redacted** body (passwords, tokens, secrets and keys are replaced, file
contents summarised). Add explicit events with `recordAudit({ action, category, req, … })`.

**Integrations** (`lib/integrations/`): DB triggers write `integration_events`. Every 3 s a
worker claims pending events (`FOR UPDATE SKIP LOCKED`, safe with several instances),
builds the public envelope and creates `webhook_deliveries` for subscribed webhooks and
chat connectors, and calls the HighLevel sync. A second worker sends deliveries with
signing and back-off. Secrets are sealed with AES-256-GCM (`lib/secretBox.js`).

**Real time** (`services/socket.service.js`): agents authenticate with their access token;
widget visitors with their session token. Use `broadcastToConversation`,
`broadcastToTenant`, `broadcastToVisitor` after writes.

**AI Call Center** (`src/voice/`): the former AI-Call-Center app, ported into OmniCore.
Its services are unchanged; `context.js` adapts them: a voice _account_ is an agency
(`ag_<agencyId>`) or a direct-customer workspace (`ws_<tenantId>`), each deployment is
one workspace keyed by its GoHighLevel location id, and CRM calls use OmniCore's
GoHighLevel connections. Documents live in `voice_docs` (JSONB) through `store.js`, which
implements the original Mongo-style API on PostgreSQL. The upstream test suite (35
tests) passes against it. Vapi and Twilio call `PUBLIC_APP_URL/api/voice/...`; a
database-leased timer (`startVoiceWorkers`) places queued speed-to-lead calls, retries
CRM syncs and closes stale calls. Voice activity is mirrored into the audit log as `voice.*`.

**HR module** (`src/hrms/`, front end `artifacts/hrms/`): the former GHL-HRMS app
(Express 4 + Mongoose + Redis, single company) ported into OmniCore.

- _Data:_ MongoDB, one database per workspace (`hrms_<workspace id>`) on one connection
  pool (`HRMS_MONGODB_URI`). `core/mongoose.js` is a drop-in for `require('mongoose')`:
  `mongoose.model('User', schema)` returns a proxy that resolves to the model compiled on
  the **current workspace's** database, taken from `AsyncLocalStorage`
  (`core/context.js`). Code that runs without a workspace throws instead of reading
  another workspace's data. Jobs and sockets enter a workspace with `runAsTenant()`.
- _Request flow:_ `/api/hrms/v1/*` → workspace from the HR token (`tid`), the
  workspace's activity-agent key (`x-api-key`), its device key (`?key=` on the biometric
  webhook) or `?w=` (public job applications only) → plan check
  (`tenants.hrms_feature_enabled`, cached 30 s) → ported route → HRMS error handler.
- _Sign-in:_ HR has its own accounts (employees are usually not OmniCore users). Tokens
  are signed with keys derived from `JWT_SECRET` and carry the workspace id, so they are
  never valid as dashboard tokens. Workspace admins open HR from the dashboard: `POST
/api/hrms/sso/start` creates a one-time code (`hrms_sso_codes`, 2 minutes) and the HR
  app exchanges it at `/hrms/sso`. OmniCore admins become HR `super_admin`; agency staff
  and platform support become HR `admin`. `hrms_directory` maps emails to workspaces for
  the employee login page (several matches → the user picks the company).
- _Replaced dependencies:_ Redis (refresh tokens on the user document, revoked tokens in
  `hrms_revoked_tokens`), Cloudinary and ImageKit (`core/storage.js` + `core/cloudinaryShim.js`:
  R2 or disk, signed `/api/hrms/files/...` links), nodemailer SMTP (workspace SMTP via
  `sendWorkspaceEmail`), the fixed Pakistan time zone (`core/time.js`, the workspace's
  time zone), browser-side Gemini key (server-side `/ai/chat`, AI only on plans with AI).
- _Real time:_ Socket.io namespace `/hrms` on OmniCore's server; rooms are prefixed with
  the workspace id (`core/io.js`).
- _Jobs:_ hourly attendance sweep for every HR workspace, behind a database lease.

**Invoicing and payments** (`src/payments/`): the InvoiceNow app (invoices, estimates,
payment links, coupons, gift cards) rebuilt on OmniCore's Postgres for each workspace's
own customers. Money is always an integer in minor units (cents; yen for zero-decimal
currencies); `money.computeTotals` is the only place totals are calculated.

- _Processors:_ each adapter in `providers/` implements `connect` (validate the keys,
  create webhook endpoints/client tokens), `createCheckout` (returns a redirect, a
  Paddle.js transaction or a hosted form), `handleReturn` (verify with the processor when
  the customer comes back), and optionally `verifyWebhook` + `parseWebhook`. Manual
  methods (bank transfer, Payoneer, cash on delivery) create a **pending** transaction
  that staff confirm. Credentials are sealed with `secretBox`.
- _Payment flow:_ the customer page (`/pay/<token>` for invoices and estimates,
  `/pay/l/<token>` for payment links) calls `/api/pay/.../checkout`, which records a
  `pay_attempts` row and asks the processor for a checkout of exactly the amount due.
  Webhook or return → `recordPayment`, which is idempotent on (processor, external id),
  records the amount the processor reports, applies it to the invoice only in the invoice's
  currency, emails a
  receipt and emits `payment:received` to the workspace (dashboard toast).
- _Webhooks_ are mounted in `app.ts` before `express.json` (raw body for signatures).
  The page is served with a strict CSP; its script is `/pay/assets/pay.js` (no inline
  script), and it allows only Paddle's CDN and Authorize.net's hosted form.
- _Plan gate:_ `tenants.payments_feature_enabled` (403 `payments_disabled`); public
  pages of a workspace without the feature return 404.

**Reverse DNS tool** (`src/rdns/`, super admins only): the former Python/Flask
reverse-dns-tool rewritten in Node on OmniCore's Postgres. A watchlist of CNAME targets
or IPs is polled continuously by nine passive-DNS sources (RapidDNS, crt.sh, Certspotter,
IP.THC, Robtex, Shodan InternetDB, AlienVault OTX, and the paid SecurityTrails and
DNSDB). Each (target, source) pair has a cursor in `rdns_cursors` with its page state and
the next time it may run, so paginated sources are walked to the end over many turns,
429s back off exponentially and restarts never re-burst a source. New domains are
deduplicated per target and, if enabled, queued for the forms crawler, which records
only form method, action, field names and a guessed purpose for pages of that domain
(robots.txt honoured, one page per turn, 50 pages per domain, private addresses refused
on every redirect). The scheduler runs every few seconds on one instance (database
lease). It is polite by design: an honest User-Agent, no proxy rotation and no attempt
to disguise traffic. It collects no WHOIS or contact data.

## 7. Recipes

**Add an API endpoint**

1. Add the route in the relevant controller (or a new controller mounted in `routes/index.ts`).
2. Guard it: `requireAuth` + `requirePermission('<feature>', 'read'|'edit')`.
3. Scope every query by `req.agent.tenantId`.
4. It is audited automatically if it writes; add `req.auditExtra = {…}` for extra detail.
5. Add a test next to any pure logic (`*.test.ts`, Vitest).

**Add a dashboard section**

1. Create `artifacts/dashboard/src/sections/MySection.tsx` (take `authFetch` as a prop).
2. Add `'my_section'` to `Section` in `src/lib/dashboardTypes.ts`.
3. Add a sidebar item in `App.tsx` (`feature`, `adminOnly` or `superAdminOnly`) and render it.

**Add an integration event**

1. Emit it from a trigger in `lib/integrations/schema.js` (`omnicore_emit_event(...)`).
2. Describe it in `EVENT_TYPES` and, if needed, load extra data in `buildEnvelope` (`dispatcher.js`).

**Add a marketing page**
Create the page, add the `<Route>` in `src/App.tsx`, an entry in `src/lib/seo.ts` (this
also prerenders it), and a `<url>` in `public/sitemap.xml`.

## 8. Local development

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
docker compose up -d postgres
```

```bash
set -a; . ./.env; set +a; pnpm --filter @workspace/api-server run dev
```

```bash
pnpm --filter @workspace/dashboard run dev
```

Dashboard: `http://localhost:5174/dashboard/` (Vite proxies `/api` to port 5000).
More in [local-development.md](local-development.md).

## 9. Quality gates (CI)

`.github/workflows/ci.yml` runs on every push and PR:

```bash
pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm run test:coverage && pnpm run build && pnpm audit --prod --audit-level=high
```

- ESLint allows at most **93 warnings** (the existing baseline). New code must not add any.
- Prettier formats `artifacts/{api-server,dashboard}/src/**`, `lib/**`, `scripts/**`, docs.
- Use **pnpm** only; add dependencies inside the package that uses them (`pnpm --filter <pkg> add …`).
- Node 24 (`engines`), pnpm 10.26.1 (`packageManager`).

## 10. Conventions and gotchas

- The backend mixes TypeScript (`app.ts`, `index.ts`, `routes/index.ts`) with CommonJS
  `.js` controllers; esbuild bundles both into `dist/index.mjs`.
- Every schema change must be additive and idempotent (several instances may start at once:
  take an advisory lock like `ensureIntegrationsSchema`).
- Uploads go to R2 when configured; otherwise to `artifacts/uploads/` (ignored by git).
- `trust proxy` is configured; use `req.ip` for client IPs.
- `VITE_*` values are compiled in at build time.
- Webhook routes that verify signatures (Paddle, HighLevel) are mounted **before**
  `express.json()` with `express.raw()` in `app.ts`.
