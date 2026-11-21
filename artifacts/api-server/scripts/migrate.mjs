#!/usr/bin/env node
/**
 * migrate.mjs — idempotent database setup + first super admin.
 *
 * Used by platforms without shell access (Render free tier, Docker, Vercel
 * + external API) and safe to run on every start:
 *
 *   node artifacts/api-server/scripts/migrate.mjs
 *
 * 1. Creates extensions (uuid-ossp, pgcrypto, vector — vector is optional).
 * 2. Applies artifacts/api-server/schema.sql (CREATE … IF NOT EXISTS only).
 * 3. If SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are set and that account
 *    does not exist yet, creates the platform workspace and the super admin.
 *    The password is only used once; change it in the app afterwards and you
 *    can remove SUPER_ADMIN_PASSWORD from the environment.
 *
 * Runtime migrations for newer tables (audit_logs, integrations, billing
 * plans…) run automatically when the API starts.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('pg');
const bcrypt = require('bcryptjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[migrate] DATABASE_URL is not set');
  process.exit(1);
}

const { sslFor } = require('../src/lib/dbSsl.js');
const ssl = sslFor(url);

const client = new pg.Client({ connectionString: url, ssl });
await client.connect();
const log = (m) => console.log(`[migrate] ${m}`);

try {
  await client.query('SELECT pg_advisory_lock(hashtext($1))', [
    'omnicore_migrate',
  ]);

  for (const ext of ['uuid-ossp', 'pgcrypto', 'vector']) {
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS "${ext}"`);
    } catch (err) {
      log(
        `extension ${ext} unavailable (${err.message.split('\n')[0]}) — continuing`,
      );
    }
  }

  const schema = await readFile(path.join(here, '..', 'schema.sql'), 'utf8');
  try {
    await client.query(schema);
    log('schema.sql applied');
  } catch (err) {
    // pgvector may be missing on some hosts; apply statement by statement so
    // the rest of the schema still lands.
    log(
      `bulk apply failed (${err.message.split('\n')[0]}); applying statements individually`,
    );
    const statements = schema
      .replace(/--.*$/gm, '')
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean);
    let failed = 0;
    for (const st of statements) {
      try {
        await client.query(st);
      } catch (e) {
        failed += 1;
        log(
          `  skipped: ${st.split('\n')[0].slice(0, 80)} — ${e.message.split('\n')[0]}`,
        );
      }
    }
    log(`schema applied with ${failed} skipped statement(s)`);
  }

  const email = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || '';
  if (email && password) {
    const { rows } = await client.query(
      'SELECT 1 FROM agents WHERE lower(email) = $1 LIMIT 1',
      [email],
    );
    if (rows.length) {
      log(`super admin ${email} already exists — SUPER_ADMIN_PASSWORD ignored`);
    } else if (password.length < 12) {
      log(
        'SUPER_ADMIN_PASSWORD must be at least 12 characters — super admin not created',
      );
    } else {
      const hash = await bcrypt.hash(password, 12);
      await client.query(
        `INSERT INTO tenants (id, company_name, subscription_status)
         VALUES ('00000000-0000-0000-0000-000000000001', 'Platform Admin', 'active')
         ON CONFLICT (id) DO NOTHING`,
      );
      await client.query(
        `INSERT INTO agents (tenant_id, name, email, password_hash, role, is_active)
         VALUES ('00000000-0000-0000-0000-000000000001', 'Super Admin', $1, $2, 'admin', true)
         ON CONFLICT (tenant_id, email) DO NOTHING`,
        [email, hash],
      );
      log(
        `super admin ${email} created — sign in at /dashboard/ and change the password`,
      );
    }
  }
} finally {
  await client
    .query('SELECT pg_advisory_unlock(hashtext($1))', ['omnicore_migrate'])
    .catch(() => {});
  await client.end();
}
