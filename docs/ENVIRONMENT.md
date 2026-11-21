# Environment variables & super admin setup

Every setting OmniCore reads from the environment, what it does, and where to get
the value. The template with the same variables is [`.env.example`](../.env.example).

**Where the variables live**

| Deployment              | Where to set them                                                        |
| ----------------------- | ------------------------------------------------------------------------ |
| OCI / VPS (`deploy.sh`) | `/srv/omnicore/artifacts/api-server/.env` (mode 600), then `pm2 restart` |
| Render                  | Service → Environment (the blueprint pre-creates every key)              |
| Vercel (frontends)      | Project → Settings → Environment Variables (build-time values only)      |
| Docker                  | `docker run -e …` / `env_file:` in compose                               |
| Local development       | `.env` in the repo root                                                  |

`VITE_*` variables are compiled into the dashboard/marketing bundles at **build
time**. After changing one, rebuild (`./deploy.sh deploy`, or redeploy on Render/Vercel).
Everything else is read when the API starts; restart after changing.

---

## 1. Required

| Variable         | Example                                         | Notes                                                                                               |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `NODE_ENV`       | `production`                                    | Enables secure cookies, hides error details, verifies database TLS for public hosts.                |
| `PORT`           | `8080`                                          | Port the API listens on. `deploy.sh` and Docker use 8080; nginx proxies to it.                      |
| `DATABASE_URL`   | `postgres://omnicore:…@localhost:5432/omnicore` | PostgreSQL 15+ (16 recommended). `pgvector` is optional.                                            |
| `JWT_SECRET`     | 128 hex chars                                   | Signs access/refresh tokens. `openssl rand -hex 64`. Rotating it signs everyone out.                |
| `GEMINI_API_KEY` | `AIza…`                                         | [Google AI Studio](https://aistudio.google.com/app/apikey). Powers AI replies, rephrase, summaries. |

The API refuses to start without `DATABASE_URL`, `JWT_SECRET` and `GEMINI_API_KEY`
(a placeholder value is accepted if you are not using AI yet).

## 2. URLs, CORS, cookies, proxies

| Variable          | Default                              | Notes                                                                                                                                                                            |
| ----------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_APP_URL`  | Render URL on Render, otherwise none | Canonical `https://` origin. Used in emails, Paddle/HighLevel callbacks, webhook payload links. **Set it in production.**                                                        |
| `ALLOWED_ORIGINS` | `PUBLIC_APP_URL`                     | Comma-separated browser origins allowed to call the API with cookies. The chat widget is always allowed from any site.                                                           |
| `COOKIE_SECURE`   | `true` in production                 | Refresh cookie `Secure` flag. Only set `false` for plain-HTTP testing.                                                                                                           |
| `TRUST_PROXY`     | `loopback, linklocal, uniquelocal`   | Which proxies may set `X-Forwarded-For`. Correct for nginx on the same host, Render, and Docker networks. See §9 for Cloudflare.                                                 |
| `DATABASE_SSL`    | auto                                 | `auto`: no TLS for localhost/private hosts, verified TLS for public hosts. `disable`, `no-verify` (self-signed managed DBs), `verify`. A `sslmode=` in `DATABASE_URL` overrides. |
| `SERVE_STATIC`    | `false`                              | `true` = the API also serves the dashboard and marketing site (Render, Docker). On OCI nginx does this.                                                                          |
| `STATIC_ROOT`     | working directory                    | Repo root containing `artifacts/*/dist` when `SERVE_STATIC=true`.                                                                                                                |

## 3. Super admin (platform owner)

| Variable               | Notes                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPER_ADMIN_EMAIL`    | The primary super admin. This account always has Super Admin access; more super admins can be added in the app.                                               |
| `SUPER_ADMIN_PASSWORD` | **First boot only.** `scripts/migrate.mjs` creates the account if it does not exist (min 12 characters). Remove it after you sign in and change the password. |
| `PLATFORM_ADMIN_EMAIL` | Receives operational alerts (e.g. a workspace locked for non-payment).                                                                                        |

### Setting up the super admin panel — step by step

1. **Create the account** (choose one):
   - Render / Docker: set `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`, deploy. The start command runs `migrate.mjs`, which creates it.
   - OCI / VPS: `cd /srv/omnicore && ./deploy.sh seed-admin` (asks for email and password, sets `SUPER_ADMIN_EMAIL` in `.env`, restarts the API).
2. Sign in at `https://<your-domain>/dashboard/`. You land in **Super Admin**.
3. **Platform Email** tab: enter the SMTP server used for system mail (invitations, password resets, billing notices) and press **Send test**.
4. **Billing** tab: the _Paddle Connection_ card must say **Connected** (needs `PADDLE_API_KEY`). Create or edit plans: name, price, trial days, limits (brands, agents, conversations) and feature flags. Saving a paid plan creates the matching Paddle product and price. Plans marked _Not synced_ cannot be bought.
5. **Super Admins** tab: add co-owners by email (they must also have an agent account).
6. **Tenants** tab: create workspaces manually, change a workspace's plan, limits or status, open a checkout link for a customer, or purge a workspace.
7. **User Accounts** tab: reset any user's password or send a reset email.
8. **Audit Log** tab: everything that happens across all workspaces (see §8).
9. Use **View as workspace** (top bar) to support a customer inside their workspace. Every action you take there is audited as _super admin on behalf of_ that workspace.

## 4. Billing — Paddle

| Variable                   | Notes                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `BILLING_PROVIDER`         | `paddle` (default). `stripe` only for legacy Stripe customers.                                            |
| `PADDLE_ENVIRONMENT`       | `sandbox` or `production`; must match the keys.                                                           |
| `PADDLE_API_KEY`           | Paddle → Developer tools → Authentication → API keys.                                                     |
| `PADDLE_WEBHOOK_SECRET`    | Paddle → Developer tools → Notifications → destination secret.                                            |
| `VITE_PADDLE_CLIENT_TOKEN` | Paddle → Developer tools → Authentication → Client-side tokens. **Build-time.** `test_…` = sandbox.       |
| `PADDLE_<PLAN>_PRICE_ID`   | Optional fallback price per plan slug (e.g. `PADDLE_STARTER_PRICE_ID`). Normally plans sync from the app. |

Full Paddle setup (webhook URL, events, default payment link): [OCI_Deployment.md §5a](OCI_Deployment.md#5a-paddle-setup-payments).

## 5. File storage — Cloudflare R2

| Variable               | Notes                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| `R2_ENDPOINT`          | `https://<account-id>.r2.cloudflarestorage.com`                          |
| `R2_ACCESS_KEY_ID`     | R2 → Manage API tokens → Create token (Object Read & Write, this bucket) |
| `R2_SECRET_ACCESS_KEY` | Shown once when the token is created                                     |
| `R2_BUCKET_NAME`       | Bucket name                                                              |

Without R2, uploads are stored on local disk (`artifacts/uploads/`). That is fine on
OCI, but **not on Render/Docker**: their disks are wiped on every deploy.

## 6. Email

| Variable                 | Notes                                                                           |
| ------------------------ | ------------------------------------------------------------------------------- |
| `INBOUND_EMAIL_DOMAIN`   | Domain of brand forwarding addresses (`<prefix>@inbound.your-domain.com`).      |
| `INBOUND_WEBHOOK_SECRET` | Shared secret your inbound-mail provider sends to `/api/webhooks/inbound-mail`. |

Outbound SMTP is not an environment variable: set it in **Super Admin → Platform Email**
(system mail) and per workspace in **Email / SMTP**.

## 7. Integrations

| Variable                              | Default                   | Notes                                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTEGRATIONS_ENCRYPTION_KEY`         | derived from `JWT_SECRET` | 32 random bytes as 64 hex chars (`openssl rand -hex 32`) or base64. Encrypts webhook secrets, chat webhook URLs and HighLevel tokens. **Set a dedicated key in production and never change it** — changing it makes stored secrets unreadable. |
| `INTEGRATIONS_WORKER`                 | `true`                    | Set `false` on extra API replicas if you only want one instance delivering (all instances are safe either way).                                                                                                                                |
| `API_RATE_LIMIT_PER_MINUTE`           | `120`                     | REST API v1 limit per key.                                                                                                                                                                                                                     |
| `WEBHOOKS_ALLOW_HTTP`                 | `false`                   | Allow `http://` webhook URLs in production.                                                                                                                                                                                                    |
| `WEBHOOKS_ALLOW_PRIVATE`              | `false`                   | Allow webhooks to private/internal IPs. Leave off on multi-tenant hosting (SSRF protection).                                                                                                                                                   |
| `GHL_CLIENT_ID` / `GHL_CLIENT_SECRET` | —                         | HighLevel Marketplace → your app → Advanced Settings → Auth.                                                                                                                                                                                   |
| `GHL_SCOPES`                          | see `.env.example`        | Must match the scopes selected in the Marketplace app.                                                                                                                                                                                         |
| `GHL_WEBHOOK_ED25519_PUBLIC_KEY`      | —                         | PEM public key for the `x-ghl-signature` header (HighLevel webhook docs).                                                                                                                                                                      |
| `GHL_WEBHOOK_PUBLIC_KEY`              | —                         | PEM RSA key for the legacy `x-wh-signature` header. Set either or both.                                                                                                                                                                        |
| `GHL_WEBHOOK_SKIP_VERIFY`             | `false`                   | Development only; ignored in production.                                                                                                                                                                                                       |

## 7a. AI assistant and agencies (white-label)

| Variable               | Default            | Notes                                                                                                                                                               |
| ---------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COPILOT_MODEL`        | `gemini-2.5-flash` | Model for the built-in assistant on the platform key (`GEMINI_API_KEY`). Agencies can use their own provider and key instead (Agency → AI provider).                |
| `COPILOT_DAILY_LIMIT`  | `300`              | Assistant messages per workspace per day (`0` = unlimited).                                                                                                         |
| `CLOUDFLARE_API_TOKEN` | —                  | Optional. Token with _SSL and Certificates: Edit_ on the zone, to register agency custom domains with **Cloudflare for SaaS** so their TLS is issued automatically. |
| `CLOUDFLARE_ZONE_ID`   | —                  | The zone of your platform domain (Cloudflare → domain → Overview → Zone ID).                                                                                        |

Agency custom domains: the agency adds `app.theiragency.com` under Agency → Domains,
creates the CNAME (to your platform host) and TXT records shown, and clicks **Verify**.
With the two Cloudflare variables set, the hostname is registered as a Cloudflare for
SaaS custom hostname (enable _SSL/TLS → Custom Hostnames_ on the zone and set the
fallback origin to your platform hostname once). Without them, issue a certificate for
each agency hostname on the server (e.g. `sudo certbot --nginx -d app.theiragency.com`).

## 8. Audit log

| Variable                   | Default | Notes                                              |
| -------------------------- | ------- | -------------------------------------------------- |
| `AUDIT_LOG_ENABLED`        | `true`  | `false` stops writing new entries.                 |
| `AUDIT_LOG_RETENTION_DAYS` | `365`   | Older rows are purged daily. `0` keeps everything. |

## 9. Cloudflare in front

No extra variables are needed. On OCI, `deploy.sh` writes nginx's
`real_ip_header CF-Connecting-IP` for Cloudflare's published IP ranges, so nginx,
the API and the audit log all see the visitor's real IP. If you run the API
directly behind Cloudflare without nginx, set `TRUST_PROXY` to Cloudflare's ranges
(or `true` only if the origin is firewalled to Cloudflare).

## 10. Optional

| Variable         | Notes                                                                |
| ---------------- | -------------------------------------------------------------------- |
| `REDIS_URL`      | Enables the BullMQ queue for the website crawler (otherwise inline). |
| `LOG_LEVEL`      | `info` (default), `debug`, `warn`, `error`.                          |
| `SESSION_SECRET` | Reserved; not currently read.                                        |

## 11. Build-time / hosting-specific

| Variable                   | Used by         | Notes                                                         |
| -------------------------- | --------------- | ------------------------------------------------------------- |
| `VITE_API_URL`             | dashboard build | Keep `/api` (same-origin cookies and sockets).                |
| `VITE_PADDLE_CLIENT_TOKEN` | both frontends  | See §4.                                                       |
| `OMNICORE_API_ORIGIN`      | Vercel build    | `https://` origin of the API that Vercel proxies `/api/*` to. |
| `NODE_VERSION`             | Render          | `24`.                                                         |
| `RENDER_EXTERNAL_URL`      | set by Render   | Fallback for `PUBLIC_APP_URL`.                                |
