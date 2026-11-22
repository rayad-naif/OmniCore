'use strict';

/**
 * payments/schema.js
 * Invoicing & payments (ported from InvoiceNow, rebuilt for OmniCore).
 * All money is stored as integer minor units (cents) with an ISO currency.
 *
 *   pay_settings       per workspace: business details, invoice numbering, default
 *                      currency/tax, email wording, review request, manual-method texts
 *   pay_providers      payment processors a workspace connected (credentials sealed)
 *   pay_invoices       invoices and estimates (kind), line items as JSONB
 *   pay_products       product / service catalog
 *   pay_links          shareable payment links (fixed or customer-chosen amount)
 *   pay_coupons        discount codes
 *   pay_gift_cards     gift cards with a balance and an activity ledger
 *   pay_attempts       a checkout started with a processor (resolved by webhook/return)
 *   pay_transactions   money received (or pending confirmation for manual methods)
 */

const { pool } = require('../lib/db');

let ready = null;

function ensureSchema() {
  if (!ready) {
    ready = pool
      .query(
        `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payments_feature_enabled BOOLEAN NOT NULL DEFAULT false;
         DO $$ BEGIN
           IF to_regclass('billing_plans') IS NOT NULL THEN
             ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS payments_feature_enabled BOOLEAN NOT NULL DEFAULT false;
           END IF;
         END $$;

         CREATE TABLE IF NOT EXISTS pay_settings (
           tenant_id            UUID PRIMARY KEY,
           business_name        TEXT NOT NULL DEFAULT '',
           business_email       TEXT NOT NULL DEFAULT '',
           business_phone       TEXT NOT NULL DEFAULT '',
           business_address     TEXT NOT NULL DEFAULT '',
           logo_url             TEXT NOT NULL DEFAULT '',
           default_currency     TEXT NOT NULL DEFAULT 'usd',
           default_tax_rate     NUMERIC(7,4) NOT NULL DEFAULT 0,
           invoice_prefix       TEXT NOT NULL DEFAULT 'INV-',
           estimate_prefix      TEXT NOT NULL DEFAULT 'EST-',
           next_invoice_number  INTEGER NOT NULL DEFAULT 1001,
           next_estimate_number INTEGER NOT NULL DEFAULT 1001,
           payment_terms        TEXT NOT NULL DEFAULT 'Due on receipt',
           footer_note          TEXT NOT NULL DEFAULT '',
           email_subject        TEXT NOT NULL DEFAULT 'Invoice {{number}} from {{business}}',
           email_message        TEXT NOT NULL DEFAULT 'Thank you for your business. You can view and pay your invoice online.',
           review_url           TEXT NOT NULL DEFAULT '',
           review_request       BOOLEAN NOT NULL DEFAULT false,
           updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
         );

         CREATE TABLE IF NOT EXISTS pay_providers (
           tenant_id         UUID NOT NULL,
           provider          TEXT NOT NULL,
           status            TEXT NOT NULL DEFAULT 'connected',
           environment       TEXT NOT NULL DEFAULT 'live',
           credentials_sealed TEXT,
           settings          JSONB NOT NULL DEFAULT '{}',
           connected_by      TEXT,
           connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           PRIMARY KEY (tenant_id, provider)
         );

         CREATE TABLE IF NOT EXISTS pay_invoices (
           id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           tenant_id       UUID NOT NULL,
           kind            TEXT NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice','estimate')),
           number          TEXT NOT NULL,
           status          TEXT NOT NULL DEFAULT 'draft',
           contact_id      UUID,
           customer_name   TEXT NOT NULL DEFAULT '',
           customer_email  TEXT NOT NULL DEFAULT '',
           customer_phone  TEXT NOT NULL DEFAULT '',
           customer_address TEXT NOT NULL DEFAULT '',
           title           TEXT NOT NULL DEFAULT '',
           currency        TEXT NOT NULL DEFAULT 'usd',
           line_items      JSONB NOT NULL DEFAULT '[]',
           subtotal        BIGINT NOT NULL DEFAULT 0,
           tax_total       BIGINT NOT NULL DEFAULT 0,
           discount_total  BIGINT NOT NULL DEFAULT 0,
           coupon_code     TEXT,
           total           BIGINT NOT NULL DEFAULT 0,
           amount_paid     BIGINT NOT NULL DEFAULT 0,
           issue_date      DATE NOT NULL DEFAULT CURRENT_DATE,
           due_date        DATE,
           payment_terms   TEXT NOT NULL DEFAULT '',
           notes           TEXT NOT NULL DEFAULT '',
           allowed_methods TEXT[],
           public_token    TEXT NOT NULL UNIQUE,
           sent_at         TIMESTAMPTZ,
           viewed_at       TIMESTAMPTZ,
           paid_at         TIMESTAMPTZ,
           accepted_at     TIMESTAMPTZ,
           converted_invoice_id UUID,
           created_by      TEXT,
           created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           UNIQUE (tenant_id, kind, number)
         );
         CREATE INDEX IF NOT EXISTS idx_pay_invoices_tenant ON pay_invoices (tenant_id, kind, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_pay_invoices_email ON pay_invoices (tenant_id, lower(customer_email));

         CREATE TABLE IF NOT EXISTS pay_products (
           id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           tenant_id   UUID NOT NULL,
           name        TEXT NOT NULL,
           description TEXT NOT NULL DEFAULT '',
           unit_price  BIGINT NOT NULL DEFAULT 0,
           currency    TEXT NOT NULL DEFAULT 'usd',
           taxable     BOOLEAN NOT NULL DEFAULT false,
           tax_rate    NUMERIC(7,4) NOT NULL DEFAULT 0,
           sku         TEXT NOT NULL DEFAULT '',
           active      BOOLEAN NOT NULL DEFAULT true,
           created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
         );
         CREATE INDEX IF NOT EXISTS idx_pay_products_tenant ON pay_products (tenant_id, active);

         CREATE TABLE IF NOT EXISTS pay_links (
           id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           tenant_id    UUID NOT NULL,
           title        TEXT NOT NULL,
           description  TEXT NOT NULL DEFAULT '',
           amount       BIGINT,
           currency     TEXT NOT NULL DEFAULT 'usd',
           min_amount   BIGINT,
           active       BOOLEAN NOT NULL DEFAULT true,
           public_token TEXT NOT NULL UNIQUE,
           allowed_methods TEXT[],
           payments_count INTEGER NOT NULL DEFAULT 0,
           collected    BIGINT NOT NULL DEFAULT 0,
           created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
         );

         CREATE TABLE IF NOT EXISTS pay_coupons (
           id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           tenant_id       UUID NOT NULL,
           code            TEXT NOT NULL,
           kind            TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
           value           NUMERIC(14,4) NOT NULL,
           currency        TEXT,
           max_redemptions INTEGER,
           redemptions     INTEGER NOT NULL DEFAULT 0,
           expires_at      TIMESTAMPTZ,
           active          BOOLEAN NOT NULL DEFAULT true,
           created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           UNIQUE (tenant_id, code)
         );

         CREATE TABLE IF NOT EXISTS pay_gift_cards (
           id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           tenant_id       UUID NOT NULL,
           code            TEXT NOT NULL,
           currency        TEXT NOT NULL DEFAULT 'usd',
           initial_balance BIGINT NOT NULL,
           balance         BIGINT NOT NULL,
           recipient_name  TEXT NOT NULL DEFAULT '',
           recipient_email TEXT NOT NULL DEFAULT '',
           message         TEXT NOT NULL DEFAULT '',
           status          TEXT NOT NULL DEFAULT 'active',
           expires_at      TIMESTAMPTZ,
           activity        JSONB NOT NULL DEFAULT '[]',
           created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           UNIQUE (tenant_id, code)
         );

         CREATE TABLE IF NOT EXISTS pay_attempts (
           id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           tenant_id     UUID NOT NULL,
           invoice_id    UUID,
           link_id       UUID,
           provider      TEXT NOT NULL,
           amount        BIGINT NOT NULL,
           currency      TEXT NOT NULL,
           external_ref  TEXT,
           status        TEXT NOT NULL DEFAULT 'started',
           customer_name TEXT NOT NULL DEFAULT '',
           customer_email TEXT NOT NULL DEFAULT '',
           note          TEXT NOT NULL DEFAULT '',
           created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           completed_at  TIMESTAMPTZ
         );
         CREATE INDEX IF NOT EXISTS idx_pay_attempts_ref ON pay_attempts (provider, external_ref);

         CREATE TABLE IF NOT EXISTS pay_transactions (
           id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           tenant_id     UUID NOT NULL,
           invoice_id    UUID,
           link_id       UUID,
           attempt_id    UUID,
           gift_card_id  UUID,
           provider      TEXT NOT NULL,
           external_id   TEXT,
           amount        BIGINT NOT NULL,
           currency      TEXT NOT NULL,
           status        TEXT NOT NULL DEFAULT 'succeeded',
           method        TEXT NOT NULL DEFAULT '',
           customer_name TEXT NOT NULL DEFAULT '',
           customer_email TEXT NOT NULL DEFAULT '',
           reference     TEXT NOT NULL DEFAULT '',
           note          TEXT NOT NULL DEFAULT '',
           confirmed_by  TEXT,
           confirmed_at  TIMESTAMPTZ,
           created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
         );
         CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_tx_external ON pay_transactions (provider, external_id) WHERE external_id IS NOT NULL;
         CREATE INDEX IF NOT EXISTS idx_pay_tx_tenant ON pay_transactions (tenant_id, created_at DESC);`,
      )
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

module.exports = { ensureSchema };
