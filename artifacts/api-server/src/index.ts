// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyEnv } = require("./lib/env");
verifyEnv();

import { createAppServer } from "./app";
import { logger } from "./lib/logger";
import { getStripeSync } from "./lib/stripeClient";

/**
 * Initialize the Stripe schema + managed webhook and backfill synced data.
 * Non-fatal: the rest of the app must keep working even if Stripe isn't ready.
 */
async function initStripe(): Promise<void> {
  try {
    const { runMigrations } = await import("stripe-replit-sync");
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) {
      logger.warn("DATABASE_URL missing — skipping Stripe init");
      return;
    }
    // The migration runner always targets the `stripe` schema internally.
    await runMigrations({ databaseUrl });

    const sync = await getStripeSync();
    const domain = (process.env["REPLIT_DOMAINS"] || "").split(",")[0]?.trim();
    if (domain) {
      const webhook = await sync.findOrCreateManagedWebhook(
        `https://${domain}/api/stripe/webhook`,
      );
      logger.info(
        { webhook: webhook?.url ?? "configured" },
        "stripe_webhook_ready",
      );
    } else {
      logger.warn("REPLIT_DOMAINS missing — skipping managed webhook setup");
    }

    sync
      .syncBackfill()
      .then(() => logger.info("stripe_backfill_complete"))
      .catch((err: unknown) => logger.error({ err }, "stripe_backfill_failed"));

    logger.info("stripe_init_complete");
  } catch (err) {
    logger.error({ err }, "stripe_init_failed");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createAppServer();

server.listen(port, () => {
  logger.info({ port }, "Server listening");
  // Fire-and-forget: never block server startup on Stripe readiness.
  void initStripe();
});

server.on("error", (err: Error) => {
  logger.error({ err }, "HTTP server error");
  process.exit(1);
});
