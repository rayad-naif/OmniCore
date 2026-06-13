/**
 * billing.controller.js
 * Atelier OmniCore — Lemon Squeezy billing controller
 *
 * Routes (registered in server.js):
 *   POST /api/checkout                     — create LS checkout session
 *   POST /api/billing/portal               — customer self-serve portal URL
 *   GET  /api/billing/subscription         — current tenant subscription
 *   GET  /api/billing/usage                — current period usage meters
 *   POST /api/webhooks/lemonsqueezy        — LS signed webhook receiver
 *
 * Env vars required:
 *   LEMONSQUEEZY_API_KEY       — LS API key (secret)
 *   LEMONSQUEEZY_STORE_ID      — numeric store ID
 *   LEMONSQUEEZY_WEBHOOK_SECRET — signing secret for webhook HMAC-SHA256
 *
 * Database columns consumed (tenants table):
 *   ls_customer_id          TEXT
 *   ls_subscription_id      TEXT
 *   ls_variant_id           TEXT
 *   plan                    TEXT   ('free'|'starter'|'pro'|'enterprise')
 *   subscription_status     TEXT   ('active'|'trialing'|'past_due'|'cancelled'|'paused')
 *   current_period_end      TIMESTAMPTZ
 *   trial_ends_at           TIMESTAMPTZ
 *   grace_period_ends_at    TIMESTAMPTZ
 *   widget_enabled          BOOLEAN DEFAULT true
 */

'use strict';

const crypto = require('node:crypto');
const { pool } = require('../lib/db');
const logger   = require('../utils/logger');   // pino singleton

// ─── Lemon Squeezy API wrapper ────────────────────────────────────────────────
const LS_BASE = 'https://api.lemonsqueezy.com/v1';

async function lsRequest(method, path, body) {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) throw new Error('LEMONSQUEEZY_API_KEY not set');

  const res = await fetch(`${LS_BASE}${path}`, {
    method,
    headers: {
      'Accept':        'application/vnd.api+json',
      'Content-Type':  'application/vnd.api+json',
      'Authorization': `Bearer ${apiKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.errors?.[0]?.detail || data?.message || `LS HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status, lsData: data });
  }
  return data;
}

// ─── POST /api/checkout ───────────────────────────────────────────────────────
/**
 * Creates a Lemon Squeezy checkout URL for the authenticated agent's tenant.
 * Body: { variantId: string, planId: string }
 * Returns: { checkoutUrl: string }
 */
async function createCheckout(req, res) {
  const { variantId, planId } = req.body || {};
  if (!variantId) return res.status(400).json({ error: 'variantId is required' });

  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  if (!storeId)  return res.status(500).json({ error: 'LEMONSQUEEZY_STORE_ID not set' });

  const tenantId = req.agent?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

  // Fetch tenant for prefill
  const { rows } = await pool.query(
    'SELECT id, name, ls_customer_id FROM tenants WHERE id = $1',
    [tenantId]
  );
  const tenant = rows[0];
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const agentEmail = req.agent?.email;

  const payload = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          email:       agentEmail || '',
          name:        tenant.name || '',
          custom: {
            tenant_id: String(tenantId),
            plan_id:   planId || '',
            agent_id:  String(req.agent?.id || ''),
          },
        },
        product_options: {
          // Redirect back to dashboard after payment
          redirect_url: `${process.env.FRONTEND_URL || 'https://app.omnicore.app'}/dashboard/billing?checkout=success`,
          receipt_link_url: `${process.env.FRONTEND_URL || 'https://app.omnicore.app'}/dashboard/billing`,
        },
        checkout_options: {
          embed:         false,
          media:         true,
          logo:          true,
          desc:          true,
          discount:      true,
          dark:          false,
          subscription_preview: true,
        },
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),  // 30 min
      },
      relationships: {
        store: {
          data: { type: 'stores', id: String(storeId) },
        },
        variant: {
          data: { type: 'variants', id: String(variantId) },
        },
      },
    },
  };

  // If tenant already has a LS customer, pass it so the checkout is pre-filled
  if (tenant.ls_customer_id) {
    payload.data.attributes.checkout_data.custom.ls_customer_id = tenant.ls_customer_id;
  }

  const data = await lsRequest('POST', '/checkouts', payload);
  const checkoutUrl = data?.data?.attributes?.url;
  if (!checkoutUrl) throw new Error('No checkout URL in LS response');

  req.log.info({ tenantId, planId, variantId }, 'checkout_created');
  return res.json({ checkoutUrl });
}

// ─── POST /api/billing/portal ─────────────────────────────────────────────────
/**
 * Generates a Lemon Squeezy customer portal URL for the tenant's customer.
 * Returns: { portalUrl: string }
 */
async function getPortalUrl(req, res) {
  const tenantId = req.agent?.tenantId;
  const { rows } = await pool.query(
    'SELECT ls_customer_id FROM tenants WHERE id = $1',
    [tenantId]
  );
  const customerId = rows[0]?.ls_customer_id;
  if (!customerId) return res.status(404).json({ error: 'No billing customer found for this tenant' });

  const data = await lsRequest('GET', `/customers/${customerId}?include=subscriptions`);
  const portalUrl = data?.data?.attributes?.urls?.customer_portal;
  if (!portalUrl) return res.status(404).json({ error: 'Portal URL not available' });

  return res.json({ portalUrl });
}

// ─── GET /api/billing/subscription ───────────────────────────────────────────
async function getSubscription(req, res) {
  const tenantId = req.agent?.tenantId;
  const { rows } = await pool.query(
    `SELECT
       ls_customer_id AS "customerId",
       ls_subscription_id AS "subscriptionId",
       plan,
       subscription_status AS status,
       current_period_end AS "currentPeriodEnd",
       trial_ends_at AS "trialEndsAt",
       grace_period_ends_at AS "gracePeriodEndsAt",
       widget_enabled AS "widgetEnabled"
     FROM tenants WHERE id = $1`,
    [tenantId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Tenant not found' });
  return res.json(rows[0]);
}

// ─── GET /api/billing/usage ───────────────────────────────────────────────────
async function getUsage(req, res) {
  const tenantId = req.agent?.tenantId;

  // Count active agents (seats), conversations this calendar month, articles, AI usage this month
  const [seats, convos, articles, credits] = await Promise.all([
    pool.query(
      "SELECT COUNT(*) FROM agents WHERE tenant_id=$1 AND status='active'",
      [tenantId]
    ),
    pool.query(
      "SELECT COUNT(*) FROM conversations WHERE tenant_id=$1 AND created_at >= date_trunc('month', NOW())",
      [tenantId]
    ),
    pool.query(
      'SELECT COUNT(*) FROM knowledge_articles WHERE tenant_id=$1',
      [tenantId]
    ),
    pool.query(
      "SELECT COALESCE(SUM(credits_used),0) FROM ai_usage_log WHERE tenant_id=$1 AND created_at >= date_trunc('month', NOW())",
      [tenantId]
    ),
  ]);

  return res.json({
    seats:         parseInt(seats.rows[0].count,     10),
    conversations: parseInt(convos.rows[0].count,    10),
    articles:      parseInt(articles.rows[0].count,  10),
    aiCredits:     parseInt(credits.rows[0].coalesce,10),
  });
}

// ─── POST /api/webhooks/lemonsqueezy ─────────────────────────────────────────
/**
 * Receives Lemon Squeezy signed webhooks.
 * Verified via HMAC-SHA256 on raw body using LEMONSQUEEZY_WEBHOOK_SECRET.
 *
 * Handled events:
 *   subscription_created    → provision plan, enable widget
 *   subscription_updated    → update plan / status
 *   subscription_cancelled  → mark cancelled, schedule widget disable
 *   subscription_resumed    → restore active
 *   subscription_expired    → disable widget
 *   subscription_paused     → disable widget
 *   subscription_unpaused   → enable widget
 *   order_created           → initial order acknowledgement
 *   payment_failed          → set past_due, start grace period
 */
async function handleWebhook(req, res) {
  // ── 1. Verify HMAC-SHA256 signature ────────────────────────────────────────
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('LEMONSQUEEZY_WEBHOOK_SECRET not set — rejecting webhook');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const signature = req.headers['x-signature'];
  if (!signature) return res.status(401).json({ error: 'Missing x-signature header' });

  // req.rawBody must be set by express.raw() middleware on this route
  const rawBody = req.rawBody;
  if (!rawBody) return res.status(400).json({ error: 'Raw body unavailable — use express.raw()' });

  const hmac    = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const digest  = hmac.digest('hex');

  // Constant-time comparison to prevent timing attacks
  const sigBuf    = Buffer.from(signature, 'utf8');
  const digestBuf = Buffer.from(digest,    'utf8');
  if (sigBuf.length !== digestBuf.length || !crypto.timingSafeEqual(sigBuf, digestBuf)) {
    logger.warn({ signature, digest }, 'webhook_signature_invalid');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // ── 2. Parse event ──────────────────────────────────────────────────────────
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const eventName = req.headers['x-event-name'] || event?.meta?.event_name;
  if (!eventName) return res.status(400).json({ error: 'Missing event name' });

  const attrs      = event?.data?.attributes || {};
  const customData = attrs?.first_order_item?.custom_data
    || attrs?.custom_data
    || event?.meta?.custom_data
    || {};

  const tenantId      = customData?.tenant_id;
  const lsCustomerId  = attrs?.customer_id    ? String(attrs.customer_id)  : null;
  const lsSubId       = event?.data?.id       ? String(event.data.id)      : null;
  const lsVariantId   = attrs?.variant_id     ? String(attrs.variant_id)   : null;
  const status        = attrs?.status         || null;     // active | cancelled | past_due | paused | trialing
  const periodEnd     = attrs?.renews_at || attrs?.ends_at || null;
  const trialEnd      = attrs?.trial_ends_at  || null;

  logger.info({ eventName, tenantId, lsSubId, status }, 'webhook_received');

  if (!tenantId) {
    logger.warn({ eventName, customData }, 'webhook_missing_tenant_id');
    // Still return 200 so LS does not retry — we can't route this event
    return res.status(200).json({ received: true, warning: 'no tenant_id in custom_data' });
  }

  // ── 3. Dispatch by event type ───────────────────────────────────────────────
  try {
    switch (eventName) {

      case 'order_created':
        // Acknowledge order; subscription_created follows separately
        await pool.query(
          `UPDATE tenants SET ls_customer_id = COALESCE($1, ls_customer_id) WHERE id = $2`,
          [lsCustomerId, tenantId]
        );
        break;

      case 'subscription_created':
      case 'subscription_updated': {
        const plan = resolvePlanFromVariant(lsVariantId);
        await pool.query(
          `UPDATE tenants SET
             ls_customer_id      = COALESCE($1, ls_customer_id),
             ls_subscription_id  = COALESCE($2, ls_subscription_id),
             ls_variant_id       = COALESCE($3, ls_variant_id),
             plan                = COALESCE($4, plan),
             subscription_status = COALESCE($5, subscription_status),
             current_period_end  = COALESCE($6::timestamptz, current_period_end),
             trial_ends_at       = $7::timestamptz,
             grace_period_ends_at = NULL,
             widget_enabled      = true,
             updated_at          = NOW()
           WHERE id = $8`,
          [
            lsCustomerId, lsSubId, lsVariantId, plan,
            normaliseStatus(status),
            periodEnd ? new Date(periodEnd) : null,
            trialEnd  ? new Date(trialEnd)  : null,
            tenantId,
          ]
        );
        logger.info({ tenantId, plan, status: normaliseStatus(status) }, 'subscription_provisioned');
        break;
      }

      case 'subscription_cancelled': {
        // Mark cancelled; access continues until current_period_end
        await pool.query(
          `UPDATE tenants SET
             subscription_status = 'cancelled',
             current_period_end  = COALESCE($1::timestamptz, current_period_end),
             updated_at          = NOW()
           WHERE id = $2`,
          [periodEnd ? new Date(periodEnd) : null, tenantId]
        );
        logger.info({ tenantId }, 'subscription_cancelled');
        break;
      }

      case 'subscription_resumed': {
        await pool.query(
          `UPDATE tenants SET
             subscription_status   = 'active',
             grace_period_ends_at  = NULL,
             widget_enabled        = true,
             updated_at            = NOW()
           WHERE id = $1`,
          [tenantId]
        );
        break;
      }

      case 'subscription_expired': {
        // Hard expiry — downgrade to free and disable widget
        await pool.query(
          `UPDATE tenants SET
             subscription_status = 'cancelled',
             plan                = 'free',
             widget_enabled      = false,
             updated_at          = NOW()
           WHERE id = $1`,
          [tenantId]
        );
        logger.warn({ tenantId }, 'subscription_expired_widget_disabled');
        break;
      }

      case 'subscription_paused': {
        await pool.query(
          `UPDATE tenants SET
             subscription_status = 'paused',
             widget_enabled      = false,
             updated_at          = NOW()
           WHERE id = $1`,
          [tenantId]
        );
        break;
      }

      case 'subscription_unpaused': {
        await pool.query(
          `UPDATE tenants SET
             subscription_status = 'active',
             widget_enabled      = true,
             updated_at          = NOW()
           WHERE id = $1`,
          [tenantId]
        );
        break;
      }

      case 'payment_failed': {
        // Set past_due and a 7-day grace window
        const gracePeriodEnd = new Date(Date.now() + 7 * 86_400_000);
        await pool.query(
          `UPDATE tenants SET
             subscription_status   = 'past_due',
             grace_period_ends_at  = $1,
             updated_at            = NOW()
           WHERE id = $2`,
          [gracePeriodEnd, tenantId]
        );
        logger.warn({ tenantId, gracePeriodEnd }, 'payment_failed_grace_period_started');

        // Schedule widget disable after grace period (fire-and-forget; use BullMQ in production)
        scheduleWidgetDisable(tenantId, gracePeriodEnd);
        break;
      }

      default:
        logger.info({ eventName }, 'webhook_unhandled_event');
    }
  } catch (err) {
    logger.error({ err, eventName, tenantId }, 'webhook_db_error');
    // Return 500 so LS retries
    return res.status(500).json({ error: 'Internal error processing webhook' });
  }

  return res.status(200).json({ received: true, event: eventName });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map LS variant IDs (from env) to internal plan names.
 * Falls back to 'pro' if unknown variant — safer than downgrading to free.
 */
function resolvePlanFromVariant(variantId) {
  if (!variantId) return null;
  const map = {
    [process.env.LS_STARTER_VARIANT_ID]: 'starter',
    [process.env.LS_PRO_VARIANT_ID]:     'pro',
    [process.env.LS_ENT_VARIANT_ID]:     'enterprise',
  };
  return map[variantId] || 'pro';
}

/**
 * Normalise LS status strings to our internal enum.
 * LS uses: active | cancelled | past_due | on_trial | paused | expired | unpaid
 */
function normaliseStatus(lsStatus) {
  if (!lsStatus) return null;
  const map = {
    active:    'active',
    on_trial:  'trialing',
    past_due:  'past_due',
    unpaid:    'past_due',
    cancelled: 'cancelled',
    expired:   'cancelled',
    paused:    'paused',
  };
  return map[lsStatus.toLowerCase()] || lsStatus.toLowerCase();
}

/**
 * Schedule widget disable after grace period.
 * Uses setTimeout for simplicity. In production swap for a BullMQ delayed job
 * so the schedule survives process restarts.
 */
function scheduleWidgetDisable(tenantId, disableAt) {
  const delayMs = disableAt.getTime() - Date.now();
  if (delayMs <= 0) {
    disableWidgetNow(tenantId);
    return;
  }
  setTimeout(() => disableWidgetNow(tenantId), delayMs);
  logger.info({ tenantId, disableAt, delayMs }, 'widget_disable_scheduled');
}

async function disableWidgetNow(tenantId) {
  try {
    const { rows } = await pool.query(
      "SELECT subscription_status FROM tenants WHERE id = $1",
      [tenantId]
    );
    // Only disable if still past_due (not recovered)
    if (rows[0]?.subscription_status === 'past_due') {
      await pool.query(
        "UPDATE tenants SET widget_enabled=false, updated_at=NOW() WHERE id=$1",
        [tenantId]
      );
      logger.warn({ tenantId }, 'widget_disabled_past_due_grace_expired');
    }
  } catch (err) {
    logger.error({ err, tenantId }, 'widget_disable_error');
  }
}

// ─── Express error wrapper ────────────────────────────────────────────────────
function wrap(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      logger.error({ err, path: req.path }, 'billing_controller_error');
      if (!res.headersSent) {
        res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
      }
    }
  };
}

module.exports = {
  createCheckout:   wrap(createCheckout),
  getPortalUrl:     wrap(getPortalUrl),
  getSubscription:  wrap(getSubscription),
  getUsage:         wrap(getUsage),
  handleWebhook:    wrap(handleWebhook),   // raw-body route must use express.raw()
};
