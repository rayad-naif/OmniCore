// Store-agent configuration (environment variables; deploy-store-host.sh writes them).
import fs from 'node:fs';
import path from 'node:path';

const env = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
};

function readSecretFile(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

export function loadConfig(overrides = {}) {
  const dataDir = env('STORES_DATA_DIR', '/var/lib/omnicore-stores');
  const cfg = {
    secret: env('AGENT_SECRET', ''),
    bind: env('AGENT_BIND', '0.0.0.0'),
    port: Number(env('AGENT_PORT', '8790')),
    allowIps: env('AGENT_ALLOW_IPS', '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dataDir,
    cacheDir: env('STORES_CACHE_DIR', path.join(dataDir, 'cache')),
    jobsDir: path.join(dataDir, 'jobs'),
    stateDir: path.join(dataDir, 'state'),
    backupsDir: env('STORES_BACKUP_DIR', path.join(dataDir, 'backups')),
    routesDir: env(
      'TRAEFIK_DYNAMIC_DIR',
      path.join(dataDir, 'traefik', 'dynamic'),
    ),
    network: env('STORES_NETWORK', 'omnicore-stores'),
    dbContainer: env('STORES_DB_CONTAINER', 'omnicore-stores-db'),
    dbRootPassword:
      env('STORES_DB_ROOT_PASSWORD', '') ||
      readSecretFile(
        env(
          'STORES_DB_ROOT_PASSWORD_FILE',
          '/etc/omnicore-stores/db-root-password',
        ),
      ),
    // The current WordPress release: new WooCommerce versions require it.
    wpImage: env('WP_IMAGE', 'wordpress:php8.3-apache'),
    wpCliImage: env('WPCLI_IMAGE', 'wordpress:cli-php8.3'),
    storeMemory: env('STORE_MEMORY', '512m'),
    storeCpus: env('STORE_CPUS', '1'),
    // "acme": HTTPS with the default (wildcard / Cloudflare origin) certificate for platform
    // sub-domains and Let's Encrypt for custom domains. "acme-all": Let's Encrypt for every
    // host. "off": plain HTTP (local testing only).
    tlsMode: env('TLS_MODE', 'acme'),
    // Where Traefik sends suspended stores (the agent's own /parked page).
    parkedUrl: env('PARKED_URL', 'http://host.docker.internal:8790'),
    // Extra /etc/hosts entries for store containers, e.g. "host.docker.internal:host-gateway".
    extraHosts: env('STORE_EXTRA_HOSTS', '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxConcurrentJobs: Number(env('AGENT_MAX_JOBS', '2')),
    backupKeepDays: Number(env('BACKUP_KEEP_DAYS', '14')),
    backupHourUtc: Number(env('BACKUP_HOUR_UTC', '3')),
    ...overrides,
  };
  return cfg;
}

export const AGENT_VERSION = '1.0.0';
