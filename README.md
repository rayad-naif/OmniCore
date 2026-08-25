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
| `JWT_SECRET` | ✅ | Random 64+ character signing secret for access and refresh JWTs |
| `SESSION_SECRET` | optional | Session middleware secret when that middleware is enabled |
| `GEMINI_API_KEY` | ✅ | Google AI Studio key for Gemini 1.5 Flash |
| `R2_ACCOUNT_ID` | ⚠️ | Cloudflare account ID (logo upload + PDF export) |
| `R2_ACCESS_KEY_ID` | ⚠️ | Cloudflare R2 access key |
| `R2_SECRET_ACCESS_KEY` | ⚠️ | Cloudflare R2 secret |
| `R2_BUCKET_NAME` | ⚠️ | R2 bucket name |
| `PADDLE_API_KEY` | ⚠️ | Paddle server API key |
| `PADDLE_WEBHOOK_SECRET` | ⚠️ | Paddle webhook signing secret |
| `VITE_PADDLE_CLIENT_TOKEN` | ⚠️ | Public Paddle.js token, set at Vite build time |
| `PUBLIC_APP_URL` | ⚠️ | Canonical application URL (e.g. `https://app.omnicore.app`) |
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

### Clean-clone startup

For an isolated API, dashboard, PostgreSQL 15, and pgvector stack, use:

```bash
docker compose up --build
```

See [local development and clean-clone verification](docs/local-development.md)
for the local ports, reset instructions, and the native development path.
Set `VITE_PADDLE_CLIENT_TOKEN` in `.env` before building when Paddle checkout is
needed; it is a public browser token rather than a server secret.

---

### 5. Production build

```bash
# Type-check all packages
pnpm run typecheck

# Build all packages
pnpm run build

# Run the quality gates used by CI
pnpm run format:check
pnpm test
pnpm audit --prod --audit-level=high
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
| `GET` | `/api/healthz` | Unauthenticated process health check |
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
| `POST` | `/api/checkout` | Create configured billing-provider checkout |
| `POST` | `/api/billing/portal` | Customer portal URL |
| `GET` | `/api/billing/subscription` | Current plan + status |
| `GET` | `/api/billing/usage` | Period usage meters |
| `POST` | `/api/paddle/webhook` | Paddle webhook receiver (signature-verified) |
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
