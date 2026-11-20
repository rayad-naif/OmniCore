# Deploying OmniCore on Oracle Cloud Infrastructure (OCI)

This runbook installs the full stack (API, dashboard, marketing site,
PostgreSQL 16 + pgvector, nginx, PM2, Let's Encrypt) on a single OCI compute
instance using `deploy.sh vps-install`.

Target used in this project: `omnicore.irofficial.com` → `80.225.249.112`.

## 1. Instance

- Image: **Canonical Ubuntu 22.04 or 24.04** (x86 or Ampere A1 arm64 both work).
- Shape: 2 GB RAM or more is recommended. On 1 GB shapes the script adds a 4 GB
  swap file automatically so the build does not run out of memory.
- Default user: `ubuntu` (override with `RUN_USER=...`).

## 2. Network — open 80 and 443 in the VCN

OCI blocks inbound web traffic at the VCN level. In the OCI Console:

**Networking → Virtual Cloud Networks → your VCN → Security Lists → Default
Security List → Add Ingress Rules**

| Source CIDR | Protocol | Destination port |
| ----------- | -------- | ---------------- |
| `0.0.0.0/0` | TCP      | `80`             |
| `0.0.0.0/0` | TCP      | `443`            |

The instance's own iptables rules are opened by the script (it does **not** use
`ufw`, which Oracle advises against on its Ubuntu images).

## 3. DNS

Create an **A record**: `omnicore` → `80.225.249.112`. Wait until
`dig +short omnicore.irofficial.com` returns the IP — certbot needs it.

## 4. Install

SSH in and run:

```bash
ssh -i /path/to/oci-key ubuntu@80.225.249.112
```

```bash
git clone https://github.com/rayad-naif/OmniCore.git /tmp/omnicore-bootstrap
```

```bash
sudo DOMAIN=omnicore.irofficial.com CERTBOT_EMAIL=you@example.com /tmp/omnicore-bootstrap/deploy.sh vps-install
```

Optional overrides: `REPO_BRANCH` (default `main`), `APP_DIR` (default
`/srv/omnicore`), `PORT` (default `8080`), `DB_PASSWORD`.

The script:

1. Installs Node 24, pnpm 10.26.1, PM2, PostgreSQL 16 + pgvector, nginx, certbot.
2. Creates the `omnicore` database and user (the generated password is printed
   once and stored in `.env`).
3. Clones the repo to `/srv/omnicore`, owned by `ubuntu`.
4. Writes `/srv/omnicore/artifacts/api-server/.env` (mode 600) with
   `NODE_ENV=production`, `PORT=8080`, `DATABASE_URL`, generated `JWT_SECRET` and
   `SESSION_SECRET`, `PUBLIC_APP_URL`/`ALLOWED_ORIGINS` set to the domain, and
   `COOKIE_SECURE=true`.
5. Builds all artifacts and applies `schema.sql`.
6. Configures nginx (`/api` + Socket.io → API, `/dashboard/` → SPA, `/` →
   marketing site), opens iptables 80/443, starts the API under PM2 with
   boot-time auto-start, and issues the TLS certificate.

## 5. Fill in secrets and restart

```bash
sudo -u ubuntu nano /srv/omnicore/artifacts/api-server/.env
```

Set at least `GEMINI_API_KEY`, `SUPER_ADMIN_EMAIL`, and the `PADDLE_*` / `R2_*`
values for the features you use. `VITE_PADDLE_CLIENT_TOKEN` is baked into the
dashboard at build time, so rebuild after setting it (step 7). Then:

```bash
sudo -u ubuntu pm2 restart omnicore-api --update-env
```

```bash
cd /srv/omnicore && ./deploy.sh seed-admin
```

## 5a. Paddle setup (payments)

Paddle is the billing provider (`BILLING_PROVIDER=paddle`, the default). Do this
in the Paddle sandbox first, then repeat with live keys.

1. **API key** — Paddle → Developer tools → Authentication → API keys → create
   one with read/write access to products, prices, customers, transactions and
   subscriptions. Put it in `PADDLE_API_KEY`.
2. **Client-side token** — same page, Client-side tokens. Put it in
   `VITE_PADDLE_CLIENT_TOKEN` (`test_…` for sandbox, `live_…` for production;
   the app picks the Paddle.js environment from the prefix).
3. **Webhook** — Developer tools → Notifications → New destination:
   - URL: `https://omnicore.irofficial.com/api/paddle/webhook`
   - Events: `subscription.created`, `subscription.updated`,
     `subscription.canceled`, `transaction.created`, `transaction.ready`,
     `transaction.paid`, `transaction.completed`
   - Copy the destination's secret key into `PADDLE_WEBHOOK_SECRET`.
4. **Checkout settings** — Checkout → Checkout settings: set the _Default
   payment link_ to `https://omnicore.irofficial.com/checkout`. For live
   payments also add `omnicore.irofficial.com` under approved domains
   (Paddle reviews it).
5. **Environment** — set `PADDLE_ENVIRONMENT=sandbox` or `production` to match
   the keys.
6. Rebuild and restart so the client token is baked into the frontends:

   ```bash
   cd /srv/omnicore && sudo -u ubuntu ./deploy.sh deploy
   ```

7. **Plans** — log in as super admin → Super Admin → Billing. The Paddle
   Connection card should show **Connected**. Open each paid plan and save it
   (or create new ones): the app creates the matching Paddle product and price
   and stores their IDs. Plans marked _Not synced_ cannot be bought.

Test with a [Paddle sandbox test card](https://developer.paddle.com/concepts/payment-methods/credit-debit-card#test-payment-method)
from `/pricing` → _Start free trial_: a new workspace is provisioned and the
owner receives a set-password email.

## 6. Verify

```bash
curl -s https://omnicore.irofficial.com/api/healthz
```

Expected: `{"status":"ok"}`. Dashboard: `https://omnicore.irofficial.com/dashboard/`.
Register the Paddle webhook at `https://omnicore.irofficial.com/api/paddle/webhook`.

## 7. Updating

```bash
cd /srv/omnicore && sudo -u ubuntu ./deploy.sh deploy
```

This pulls, installs, typechecks, builds, re-applies the schema, restarts PM2 and
runs the health check.

## Troubleshooting

| Symptom                           | Check                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| Site unreachable from the browser | VCN ingress rules for 80/443; `sudo iptables -L INPUT -n --line-numbers`           |
| certbot fails                     | DNS A record not propagated yet; rerun `sudo certbot --nginx -d <domain>`          |
| 502 on `/api/*`                   | `sudo -u ubuntu pm2 logs omnicore-api`; `PORT` in `.env` must match nginx (`8080`) |
| Login works but session drops     | `COOKIE_SECURE=true` requires HTTPS; `PUBLIC_APP_URL`/`ALLOWED_ORIGINS` must match |
