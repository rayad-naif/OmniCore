'use strict';

/**
 * hrms/core/mongoose.js
 * Workspace-aware drop-in for `require('mongoose')` used by the HRMS module.
 *
 * Isolation model: one MongoDB database per OmniCore workspace
 * (`hrms_<workspace id without dashes>`), all sharing a single connection pool
 * to HRMS_MONGODB_URI via `connection.useDb()`.
 *
 * The HRMS code was written for a single company and does
 *   const User = mongoose.model('User', userSchema);  ...  User.find(...)
 * Here `mongoose.model()` registers the schema and returns a proxy. Every use
 * of the proxy (statics, `new User()`, instanceof) resolves to the model
 * compiled on the CURRENT workspace's database, taken from the request's
 * AsyncLocalStorage context (core/context.js). Code that runs without a
 * workspace context throws instead of touching another workspace's data.
 */

const realMongoose = require('mongoose');
const logger = require('../../utils/logger');
const { requireTenantId } = require('./context');

const registry = new Map(); // model name -> Schema
const proxies = new Map(); // model name -> proxy
const tenantConns = new Map(); // workspace id -> Connection
const registerHooks = [];
let registryVersion = 0;
let base = null;

function mongoUri() {
  return process.env.HRMS_MONGODB_URI || '';
}

function isConfigured() {
  return Boolean(mongoUri());
}

function notConfiguredError() {
  const err = new Error(
    'The HR module database is not configured. Set HRMS_MONGODB_URI on the server.',
  );
  err.statusCode = 503;
  return err;
}

function baseConnection() {
  if (!isConfigured()) throw notConfiguredError();
  if (!base) {
    base = realMongoose.createConnection(mongoUri(), {
      maxPoolSize: Number(process.env.HRMS_MONGODB_POOL_SIZE) || 10,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
    });
    base.on('connected', () => logger.info('hrms_mongodb_connected'));
    base.on('error', (err) =>
      logger.error({ err: err.message }, 'hrms_mongodb_error'),
    );
    base.on('disconnected', () => logger.warn('hrms_mongodb_disconnected'));
  }
  return base;
}

/** Database name for a workspace (≤ 38 chars, safe on MongoDB Atlas). */
function dbNameFor(tenantId) {
  const prefix = process.env.HRMS_DB_PREFIX || 'hrms_';
  const id = String(tenantId)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!id) throw new Error('HRMS: invalid workspace id');
  return `${prefix}${id}`.slice(0, 38);
}

function tenantConnection(tenantId) {
  const key = String(tenantId);
  let conn = tenantConns.get(key);
  if (!conn) {
    conn = baseConnection().useDb(dbNameFor(key), { useCache: true });
    tenantConns.set(key, conn);
  }
  if (conn.__hrmsRegistryVersion !== registryVersion) {
    // Compile every known schema on this database so populate() can resolve
    // refs ('User', 'Department', …) inside the same workspace.
    for (const [name, schema] of registry) {
      if (!conn.models[name]) conn.model(name, schema);
    }
    conn.__hrmsRegistryVersion = registryVersion;
  }
  return conn;
}

function modelFor(name, tenantId = requireTenantId()) {
  const conn = tenantConnection(tenantId);
  return conn.models[name] || conn.model(name, registry.get(name));
}

function registerSchema(name, schema) {
  const existing = registry.get(name);
  if (existing) {
    if (existing !== schema) {
      logger.warn({ model: name }, 'hrms_model_registered_twice_keeping_first');
    }
    return;
  }
  for (const hook of registerHooks) hook(name, schema);
  registry.set(name, schema);
  registryVersion += 1;
}

/** Lets other HRMS core modules attach schema hooks before compilation. */
function onRegister(hook) {
  registerHooks.push(hook);
  for (const [name, schema] of registry) hook(name, schema);
}

function tenantModel(name) {
  if (proxies.has(name)) return proxies.get(name);
  const resolve = () => modelFor(name);
  const target = function HrmsTenantModel() {};
  const proxy = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'modelName') return name;
      if (prop === 'schema') return registry.get(name);
      const M = resolve();
      const value = Reflect.get(M, prop, M);
      if (typeof value === 'function' && typeof prop === 'string') {
        // Model statics (find, create, aggregate, custom statics…) need `this`
        // to be the compiled model; constructors such as M.Query do not.
        return /^[A-Z]/.test(prop) ? value : value.bind(M);
      }
      return value;
    },
    set(_t, prop, value) {
      resolve()[prop] = value;
      return true;
    },
    has(_t, prop) {
      return prop in resolve();
    },
    construct(_t, args) {
      const M = resolve();
      return new M(...args);
    },
    apply(_t, thisArg, args) {
      return Reflect.apply(resolve(), thisArg, args);
    },
  });
  proxies.set(name, proxy);
  return proxy;
}

function missingSchema(name) {
  const err = new Error(`HRMS model "${name}" has not been registered`);
  err.name = 'MissingSchemaError';
  return err;
}

const modelsView = new Proxy(
  {},
  {
    get: (_t, name) =>
      typeof name === 'string' && registry.has(name)
        ? tenantModel(name)
        : undefined,
    has: (_t, name) => registry.has(name),
    ownKeys: () => [...registry.keys()],
    getOwnPropertyDescriptor: (_t, name) =>
      registry.has(name)
        ? { enumerable: true, configurable: true, value: tenantModel(name) }
        : undefined,
  },
);

function model(name, schema) {
  if (schema) registerSchema(name, schema);
  else if (!registry.has(name)) throw missingSchema(name);
  return tenantModel(name);
}

const shim = new Proxy(realMongoose, {
  get(target, prop) {
    switch (prop) {
      case 'model':
        return model;
      case 'models':
        return modelsView;
      case 'connection':
        return tenantConnection(requireTenantId());
      case '__hrms':
        return internals;
      case 'connect':
      case 'createConnection':
        return () => {
          throw new Error('HRMS: use the shared workspace connection');
        };
      default:
        return Reflect.get(target, prop, target);
    }
  },
});

/** Drops every HRMS collection of one workspace (super admin "delete data"). */
async function dropTenantDatabase(tenantId) {
  const conn = tenantConnection(tenantId);
  await conn.dropDatabase();
  tenantConns.delete(String(tenantId));
}

/** Storage statistics for the super admin console. */
async function tenantDatabaseStats(tenantId) {
  const conn = tenantConnection(tenantId);
  await conn.asPromise();
  const stats = await conn.db.stats();
  return {
    database: conn.name,
    collections: stats.collections,
    objects: stats.objects,
    dataSize: stats.dataSize,
    storageSize: stats.storageSize,
  };
}

async function ping() {
  const conn = baseConnection();
  await conn.asPromise();
  await conn.db.admin().ping();
  return true;
}

async function closeAll() {
  if (base) await base.close().catch(() => {});
  base = null;
  tenantConns.clear();
}

const internals = {
  isConfigured,
  dbNameFor,
  tenantConnection,
  modelFor,
  onRegister,
  registeredModels: () => [...registry.keys()],
  dropTenantDatabase,
  tenantDatabaseStats,
  ping,
  closeAll,
};

module.exports = shim;
