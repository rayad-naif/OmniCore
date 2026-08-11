# Atelier OmniCore — Cloud Deployment Guide

> **Acquisition Edition** · Flexible deployment for modern cloud and VPS environments  
> Covers: Linux VPS · Render · Railway · Fly.io · Vercel + Backend

---

## Table of Contents

1. [Architecture Deployment Model](#1-architecture-deployment-model)
2. [Option A — Linux VPS (Ubuntu / Debian)](#2-option-a--linux-vps-ubuntu--debian)
3. [Option B — Render.com (PaaS)](#3-option-b--rendercom-paas)
4. [Option C — Railway.app](#4-option-c--railwayapp)
5. [Option D — Fly.io](#5-option-d--flyio)
6. [Option E — Vercel (Frontend) + Backend VPS](#6-option-e--vercel-frontend--backend-vps)
7. [Database: Managed PostgreSQL Options](#7-database-managed-postgresql-options)
8. [File Storage: Cloudflare R2 Setup](#8-file-storage-cloudflare-r2-setup)
9. [nginx Configuration Reference](#9-nginx-configuration-reference)
10. [SSL / TLS Setup](#10-ssl--tls-setup)
11. [Environment Variables Checklist](#11-environment-variables-checklist)
12. [Scaling Considerations](#12-scaling-considerations)

---

## 1. Architecture Deployment Model

OmniCore has three deployable units and one stateful backing service:

| Unit | Type | Build output | Recommended hosting |
|---|---|---|---|
| **API Server** | Node.js 24 process | `artifacts/api-server/dist/index.mjs` | VPS / Railway / Render / Fly.io |
| **Dashboard** | Static SPA | `artifacts/dashboard/dist/` | nginx / Vercel / Cloudflare Pages / Render Static |
| **Marketing Site** | Prerendered HTML | `artifacts/marketing-site/dist/public/` | nginx / Vercel / Cloudflare Pages / Render Static |
| **PostgreSQL** | Database | — | Same VPS / Supabase / Neon / Railway / RDS |

> **Socket.io note:** The API server uses Socket.io with long-polling + WebSocket transport. Any reverse proxy or PaaS must support persistent WebSocket connections and pass `Upgrade` headers correctly.

### Build all artifacts

```bash
pnpm install
pnpm run build
# Produces:
#   artifacts/api-server/dist/index.mjs
#   artifacts/dashboard/dist/
#   artifacts/marketing-site/dist/public/
```

---

## 2. Option A — Linux VPS (Ubuntu / Debian)

**Best for:** Full control, lowest cost, no vendor lock-in.  
**Recommended specs:** 2 vCPU · 4 GB RAM · 40 GB SSD (scales from 1 vCPU / 2 GB)  
**Providers:** DigitalOcean · Hetzner · Oracle Cloud Free Tier · Linode · Vultr

### 2.1 System setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm
npm install -g pnpm pm2

# PostgreSQL 16 + pgvector
sudo apt install -y postgresql-16 postgresql-16-pgvector

# nginx
sudo apt install -y nginx certbot python3-certbot-nginx

node -v && pnpm -v && pm2 -v
```

### 2.2 Database

```bash
sudo -u postgres psql << SQL
CREATE USER omnicore WITH PASSWORD 'strong_password_here';
CREATE DATABASE omnicore OWNER omnicore;
\c omnicore
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
SQL

# Apply schema
psql -U omnicore -d omnicore -h localhost -f artifacts/api-server/schema.sql
```

### 2.3 Deploy application

```bash
# Clone and build
git clone https://github.com/your-org/omnicore.git /srv/omnicore
cd /srv/omnicore
pnpm install
pnpm run build

# Environment
cp .env.example /srv/omnicore/artifacts/api-server/.env
nano /srv/omnicore/artifacts/api-server/.env   # Fill all values
```

### 2.4 PM2 process management

```bash
# Create PM2 ecosystem file
cat > /srv/omnicore/ecosystem.config.cjs << 'EOF'
const fs   = require('fs');
const path = require('path');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
      .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
  );
}

module.exports = {
  apps: [{
    name:       'omnicore-api',
    script:     './artifacts/api-server/dist/index.mjs',
    cwd:        '/srv/omnicore',
    env:        loadEnv('/srv/omnicore/artifacts/api-server/.env'),
    instances:  1,
    exec_mode:  'fork',
    watch:      false,
    max_memory_restart: '512M',
    error_file: '/var/log/omnicore/error.log',
    out_file:   '/var/log/omnicore/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }]
};
EOF

mkdir -p /var/log/omnicore
pm2 start /srv/omnicore/ecosystem.config.cjs
pm2 save
pm2 startup    # Follow the printed command to enable auto-start
```

### 2.5 nginx reverse proxy

```nginx
# /etc/nginx/sites-available/omnicore
server {
    listen 80;
    server_name yourdomain.com;

    # API + Socket.io
    location /api/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }

    # Agent dashboard
    location /dashboard/ {
        alias /srv/omnicore/artifacts/dashboard/dist/;
        try_files $uri $uri/ /dashboard/index.html;
    }

    # Marketing site (root)
    location / {
        root /srv/omnicore/artifacts/marketing-site/dist/public/;
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/omnicore /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 2.6 Deploy updates

```bash
cd /srv/omnicore
git pull
pnpm install
pnpm run build
pm2 restart omnicore-api
```

---

## 3. Option B — Render.com (PaaS)

**Best for:** Managed infrastructure, zero server admin, auto-deployments from GitHub.  
**Cost:** Web service from ~$7/mo; PostgreSQL from $7/mo.

### 3.1 API Server (Web Service)

1. Connect your GitHub repository in the Render dashboard
2. Create a **Web Service** with:

| Setting | Value |
|---|---|
| **Runtime** | Node |
| **Build Command** | `pnpm install && pnpm --filter @workspace/api-server run build` |
| **Start Command** | `node artifacts/api-server/dist/index.mjs` |
| **Health Check Path** | `/api/health` |
| **Node version** | `24` (set in `NODE_VERSION` env var) |

3. Add all environment variables from `.env.example` in the **Environment** tab
4. Set `PORT` to `10000` (Render's default) or leave it unset (Render injects `PORT` automatically)
5. Enable **Auto-Deploy** on push to `main`

> **Socket.io:** Render Web Services support WebSockets natively. No extra configuration needed.

### 3.2 Dashboard & Marketing Site (Static Sites)

Create two **Static Sites** on Render:

**Dashboard:**
| Setting | Value |
|---|---|
| **Build Command** | `pnpm install && pnpm --filter @workspace/dashboard run build` |
| **Publish Directory** | `artifacts/dashboard/dist` |
| **Routes** | Add a rewrite rule: `/*` → `/index.html` (200) |

**Marketing Site:**
| Setting | Value |
|---|---|
| **Build Command** | `pnpm install && pnpm --filter @workspace/marketing-site run build` |
| **Publish Directory** | `artifacts/marketing-site/dist/public` |

### 3.3 Database

Use **Render Managed PostgreSQL** (postgres 15/16):
- Copy the Internal Database URL to `DATABASE_URL` in your API service environment

Enable pgvector after creation:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```
(Run via Render's database shell or any psql client)

---

## 4. Option C — Railway.app

**Best for:** Developer-friendly PaaS with integrated Postgres + automatic TLS.  
**Cost:** Usage-based from ~$5/mo with free $5 credit/mo.

### 4.1 Setup

```bash
# Install Railway CLI
npm install -g @railway/cli
railway login
railway init
```

### 4.2 Deploy via railway.toml

Create `railway.toml` in the repository root:

```toml
[build]
builder = "NIXPACKS"
buildCommand = "pnpm install && pnpm run build"

[deploy]
startCommand = "node artifacts/api-server/dist/index.mjs"
healthcheckPath = "/api/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
```

### 4.3 Add PostgreSQL

```bash
# In Railway dashboard: Add → Database → PostgreSQL
# Railway injects DATABASE_URL automatically
```

After provisioning, run the schema:
```bash
railway run psql $DATABASE_URL -f artifacts/api-server/schema.sql
railway run psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 4.4 Static frontends

Railway can also serve static files. Alternatively, deploy the dashboard and marketing site to **Cloudflare Pages** (free) by connecting the same GitHub repo with separate build configurations:

| Site | Build command | Output dir |
|---|---|---|
| Dashboard | `pnpm install && pnpm --filter @workspace/dashboard run build` | `artifacts/dashboard/dist` |
| Marketing | `pnpm install && pnpm --filter @workspace/marketing-site run build` | `artifacts/marketing-site/dist/public` |

---

## 5. Option D — Fly.io

**Best for:** Global edge deployment, Docker-compatible, generous free tier.

### 5.1 Dockerfile

```dockerfile
FROM node:24-slim

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/ ./lib/
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm --filter @workspace/api-server run build

EXPOSE 8080
ENV PORT=8080

CMD ["node", "artifacts/api-server/dist/index.mjs"]
```

### 5.2 fly.toml

```toml
app = "omnicore-api"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    path = "/api/health"
    interval = "10s"
    timeout  = "5s"

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

### 5.3 Deploy

```bash
fly auth login
fly launch --no-deploy
fly postgres create --name omnicore-db
fly postgres attach omnicore-db    # Injects DATABASE_URL

# Set secrets
fly secrets set JWT_SECRET="..." GEMINI_API_KEY="..." PADDLE_API_KEY="..."

# Deploy
fly deploy

# Apply schema
fly ssh console -C "psql \$DATABASE_URL -f /app/artifacts/api-server/schema.sql"
fly ssh console -C "psql \$DATABASE_URL -c 'CREATE EXTENSION IF NOT EXISTS vector;'"
```

---

## 6. Option E — Vercel (Frontend) + Backend VPS

**Best for:** Buyers who want Vercel's edge CDN for marketing/dashboard and a cheap VPS for the API.

### Architecture

```
Vercel (Edge CDN)                    VPS / Any Cloud
├── marketing-site → yourdomain.com  ├── API Server  → api.yourdomain.com
└── dashboard      → app.yourdomain.com   └── PostgreSQL
```

### 6.1 Deploy frontends to Vercel

**Marketing site — `vercel.json`:**
```json
{
  "buildCommand": "pnpm install && pnpm --filter @workspace/marketing-site run build",
  "outputDirectory": "artifacts/marketing-site/dist/public",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**Dashboard — `vercel.json`** (in `artifacts/dashboard/` or a separate Vercel project):
```json
{
  "buildCommand": "pnpm install && pnpm --filter @workspace/dashboard run build",
  "outputDirectory": "artifacts/dashboard/dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### 6.2 API on VPS

Follow **Option A** (VPS setup), but configure the API on a subdomain:
- `api.yourdomain.com` → nginx proxies to `127.0.0.1:8080`
- Update `PUBLIC_APP_URL=https://api.yourdomain.com`
- Update `ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com`

### 6.3 CORS configuration

In the API's `.env`:
```
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

---

## 7. Database: Managed PostgreSQL Options

All options require pgvector extension support.

| Provider | pgvector | Free tier | Notes |
|---|---|---|---|
| **Neon** | ✅ Built-in | ✅ Yes | Serverless Postgres; serverless-compatible with connection pooling |
| **Supabase** | ✅ Built-in | ✅ Yes (2 projects) | Excellent DX; includes auth/storage (unused but available) |
| **Railway Postgres** | ✅ Yes | Hobby plan | Tightly integrated with Railway deployments |
| **Render Postgres** | ✅ Yes | ❌ No | Managed, reliable, simple |
| **AWS RDS** | ✅ via extension | ❌ No | Enterprise-grade; higher cost |
| **Self-hosted** | ✅ via apt | N/A | `postgresql-16-pgvector` package |

### Applying schema to any managed database

```bash
# Replace with your DATABASE_URL
psql "postgresql://user:pass@host:5432/dbname?sslmode=require" << SQL
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
SQL

psql "postgresql://user:pass@host:5432/dbname?sslmode=require" \
  -f artifacts/api-server/schema.sql
```

---

## 8. File Storage: Cloudflare R2 Setup

OmniCore uses Cloudflare R2 for all file storage (widget attachments, logos, exports).

### Setup steps

1. **Create a Cloudflare account** at [cloudflare.com](https://cloudflare.com)
2. Navigate to **R2 Object Storage** → **Create bucket** (e.g. `omnicore-files`)
3. Go to **Manage R2 API Tokens** → Create token with **Object Read & Write** on your bucket
4. Copy:
   - Account ID (found on R2 dashboard)
   - Access Key ID
   - Secret Access Key
5. Set the endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
6. **Configure CORS** on the bucket (for presigned URL uploads from browsers):

```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com"],
    "AllowedMethods": ["GET", "PUT", "POST"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

### Alternative: AWS S3

The R2 client uses the AWS SDK S3Client — any S3-compatible storage works. Replace the endpoint and credentials with your AWS S3 bucket details.

---

## 9. nginx Configuration Reference

Full production nginx config with WebSocket support and static file serving:

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Security headers
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    # API + Socket.io (WebSocket upgrade)
    location /api/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        client_max_body_size 50M;
    }

    # Agent dashboard (SPA)
    location /dashboard/ {
        alias /srv/omnicore/artifacts/dashboard/dist/;
        try_files $uri $uri/ /dashboard/index.html;
        expires 1h;
        add_header Cache-Control "public, must-revalidate";

        # Cache hashed assets aggressively
        location ~* \.(js|css|woff2|png|svg|ico)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # Marketing site (root, prerendered HTML)
    location / {
        root /srv/omnicore/artifacts/marketing-site/dist/public/;
        try_files $uri $uri/ /index.html;
        expires 10m;

        location ~* \.(js|css|woff2|png|svg|ico)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}
```

---

## 10. SSL / TLS Setup

### Let's Encrypt (free, auto-renews)

```bash
# Obtain certificate
sudo certbot --nginx -d yourdomain.com

# Auto-renewal (already configured by certbot, verify):
sudo systemctl status certbot.timer
```

### Cloudflare (proxy mode)

If your DNS is on Cloudflare, enable the orange-cloud proxy:
- Cloudflare handles TLS termination
- Set nginx to listen on 80 only (Cloudflare → origin is HTTP)
- Set `COOKIE_SECURE=false` if not using Cloudflare's flexible SSL → instead enable **Full (strict)** SSL mode in Cloudflare and keep HTTPS end-to-end

---

## 11. Environment Variables Checklist

All of the following must be set in your production environment before the first start:

```
# Core
NODE_ENV=production
PORT=8080
DATABASE_URL=postgres://omnicore:password@localhost:5432/omnicore
JWT_SECRET=<64-char random hex>
SESSION_SECRET=<32-char random hex>
PUBLIC_APP_URL=https://yourdomain.com
ALLOWED_ORIGINS=https://yourdomain.com

# Cookie (HTTP-only deployments)
COOKIE_SECURE=false  # ← Remove or set true when HTTPS is active

# AI
GEMINI_API_KEY=your_key

# Billing (Paddle)
BILLING_PROVIDER=paddle
PADDLE_ENVIRONMENT=production
PADDLE_API_KEY=your_key
PADDLE_WEBHOOK_SECRET=your_secret
PADDLE_STARTER_PRICE_ID=pri_xxx
PADDLE_GROWTH_PRICE_ID=pri_xxx

# Storage (Cloudflare R2)
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=omnicore-files
```

---

## 12. Scaling Considerations

### Horizontal scaling (multiple API instances)

Socket.io uses in-process memory for rooms by default. To run multiple API instances behind a load balancer, add a Redis adapter:

```bash
pnpm --filter @workspace/api-server add socket.io-redis
```

```typescript
// In socket.service.js — add after io creation:
import { createAdapter } from 'socket.io-redis';
io.adapter(createAdapter(redisClient));
```

Set `REDIS_URL` in environment and ensure your load balancer uses **sticky sessions** (IP hash or cookie) for the polling transport fallback.

### Database connection pooling

For high-traffic deployments, add **PgBouncer** in front of PostgreSQL:
```
DATABASE_URL=postgres://omnicore:pass@127.0.0.1:6432/omnicore
```

### CDN for static assets

Serve `artifacts/dashboard/dist/assets/` and `artifacts/marketing-site/dist/public/` from Cloudflare CDN or AWS CloudFront to reduce origin load. The Vite builds produce content-hashed filenames — set `Cache-Control: public, immutable` with a 1-year TTL on hashed assets.

### Minimum recommended specs by tier

| Traffic | API Server | Database |
|---|---|---|
| < 1k visits/day | 1 vCPU · 1 GB RAM | 5 GB storage |
| 1k–10k visits/day | 2 vCPU · 4 GB RAM | 20 GB storage |
| 10k–100k visits/day | 4 vCPU · 8 GB RAM + Redis | 50 GB + read replica |

---

*Atelier OmniCore — Flexible architecture, production-ready from day one.*
