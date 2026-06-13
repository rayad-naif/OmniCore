'use strict';

/**
 * src/utils/logger.js
 * CJS-compatible pino logger stub.
 * All .js controllers `require('../utils/logger')` and get the same pino
 * instance that the TypeScript entry uses (same config, same level).
 * esbuild bundles both this file and src/lib/logger.ts — they are kept
 * separate so CJS require() paths resolve without dynamic import().
 */

const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    "res.headers['set-cookie']",
  ],
  ...(process.env.NODE_ENV !== 'production'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

module.exports = logger;
