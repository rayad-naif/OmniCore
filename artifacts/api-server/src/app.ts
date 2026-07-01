import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { createServer, type Server as HttpServer } from "node:http";
import router, { emailWebhook } from "./routes";
import { logger } from "./lib/logger";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { attachSocketServer } = require("./services/socket.service");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pool } = require("./lib/db");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendAccountUpdateEmail, sendAgentInviteEmail } =
  require("./services/email.service");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bcrypt = require("bcryptjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require("crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { publicAppUrl } = require("./lib/env");

// Injects the shared pg.Pool as req.db — consumed by CJS controllers via req.db.query()
function attachDb(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
): void {
  (req as express.Request & { db: unknown }).db = pool;
  next();
}

const app: Express = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : "*";

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

// ── Structured request logging ────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Stripe webhook (raw body — MUST be before express.json()) ────────────────
// stripe-replit-sync verifies the signature and syncs Stripe objects into the
// `stripe` Postgres schema. We then reconcile the tenant's plan/status.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature" });
    }
    if (!Buffer.isBuffer(req.body)) {
      logger.error("stripe_webhook_body_not_buffer");
      return res.status(500).json({ error: "Webhook processing error" });
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      const { getStripeSync } = await import("./lib/stripeClient");
      const sync = await getStripeSync();
      await sync.processWebhook(req.body, sig);

      // Reconcile tenant plan/status from the verified event payload.
      try {
        await provisionTenantFromEvent(req.body);
      } catch (err) {
        logger.error({ err }, "stripe_tenant_provision_failed");
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      logger.error({ err: (err as Error).message }, "stripe_webhook_error");
      return res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

// Maps Stripe subscription status → tenants.subscription_status CHECK values.
function mapStripeStatus(status: string | undefined): string {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "past_due";
    case "paused":
      return "paused";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    default:
      return "active";
  }
}

// Notify a tenant's active admins about a billing/account change (best-effort).
async function notifyTenantAdmins(
  tenantId: string,
  subject: string,
  heading: string,
  message: string,
): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT email, name FROM agents
       WHERE tenant_id = $1 AND role = 'admin' AND is_active = TRUE`,
      [tenantId],
    );
    await Promise.all(
      rows.map((a: { email: string }) =>
        sendAccountUpdateEmail({ to: a.email, subject, heading, message }),
      ),
    );
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, tenantId },
      "tenant_admin_notify_failed",
    );
  }
}

// Reads a plan's feature/limit set from the `billing_plans` table (the source of
// truth, including the Free plan) and applies it to the tenant's capability
// columns. Activating a plan therefore grants exactly the features configured on
// that plan in the Super Admin → Billing plan manager.
async function applyPlanFeatures(
  tenantId: string,
  plan: string | null,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const plansRepo = require("./lib/plansRepo");

  type PlanShape = {
    is_free: boolean;
    features: { ai_feature_enabled: boolean; smtp_feature_enabled: boolean };
    limits: {
      max_brands_allowed: number | null;
      max_agents_allowed: number | null;
      conversation_limit: number | null;
    };
  };

  // Resolve the plan row, falling back to the Free plan for null/unknown plans.
  let row: PlanShape | null = null;
  try {
    row = (await plansRepo.getPlanBySlug(plan || "free")) as PlanShape | null;
    if (!row) row = (await plansRepo.getPlanBySlug("free")) as PlanShape | null;
  } catch {
    row = null;
  }

  // No table/plan available yet → reset to baseline free-tier limits.
  if (!row) {
    await pool.query(
      `UPDATE tenants SET
         max_brands_allowed   = 1,
         max_agents_allowed   = 2,
         conversation_limit   = 100,
         ai_feature_enabled   = false,
         smtp_feature_enabled = false,
         updated_at           = NOW()
       WHERE id = $1`,
      [tenantId],
    );
    return;
  }

  await pool.query(
    `UPDATE tenants SET
       max_brands_allowed   = $1,
       max_agents_allowed   = $2,
       conversation_limit   = $3,
       ai_feature_enabled   = $4,
       smtp_feature_enabled = $5,
       updated_at           = NOW()
     WHERE id = $6`,
    [
      row.limits.max_brands_allowed ?? (row.is_free ? 1 : 3),
      row.limits.max_agents_allowed ?? (row.is_free ? 2 : 10),
      row.limits.conversation_limit ?? (row.is_free ? 100 : 1000),
      row.features.ai_feature_enabled,
      row.features.smtp_feature_enabled,
      tenantId,
    ],
  );
  logger.info({ tenantId, plan: plan || "free" }, "plan_features_applied");
}

// Resolve a tenant id from a Stripe customer id (used by invoice events).
async function tenantIdForCustomer(
  customerId: string | undefined,
): Promise<string | null> {
  if (!customerId) return null;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM tenants WHERE stripe_customer_id = $1 LIMIT 1`,
      [customerId],
    );
    return rows[0]?.id || null;
  } catch {
    return null;
  }
}

// Reconciles the tenant row from a verified Stripe webhook payload.
async function provisionTenantFromEvent(rawBody: Buffer): Promise<void> {
  let event: {
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return;
  }
  const type = event.type;
  const obj = event.data?.object;
  if (!type || !obj) return;

  if (type.startsWith("customer.subscription.")) {
    const metadata = (obj.metadata as Record<string, string>) || {};
    const tenantId = metadata.tenant_id;
    if (!tenantId) return;
    const subId = obj.id as string;
    const customerId = obj.customer as string;
    const deleted = type === "customer.subscription.deleted";
    const plan = deleted ? "free" : metadata.plan || null;
    const status = deleted
      ? "cancelled"
      : mapStripeStatus(obj.status as string);

    await pool.query(
      `UPDATE tenants SET
         stripe_customer_id     = COALESCE($1, stripe_customer_id),
         stripe_subscription_id = $2,
         plan                   = COALESCE($3, plan),
         subscription_status    = $4,
         grace_period_ends_at   = NULL,
         updated_at             = NOW()
       WHERE id = $5`,
      [customerId, deleted ? null : subId, plan, status, tenantId],
    );
    logger.info({ tenantId, plan, status }, "stripe_tenant_provisioned");

    // Grant / revoke the plan's features on the tenant.
    if (deleted || status === "cancelled") {
      await applyPlanFeatures(tenantId, "free");
      await notifyTenantAdmins(
        tenantId,
        "Your subscription has been cancelled",
        "Subscription cancelled",
        "Your subscription has ended and your workspace has been moved to the free tier. Reactivate any time from Billing to restore your plan features.",
      );
    } else if (status === "active" || status === "trialing") {
      await applyPlanFeatures(tenantId, plan);
      await notifyTenantAdmins(
        tenantId,
        "Your plan is now active",
        "Plan activated",
        `Your ${plan || "subscription"} plan is now active and its features have been enabled on your workspace. Thank you for subscribing!`,
      );
    } else if (status === "past_due") {
      await notifyTenantAdmins(
        tenantId,
        "Payment issue on your subscription",
        "Payment past due",
        "We couldn't process your latest payment. Please update your payment method in Billing to avoid losing access to your plan features.",
      );
    }
  } else if (type === "invoice.payment_succeeded") {
    const customerId = obj.customer as string;
    const tid = await tenantIdForCustomer(customerId);
    if (!tid) return;
    const amount = typeof obj.amount_paid === "number" ? obj.amount_paid : 0;
    const currency = ((obj.currency as string) || "usd").toUpperCase();
    const formatted = `${currency} ${(amount / 100).toFixed(2)}`;
    const hostedUrl = (obj.hosted_invoice_url as string) || "";
    await notifyTenantAdmins(
      tid,
      "Payment received — receipt",
      "Payment received",
      `We've received your payment of ${formatted}. Thank you!${hostedUrl ? ` You can view your receipt here: ${hostedUrl}` : ""}`,
    );
  } else if (type === "invoice.payment_failed") {
    const customerId = obj.customer as string;
    const tid = await tenantIdForCustomer(customerId);
    if (!tid) return;
    const hostedUrl = (obj.hosted_invoice_url as string) || "";
    await notifyTenantAdmins(
      tid,
      "Payment failed on your subscription",
      "Payment failed",
      `Your most recent payment could not be processed. Please update your payment method to keep your plan active.${hostedUrl ? ` Retry your payment here: ${hostedUrl}` : ""}`,
    );
  } else if (type === "checkout.session.completed") {
    const tenantId =
      (obj.client_reference_id as string) ||
      ((obj.metadata as Record<string, string>) || {}).tenant_id;
    if (!tenantId) return;
    const customerId = obj.customer as string;
    const subId = obj.subscription as string;
    await pool.query(
      `UPDATE tenants SET
         stripe_customer_id     = COALESCE($1, stripe_customer_id),
         stripe_subscription_id = COALESCE($2, stripe_subscription_id),
         updated_at             = NOW()
       WHERE id = $3`,
      [customerId, subId, tenantId],
    );
  }
}

// ── Paddle webhook (raw body — MUST be before express.json()) ─────────────────
// Paddle sends a Paddle-Signature header. We verify it with HMAC-SHA256 then
// reconcile the tenant plan/status from the event payload.
app.post(
  "/api/paddle/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signatureHeader = req.headers["paddle-signature"];
    const secret = process.env.PADDLE_WEBHOOK_SECRET;

    // Diagnostic logging — helps verify the correct secret is configured.
    logger.info(
      {
        hasSecret: !!secret,
        secretLength: secret?.length,
        hasSig: !!signatureHeader,
        sigLength: (
          Array.isArray(signatureHeader)
            ? signatureHeader[0]
            : signatureHeader
        )?.length,
      },
      "paddle_webhook_received",
    );

    if (!signatureHeader || !secret) {
      logger.warn("paddle_webhook_missing_signature_or_secret");
      return res.status(400).json({ error: "Webhook configuration error" });
    }

    if (!Buffer.isBuffer(req.body)) {
      logger.error("paddle_webhook_body_not_buffer");
      return res.status(500).json({ error: "Webhook processing error" });
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { verifyPaddleWebhook } = require("./lib/paddleClient");
      const sig = Array.isArray(signatureHeader)
        ? signatureHeader[0]
        : signatureHeader;
      const event = verifyPaddleWebhook(
        req.body,
        secret,
        sig,
      ) as Record<string, unknown> | null;

      if (!event) {
        logger.warn("paddle_webhook_signature_invalid");
        return res.status(400).json({ error: "Invalid signature" });
      }

      logger.info(
        { eventType: event.event_type },
        "paddle_webhook_verified",
      );

      try {
        await provisionTenantFromPaddleEvent(event);
      } catch (err) {
        logger.error({ err }, "paddle_tenant_provision_failed");
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      logger.error(
        { err: (err as Error).message },
        "paddle_webhook_error",
      );
      return res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

// Maps Paddle subscription status strings → tenants.subscription_status values.
function mapPaddleStatus(status: string | undefined): string {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "paused":
      return "paused";
    case "canceled":
    case "cancelled":
      return "cancelled";
    default:
      return "active";
  }
}

// Creates a tenant + admin agent from a Paddle public checkout, then sends a
// setup email with a password-reset link. Returns the new tenant id.
async function provisionTenantFromPaddlePublicCheckout({
  email,
  plan,
  paddleCustomerId,
  paddleSubscriptionId,
  businessName,
  userName,
}: {
  email: string;
  plan: string;
  paddleCustomerId: string;
  paddleSubscriptionId?: string | null;
  businessName?: string | null;
  userName?: string | null;
}): Promise<string> {
  // The webhook and the /checkout/confirm success-page call can both fire for
  // the same purchase. A per-customer advisory lock serializes them so exactly
  // one call creates the tenant + admin + setup token (no duplicate workspaces).
  const client = await pool.connect();
  let tenantId = "";
  let created = false;
  let displayName = "";
  let companyName = "";
  let rawToken = "";
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      paddleCustomerId,
    ]);

    const { rows: existing } = await client.query(
      `SELECT id FROM tenants WHERE paddle_customer_id = $1 LIMIT 1`,
      [paddleCustomerId],
    );
    if (existing[0]?.id) {
      await client.query(
        `UPDATE tenants SET
           plan = COALESCE($1, plan),
           subscription_status = 'trialing',
           paddle_subscription_id = COALESCE($2, paddle_subscription_id),
           updated_at = NOW()
         WHERE id = $3`,
        [plan, paddleSubscriptionId || null, existing[0].id],
      );
      await client.query("COMMIT");
      return existing[0].id as string;
    }

    displayName = userName || email.split("@")[0];
    companyName = businessName || `${displayName}'s workspace`;

    const { rows: tenantRows } = await client.query(
      `INSERT INTO tenants
         (company_name, plan, subscription_status,
          paddle_customer_id, paddle_subscription_id)
       VALUES ($1, $2, 'trialing', $3, $4)
       RETURNING id`,
      [companyName, plan, paddleCustomerId, paddleSubscriptionId || null],
    );
    tenantId = tenantRows[0].id as string;

    const tempPassword = crypto.randomBytes(16).toString("hex");
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const { rows: agentRows } = await client.query(
      `INSERT INTO agents
         (tenant_id, name, email, role, password_hash, is_active)
       VALUES ($1, $2, $3, 'admin', $4, true)
       RETURNING id`,
      [tenantId, displayName, email, passwordHash],
    );
    const agentId = agentRows[0].id as string;

    rawToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO password_reset_tokens (agent_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [agentId, rawToken, expiresAt],
    );

    await client.query("COMMIT");
    created = true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Side effects run only for the winning call, and outside the lock/txn so we
  // never hold the advisory lock during email/network I/O.
  if (created) {
    const setupLink = `${publicAppUrl()}/dashboard/?reset_token=${rawToken}`;
    await sendAgentInviteEmail({
      to: email,
      name: displayName,
      inviteLink: setupLink,
      companyName,
    });
    await applyPlanFeatures(tenantId, plan);
    logger.info({ tenantId, email, plan }, "paddle_public_tenant_provisioned");
  }

  return tenantId;
}

// Reconcile tenant plan/status from a verified Paddle webhook event.
async function provisionTenantFromPaddleEvent(
  event: Record<string, unknown>,
): Promise<void> {
  const eventType = event.event_type as string | undefined;
  const data = event.data as Record<string, unknown> | undefined;
  if (!eventType || !data) return;

  if (
    eventType === "subscription.created" ||
    eventType === "subscription.updated"
  ) {
    const customData =
      (data.custom_data as Record<string, string>) ||
      (data.transaction_details as Record<string, Record<string, string>>)
        ?.custom_data ||
      {};
    const tenantId = customData.tenant_id;
    const email = customData.email;
    const items =
      (data.items as Array<{
        price?: { custom_data?: { plan?: string } };
      }>) || [];
    const plan =
      items[0]?.price?.custom_data?.plan || customData.plan || null;
    const subId = data.id as string;
    const customerId = data.customer_id as string;
    const status = mapPaddleStatus(data.status as string);

    if (!tenantId) {
      // Public checkout — no tenant yet, create one.
      if (email && customerId) {
        const createdTenantId =
          await provisionTenantFromPaddlePublicCheckout({
            email,
            plan: plan || "starter",
            paddleCustomerId: customerId,
            paddleSubscriptionId: subId,
            businessName: customData.business_name || null,
            userName: customData.user_name || null,
          });
        await notifyTenantAdmins(
          createdTenantId,
          "Your plan is now active",
          "Plan activated",
          `Your ${plan || "subscription"} plan is now active. Thank you for subscribing!`,
        );
      }
      return;
    }

    await pool.query(
      `UPDATE tenants SET
         paddle_customer_id      = COALESCE($1, paddle_customer_id),
         paddle_subscription_id  = $2,
         plan                    = COALESCE($3, plan),
         subscription_status     = $4,
         grace_period_ends_at    = NULL,
         updated_at              = NOW()
       WHERE id = $5`,
      [customerId || null, subId, plan, status, tenantId],
    );
    logger.info({ tenantId, plan, status }, "paddle_tenant_provisioned");

    if (status === "active" || status === "trialing") {
      await applyPlanFeatures(tenantId, plan);
      await notifyTenantAdmins(
        tenantId,
        "Your plan is now active",
        "Plan activated",
        `Your ${plan || "subscription"} plan is now active. Thank you for subscribing!`,
      );
    } else if (status === "past_due") {
      await notifyTenantAdmins(
        tenantId,
        "Payment issue on your subscription",
        "Payment past due",
        "We couldn't process your latest payment. Please update your payment method in Billing.",
      );
    }
  } else if (
    eventType === "transaction.created" ||
    eventType === "transaction.completed" ||
    eventType === "transaction.ready" ||
    eventType === "transaction.paid"
  ) {
    const customData =
      (data.custom_data as Record<string, string>) || {};
    const email = customData.email;
    const plan =
      (
        data.items as Array<{
          price?: { custom_data?: { plan?: string } };
        }>
      )?.[0]?.price?.custom_data?.plan ||
      customData.plan ||
      null;
    const customerId = data.customer_id as string;
    const subId = data.subscription_id as string | undefined;

    if (email && customerId) {
      await provisionTenantFromPaddlePublicCheckout({
        email,
        plan: plan || "starter",
        paddleCustomerId: customerId,
        paddleSubscriptionId: subId,
        businessName: customData.business_name || null,
        userName: customData.user_name || null,
      });
    }
  } else if (eventType === "subscription.canceled") {
    const customData =
      (data.custom_data as Record<string, string>) || {};
    let tenantId = customData.tenant_id;
    const subId = data.id as string;
    const customerId = data.customer_id as string;

    if (!tenantId && subId) {
      const { rows } = await pool.query(
        `SELECT id FROM tenants WHERE paddle_subscription_id = $1 LIMIT 1`,
        [subId],
      );
      tenantId = rows[0]?.id;
    }
    if (!tenantId && customerId) {
      const { rows } = await pool.query(
        `SELECT id FROM tenants WHERE paddle_customer_id = $1 LIMIT 1`,
        [customerId],
      );
      tenantId = rows[0]?.id;
    }
    if (!tenantId) return;

    await pool.query(
      `UPDATE tenants SET
         paddle_subscription_id = NULL,
         plan                   = 'free',
         subscription_status    = 'cancelled',
         grace_period_ends_at   = NULL,
         updated_at             = NOW()
       WHERE id = $1`,
      [tenantId],
    );
    logger.info({ tenantId, subId }, "paddle_subscription_cancelled");
    await applyPlanFeatures(tenantId, "free");
    await notifyTenantAdmins(
      tenantId,
      "Your subscription has been cancelled",
      "Subscription cancelled",
      "Your subscription has ended and your workspace has been moved to the free tier.",
    );
  }
}

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// ── Cookie parser (for httpOnly refresh token) ────────────────────────────────
app.use(cookieParser());

// ── Database pool injection (req.db) ──────────────────────────────────────────
app.use(attachDb);

// ── Public checkout confirmation (webhook-independent onboarding) ─────────────
// The marketing /checkout/success page calls this with the Paddle transaction
// id (Paddle appends ?_ptxn=… to the return URL). We fetch the transaction and
// provision the workspace + admin and send the setup email immediately, so
// onboarding never depends on webhook delivery timing. Idempotent: repeat calls
// and the later webhook reuse the tenant keyed by paddle_customer_id.
app.post(
  "/api/billing/checkout/confirm",
  async (req: express.Request, res: express.Response) => {
    const transactionId = String(
      (req.body as { transactionId?: string })?.transactionId || "",
    ).trim();
    if (!transactionId) {
      return res.status(400).json({ error: "transactionId is required" });
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { paddleRequest } = require("./lib/paddleClient");
      const resp = (await paddleRequest(
        "GET",
        `/transactions/${transactionId}`,
      )) as { data?: Record<string, unknown> };
      const data = resp?.data;
      if (!data) return res.status(404).json({ error: "Transaction not found" });

      const customData = (data.custom_data as Record<string, string>) || {};
      const items =
        (data.items as Array<{
          price?: { custom_data?: { plan?: string } };
        }>) || [];
      const email = customData.email;
      const plan =
        items[0]?.price?.custom_data?.plan || customData.plan || "starter";
      const customerId = data.customer_id as string | undefined;
      const subId = (data.subscription_id as string | undefined) || null;

      if (!email || !customerId) {
        // Transaction not finalized yet — the webhook will complete provisioning.
        return res.status(202).json({ provisioned: false, reason: "pending" });
      }

      const tenantId = await provisionTenantFromPaddlePublicCheckout({
        email,
        plan,
        paddleCustomerId: customerId,
        paddleSubscriptionId: subId,
        businessName: customData.business_name || null,
        userName: customData.user_name || null,
      });
      return res.json({ provisioned: true, tenantId });
    } catch (err) {
      logger.error(
        { err: (err as Error).message },
        "checkout_confirm_failed",
      );
      return res.status(500).json({ error: "Could not confirm checkout" });
    }
  },
);

// ── Routes ────────────────────────────────────────────────────────────────────
// Redirect root domain to the dashboard
app.get("/", (req: express.Request, res: express.Response) => {
  res.redirect(301, "/dashboard");
});

app.use("/api", router);
// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Global error handler (4-arg signature required by Express) ────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use(
  (
    err: Error & { status?: number; statusCode?: number },
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status =
      (err as { status?: number }).status ??
      (err as { statusCode?: number }).statusCode ??
      500;
    const message = err.message || "Internal server error";

    if (status >= 500) {
      req.log?.error({ err }, "unhandled_error");
    }

    res.status(status).json({
      error: message,
      ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
    });
  },
);

// ── Auto-close idle conversations ─────────────────────────────────────────────
// Runs every 2 minutes. Closes conversations whose brands have auto_close_enabled=true
// and whose last activity exceeded auto_close_idle_minutes.
function startAutoCloseScheduler(): void {
  const RUN_INTERVAL_MS = 2 * 60 * 1000; // every 2 minutes

  const run = async () => {
    try {
      const { rows } = await (pool.query as (sql: string) => Promise<{ rows: { id: string; tenant_id: string }[] }>)(`
        UPDATE conversations c
        SET status = 'closed', updated_at = NOW()
        FROM brands b
        WHERE c.brand_id = b.id
          AND c.status   = 'open'
          AND (b.widget_config_json->>'auto_close_enabled')::boolean = true
          AND c.updated_at < NOW() - (
            COALESCE(
              (b.widget_config_json->>'auto_close_idle_minutes')::integer,
              60
            ) || ' minutes'
          )::interval
        RETURNING c.id, c.tenant_id
      `);
      if (rows.length) {
        logger.info({ closed: rows.length }, "auto_close_conversations");
      }
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "auto_close_scheduler_error",
      );
    }
  };

  // Run once at startup, then on interval
  run().catch(() => {});
  setInterval(run, RUN_INTERVAL_MS);
}

// ── HTTP server + Socket.io factory ──────────────────────────────────────────
export function createAppServer(): HttpServer {
  const httpServer = createServer(app);

  // socket.service.js creates the Socket.io server internally and returns it.
  // Passing it to emailWebhook.setIo() lets inbound-mail events flow in real time.
  const io = attachSocketServer(httpServer) as { to: unknown };
  emailWebhook.setIo(io);

  // Start background auto-close scheduler
  startAutoCloseScheduler();

  return httpServer;
}

export default app;
