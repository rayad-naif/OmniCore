'use strict';

/**
 * integrations/schema.js
 * Idempotent DDL for the integrations platform.
 *
 * integration_events   transactional outbox, filled by DB triggers so that
 *                      EVERY write path (widget, email, socket, AI, API, agents)
 *                      produces events without touching each controller.
 * webhook_endpoints    tenant-defined outgoing webhooks (signed)
 * webhook_deliveries   one row per attempt-tracked delivery, with retries
 * api_keys             hashed keys for the public REST API (/api/v1)
 * tenant_integrations  per-tenant connector config (slack, discord, teams, ghl…)
 * ghl_connections      GoHighLevel OAuth installs (one per location)
 * ghl_links            OmniCore ↔ GoHighLevel id mapping (contacts, conversations)
 */

const { pool } = require('../db');
const logger = require('../../utils/logger');

const DDL = `
CREATE TABLE IF NOT EXISTS integration_events (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  event_type    TEXT NOT NULL,
  resource_id   UUID,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT
);
CREATE INDEX IF NOT EXISTS idx_integration_events_pending
  ON integration_events (id) WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  url               TEXT NOT NULL,
  description       TEXT,
  events            TEXT[] NOT NULL DEFAULT '{*}',
  secret_sealed     TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  failure_streak    INTEGER NOT NULL DEFAULT 0,
  last_delivery_at  TIMESTAMPTZ,
  last_status       INTEGER,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_tenant ON webhook_endpoints (tenant_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  target_kind     TEXT NOT NULL DEFAULT 'webhook',
  target_id       UUID NOT NULL,
  event_id        BIGINT,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_status INTEGER,
  response_body   TEXT,
  error           TEXT,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_target
  ON webhook_deliveries (target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  scopes        TEXT[] NOT NULL DEFAULT '{read}',
  last_used_at  TIMESTAMPTZ,
  last_used_ip  TEXT,
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys (tenant_id);

CREATE TABLE IF NOT EXISTS tenant_integrations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  provider       TEXT NOT NULL,
  name           TEXT,
  config_sealed  TEXT,
  settings       JSONB NOT NULL DEFAULT '{}'::jsonb,
  events         TEXT[] NOT NULL DEFAULT '{*}',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_error     TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenant_integrations_tenant ON tenant_integrations (tenant_id, provider);

CREATE TABLE IF NOT EXISTS ghl_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID,
  location_id         TEXT NOT NULL UNIQUE,
  company_id          TEXT,
  location_name       TEXT,
  brand_id            UUID,
  tokens_sealed       TEXT NOT NULL,
  scopes              TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  settings            JSONB NOT NULL DEFAULT '{"syncContacts":true,"syncConversations":true,"postTranscripts":true,"inboundMessages":true}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'active',
  last_error          TEXT,
  installed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ghl_connections_tenant ON ghl_connections (tenant_id);

CREATE TABLE IF NOT EXISTS ghl_links (
  id             BIGSERIAL PRIMARY KEY,
  connection_id  UUID NOT NULL REFERENCES ghl_connections(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  omnicore_id    UUID NOT NULL,
  ghl_id         TEXT NOT NULL,
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, kind, omnicore_id),
  UNIQUE (connection_id, kind, ghl_id)
);

-- ── Outbox triggers ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION omnicore_emit_event(p_tenant UUID, p_type TEXT, p_resource UUID, p_payload JSONB)
RETURNS VOID LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_tenant IS NULL THEN RETURN; END IF;
  INSERT INTO integration_events (tenant_id, event_type, resource_id, payload)
  VALUES (p_tenant, p_type, p_resource, COALESCE(p_payload, '{}'::jsonb));
END
$fn$;

CREATE OR REPLACE FUNCTION omnicore_conversations_events() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM omnicore_emit_event(NEW.tenant_id, 'conversation.created', NEW.id,
      jsonb_build_object('channel', NEW.channel, 'status', NEW.status));
    IF NEW.is_ticket THEN
      PERFORM omnicore_emit_event(NEW.tenant_id, 'ticket.created', NEW.id,
        jsonb_build_object('ticket_number', NEW.ticket_number, 'priority', NEW.priority));
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM omnicore_emit_event(NEW.tenant_id,
      CASE WHEN NEW.status = 'closed' THEN 'conversation.closed'
           WHEN OLD.status = 'closed' THEN 'conversation.reopened'
           ELSE 'conversation.status_changed' END,
      NEW.id, jsonb_build_object('from', OLD.status, 'to', NEW.status));
  END IF;
  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    PERFORM omnicore_emit_event(NEW.tenant_id, 'conversation.assigned', NEW.id,
      jsonb_build_object('from', OLD.assigned_agent_id, 'to', NEW.assigned_agent_id));
  END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    PERFORM omnicore_emit_event(NEW.tenant_id, 'conversation.priority_changed', NEW.id,
      jsonb_build_object('from', OLD.priority, 'to', NEW.priority));
  END IF;
  IF COALESCE(NEW.is_ticket, FALSE) AND NOT COALESCE(OLD.is_ticket, FALSE) THEN
    PERFORM omnicore_emit_event(NEW.tenant_id, 'ticket.created', NEW.id,
      jsonb_build_object('ticket_number', NEW.ticket_number, 'priority', NEW.priority));
  END IF;
  IF NEW.csat_score IS NOT NULL AND OLD.csat_score IS DISTINCT FROM NEW.csat_score THEN
    PERFORM omnicore_emit_event(NEW.tenant_id, 'csat.submitted', NEW.id,
      jsonb_build_object('score', NEW.csat_score));
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION omnicore_messages_events() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
DECLARE v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM conversations WHERE id = NEW.conversation_id;
  PERFORM omnicore_emit_event(v_tenant,
    CASE WHEN NEW.is_internal_note THEN 'note.created' ELSE 'message.created' END,
    NEW.id,
    jsonb_build_object('conversation_id', NEW.conversation_id, 'sender_type', NEW.sender_type));
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION omnicore_visitors_events() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM omnicore_emit_event(NEW.tenant_id, 'contact.created', NEW.id, '{}'::jsonb);
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_omnicore_conversations_events ON conversations;
CREATE TRIGGER trg_omnicore_conversations_events
  AFTER INSERT OR UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION omnicore_conversations_events();

DROP TRIGGER IF EXISTS trg_omnicore_messages_events ON messages;
CREATE TRIGGER trg_omnicore_messages_events
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION omnicore_messages_events();

DROP TRIGGER IF EXISTS trg_omnicore_visitors_events ON visitors;
CREATE TRIGGER trg_omnicore_visitors_events
  AFTER INSERT ON visitors
  FOR EACH ROW EXECUTE FUNCTION omnicore_visitors_events();
`;

let ready = null;

/** Creates tables and triggers once per process. Safe to call repeatedly. */
function ensureIntegrationsSchema() {
  if (!ready) {
    ready = (async () => {
      const client = await pool.connect();
      try {
        // Serialise across instances: CREATE OR REPLACE FUNCTION / TRIGGER are
        // not concurrency-safe when two processes start at the same time.
        await client.query('SELECT pg_advisory_lock(hashtext($1))', [
          'omnicore_integrations_schema',
        ]);
        await client.query(DDL);
      } finally {
        await client
          .query('SELECT pg_advisory_unlock(hashtext($1))', [
            'omnicore_integrations_schema',
          ])
          .catch(() => {});
        client.release();
      }
      logger.info('integrations_schema_ok');
    })().catch((err) => {
      ready = null;
      logger.error({ err: err.message }, 'integrations_schema_failed');
      throw err;
    });
  }
  return ready;
}

module.exports = { ensureIntegrationsSchema };
