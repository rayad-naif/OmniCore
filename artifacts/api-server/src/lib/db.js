'use strict';

/**
 * src/lib/db.js
 * Singleton pg.Pool — shared across all CJS controllers and services.
 * Lives in src/ so it inherits the CJS treatment from src/package.json.
 * Import with: const { pool } = require('../lib/db');
 */

const { Pool } = require('pg');
const logger   = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: true }
    : false,
  max: 20,
  idleTimeoutMillis:    30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'db_idle_client_error');
});

module.exports = { pool };
