# Deploying OmniCore

OmniCore has four runtime pieces:

| Piece          | What it is                                       | Needs                              |
| -------------- | ------------------------------------------------ | ---------------------------------- |
| API server     | Node 24 Express + Socket.io + background workers | A long-running process, WebSockets |
| Dashboard      | React SPA served at `/dashboard/`                | Static hosting                     |
| Marketing site | Prerendered HTML served at `/`                   | Static hosting                     |
| PostgreSQL     | 15+ (16 recommended), `pgvector` optional        | Managed or self-hosted             |

Because the API is a long-running WebSocket server with background jobs, it
**cannot run on serverless platforms** (Vercel Functions, Cloudflare Workers/Pages
Functions, Netlify Functions). The frontends can run anywhere.

| Option                                    | Best for                                    | Cost                              | Section                                            |
| ----------------------------------------- | ------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| **Render (all-in-one)**                   | Testing period, quickest start              | Free (sleeps when idle)           | [1](#1-render-all-in-one--recommended-for-testing) |
| **Vercel (frontends) + Render/OCI (API)** | If you want the frontends on Vercel         | Free Hobby is non-commercial      | [2](#2-vercel-frontends--api-elsewhere)            |
| **OCI + Cloudflare**                      | Production                                  | OCI Always Free + Cloudflare Free | [3](#3-production-oracle-cloud--cloudflare)        |
| **Docker (any host)**                     | Fly.io, Cloud Run, Railway, your own server | Varies                            | [4](#4-docker-any-container-host)                  |

Environment variables for every option: [ENVIRONMENT.md](ENVIRONMENT.md).

---

## 1. Render (all-in-one) — recommended for testing

One Render web service runs the API **and** serves the dashboard and marketing
site (`SERVE_STATIC=true`); one Render Postgres holds the data. Migrations and the
first super admin are created automatically on start (`scripts/migrate.mjs`), so
no shell access is needed.

1. Push the repo to GitHub (already done: `rayad-naif/OmniCore`).
2. [Render Dashboard](https://dashboard.render.com) → **New → Blueprint** → select the repo.
   Render reads [`render.yaml`](../render.yaml) and proposes the `omnicore` web service
   and the `omnicore-db` database.
3. Fill the prompted values. Minimum to start:
   - `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` (12+ characters)
   - `GEMINI_API_KEY` (any placeholder works if you are not testing AI yet)
   - Paddle sandbox: `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `VITE_PADDLE_CLIENT_TOKEN`
   - R2 (strongly recommended on Render, the disk is wiped on every deploy)
     Leave `PUBLIC_APP_URL` empty at first, the `onrender.com` URL is used automatically.
4. **Apply**. The first build takes about 5–8 minutes.
5. Open `https://<service>.onrender.com/dashboard/`, sign in with the super admin
   credentials, then remove `SUPER_ADMIN_PASSWORD` from the environment.
6. Paddle sandbox webhook: `https://<service>.onrender.com/api/paddle/webhook`
   (events in [OCI_Deployment.md §5a](OCI_Deployment.md#5a-paddle-setup-payments)).

**AI Call Center on Render:** phone calls need the server awake at all times (Vapi and
Twilio call it during the call), so use a paid Render instance or OCI for live phone
agents. Everything else works on the free plan for testing.

**Free-plan limits:** the service sleeps after ~15 minutes idle (the first request
then takes ~1 minute, and webhook deliveries/integration sync pause while asleep);
the free database expires after 30 days. Upgrade the service to _Starter_ to keep it awake.

**Custom domain on Render:** Service → Settings → Custom Domains → add
`omnicore.irofficial.com` → create the CNAME Render shows in Cloudflare (proxied is
fine) → set `PUBLIC_APP_URL=https://omnicore.irofficial.com` → redeploy.

## 2. Vercel (frontends) + API elsewhere

Vercel hosts the marketing site and dashboard; every `/api/*` request (including
Socket.io, which falls back to long-polling) is proxied to your API host, so
cookies stay same-origin.

> Vercel's free **Hobby** plan is for non-commercial use only. Because OmniCore
> takes payments, a commercial launch on Vercel needs the Pro plan.

1. Deploy the API first: Render (section 1) or OCI (section 3). Note its origin,
   e.g. `https://omnicore-api.onrender.com`.
2. Vercel → **Add New → Project** → import `rayad-naif/OmniCore`. Leave the framework
   as _Other_; [`vercel.json`](../vercel.json) supplies the install and build commands.
3. Environment variables (Production + Preview):
   - `OMNICORE_API_ORIGIN` = the API origin from step 1
   - `VITE_PADDLE_CLIENT_TOKEN` = your Paddle client token
4. Deploy. `scripts/vercel-build.mjs` builds both frontends and writes routing that
   proxies `/api/*` to the API.
5. On the **API** host set `PUBLIC_APP_URL` and `ALLOWED_ORIGINS` to the Vercel URL
   (or your custom domain), then restart it.
6. Custom domain: Vercel → Project → Settings → Domains → add the domain and create
   the record Vercel shows in Cloudflare (**DNS only / grey cloud** for Vercel).

## 3. Production: Oracle Cloud + Cloudflare

The OCI runbook is [OCI_Deployment.md](OCI_Deployment.md). This section adds
Cloudflare and connects `omnicore.irofficial.com` to the server's public IP
`80.225.249.112`.

### 3.1 How traffic flows

```
visitor ──HTTPS──► Cloudflare edge (CDN, WAF, DDoS) ──HTTPS──► OCI 80.225.249.112
                                                               nginx :443
                                                                ├─ /            marketing site (static)
                                                                ├─ /dashboard/  dashboard (static)
                                                                └─ /api/*       → 127.0.0.1:8080 API + Socket.io
                                                                                  └─ PostgreSQL (localhost)
```

### 3.2 Add the domain to Cloudflare

1. Cloudflare dashboard → **Add a site** → `irofficial.com` → Free plan.
2. Cloudflare lists two nameservers. At the registrar where you bought
   `irofficial.com`, replace the nameservers with those two. Wait until Cloudflare
   shows the site as **Active** (minutes to a few hours).
   _(If `irofficial.com` is already on Cloudflare, skip this step.)_

### 3.3 Connect the domain to the public IP

Cloudflare → `irofficial.com` → **DNS → Records → Add record**:

| Type | Name       | IPv4 address     | Proxy status         | TTL  |
| ---- | ---------- | ---------------- | -------------------- | ---- |
| A    | `omnicore` | `80.225.249.112` | **Proxied** (orange) | Auto |

Verify (a proxied record returns Cloudflare IPs, which is expected):

```bash
dig +short omnicore.irofficial.com
```

### 3.4 TLS: pick one

**Option A — Cloudflare Origin Certificate (recommended).** No certbot, valid 15 years.

1. Cloudflare → **SSL/TLS → Origin Server → Create Certificate** → RSA, hostnames
   `omnicore.irofficial.com` (and `*.irofficial.com` if you like) → 15 years → Create.
2. On the server save the two blocks:

   ```bash
   sudo mkdir -p /etc/ssl/cloudflare && sudo nano /etc/ssl/cloudflare/omnicore.pem
   ```

   ```bash
   sudo nano /etc/ssl/cloudflare/omnicore.key && sudo chmod 600 /etc/ssl/cloudflare/omnicore.key
   ```

3. Install with:

   ```bash
   sudo DOMAIN=omnicore.irofficial.com CF_ORIGIN_CERT=/etc/ssl/cloudflare/omnicore.pem CF_ORIGIN_KEY=/etc/ssl/cloudflare/omnicore.key /tmp/omnicore-bootstrap/deploy.sh vps-install
   ```

4. Cloudflare → **SSL/TLS → Overview → Full (strict)**.

An Origin Certificate is trusted by Cloudflare only, so the record must stay
**Proxied**. If you turn the orange cloud off, browsers will show a certificate error.

**Option B — Let's Encrypt.**

1. Set the DNS record to **DNS only** (grey cloud) temporarily.
2. Install with `DOMAIN=omnicore.irofficial.com CERTBOT_EMAIL=you@example.com` (see the OCI runbook).
3. When `https://omnicore.irofficial.com` works, switch the record to **Proxied** and
   set SSL/TLS mode to **Full (strict)**. Renewals keep working through Cloudflare.

### 3.5 Recommended Cloudflare settings

| Where                       | Setting                                                                                                                                                  | Why                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| SSL/TLS → Overview          | **Full (strict)**                                                                                                                                        | Encrypted and verified all the way to OCI.                                       |
| SSL/TLS → Edge Certificates | Always Use HTTPS: **On**; Min TLS **1.2**                                                                                                                |                                                                                  |
| Network                     | WebSockets: **On** (default)                                                                                                                             | Live inbox and chat widget.                                                      |
| Speed → Optimization        | Rocket Loader: **Off**                                                                                                                                   | It rewrites scripts and can break the dashboard and Paddle.js.                   |
| Caching → Configuration     | Browser cache TTL: **Respect existing headers**                                                                                                          | nginx already sends immutable caching for hashed assets and `no-cache` for HTML. |
| Rules → Cache Rules         | Bypass cache for `/api/*`                                                                                                                                | API and Socket.io must never be cached (the default already skips most).         |
| Security → WAF              | Leave managed rules on. If a Paddle or HighLevel webhook is ever blocked, add a skip rule for `/api/paddle/webhook` and `/api/integrations/ghl/webhook`. |                                                                                  |

### 3.6 Real visitor IPs

`deploy.sh vps-install` writes `/etc/nginx/conf.d/cloudflare-realip.conf` from
Cloudflare's published ranges, so nginx, rate limits and the audit log see the real
visitor IP rather than a Cloudflare address. Refresh the ranges occasionally:

```bash
sudo /srv/omnicore/deploy.sh cloudflare-ips
```

Optional hardening: allow ports 80/443 in the OCI security list only from
[Cloudflare's IP ranges](https://www.cloudflare.com/ips/), so nobody can bypass Cloudflare.

### 3.7 After DNS works

- Paddle: webhook URL and default payment link use `https://omnicore.irofficial.com`.
- HighLevel app: redirect URL `https://omnicore.irofficial.com/api/integrations/ghl/callback`,
  webhook URL `https://omnicore.irofficial.com/api/integrations/ghl/webhook`.
- `.env`: `PUBLIC_APP_URL` and `ALLOWED_ORIGINS` = `https://omnicore.irofficial.com`,
  `COOKIE_SECURE=true` (`vps-install` sets these when `DOMAIN` is given).

### 3.8 Can it all run on Cloudflare instead?

Partly. The marketing site and dashboard can be served from **Cloudflare Pages**
(build the same way as `scripts/vercel-build.mjs`, plus a small Pages Function that
forwards `/api/*` to the API, because `_redirects` cannot proxy to another origin).
The API itself needs a server (OCI, Render, Docker); Workers cannot run its
Express + Socket.io process. The OCI + Cloudflare proxy setup above already gives
you Cloudflare's CDN and protection for the whole app.

## 4. Docker (any container host)

The default `Dockerfile` target builds one image with everything:

```bash
docker build -t omnicore --build-arg VITE_PADDLE_CLIENT_TOKEN=test_xxx .
```

```bash
docker run -p 8080:8080 -e DATABASE_URL=postgres://… -e JWT_SECRET=… -e GEMINI_API_KEY=… -e SUPER_ADMIN_EMAIL=… -e SUPER_ADMIN_PASSWORD=… -e PUBLIC_APP_URL=https://… omnicore
```

The container runs migrations on start and serves the API, dashboard and marketing
site on port 8080. `docker compose up --build` still starts the separate
development stack described in [local-development.md](local-development.md).

## 5. Updating a deployment

| Host   | How                                                           |
| ------ | ------------------------------------------------------------- |
| OCI    | `cd /srv/omnicore && sudo -u ubuntu ./deploy.sh deploy`       |
| Render | Push to the tracked branch (auto-deploy) or **Manual Deploy** |
| Vercel | Push to the tracked branch                                    |
| Docker | Rebuild and restart the container; migrations run on start    |

Schema changes are additive and applied automatically on start, so updates need
no manual migration step.
