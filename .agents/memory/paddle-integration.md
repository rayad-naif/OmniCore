---
name: Paddle billing integration
description: Architecture decisions for the Stripe + Paddle dual-provider billing setup in OmniCore
---

## Design

Provider abstraction lives in `artifacts/api-server/src/lib/billingProvider.js`.
Low-level Paddle API wrapper (fetch-based, no SDK) lives in `artifacts/api-server/src/lib/paddleClient.js`.

`BILLING_PROVIDER=stripe` (default) | `paddle` env var controls which provider handles NEW public checkouts.
Existing Stripe subscribers are never rerouted — the code checks for `paddle_customer_id` vs `stripe_customer_id` on the tenant row.

## Paddle env vars required

- `PADDLE_API_KEY` — Paddle dashboard → Developer → Authentication
- `PADDLE_WEBHOOK_SECRET` — Paddle dashboard → Developer → Notifications
- `PADDLE_ENVIRONMENT` — `sandbox` (default) | `production`
- `PADDLE_STARTER_PRICE_ID` — set after running `pnpm --filter @workspace/scripts run seed-paddle`
- `PADDLE_GROWTH_PRICE_ID` — set after running seed-paddle

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
