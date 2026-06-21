'use strict';

/**
 * verifyEnv — call once at process start before any server setup.
 * Exits with code 1 if any required variable is absent.
 */
function verifyEnv() {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'GEMINI_API_KEY'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`FATAL: Missing environment variable: ${key}`);
      process.exit(1);
    }
  }
}

module.exports = { verifyEnv };
