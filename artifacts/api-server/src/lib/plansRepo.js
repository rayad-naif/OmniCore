'use strict';

/**
 * plansRepo.js
 * Source of truth for subscription plans, stored in the `billing_plans`
 * Postgres table and kept in sync with Paddle Billing's catalog.
 *
 * Why a DB table instead of reading the provider's catalog directly:
 *   - The previous design stored plans as Stripe products and read them from a
 *     synced `stripe` schema. That breaks the moment Stripe is unavailable.
 *   - With a local table as the source of truth, plan management (create / edit /
 *     archive, including per-plan features and the Free plan) always works, and
 *     paid plans are mirrored into Paddle so checkout can use their price IDs.
 *
 * Paddle sync rules:
 *   - Free plans (is_free=true / amount 0) never get a Paddle product.
 *   - Creating a paid plan creates a Paddle product + recurring monthly price.
 *   - Changing a paid plan's price creates a new Paddle price and archives the
 *     old one (Paddle prices are immutable).
 *   - All Paddle calls are best-effort: a Paddle outage never blocks DB writes.
 *     A plan with no paddle_price_id is flagged as un-synced in the UI and is
 *     lazily synced the next time checkout needs it.
 */

const { pool } = require('./db');
const logger = require('../utils/logger');
const paddle = require('./paddleClient');

const TRIAL_DAYS = 14;

// ─── Schema + seed (idempotent) ──────────────────────────────────────────────
let _ready = null;
function ensureSchema() {
  if (_ready) return _ready;
  _ready = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_plans (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug                 TEXT NOT NULL UNIQUE,
        name                 TEXT NOT NULL,
        description          TEXT,
        amount_cents         INTEGER NOT NULL DEFAULT 0,
        currency             TEXT NOT NULL DEFAULT 'usd',
        interval             TEXT NOT NULL DEFAULT 'month',
        is_free              BOOLEAN NOT NULL DEFAULT false,
        self_serve           BOOLEAN NOT NULL DEFAULT true,
        active               BOOLEAN NOT NULL DEFAULT true,
        sort_order           INTEGER NOT NULL DEFAULT 0,
        trial_days           INTEGER NOT NULL DEFAULT 14,
        ai_feature_enabled   BOOLEAN NOT NULL DEFAULT false,
        smtp_feature_enabled BOOLEAN NOT NULL DEFAULT false,
        max_brands_allowed   INTEGER,
        max_agents_allowed   INTEGER,
        conversation_limit   INTEGER,
        paddle_product_id    TEXT,
        paddle_price_id      TEXT,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Seed defaults only when the table is empty, mirroring the previous Stripe
    // plan definitions so existing tenants keep their expected limits.
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM billing_plans');
    if ((rows[0]?.n || 0) === 0) {
      await pool.query(
        `INSERT INTO billing_plans
           (slug, name, description, amount_cents, is_free, self_serve, sort_order,
            ai_feature_enabled, smtp_feature_enabled,
            max_brands_allowed, max_agents_allowed, conversation_limit)
         VALUES
           ('free',    'Free',             'Get started with the essentials.',                 0,    true,  false, 0, false, false, 1,  2,   100),
           ('starter', 'OmniCore Starter', 'For small teams getting started with omnichannel support.', 2900, false, true,  1, false, false, 1,  3,   500),
           ('growth',  'OmniCore Growth',  'For scaling teams with AI deflection and automations.',     7900, false, true,  2, true,  true,  10, 999, 10000)`
      );
      logger.info('billing_plans_seeded');
    }
  })().catch((err) => {
    _ready = null; // allow retry on next call
    logger.error({ err: err.message }, 'billing_plans_schema_failed');
    throw err;
  });
  return _ready;
}

// ─── Shaping ─────────────────────────────────────────────────────────────────
function shape(r) {
  return {
    id:           r.id,
    slug:         r.slug,
    plan:         r.slug, // alias kept for dashboard/back-compat
    name:         r.name,
    description:  r.description || '',
    amount:       r.amount_cents,
    currency:     r.currency,
    interval:     r.interval,
    is_free:      r.is_free,
    self_serve:   r.self_serve,
    active:       r.active,
    sort_order:   r.sort_order,
    trial_days:   r.trial_days,
    paddle_product_id: r.paddle_product_id,
    paddle_price_id:   r.paddle_price_id,
    paddle_synced:     !!r.paddle_price_id,
    features: {
      ai_feature_enabled:   r.ai_feature_enabled,
      smtp_feature_enabled: r.smtp_feature_enabled,
    },
    limits: {
      max_brands_allowed: r.max_brands_allowed,
      max_agents_allowed: r.max_agents_allowed,
      conversation_limit: r.conversation_limit,
    },
  };
}

// ─── Reads ───────────────────────────────────────────────────────────────────
async function listPlans({ includeInactive = false } = {}) {
  await ensureSchema();
  const where = includeInactive ? '' : 'WHERE active = true';
  const { rows } = await pool.query(
    `SELECT * FROM billing_plans ${where} ORDER BY sort_order ASC, amount_cents ASC`
  );
  return rows.map(shape);
}

/** Self-serve, purchasable plans for the tenant billing grid (excludes free). */
async function listSelfServePlans() {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT * FROM billing_plans
     WHERE active = true AND self_serve = true AND is_free = false
     ORDER BY sort_order ASC, amount_cents ASC`
  );
  return rows.map(shape);
}

async function getPlanRowBySlug(slug) {
  await ensureSchema();
  const { rows } = await pool.query(
    'SELECT * FROM billing_plans WHERE slug = $1 LIMIT 1',
    [String(slug).toLowerCase()]
  );
  return rows[0] || null;
}

async function getPlanBySlug(slug) {
  const row = await getPlanRowBySlug(slug);
  return row ? shape(row) : null;
}

// ─── Paddle sync ─────────────────────────────────────────────────────────────
/**
 * Ensures a paid plan has a live Paddle product + price matching its current
 * amount. Persists the resulting ids. Returns { plan, warning }.
 * Best-effort: on Paddle failure the DB row is returned unchanged with a warning.
 */
async function syncPlanToPaddle(row) {
  if (row.is_free || row.amount_cents <= 0) return { row, warning: null };

  try {
    const customData = { plan: row.slug, self_serve: String(row.self_serve) };

    let productId = row.paddle_product_id;
    if (!productId) {
      const product = await paddle.createPaddleProduct({
        name: row.name,
        description: row.description,
        customData,
      });
      productId = product.id;
    } else {
      await paddle.updatePaddleProduct(productId, {
        name: row.name,
        description: row.description,
        customData,
      }).catch((err) => logger.warn({ err: err.message, productId }, 'paddle_product_update_failed'));
    }

    const price = await paddle.createPaddlePrice({
      productId,
      amountCents: row.amount_cents,
      currency: row.currency,
      trialDays: row.trial_days,
      plan: row.slug,
    });

    // Archive the previous price (immutable; replaced by the new one).
    if (row.paddle_price_id && row.paddle_price_id !== price.id) {
      await paddle.archivePaddlePrice(row.paddle_price_id)
        .catch((err) => logger.warn({ err: err.message }, 'paddle_price_archive_failed'));
    }

    const { rows } = await pool.query(
      `UPDATE billing_plans
         SET paddle_product_id = $1, paddle_price_id = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [productId, price.id, row.id]
    );
    logger.info({ slug: row.slug, productId, priceId: price.id }, 'plan_synced_to_paddle');
    return { row: rows[0], warning: null };
  } catch (err) {
    logger.error({ err: err.message, slug: row.slug }, 'plan_paddle_sync_failed');
    return { row, warning: `Saved, but Paddle sync failed: ${err.message}` };
  }
}

/**
 * Returns a usable Paddle price id for a plan slug, lazily creating the Paddle
 * objects if the plan exists but has not been synced yet. Falls back to the
 * PADDLE_<SLUG>_PRICE_ID env var. Returns null if nothing is available.
 */
async function ensurePaddlePriceId(slug) {
  const row = await getPlanRowBySlug(slug);
  if (!row || row.is_free || row.amount_cents <= 0) {
    return paddle.getPaddlePriceId(slug);
  }
  if (row.paddle_price_id) return row.paddle_price_id;
  const { row: synced } = await syncPlanToPaddle(row);
  return synced.paddle_price_id || paddle.getPaddlePriceId(slug);
}

// ─── Writes ──────────────────────────────────────────────────────────────────
function slugify(input) {
  return String(input).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function createPlan(body) {
  await ensureSchema();
  const name = String(body.name || '').trim();
  if (!name) { const e = new Error('name is required'); e.status = 400; throw e; }

  const slug = slugify(body.slug || body.plan || name);
  if (!slug) { const e = new Error('A valid plan key/slug is required'); e.status = 400; throw e; }

  const isFree = !!body.is_free;
  const amount = isFree ? 0 : normInt(body.amount) ?? 0;

  const existing = await getPlanRowBySlug(slug);
  if (existing) { const e = new Error(`A plan with key "${slug}" already exists`); e.status = 409; throw e; }

  const { rows } = await pool.query(
    `INSERT INTO billing_plans
       (slug, name, description, amount_cents, currency, is_free, self_serve, sort_order,
        trial_days, ai_feature_enabled, smtp_feature_enabled,
        max_brands_allowed, max_agents_allowed, conversation_limit)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      slug,
      name,
      String(body.description || '').trim() || null,
      amount,
      String(body.currency || 'usd').toLowerCase(),
      isFree,
      isFree ? false : body.self_serve !== false,
      normInt(body.sort_order) ?? 0,
      normInt(body.trial_days) ?? TRIAL_DAYS,
      !!body.ai_feature_enabled,
      !!body.smtp_feature_enabled,
      normInt(body.max_brands_allowed),
      normInt(body.max_agents_allowed),
      normInt(body.conversation_limit),
    ]
  );

  const { row, warning } = await syncPlanToPaddle(rows[0]);
  logger.info({ slug }, 'plan_created');
  return { plan: shape(row), warning };
}

async function updatePlan(id, body) {
  await ensureSchema();
  const { rows: cur } = await pool.query('SELECT * FROM billing_plans WHERE id = $1', [id]);
  const existing = cur[0];
  if (!existing) { const e = new Error('Plan not found'); e.status = 404; throw e; }

  const next = { ...existing };
  if (body.name !== undefined) next.name = String(body.name).trim() || existing.name;
  if (body.description !== undefined) next.description = String(body.description).trim() || null;
  if (body.currency !== undefined) next.currency = String(body.currency).toLowerCase();
  if (body.active !== undefined) next.active = !!body.active;
  if (body.sort_order !== undefined) next.sort_order = normInt(body.sort_order) ?? existing.sort_order;
  if (body.trial_days !== undefined) next.trial_days = normInt(body.trial_days) ?? existing.trial_days;
  if (body.ai_feature_enabled !== undefined) next.ai_feature_enabled = !!body.ai_feature_enabled;
  if (body.smtp_feature_enabled !== undefined) next.smtp_feature_enabled = !!body.smtp_feature_enabled;
  if (body.max_brands_allowed !== undefined) next.max_brands_allowed = normInt(body.max_brands_allowed);
  if (body.max_agents_allowed !== undefined) next.max_agents_allowed = normInt(body.max_agents_allowed);
  if (body.conversation_limit !== undefined) next.conversation_limit = normInt(body.conversation_limit);
  // Free plans never carry a price or self-serve flag.
  if (!existing.is_free) {
    if (body.self_serve !== undefined) next.self_serve = !!body.self_serve;
    if (body.amount !== undefined) next.amount_cents = normInt(body.amount) ?? existing.amount_cents;
  }

  const { rows } = await pool.query(
    `UPDATE billing_plans SET
       name = $1, description = $2, amount_cents = $3, currency = $4, active = $5,
       self_serve = $6, sort_order = $7, trial_days = $8,
       ai_feature_enabled = $9, smtp_feature_enabled = $10,
       max_brands_allowed = $11, max_agents_allowed = $12, conversation_limit = $13,
       updated_at = NOW()
     WHERE id = $14 RETURNING *`,
    [
      next.name, next.description, next.amount_cents, next.currency, next.active,
      next.self_serve, next.sort_order, next.trial_days,
      next.ai_feature_enabled, next.smtp_feature_enabled,
      next.max_brands_allowed, next.max_agents_allowed, next.conversation_limit,
      id,
    ]
  );

  let row = rows[0];
  let warning = null;

  // Re-sync Paddle when the price changed, the plan has no price yet, or core
  // catalog fields changed — but only for active paid plans.
  const priceChanged = next.amount_cents !== existing.amount_cents || next.currency !== existing.currency;
  if (!row.is_free && row.active) {
    if (priceChanged || !row.paddle_price_id || body.name !== undefined || body.description !== undefined) {
      ({ row, warning } = await syncPlanToPaddle(row));
    }
  } else if (!row.is_free && !row.active && row.paddle_product_id) {
    // Archived — remove it from Paddle's catalog (best-effort).
    await paddle.archivePaddleProduct(row.paddle_product_id)
      .catch((err) => logger.warn({ err: err.message }, 'paddle_product_archive_failed'));
  }

  logger.info({ id, slug: row.slug }, 'plan_updated');
  return { plan: shape(row), warning };
}

async function archivePlan(id) {
  return updatePlan(id, { active: false });
}

async function deletePlan(id) {
  await ensureSchema();
  const { rows } = await pool.query('SELECT * FROM billing_plans WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) { const e = new Error('Plan not found'); e.status = 404; throw e; }
  if (row.is_free) { const e = new Error('The Free plan cannot be removed'); e.status = 400; throw e; }
  if (row.paddle_product_id) {
    await paddle.archivePaddleProduct(row.paddle_product_id)
      .catch((err) => logger.warn({ err: err.message }, 'paddle_product_archive_failed'));
  }
  await pool.query('DELETE FROM billing_plans WHERE id = $1', [id]);
  logger.info({ id, slug: row.slug }, 'plan_deleted');
  return { ok: true };
}

module.exports = {
  ensureSchema,
  listPlans,
  listSelfServePlans,
  getPlanBySlug,
  ensurePaddlePriceId,
  createPlan,
  updatePlan,
  archivePlan,
  deletePlan,
};
