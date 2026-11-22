// Store lifecycle on the store host: provision, apply design, domains, suspend/resume,
// backup and delete. Every WordPress store is its own container (official image) with
// its own volume and its own database/user on the shared MariaDB container.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { docker, containerState } from './docker.mjs';
import {
  routeConfig,
  writeRoute,
  removeRoute,
  validHostname,
} from './traefik.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETUP_PHP = path.join(HERE, '..', 'wp', 'setup.php');

export const ID_RE = /^[a-z0-9][a-z0-9-]{5,62}$/;
const short = (id) => id.replace(/[^a-z0-9]/g, '').slice(0, 24);
const now = () => new Date().toISOString();

export class AgentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function createStoreManager(cfg) {
  for (const d of [
    cfg.dataDir,
    cfg.stateDir,
    cfg.jobsDir,
    cfg.backupsDir,
    cfg.routesDir,
    cfg.cacheDir,
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }

  // ── State (one JSON file per store; mode 600 because it holds the DB password) ──
  const statePath = (id) => path.join(cfg.stateDir, `${id}.json`);
  const load = (id) => {
    try {
      return JSON.parse(fs.readFileSync(statePath(id), 'utf8'));
    } catch {
      return null;
    }
  };
  const save = (st) => {
    st.updated_at = now();
    const tmp = `${statePath(st.id)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(st, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, statePath(st.id));
    return st;
  };
  const list = () =>
    fs
      .readdirSync(cfg.stateDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => load(f.slice(0, -5)))
      .filter(Boolean);

  // ── Jobs (one at a time per store, AGENT_MAX_JOBS overall) ──────────────────
  let running = 0;
  const queue = [];
  const busy = new Set();
  function enqueue(st, kind, fn) {
    if (busy.has(st.id))
      throw new AgentError(
        'Another operation is still running for this store',
        409,
      );
    busy.add(st.id);
    st.job = {
      kind,
      status: 'queued',
      step: 'queued',
      log: [],
      started_at: now(),
    };
    save(st);
    queue.push(async () => {
      const log = (step, msg = '') => {
        const cur = load(st.id) || st;
        cur.job = cur.job || { kind, log: [] };
        cur.job.status = 'running';
        cur.job.step = step;
        cur.job.log = [
          ...(cur.job.log || []),
          { at: now(), step, msg: String(msg).slice(0, 500) },
        ].slice(-60);
        save(cur);
      };
      try {
        await fn(log);
        const cur = load(st.id);
        if (cur) {
          cur.job = {
            ...cur.job,
            status: 'done',
            step: 'done',
            finished_at: now(),
          };
          save(cur);
        }
      } catch (err) {
        const cur = load(st.id) || st;
        cur.job = {
          ...(cur.job || {}),
          status: 'failed',
          error: String(err.message || err).slice(0, 2000),
          finished_at: now(),
        };
        if (kind === 'provision') cur.status = 'failed';
        save(cur);
      } finally {
        busy.delete(st.id);
      }
    });
    pump();
  }
  function pump() {
    while (running < cfg.maxConcurrentJobs && queue.length) {
      const next = queue.shift();
      running += 1;
      next().finally(() => {
        running -= 1;
        pump();
      });
    }
  }

  // Jobs interrupted by a restart are reported as failed so OmniCore can retry them.
  for (const st of list()) {
    if (st.job && ['queued', 'running'].includes(st.job.status)) {
      st.job = {
        ...st.job,
        status: 'failed',
        error: 'Interrupted by an agent restart',
      };
      if (st.status === 'provisioning') st.status = 'failed';
      save(st);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const scheme = () => (cfg.tlsMode === 'off' ? 'http' : 'https');
  const container = (st) => `store-${st.id}`;
  const volume = (st) => `store_${short(st.id)}_wp`;
  const configExtra = [
    "define('WP_MEMORY_LIMIT', '256M');",
    "define('FS_METHOD', 'direct');",
    "define('WP_AUTO_UPDATE_CORE', 'minor');",
    "define('WP_POST_REVISIONS', 10);",
    "define('DISALLOW_FILE_EDIT', true);",
    // The agent runs WP-Cron every minute (see runCron); no loopback requests from visitors.
    "define('DISABLE_WP_CRON', true);",
  ].join('\n');

  function dbEnv(st) {
    return [
      '-e',
      `WORDPRESS_DB_HOST=${cfg.dbContainer}:3306`,
      '-e',
      `WORDPRESS_DB_NAME=${st.db.name}`,
      '-e',
      `WORDPRESS_DB_USER=${st.db.user}`,
      '-e',
      `WORDPRESS_DB_PASSWORD=${st.db.password}`,
      '-e',
      `WORDPRESS_CONFIG_EXTRA=${configExtra}`,
    ];
  }

  async function sql(statement) {
    await docker(
      [
        'exec',
        '-i',
        '-e',
        `MYSQL_PWD=${cfg.dbRootPassword}`,
        cfg.dbContainer,
        'mariadb',
        '-uroot',
      ],
      {
        input: statement,
      },
    );
  }

  /** Runs WP-CLI against the store's files and database. */
  async function wp(
    st,
    args,
    { extraEnv = [], writableBackup = false, asRoot = false } = {},
  ) {
    const jobDir = path.join(cfg.jobsDir, st.id);
    fs.mkdirSync(jobDir, { recursive: true });
    const mounts = [
      '-v',
      `${cfg.cacheDir}:/cache:ro`,
      '-v',
      `${jobDir}:/job:ro`,
    ];
    if (writableBackup) mounts.push('-v', `${cfg.backupsDir}:/backup`);
    return docker([
      'run',
      '--rm',
      '--network',
      cfg.network,
      '--volumes-from',
      container(st),
      '--user',
      asRoot ? '0:0' : '33:33',
      ...dbEnv(st),
      '-e',
      'HOME=/tmp',
      '-e',
      'WP_CLI_CACHE_DIR=/tmp/wp-cli-cache',
      ...extraEnv,
      ...cfg.extraHosts.flatMap((h) => ['--add-host', h]),
      ...mounts,
      cfg.wpCliImage,
      'wp',
      ...args,
      '--path=/var/www/html',
      ...(asRoot ? ['--allow-root'] : []),
    ]);
  }

  async function runSetup(st, spec, log) {
    const jobDir = path.join(cfg.jobsDir, st.id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.copyFileSync(SETUP_PHP, path.join(jobDir, 'setup.php'));
    fs.writeFileSync(path.join(jobDir, 'spec.json'), JSON.stringify(spec), {
      mode: 0o644,
    });
    try {
      const out = await wp(st, ['eval-file', '/job/setup.php'], {
        extraEnv: ['-e', 'OC_SPEC=/job/spec.json'],
      });
      const line = out
        .split('\n')
        .find((l) => l.startsWith('OMNICORE_RESULT:'));
      if (!line)
        throw new AgentError(
          `Store setup did not finish: ${out.trim().split('\n').slice(-3).join(' ')}`,
          500,
        );
      const result = JSON.parse(line.slice('OMNICORE_RESULT:'.length));
      log('setup', `applied (${result.summary || 'ok'})`);
      return result;
    } finally {
      // The spec can hold the OmniCore connection secret; do not leave it on disk.
      fs.rmSync(path.join(jobDir, 'spec.json'), { force: true });
    }
  }

  function writeStoreRoute(st) {
    writeRoute(
      cfg.routesDir,
      st.id,
      routeConfig({
        id: st.id,
        hostnames: st.hostnames,
        acmeHosts: st.acme_hosts || [],
        suspended: st.status === 'suspended',
        tlsMode: cfg.tlsMode,
        parkedUrl: cfg.parkedUrl,
      }),
    );
  }

  function checkHosts(hostnames, primary, selfId) {
    const hosts = [
      ...new Set((hostnames || []).map((h) => String(h).toLowerCase().trim())),
    ];
    if (!hosts.length || hosts.some((h) => !validHostname(h)))
      throw new AgentError('Invalid hostnames');
    const p = String(primary || hosts[0]).toLowerCase();
    if (!hosts.includes(p))
      throw new AgentError('The primary hostname must be one of the hostnames');
    for (const other of list()) {
      if (other.status === 'deleted') continue;
      if (
        other.hostnames?.some((h) => hosts.includes(h)) &&
        other.id !== selfId
      )
        throw new AgentError(
          'A hostname is already used by another store',
          409,
        );
    }
    return { hosts, primary: p };
  }

  // ── Operations ─────────────────────────────────────────────────────────────
  function provision(body) {
    const id = String(body.id || '');
    if (!ID_RE.test(id)) throw new AgentError('Invalid store id');
    const existing = load(id);
    if (existing && !['failed', 'deleted'].includes(existing.status))
      throw new AgentError('This store already exists on this host', 409);
    const { hosts, primary } = checkHosts(body.hostnames, body.primary, id);
    const admin = body.admin || {};
    if (!/^[a-z0-9_.-]{3,60}$/i.test(admin.user || ''))
      throw new AgentError('Invalid admin user name');
    if (!admin.email || !admin.password)
      throw new AgentError('Admin email and password are required');
    if (!fs.existsSync(path.join(cfg.cacheDir, 'woocommerce.zip')))
      throw new AgentError(
        'woocommerce.zip is missing from the agent cache',
        500,
      );

    const st = save({
      id,
      status: 'provisioning',
      hostnames: hosts,
      primary,
      acme_hosts: (body.acme_hosts || [])
        .map((h) => String(h).toLowerCase())
        .filter((h) => hosts.includes(h)),
      admin_user: admin.user,
      db: existing?.db || {
        name: `wp_${short(id)}`.slice(0, 60),
        user: `u_${short(id)}`.slice(0, 30),
        password: crypto.randomBytes(18).toString('hex'),
      },
      created_at: existing?.created_at || now(),
      result: null,
    });

    const retry = Boolean(existing);
    enqueue(st, 'provision', async (log) => {
      const s = load(id);
      if (retry) {
        log('cleanup', 'removing what the previous attempt left behind');
        await docker(['rm', '-f', container(s)]).catch(() => {});
        await docker(['volume', 'rm', '-f', volume(s)]).catch(() => {});
        await sql(`DROP DATABASE IF EXISTS \`${s.db.name}\`;`);
      }
      log('database', 'creating database');
      await sql(
        `CREATE DATABASE IF NOT EXISTS \`${s.db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n` +
          `CREATE USER IF NOT EXISTS '${s.db.user}'@'%' IDENTIFIED BY '${s.db.password}';\n` +
          `ALTER USER '${s.db.user}'@'%' IDENTIFIED BY '${s.db.password}';\n` +
          `GRANT ALL PRIVILEGES ON \`${s.db.name}\`.* TO '${s.db.user}'@'%';\nFLUSH PRIVILEGES;`,
      );

      log('container', 'starting WordPress');
      await docker(['rm', '-f', container(s)]).catch(() => {});
      await docker(['volume', 'create', volume(s)]);
      await docker([
        'run',
        '-d',
        '--name',
        container(s),
        '--network',
        cfg.network,
        '--restart',
        'unless-stopped',
        '--memory',
        cfg.storeMemory,
        '--cpus',
        String(cfg.storeCpus),
        '--label',
        'omnicore.store=1',
        '--label',
        `omnicore.store.id=${s.id}`,
        ...cfg.extraHosts.flatMap((h) => ['--add-host', h]),
        '-v',
        `${volume(s)}:/var/www/html`,
        ...dbEnv(s),
        cfg.wpImage,
      ]);
      for (let i = 0; i < 90; i += 1) {
        try {
          await docker([
            'exec',
            container(s),
            'test',
            '-f',
            '/var/www/html/wp-config.php',
          ]);
          break;
        } catch {
          if (i === 89)
            throw new AgentError('WordPress files did not appear in time', 500);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      log('install', 'installing WordPress');
      const url = `${scheme()}://${s.primary}`;
      let installed = false;
      for (let i = 0; i < 20 && !installed; i += 1) {
        try {
          await wp(s, ['core', 'is-installed']);
          installed = true;
        } catch {
          try {
            await wp(s, [
              'core',
              'install',
              `--url=${url}`,
              `--title=${String(body.title || 'My store').slice(0, 120)}`,
              `--admin_user=${admin.user}`,
              `--admin_password=${admin.password}`,
              `--admin_email=${admin.email}`,
              '--skip-email',
            ]);
            installed = true;
          } catch (err) {
            if (i === 19) throw err;
            await new Promise((r) => setTimeout(r, 2000)); // database still starting
          }
        }
      }

      log('plugins', 'installing WooCommerce and the OmniCore plugin');
      await wp(s, [
        'plugin',
        'install',
        '/cache/woocommerce.zip',
        '--activate',
        '--force',
      ]);
      if (fs.existsSync(path.join(cfg.cacheDir, 'omnicore-commerce.zip')))
        await wp(s, [
          'plugin',
          'install',
          '/cache/omnicore-commerce.zip',
          '--activate',
          '--force',
        ]);
      await wp(s, ['plugin', 'delete', 'hello', 'akismet']).catch(() => {});
      if (fs.existsSync(path.join(cfg.cacheDir, 'storefront.zip')))
        await wp(s, [
          'theme',
          'install',
          '/cache/storefront.zip',
          '--activate',
          '--force',
        ]);
      await wp(s, ['plugin', 'auto-updates', 'enable', '--all']).catch(
        () => {},
      );
      await wp(s, ['theme', 'auto-updates', 'enable', '--all']).catch(() => {});

      log('design', 'applying the store design and content');
      const result = await runSetup(
        s,
        { ...(body.spec || {}), mode: 'install', admin_user: admin.user },
        log,
      );

      log('routing', `publishing ${s.hostnames.join(', ')}`);
      const done = load(id);
      done.status = 'active';
      done.result = {
        site_url: url,
        admin_user: admin.user,
        wc_consumer_key: result.wc_consumer_key,
        wc_consumer_secret: result.wc_consumer_secret,
        wp_version: result.wp_version,
        wc_version: result.wc_version,
      };
      save(done);
      writeStoreRoute(done);
    });
    return publicState(load(id));
  }

  function applyDesign(id, body) {
    const st = must(id);
    if (st.status !== 'active')
      throw new AgentError(
        'The store must be active to change its design',
        409,
      );
    enqueue(st, 'apply', async (log) => {
      await runSetup(
        load(id),
        {
          ...(body.spec || {}),
          mode: body.mode || 'design',
          admin_user: st.admin_user,
        },
        log,
      );
    });
    return publicState(load(id));
  }

  function setDomains(id, body) {
    const st = must(id);
    if (!['active', 'suspended'].includes(st.status))
      throw new AgentError('The store is not ready', 409);
    const { hosts, primary } = checkHosts(body.hostnames, body.primary, id);
    const oldPrimary = st.primary;
    st.hostnames = hosts;
    st.acme_hosts = (body.acme_hosts || [])
      .map((h) => String(h).toLowerCase())
      .filter((h) => hosts.includes(h));
    save(st);
    writeStoreRoute(st);
    if (primary !== oldPrimary) {
      enqueue(st, 'domains', async (log) => {
        log('urls', `moving the site from ${oldPrimary} to ${primary}`);
        const s = load(id);
        await wp(s, [
          'search-replace',
          `${scheme()}://${oldPrimary}`,
          `${scheme()}://${primary}`,
          '--all-tables-with-prefix',
          '--skip-columns=guid',
          '--quiet',
        ]);
        await wp(s, ['option', 'update', 'home', `${scheme()}://${primary}`]);
        await wp(s, [
          'option',
          'update',
          'siteurl',
          `${scheme()}://${primary}`,
        ]);
        const cur = load(id);
        cur.primary = primary;
        if (cur.result) cur.result.site_url = `${scheme()}://${primary}`;
        save(cur);
      });
    }
    return publicState(load(id));
  }

  async function suspend(id) {
    const st = must(id);
    if (st.status !== 'active')
      throw new AgentError('Only an active store can be suspended', 409);
    st.status = 'suspended';
    save(st);
    writeStoreRoute(st);
    await docker(['stop', container(st)]).catch(() => {});
    return publicState(st);
  }

  async function resume(id) {
    const st = must(id);
    if (st.status !== 'suspended')
      throw new AgentError('The store is not suspended', 409);
    await docker(['start', container(st)]);
    st.status = 'active';
    save(st);
    writeStoreRoute(st);
    return publicState(st);
  }

  async function backupNow(st, log = () => {}) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `${st.id}-${stamp}`;
    log('backup', 'exporting the database');
    // Root inside the throw-away CLI container: the backup folder belongs to the agent (root).
    await wp(st, ['db', 'export', `/backup/${base}.sql`, '--quiet'], {
      writableBackup: true,
      asRoot: true,
    });
    const sqlFile = path.join(cfg.backupsDir, `${base}.sql`);
    await pipeline(
      fs.createReadStream(sqlFile),
      zlib.createGzip(),
      fs.createWriteStream(`${sqlFile}.gz`),
    );
    fs.rmSync(sqlFile, { force: true });
    log('backup', 'archiving uploads, themes and plugins');
    await docker([
      'run',
      '--rm',
      '--volumes-from',
      container(st),
      '-v',
      `${cfg.backupsDir}:/backup`,
      '--user',
      '0',
      cfg.wpCliImage,
      'tar',
      'czf',
      `/backup/${base}-files.tar.gz`,
      '-C',
      '/var/www/html',
      'wp-content',
    ]);
    return { database: `${base}.sql.gz`, files: `${base}-files.tar.gz` };
  }

  function backup(id) {
    const st = must(id);
    if (!['active', 'suspended'].includes(st.status))
      throw new AgentError('The store is not ready', 409);
    enqueue(st, 'backup', async (log) => {
      const files = await backupNow(load(id), log);
      const cur = load(id);
      cur.last_backup = { at: now(), ...files };
      save(cur);
    });
    return publicState(load(id));
  }

  function remove(id, body = {}) {
    const st = must(id);
    if (st.status === 'deleted') return publicState(st);
    enqueue(st, 'delete', async (log) => {
      const s = load(id);
      removeRoute(cfg.routesDir, id);
      if (
        body.backup !== false &&
        (await containerState(container(s))) !== 'missing'
      ) {
        if ((await containerState(container(s))) !== 'running')
          await docker(['start', container(s)]).catch(() => {});
        // Never delete without the final backup (send {backup: false} to skip it deliberately).
        await backupNow(s, log);
      }
      log('delete', 'removing the container, files and database');
      await docker(['rm', '-f', container(s)]).catch(() => {});
      await docker(['volume', 'rm', '-f', volume(s)]).catch(() => {});
      await sql(
        `DROP DATABASE IF EXISTS \`${s.db.name}\`;\nDROP USER IF EXISTS '${s.db.user}'@'%';`,
      );
      const cur = load(id);
      cur.status = 'deleted';
      cur.deleted_at = now();
      save(cur);
    });
    return publicState(load(id));
  }

  function must(id) {
    if (!ID_RE.test(String(id))) throw new AgentError('Invalid store id');
    const st = load(id);
    if (!st) throw new AgentError('Unknown store', 404);
    return st;
  }

  function publicState(st) {
    if (!st) return null;
    return {
      id: st.id,
      status: st.status,
      hostnames: st.hostnames,
      primary: st.primary,
      job: st.job
        ? {
            kind: st.job.kind,
            status: st.job.status,
            step: st.job.step,
            error: st.job.error,
            log: st.job.log,
          }
        : null,
      result: st.result,
      last_backup: st.last_backup || null,
      created_at: st.created_at,
      updated_at: st.updated_at,
    };
  }

  async function status(id) {
    const st = must(id);
    const out = publicState(st);
    out.container = await containerState(container(st));
    return out;
  }

  // Nightly backups of active stores, keeping BACKUP_KEEP_DAYS days.
  async function nightly() {
    const day = new Date().toISOString().slice(0, 10);
    for (const st of list()) {
      if (st.status !== 'active' || st.last_nightly === day || busy.has(st.id))
        continue;
      try {
        const files = await backupNow(st);
        const cur = load(st.id);
        cur.last_nightly = day;
        cur.last_backup = { at: now(), ...files };
        save(cur);
      } catch (err) {
        console.error(`[backup] ${st.id}: ${err.message}`);
      }
    }
    const cutoff = Date.now() - cfg.backupKeepDays * 86400000;
    for (const f of fs.readdirSync(cfg.backupsDir)) {
      const p = path.join(cfg.backupsDir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    }
  }

  // WP-Cron (scheduled emails, Action Scheduler, WooCommerce jobs) for every active store.
  let cronRunning = false;
  async function runCron() {
    if (cronRunning) return;
    cronRunning = true;
    try {
      for (const st of list()) {
        if (st.status !== 'active' || busy.has(st.id)) continue;
        await docker(
          [
            'exec',
            '-u',
            'www-data',
            container(st),
            'php',
            '/var/www/html/wp-cron.php',
          ],
          {
            timeout: 120000,
          },
        ).catch(() => {});
      }
    } finally {
      cronRunning = false;
    }
  }

  return {
    provision,
    applyDesign,
    setDomains,
    suspend,
    resume,
    backup,
    remove,
    status,
    list,
    publicState,
    nightly,
    runCron,
  };
}
