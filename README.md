# Atelier OmniCore

Multi-tenant SaaS omnichannel helpdesk and AI customer support platform.
Agents manage tickets across web chat, email, and future channels in a unified inbox. Gemini 1.5 Flash powers AI replies, rephrasing, and RAG-based knowledge retrieval.

---

## Quick Start

### 1. Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 24 LTS |
| pnpm | 9+ |
| PostgreSQL | 15+ with `pgvector` extension |

Install dependencies from the repo root:

```bash
pnpm install
```

---

### 2. Environment variables

Copy the example and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Postgres connection string (`postgres://...`) |
| `SESSION_SECRET` | ✅ | Random 32+ char string for JWT signing |
| `GEMINI_API_KEY` | ✅ | Google AI Studio key for Gemini 1.5 Flash |
| `R2_ACCOUNT_ID` | ⚠️ | Cloudflare account ID (logo upload + PDF export) |
| `R2_ACCESS_KEY_ID` | ⚠️ | Cloudflare R2 access key |
| `R2_SECRET_ACCESS_KEY` | ⚠️ | Cloudflare R2 secret |
| `R2_BUCKET_NAME` | ⚠️ | R2 bucket name |
| `LEMONSQUEEZY_API_KEY` | ⚠️ | Lemon Squeezy API key (billing) |
| `LEMONSQUEEZY_STORE_ID` | ⚠️ | Numeric LS store ID |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | ⚠️ | LS webhook signing secret |
| `LS_STARTER_VARIANT_ID` | ⚠️ | LS variant ID for Starter plan |
| `LS_PRO_VARIANT_ID` | ⚠️ | LS variant ID for Pro plan |
| `FRONTEND_URL` | ⚠️ | Dashboard base URL (e.g. `https://app.omnicore.app`) |
| `ALLOWED_ORIGINS` | ⚠️ | Comma-separated CORS origins |
| `REDIS_URL` | optional | Redis for BullMQ job queues (crawler, email) |

> ⚠️ = required for that feature; app runs without it but the feature will degrade gracefully.

---

### 3. Database setup

The app targets Replit's built-in PostgreSQL. Push the Drizzle schema to your database:

```bash
pnpm --filter @workspace/db run push
```

Enable the `pgvector` extension once (run in psql or via your DB console):

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Fix embedding dimension if you used the original 1536 schema:
ALTER TABLE ai_embeddings
  ALTER COLUMN embedding_vector TYPE VECTOR(768)
  USING embedding_vector::VECTOR(768);
```

---

### 4. Running in development

Each artifact runs on its own port, managed by Replit Workflows. The shared proxy at `localhost:80` routes traffic by path prefix.

#### API server (Express 5 · port 5000)

```bash
pnpm --filter @workspace/api-server run dev
```

Serves all routes under `/api`. Socket.io attaches to the same HTTP server.

#### Dashboard (React + Vite)

```bash
pnpm --filter @workspace/dashboard run dev
```

Served at `/` (or the path configured in `artifact.toml`).

#### Run both together (if using concurrently)

```bash
pnpm run dev
```

---

### 5. Production build

```bash
# Type-check all packages
pnpm run typecheck

# Build all packages
pnpm run build
```

---

### 6. API codegen (OpenAPI → React Query hooks + Zod schemas)

After editing `artifacts/api-spec/openapi.yaml`:

```bash
pnpm --filter @workspace/api-spec run codegen
```

---

### 7. Key routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/healthz` | Health check + DB ping |
| `POST` | `/api/auth/login` | Agent login → JWT + refresh cookie |
| `POST` | `/api/auth/refresh` | Silent token refresh |
| `GET` | `/api/conversations` | Paginated ticket list |
| `GET` | `/api/conversations/:id/messages` | Message history |
| `POST` | `/api/conversations/:id/messages` | Send message |
| `GET` | `/api/conversations/:id/export` | PDF transcript → R2 presigned URL |
| `POST` | `/api/ai/rephrase` | Rephrase draft with Gemini |
| `GET` | `/api/knowledge-articles` | List KB articles |
| `POST` | `/api/knowledge-articles` | Create article |
| `POST` | `/api/knowledge-articles/:id/vectorise` | Embed article into pgvector |
| `POST` | `/api/crawler/start` | Start web crawler (SSE progress) |
| `GET` | `/api/crawler/job/:jobId` | Poll BullMQ job status |
| `POST` | `/api/checkout` | Create Lemon Squeezy checkout |
| `POST` | `/api/billing/portal` | Customer portal URL |
| `GET` | `/api/billing/subscription` | Current plan + status |
| `GET` | `/api/billing/usage` | Period usage meters |
| `POST` | `/api/webhooks/lemonsqueezy` | LS webhook receiver (HMAC-signed) |
| `PATCH` | `/api/brands/:id` | Update brand settings |
| `POST` | `/api/brands/:id/logo-upload-url` | R2 presigned PUT for logo |

---

### 8. Widget embed

Add to any website that is listed in your brand's CORS origins:

```html
<script>
  window.OmniCoreConfig = {
    brandId: 'YOUR_BRAND_ID',
    primaryColor: '#6366f1',
  };
</script>
<script src="https://your-api-domain/widget/omnicore-widget.js" async></script>
```

---

### 9. Architecture overview

```
browser / widget
      │
      ▼
┌─────────────────────────────────────────────────┐
│  Replit shared reverse proxy  (localhost:80)    │
│  /api  →  API server (port 5000)                │
│  /     →  Dashboard (Vite, port configurable)   │
└─────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────┐   Socket.io (ws upgrade)
│  Express 5 server   │◄──────────────────────────┐
│  + Socket.io        │                           │
└──────┬──────────────┘                    agent browsers
       │
  ┌────┴────┐
  │         │
  ▼         ▼
PostgreSQL  Gemini 1.5 Flash
+ pgvector  (rephrase · RAG · AI replies)
       │
       ▼
Cloudflare R2  (logos · PDF exports · attachments)
       │
       ▼
Lemon Squeezy  (checkout · webhooks · customer portal)
```

---

### 10. Gotchas

- **Embedding dimension**: schema originally created with `VECTOR(1536)`. The embedding model (`text-embedding-004`) outputs **768 dims**. Run the `ALTER TABLE` above before inserting any embeddings.
- **Webhook raw body**: the `/api/webhooks/lemonsqueezy` route must be mounted with `express.raw({ type: 'application/json' })` **before** `express.json()` so the HMAC check has access to the raw bytes.
- **Widget disable after grace period**: `scheduleWidgetDisable` uses `setTimeout`. On process restart the timer is lost. In production, replace with a BullMQ delayed job stored in Redis.
- **R2 presigned URLs**: the Cloudflare R2 S3 compatibility layer requires `region: 'auto'` in the S3Client config — not `us-east-1`.
- **pnpm workspace isolation**: each artifact declares its own `dependencies`. Do not rely on hoisting; always `pnpm add` inside the package that needs the dep.
