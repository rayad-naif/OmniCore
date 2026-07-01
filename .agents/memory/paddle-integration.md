---
name: Paddle billing integration
description: Architecture decisions for the Stripe + Paddle dual-provider billing setup in OmniCore
---

## Design

Provider abstraction lives in `artifacts/api-server/src/lib/billingProvider.js`.
Low-level Paddle API wrapper (fetch-based, no SDK) lives in `artifacts/api-server/src/lib/paddleClient.js`.

`BILLING_PROVIDER=stripe` (default) | `paddle` env var controls which provider handles NEW public checkouts.
Existing Stripe subscribers are never rerouted — the code checks for `paddle_customer_id` vs `stripe_customer_id` on the tenant row.

**Important:** with no billing env vars set, provider defaults to Stripe, which throws `401 Unauthorized` fetching Stripe credentials on any checkout. Set `BILLING_PROVIDER=paddle` (Paddle auth works via the Replit connector even without `PADDLE_API_KEY`). Going live in Paddle also requires approving the checkout return-URL domain in the Paddle dashboard, else checkout returns `checkout.url ... domain has been approved` — this is account config, not a code bug.

## Plan source of truth: `billing_plans` table

`artifacts/api-server/src/lib/plansRepo.js` owns a `billing_plans` table — the single source of truth for plans (free/starter/growth seeded idempotently, gen_random_uuid ids). Paid plans mirror into Paddle's catalog lazily (`ensurePaddlePriceId`); a plan with no `paddle_price_id` shows as un-synced in the UI. Sync failures are best-effort and returned as a `warning` string, not thrown.
**Why:** replaces the old approach of reading plan features from `stripe.products` metadata (dead once Stripe is gone). `applyPlanFeatures` in `app.ts` now reads limits/features from `billing_plans` (falling back to the free plan for null/unknown), so activating a plan grants exactly its configured features.
The Free plan is managed here too (features/limits only, no Paddle product, not self_serve, excluded from tenant `/api/billing/plans`) and is protected from deletion. Super-admin plan CRUD is under `/api/super-admin/billing/*` (status + plans GET/POST/PATCH/DELETE); the dashboard Super Admin tab is "Billing" (`BillingPanel`), not "Stripe".

## Paddle env vars required

- `PADDLE_API_KEY` — Paddle dashboard → Developer → Authentication
- `PADDLE_WEBHOOK_SECRET` — Paddle dashboard → Developer → Notifications
- `PADDLE_ENVIRONMENT` — `sandbox` (default) | `production`
- `PADDLE_STARTER_PRICE_ID` — set after running `pnpm --filter @workspace/scripts run seed-paddle`
- `PADDLE_GROWTH_PRICE_ID` — set after running seed-paddle

## Connector environment gotcha (non-obvious)

The Replit Paddle **connector** is a single, environment-scoped connection. In this
project it is provisioned as **production**, so `paddleRequest` (which prefers
`connectors.proxy('paddle', …)`) hits **live Paddle regardless of
`PADDLE_ENVIRONMENT`**. `PADDLE_ENVIRONMENT` only picks the base-URL strings for the
direct-fetch fallback + the portal/checkout fallback URLs (`paddleBaseUrl`,
`paddleCheckoutBaseUrl`, `_paddlePortal`).
**Why:** setting `PADDLE_ENVIRONMENT=sandbox` in dev does NOT isolate dev from live
Paddle (the connector still routes to prod) — it just makes portal/checkout fallback
URLs point at sandbox while real customers live in prod. Keep `PADDLE_ENVIRONMENT`
matched to the connector's environment (production here). True dev isolation needs a
separate sandbox connector.

## Canonical public origin for all user-facing links

`publicAppUrl(req)` in `artifacts/api-server/src/lib/env.js` is the single source for
the public origin: prefers `PUBLIC_APP_URL` (the custom domain, e.g.
`https://omnicore.irofficial.com`), then `REPLIT_DOMAINS[0]`, then request host. It
backs checkout success/cancel URLs, password-reset + agent-invite email links, and the
Stripe managed-webhook URL. `PUBLIC_APP_URL` must equal the domain approved in Paddle,
or checkout is rejected. Set `PUBLIC_APP_URL` in the **production** env scope so dev
still falls back to the Replit dev domain.

## Paddle vs Stripe key differences

- Paddle is Merchant of Record — taxes handled globally by Paddle automatically, no Stripe Tax needed
- Paddle trials are baked into the Price object (not the checkout session like Stripe's `trial_period_days`)
- Paddle webhook path: `/api/paddle/webhook` (Stripe is `/api/stripe/webhook`)
- Paddle webhook signature header: `Paddle-Signature: ts=xxx;h1=xxx` (HMAC-SHA256)
- Paddle customer portal: `https://[sandbox-]customer.paddle.com/portal/{customer_id}`
- No Paddle synced schema (unlike stripe-replit-sync); `getSubscription` calls Paddle API live for `next_billed_at`

## DB columns added (idempotent migration in billing.controller.js)

```sql
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS paddle_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT;
```

## Seed script

`pnpm --filter @workspace/scripts run seed-paddle` — creates Starter ($29) and Growth ($79) products with 14-day trial baked into Price objects. Prints the price IDs to paste into env secrets.

**Why fetch-based (no @paddle/paddle-node-sdk):** Avoids CJS/ESM compatibility issues with esbuild bundler. Native fetch works cleanly in Node 24.
