'use strict';

/**
 * stores/schema.js — tables for online stores (hosted WooCommerce stores and
 * connected existing WooCommerce stores). Created at runtime, idempotent.
 */

const { pool } = require('../lib/db');

let ready = null;

function ensureSchema() {
  if (!ready) {
    // Payments tables first: online-store checkouts are invoices with source = 'woocommerce'.
    ready = require('../payments/schema')
      .ensureSchema()
      .then(() =>
        pool.query(
          `
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stores_feature_enabled BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_stores INTEGER NOT NULL DEFAULT 1;

        CREATE TABLE IF NOT EXISTS store_hosts (
          id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name           TEXT NOT NULL,
          agent_url      TEXT NOT NULL,
          secret_sealed  TEXT NOT NULL,
          base_domain    TEXT NOT NULL,
          cname_target   TEXT,
          public_ip      TEXT,
          capacity       INTEGER NOT NULL DEFAULT 40,
          active         BOOLEAN NOT NULL DEFAULT true,
          last_seen_at   TIMESTAMPTZ,
          last_health    JSONB,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS stores (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id             UUID NOT NULL,
          kind                  TEXT NOT NULL CHECK (kind IN ('hosted','connected')),
          name                  TEXT NOT NULL,
          status                TEXT NOT NULL,
          host_id               UUID,
          agent_store_id        TEXT,
          template              TEXT,
          brand_color           TEXT,
          business_description  TEXT NOT NULL DEFAULT '',
          design                JSONB,
          subdomain             TEXT,
          custom_domain         TEXT,
          domain_status         TEXT,
          domain_detail         JSONB,
          site_url              TEXT,
          currency              TEXT,
          admin_email           TEXT,
          wc_keys_sealed        TEXT,
          webhook_secret_sealed TEXT,
          webhook_ids           JSONB NOT NULL DEFAULT '[]',
          connect_secret_sealed TEXT,
          checkout_enabled      BOOLEAN NOT NULL DEFAULT true,
          plugin_seen_at        TIMESTAMPTZ,
          plugin_version        TEXT,
          stats                 JSONB NOT NULL DEFAULT '{}',
          last_sync_at          TIMESTAMPTZ,
          sync_error            TEXT,
          error                 TEXT,
          created_by            TEXT,
          created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at            TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_stores_tenant ON stores (tenant_id) WHERE deleted_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_subdomain ON stores (lower(subdomain)) WHERE deleted_at IS NULL AND subdomain IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_custom_domain ON stores (lower(custom_domain)) WHERE deleted_at IS NULL AND custom_domain IS NOT NULL;

        CREATE TABLE IF NOT EXISTS store_jobs (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          store_id    UUID NOT NULL,
          tenant_id   UUID NOT NULL,
          kind        TEXT NOT NULL,
          payload     JSONB NOT NULL DEFAULT '{}',
          status      TEXT NOT NULL DEFAULT 'queued',
          attempts    INTEGER NOT NULL DEFAULT 0,
          run_after   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          lease_until TIMESTAMPTZ,
          error       TEXT,
          log         JSONB NOT NULL DEFAULT '[]',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_store_jobs_due ON store_jobs (status, run_after);
        CREATE INDEX IF NOT EXISTS idx_store_jobs_store ON store_jobs (store_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS store_orders (
          id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id            UUID NOT NULL,
          store_id             UUID NOT NULL,
          external_id          BIGINT NOT NULL,
          number               TEXT,
          status               TEXT,
          currency             TEXT,
          total                BIGINT NOT NULL DEFAULT 0,
          customer_name        TEXT NOT NULL DEFAULT '',
          customer_email       TEXT NOT NULL DEFAULT '',
          contact_id           UUID,
          items_count          INTEGER NOT NULL DEFAULT 0,
          payment_method       TEXT,
          payment_method_title TEXT,
          created_remote       TIMESTAMPTZ,
          updated_remote       TIMESTAMPTZ,
          raw                  JSONB,
          created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (store_id, external_id)
        );
        CREATE INDEX IF NOT EXISTS idx_store_orders_tenant ON store_orders (tenant_id, created_remote DESC);

        CREATE TABLE IF NOT EXISTS store_locks (
          name        TEXT PRIMARY KEY,
          holder      TEXT NOT NULL,
          lease_until TIMESTAMPTZ NOT NULL
        );

        ALTER TABLE pay_invoices ADD COLUMN IF NOT EXISTS source TEXT;
        ALTER TABLE pay_invoices ADD COLUMN IF NOT EXISTS source_ref JSONB;

        DO $$ BEGIN
          IF to_regclass('public.billing_plans') IS NOT NULL THEN
            ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS stores_feature_enabled BOOLEAN NOT NULL DEFAULT false;
            ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS max_stores INTEGER NOT NULL DEFAULT 1;
          END IF;
        END $$;
      `,
        ),
      )
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

module.exports = { ensureSchema };
