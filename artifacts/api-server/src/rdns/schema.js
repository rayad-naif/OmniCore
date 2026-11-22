'use strict';

/**
 * rdns/schema.js
 * Tables of the Reverse DNS tool (platform super admins only). Ported from the
 * standalone Python app's SQLAlchemy models:
 *
 *   rdns_targets   watchlist (A record IP or CNAME target)
 *   rdns_cursors   per (target, source) pagination + pacing state, so a restart
 *                  resumes exactly where it stopped and never re-bursts a source
 *   rdns_domains   deduplicated discoveries (per target), with the sources that saw them
 *   rdns_sources   source settings managed in the UI (enable, pace, API key — encrypted)
 *   rdns_crawl_jobs / rdns_forms   forms-only crawler state and findings
 *   rdns_logs      activity log shown in the UI
 *   rdns_locks     lease so only one API instance runs the scheduler
 */

const { pool } = require('../lib/db');
const { SOURCES } = require('./sources');

let ready = null;

function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS rdns_targets (
          id                    SERIAL PRIMARY KEY,
          record_type           TEXT NOT NULL CHECK (record_type IN ('A', 'CNAME')),
          value                 TEXT NOT NULL,
          enabled               BOOLEAN NOT NULL DEFAULT true,
          notes                 TEXT NOT NULL DEFAULT '',
          rescan_interval_hours INTEGER NOT NULL DEFAULT 24,
          crawl_forms           BOOLEAN NOT NULL DEFAULT true,
          created_by            TEXT,
          created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (record_type, value)
        );
        CREATE TABLE IF NOT EXISTS rdns_cursors (
          id                  SERIAL PRIMARY KEY,
          target_id           INTEGER NOT NULL REFERENCES rdns_targets(id) ON DELETE CASCADE,
          source_key          TEXT NOT NULL,
          status              TEXT NOT NULL DEFAULT 'pending',
          page_state          TEXT,
          page_number         INTEGER NOT NULL DEFAULT 0,
          pages_fetched_total INTEGER NOT NULL DEFAULT 0,
          records_found_total INTEGER NOT NULL DEFAULT 0,
          next_allowed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          backoff_seconds     INTEGER NOT NULL DEFAULT 0,
          last_run_at         TIMESTAMPTZ,
          last_error          TEXT,
          exhausted_at        TIMESTAMPTZ,
          UNIQUE (target_id, source_key)
        );
        CREATE TABLE IF NOT EXISTS rdns_domains (
          id            BIGSERIAL PRIMARY KEY,
          target_id     INTEGER NOT NULL REFERENCES rdns_targets(id) ON DELETE CASCADE,
          domain        TEXT NOT NULL,
          record_type   TEXT NOT NULL,
          sources       TEXT[] NOT NULL DEFAULT '{}',
          first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (target_id, domain)
        );
        CREATE INDEX IF NOT EXISTS idx_rdns_domains_domain ON rdns_domains (domain);
        CREATE INDEX IF NOT EXISTS idx_rdns_domains_first_seen ON rdns_domains (first_seen_at DESC);
        CREATE TABLE IF NOT EXISTS rdns_sources (
          key               TEXT PRIMARY KEY,
          enabled           BOOLEAN NOT NULL DEFAULT true,
          api_key_sealed    TEXT,
          requests_per_hour INTEGER NOT NULL,
          extra             JSONB NOT NULL DEFAULT '{}',
          updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS rdns_crawl_jobs (
          id                  SERIAL PRIMARY KEY,
          domain              TEXT NOT NULL UNIQUE,
          status              TEXT NOT NULL DEFAULT 'queued',
          queue               JSONB NOT NULL DEFAULT '[]',
          visited             JSONB NOT NULL DEFAULT '[]',
          robots_disallow     JSONB,
          crawl_delay_seconds INTEGER NOT NULL DEFAULT 2,
          max_pages           INTEGER NOT NULL DEFAULT 50,
          pages_crawled       INTEGER NOT NULL DEFAULT 0,
          forms_found         INTEGER NOT NULL DEFAULT 0,
          seeded              BOOLEAN NOT NULL DEFAULT false,
          next_allowed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_run_at         TIMESTAMPTZ,
          last_error          TEXT,
          created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_rdns_crawl_due ON rdns_crawl_jobs (status, next_allowed_at);
        CREATE TABLE IF NOT EXISTS rdns_forms (
          id              BIGSERIAL PRIMARY KEY,
          domain          TEXT NOT NULL,
          page_url        TEXT NOT NULL,
          form_index      INTEGER NOT NULL DEFAULT 0,
          method          TEXT NOT NULL DEFAULT 'GET',
          action          TEXT NOT NULL DEFAULT '',
          field_names     JSONB NOT NULL DEFAULT '[]',
          field_count     INTEGER NOT NULL DEFAULT 0,
          guessed_purpose TEXT NOT NULL DEFAULT 'unknown',
          page_title      TEXT NOT NULL DEFAULT '',
          discovered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (domain, page_url, form_index)
        );
        CREATE INDEX IF NOT EXISTS idx_rdns_forms_domain ON rdns_forms (domain);
        CREATE TABLE IF NOT EXISTS rdns_logs (
          id        BIGSERIAL PRIMARY KEY,
          ts        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          level     TEXT NOT NULL DEFAULT 'info',
          component TEXT NOT NULL DEFAULT '',
          message   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rdns_logs_ts ON rdns_logs (ts DESC);
        CREATE TABLE IF NOT EXISTS rdns_locks (
          key   TEXT PRIMARY KEY,
          until BIGINT NOT NULL
        );
      `);
      // Paid sources start disabled until an API key is added.
      for (const [key, spec] of Object.entries(SOURCES)) {
        await pool.query(
          `INSERT INTO rdns_sources (key, enabled, requests_per_hour)
           VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
          [key, spec.kind === 'free', spec.defaultRph],
        );
      }
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** Writes an activity-log line (best effort). */
async function log(level, component, message) {
  try {
    await pool.query(
      `INSERT INTO rdns_logs (level, component, message) VALUES ($1, $2, $3)`,
      [level, component, String(message).slice(0, 2000)],
    );
  } catch {
    /* logging never breaks the scheduler */
  }
}

/** Keeps the activity log bounded (newest 20,000 lines, at most 90 days). */
async function trimLogs() {
  await pool.query(
    `DELETE FROM rdns_logs WHERE ts < NOW() - INTERVAL '90 days'
       OR id < (SELECT COALESCE(MAX(id), 0) - 20000 FROM rdns_logs)`,
  );
}

async function claimLease(key, ttlMs) {
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO rdns_locks (key, until) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET until = EXCLUDED.until WHERE rdns_locks.until < $3
     RETURNING key`,
    [key, now + ttlMs, now],
  );
  return rows.length > 0;
}

module.exports = { ensureSchema, log, trimLogs, claimLease };
