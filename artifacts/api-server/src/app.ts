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

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// ── Cookie parser (for httpOnly refresh token) ────────────────────────────────
app.use(cookieParser());

// ── Database pool injection (req.db) ──────────────────────────────────────────
app.use(attachDb);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Global error handler (4-arg signature required by Express) ────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number; statusCode?: number }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status  = (err as { status?: number }).status ?? (err as { statusCode?: number }).statusCode ?? 500;
  const message = err.message || "Internal server error";

  if (status >= 500) {
    req.log?.error({ err }, "unhandled_error");
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

// ── HTTP server + Socket.io factory ──────────────────────────────────────────
export function createAppServer(): HttpServer {
  const httpServer = createServer(app);

  // socket.service.js creates the Socket.io server internally and returns it.
  // Passing it to emailWebhook.setIo() lets inbound-mail events flow in real time.
  const io = attachSocketServer(httpServer) as { to: unknown };
  emailWebhook.setIo(io);

  return httpServer;
}

export default app;
