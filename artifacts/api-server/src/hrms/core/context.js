'use strict';

/**
 * hrms/core/context.js
 * Request-scoped workspace context for the HRMS module.
 *
 * Every HRMS request, job and socket event runs inside `runAsTenant(tenantId, fn)`.
 * The tenant-aware Mongoose models (core/mongoose.js) read the current
 * workspace from here, so the ported HRMS code can keep calling
 * `User.find(...)` and always hits that workspace's own database.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();

function runAsTenant(tenantId, fn, extra = {}) {
  if (!tenantId) throw new Error('HRMS: runAsTenant needs a workspace id');
  return als.run({ tenantId: String(tenantId), ...extra }, fn);
}

function currentContext() {
  return als.getStore() || null;
}

function currentTenantId() {
  return als.getStore()?.tenantId || null;
}

function requireTenantId() {
  const id = currentTenantId();
  if (!id) {
    const err = new Error('HRMS: no workspace context for this operation');
    err.statusCode = 400;
    throw err;
  }
  return id;
}

module.exports = { als, runAsTenant, currentContext, currentTenantId, requireTenantId };
