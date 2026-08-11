# Atelier OmniCore — Buyer Onboarding Guide

> **Acquisition Edition** · Prepared for Acquire.com / Flippa transfer  
> Stack: Express 5 · React 19 · Socket.io · Gemini 2.5 Flash · Paddle Billing · pgvector

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Prerequisites](#4-prerequisites)
5. [Local Development Setup](#5-local-development-setup)
6. [Environment Variables Reference](#6-environment-variables-reference)
7. [Database Setup](#7-database-setup)
8. [Running the Application](#8-running-the-application)
9. [Feature Walkthrough](#9-feature-walkthrough)
10. [Billing & Monetisation](#10-billing--monetisation)
11. [Embeddable Widget](#11-embeddable-widget)
12. [AI / RAG System](#12-ai--rag-system)
13. [Customisation Checklist](#13-customisation-checklist)
14. [Production Checklist](#14-production-checklist)

---

## 1. Project Overview

**Atelier OmniCore** is a production-ready, multi-tenant AI-powered omnichannel helpdesk SaaS platform. It ships as a complete, self-contained codebase ready to white-label, extend, or sell as-is.

### Core capabilities

| Capability | Detail |
|---|---|
| **Multi-tenant** | Unlimited tenants, each with isolated brands, agents, and data |
| **Real-time inbox** | Socket.io-powered live chat, typing indicators, read receipts |
| **AI auto-reply** | Google Gemini 2.5 Flash + pgvector RAG over your knowledge base |
| **Embeddable widget** | Drop-in `<script>` tag for any customer website |
| **Omnichannel** | Live chat, email inbound (SMTP/IMAP), ticket system |
| **Billing** | Paddle Billing (Starter / Growth plans); Stripe also supported |
| **File storage** | Cloudflare R2 (S3-compatible) for attachments and logos |
| **CSAT** | Built-in customer satisfaction rating flow |
| **Super Admin** | Platform-level tenant management, plan limits, usage |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser / Widget                     │
│         Dashboard (React 19)   Marketing Site (React 19)   │
│           Vite 7 · Tailwind 4    Vite 7 · SSR prerender    │
└────────────┬──────────────────────────────┬─────────────────┘
             │ REST + Socket.io              │ REST
             ▼                              ▼
┌────────────────────────────────────────────────────────────┐
│                   API Server (Express 5)                   │
│  • Node.js 24 · TypeScript · esbuild bundle               │
│  • JWT auth (access token + httpOnly refresh cookie)       │
│  • Socket.io  — real-time messaging / presence             │
│  • Gemini 2.5 Flash — AI replies + confidence scoring      │
│  • Paddle Billing — checkout / webhooks / plan mgmt        │
│  • Cloudflare R2 — file upload / presigned URLs            │
│  • Nodemailer — SMTP outbound / IMAP inbound               │
│  • Helmet · CORS · pino structured logging                 │
└───────────────────────┬────────────────────────────────────┘
                        │
             ┌──────────▼──────────┐
             │  PostgreSQL 15+     │
             │  + pgvector ext.    │
             │                     │
             │  tenants            │
             │  brands             │
             │  agents             │
             │  visitors           │
             │  conversations      │
             │  messages           │
             │  knowledge_articles │
             │  ai_embeddings      │
             │  (1536-dim vector)  │
             └─────────────────────┘
```

### Request / event flow

1. **Widget visitor** loads `widget.js` from the API server → opens Socket.io connection → creates session → sends messages
2. **Agent dashboard** authenticates via JWT → subscribes to tenant Socket.io rooms → receives real-time conversation events
3. **AI reply** — on each inbound message the AI service queries `ai_embeddings` via pgvector cosine similarity, passes top-K chunks to Gemini, evaluates confidence, and either replies automatically or flags for human escalation
4. **Email inbound** — `email.webhook.controller.js` receives forwarded email payloads, creates or updates conversations, attaches files to R2
5. **Billing webhooks** — Paddle posts signed events to `/api/paddle/webhook`; the handler reconciles subscription state, trial periods, and plan limits per tenant

---

## 3. Monorepo Structure

```
/
├── artifacts/
│   ├── api-server/          # Express 5 API (Node.js 24)
│   │   ├── src/
│   │   │   ├── controllers/ # Route handlers (auth, billing, conversations…)
│   │   │   ├── middleware/  # JWT auth, permissions
│   │   │   ├── routes/      # Router mounts (ai, billing, health)
│   │   │   ├── services/    # AI, email, export, socket, ticket services
│   │   │   ├── lib/         # Paddle, R2, billing provider, plans
│   │   │   └── workers/     # Web crawler for knowledge base
│   │   ├── schema.sql       # PostgreSQL DDL (idempotent)
│   │   └── build.mjs        # esbuild bundler config
│   │
│   ├── dashboard/           # React 19 agent dashboard (Vite 7)
│   │   └── src/
│   │       ├── App.tsx      # Single-SPA with auth + all views
│   │       └── components/  # Inbox, Billing, KnowledgeBase, BrandSettings…
│   │
│   └── marketing-site/      # React 19 marketing + checkout (Vite 7 + SSR)
│       └── src/
│           ├── pages/       # Home, Pricing, Checkout, Help, Legal
│           └── entry-server.tsx
│
├── lib/
│   ├── api-client-react/    # Generated React API client
│   ├── api-spec/            # OpenAPI YAML specification
│   ├── api-zod/             # Generated Zod validators / types
│   └── db/                  # Drizzle ORM schema + config
│
├── scripts/                 # Workspace tooling
├── .env.example             # All required environment variables
├── pnpm-workspace.yaml      # pnpm monorepo config
└── deploy.sh                # Automated setup script
```

---

## 4. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | 24.x LTS | Required. Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) |
| **pnpm** | 10+ | `npm install -g pnpm` |
| **PostgreSQL** | 15 or 16 | With `pgvector` extension |
| **Git** | Any | For cloning |

### Install PostgreSQL + pgvector (Ubuntu/Debian)

```bash
# PostgreSQL 16
sudo apt install -y postgresql-16 postgresql-16-pgvector

# macOS (Homebrew)
brew install postgresql@16
brew install pgvector
```

### Install Node.js 24 via nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 24
nvm use 24
node -v   # → v24.x.x
```

---

## 5. Local Development Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-org/omnicore.git
cd omnicore

# 2. Install all workspace dependencies
pnpm install

# 3. Copy and fill in environment variables
cp .env.example artifacts/api-server/.env
# → Edit artifacts/api-server/.env (see Section 6)

# 4. Create the database and apply the schema
createdb omnicore
psql -d omnicore -f artifacts/api-server/schema.sql

# 5. Start all services in development mode
#    Terminal A — API server (port 8080)
pnpm --filter @workspace/api-server run dev

#    Terminal B — Dashboard (port 5173)
pnpm --filter @workspace/dashboard run dev

#    Terminal C — Marketing site (port 5174)
pnpm --filter @workspace/marketing-site run dev
```

The API automatically runs all `ALTER TABLE … ADD COLUMN IF NOT EXISTS` migrations on startup — no separate migration runner is needed for schema changes.

---

## 6. Environment Variables Reference

Copy `.env.example` to `artifacts/api-server/.env` and populate each value.

### Required — Core

| Variable | Example | Description |
|---|---|---|
| `NODE_ENV` | `production` | `development` or `production` |
| `PORT` | `8080` | Port the API server binds to |
| `DATABASE_URL` | `postgres://user:pass@localhost:5432/omnicore` | PostgreSQL connection string |
| `JWT_SECRET` | *(64-char hex)* | Signs all access + refresh tokens. Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `SESSION_SECRET` | *(32-char hex)* | Session middleware secret |
| `PUBLIC_APP_URL` | `https://yourdomain.com` | Used in password reset links and Paddle redirect URLs |

### Required — AI

| Variable | Example | Description |
|---|---|---|
| `GEMINI_API_KEY` | `AIza…` | Google AI Studio API key — [aistudio.google.com](https://aistudio.google.com) |

### Required — Billing (Paddle)

| Variable | Example | Description |
|---|---|---|
| `BILLING_PROVIDER` | `paddle` | `paddle` or `stripe` |
| `PADDLE_ENVIRONMENT` | `production` | `sandbox` or `production` |
| `PADDLE_API_KEY` | `…` | From Paddle dashboard → Developer → API keys |
| `PADDLE_WEBHOOK_SECRET` | `…` | From Paddle dashboard → Developer → Notifications |
| `PADDLE_STARTER_PRICE_ID` | `pri_…` | Paddle price ID for Starter plan |
| `PADDLE_GROWTH_PRICE_ID` | `pri_…` | Paddle price ID for Growth plan |

### Required — File Storage (Cloudflare R2)

| Variable | Example | Description |
|---|---|---|
| `R2_ENDPOINT` | `https://xxx.r2.cloudflarestorage.com` | R2 bucket endpoint |
| `R2_ACCESS_KEY_ID` | `…` | R2 API token Access Key ID |
| `R2_SECRET_ACCESS_KEY` | `…` | R2 API token Secret |
| `R2_BUCKET_NAME` | `omnicore-files` | R2 bucket name |

### Optional

| Variable | Default | Description |
|---|---|---|
| `COOKIE_SECURE` | *(unset)* | Set `false` for self-hosted HTTP deployments (no HTTPS) |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error` |

---

## 7. Database Setup

### Fresh install

```bash
# Create DB and user
psql -U postgres -c "CREATE USER omnicore WITH PASSWORD 'your_password';"
psql -U postgres -c "CREATE DATABASE omnicore OWNER omnicore;"

# Apply schema (idempotent — safe to re-run)
psql -U omnicore -d omnicore -f artifacts/api-server/schema.sql
```

### Seed a super admin account

```bash
# Generate a bcrypt hash for your password
node -e "const b=require('bcryptjs'); b.hash('YourPassword123!', 12).then(h => console.log(h));"

# Insert via psql
psql -U omnicore -d omnicore << SQL
-- Create platform tenant
INSERT INTO tenants (id, company_name, subdomain)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Your Company',
  'admin'
) ON CONFLICT DO NOTHING;

-- Create super admin agent
INSERT INTO agents (id, tenant_id, name, email, password_hash, role, is_active)
VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'Admin',
  'admin@yourdomain.com',
  '$2a$12$PASTE_BCRYPT_HASH_HERE',
  'admin',
  true
) ON CONFLICT DO NOTHING;

-- Register super admin email
INSERT INTO super_admin_emails (email) VALUES ('admin@yourdomain.com') ON CONFLICT DO NOTHING;
SQL
```

### Tables overview

| Table | Purpose |
|---|---|
| `tenants` | Companies using the platform; holds billing/subscription state |
| `brands` | Each tenant can have multiple brands (websites/products) with their own widget config |
| `agents` | Tenant staff (admins, agents, supervisors) with role-based permissions |
| `password_reset_tokens` | Time-limited tokens for password reset / agent invite flows |
| `visitors` | Anonymous or identified end-users chatting via the widget |
| `conversations` | Support threads — links visitor ↔ brand ↔ assigned agent |
| `messages` | Individual chat messages, internal notes, and system events |
| `knowledge_articles` | Help center articles used for AI context retrieval |
| `ai_embeddings` | 1536-dimension pgvector embeddings of article chunks for semantic search |

---

## 8. Running the Application

### Development

```bash
# All services concurrently (requires pnpm dlx concurrently or separate terminals)
pnpm --filter @workspace/api-server run dev   # :8080
pnpm --filter @workspace/dashboard run dev    # :5173
pnpm --filter @workspace/marketing-site run dev  # :5174
```

### Production build

```bash
# Typecheck + build all artifacts
pnpm run build

# Outputs:
#   artifacts/api-server/dist/index.mjs     ← Node.js bundle (esbuild)
#   artifacts/dashboard/dist/               ← Static SPA (Vite)
#   artifacts/marketing-site/dist/          ← Prerendered HTML (Vite SSR)
```

### Run in production

```bash
# API server
node artifacts/api-server/dist/index.mjs

# Dashboard + Marketing site: serve as static files via nginx or any CDN
```

### PM2 (recommended for VPS)

```bash
pm2 start artifacts/api-server/dist/index.mjs --name omnicore-api
pm2 save && pm2 startup
```

---

## 9. Feature Walkthrough

### Super Admin
- Log in with a `super_admin_emails`-registered account
- Navigate to **Super Admin** in the sidebar
- View all tenants, adjust plan limits (`max_agents_allowed`, `conversation_limit`, `max_brands_allowed`), toggle AI and SMTP features per tenant

### Tenant Onboarding
1. Tenant signs up via `/signup` on the marketing site
2. A tenant record + default brand are created automatically
3. The first agent is assigned the `admin` role
4. They configure their brand (name, logo, widget colours) in **Brands** → **Brand Settings**

### Inbox (Real-time Chat)
- Conversations appear live via Socket.io
- Assign to agents, set priority (low / medium / high / urgent)
- Add internal notes (not visible to visitors)
- AI reply suggestions with confidence scores
- SLA breach indicators

### Knowledge Base & AI Training
1. Navigate to **AI Training**
2. Add articles manually or crawl a URL
3. Articles are chunked and embedded via Gemini embeddings → stored in `ai_embeddings`
4. AI auto-reply uses cosine similarity to retrieve relevant chunks before composing a response

### CSAT
- After a conversation is resolved, a CSAT request can be triggered
- The visitor rates the interaction via the widget
- Scores visible under the **CSAT** section

### Tickets
- Mark any conversation as a ticket (assigns a sequential ticket number)
- Filter inbox by tickets vs live chats

---

## 10. Billing & Monetisation

OmniCore ships with **Paddle Billing** pre-integrated.

### Plans

| Plan | Price | Key Limits |
|---|---|---|
| **Free** | $0 | Platform default for new tenants |
| **Starter** | $29/mo | Configured via `PADDLE_STARTER_PRICE_ID` |
| **Growth** | $79/mo | Configured via `PADDLE_GROWTH_PRICE_ID` |

### Webhook endpoint
Register in Paddle dashboard → Developer → Notifications:
```
https://yourdomain.com/api/paddle/webhook
```
The server verifies the `Paddle-Signature` header using HMAC-SHA256.

### Changing plans / pricing
1. Create new products + prices in Paddle dashboard
2. Update `PADDLE_STARTER_PRICE_ID` and `PADDLE_GROWTH_PRICE_ID` in your `.env`
3. Adjust feature limits per plan in `artifacts/api-server/src/lib/plansRepo.js`

---

## 11. Embeddable Widget

The embeddable widget is a self-contained JavaScript bundle served by the API.

### Embed code (add to any customer website)

```html
<script>
  window.OmniCoreConfig = {
    brandId: "YOUR_BRAND_UUID"
  };
</script>
<script src="https://yourdomain.com/api/widget/widget.js" async></script>
```

### Widget capabilities
- Live chat with typing indicators and read receipts
- File attachments (stored in R2)
- CSAT rating after resolution
- Visitor session persistence across page navigations
- Page URL tracking (current URL sent with each message)
- Custom colours and branding configured per brand in dashboard

### Socket.io connection
The widget connects to `https://yourdomain.com/api/socket.io` using the visitor's session token. A Socket.io client bundle is served at `/api/widget/socket.io.js`.

---

## 12. AI / RAG System

### Architecture
```
User message
    │
    ▼
ai.service.js
    │── Query ai_embeddings (pgvector cosine similarity, top-K chunks)
    │── Build context prompt with retrieved article chunks
    │── Call Gemini 2.5 Flash API
    │── Evaluate confidence score
    │
    ├── High confidence  → auto-reply sent to visitor
    └── Low confidence   → conversation flagged for human agent
```

### Configuration (per brand)
- **AI auto-reply enabled** — toggle in Brand Settings
- **System prompt** — custom instructions for the AI persona
- **Confidence threshold** — minimum score to trigger auto-reply

### Embedding pipeline
1. Agent publishes a knowledge article
2. Article is chunked (sentence-level)
3. Each chunk is embedded via Gemini Embeddings API
4. 1536-dimensional vectors stored in `ai_embeddings` with `pgvector`
5. IVFFlat index enables sub-millisecond nearest-neighbour lookups

---

## 13. Customisation Checklist

After acquisition, work through this list to make the platform your own:

- [ ] Replace branding in `artifacts/marketing-site/src/` (logo, company name, colours)
- [ ] Update `PUBLIC_APP_URL` to your domain
- [ ] Replace Paddle product/price IDs with your own
- [ ] Create your own Cloudflare R2 bucket and update R2 credentials
- [ ] Set your own `JWT_SECRET` (minimum 64 characters, random hex)
- [ ] Update the super admin email and seed your own admin account
- [ ] Configure outbound SMTP in the platform settings
- [ ] Update `GEMINI_API_KEY` with your own Google AI Studio key
- [ ] Set allowed CORS origins (`ALLOWED_ORIGINS`) to your domains
- [ ] Register Paddle webhook URL pointing to your domain
- [ ] Point your domain's DNS to your server and set up TLS (certbot / Cloudflare)

---

## 14. Production Checklist

- [ ] `NODE_ENV=production`
- [ ] `COOKIE_SECURE=true` (requires HTTPS) or `false` (HTTP only)
- [ ] PostgreSQL running with a dedicated user + password
- [ ] PM2 configured with `pm2 startup` for auto-restart on reboot
- [ ] nginx reverse-proxying `/api/` with WebSocket upgrade headers
- [ ] TLS certificate installed (Let's Encrypt / Cloudflare)
- [ ] R2 CORS policy configured to allow your domain
- [ ] Paddle webhook registered and verified
- [ ] Firewall: only ports 80, 443 (and 22 for SSH) exposed
- [ ] Database backups scheduled (`pg_dump` cron or managed DB snapshots)

---

*Atelier OmniCore — Built for scale, ready to ship.*
