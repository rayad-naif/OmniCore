#!/usr/bin/env node
// OmniCore store agent: an authenticated HTTP API on the store host that creates and
// manages WordPress + WooCommerce stores in Docker. OmniCore is the only client.
//
//   GET    /v1/health
//   GET    /v1/stores                      all stores on this host
//   POST   /v1/stores                      provision {id, hostnames, primary, acme_hosts, title, admin, spec}
//   GET    /v1/stores/:id                  status, current job and result
//   POST   /v1/stores/:id/apply            re-apply design {spec, mode}
//   PUT    /v1/stores/:id/domains          {hostnames, primary, acme_hosts}
//   POST   /v1/stores/:id/suspend|resume|backup
//   DELETE /v1/stores/:id                  {backup: true}
//   any other path                         page shown for suspended stores (no auth)
import http from 'node:http';
import fs from 'node:fs';
import { loadConfig, AGENT_VERSION } from './config.mjs';
import { verifyRequest } from './auth.mjs';
import { createStoreManager, AgentError } from './stores.mjs';
import { docker } from './docker.mjs';

const PARKED_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Store unavailable</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.4rem}p{color:#475569}</style></head>
<body><main><h1>This store is temporarily unavailable</h1><p>Please check back soon.</p></main></body></html>`;

export function createServer(cfg, manager) {
  const seen = new Map();
  const send = (res, status, body) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://agent');
    // Suspended stores are routed here by Traefik with the visitor's own path:
    // everything outside the signed /v1/ API is the "temporarily unavailable" page.
    if (!url.pathname.startsWith('/v1/')) {
      res.writeHead(503, {
        'Content-Type': 'text/html; charset=utf-8',
        'Retry-After': '3600',
      });
      return res.end(PARKED_HTML);
    }

    // Behind Traefik (loopback or the Docker bridge) the client is the last X-Forwarded-For hop;
    // a direct connection is never allowed to choose its own address.
    const remote = String(req.socket.remoteAddress || '').replace(
      /^::ffff:/,
      '',
    );
    const viaProxy =
      /^(127\.|172\.(1[6-9]|2\d|3[01])\.)/.test(remote) || remote === '::1';
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const ip =
      viaProxy && forwarded.length ? forwarded[forwarded.length - 1] : remote;
    if (cfg.allowIps.length && !cfg.allowIps.includes(ip))
      return send(res, 403, { error: 'Not allowed' });

    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2 * 1024 * 1024)
        return send(res, 413, { error: 'Body too large' });
    }
    const problem = verifyRequest({
      secret: cfg.secret,
      header: req.headers['x-omnicore-agent-signature'],
      method: req.method,
      path: url.pathname + url.search,
      body,
      seen,
    });
    if (problem) return send(res, 401, { error: `Unauthorized: ${problem}` });

    let json = {};
    try {
      json = body ? JSON.parse(body) : {};
    } catch {
      return send(res, 400, { error: 'Invalid JSON' });
    }

    try {
      const parts = url.pathname.split('/').filter(Boolean); // v1, stores, :id, action
      if (parts[0] !== 'v1') return send(res, 404, { error: 'Not found' });
      if (parts[1] === 'health' && req.method === 'GET')
        return send(res, 200, await health(cfg, manager));
      if (parts[1] !== 'stores') return send(res, 404, { error: 'Not found' });
      const [, , id, action] = parts;
      if (!id) {
        if (req.method === 'GET')
          return send(res, 200, {
            stores: manager.list().map(manager.publicState),
          });
        if (req.method === 'POST')
          return send(res, 202, manager.provision(json));
      } else if (!action) {
        if (req.method === 'GET')
          return send(res, 200, await manager.status(id));
        if (req.method === 'DELETE')
          return send(res, 202, manager.remove(id, json));
      } else if (req.method === 'POST' && action === 'apply')
        return send(res, 202, manager.applyDesign(id, json));
      else if (req.method === 'PUT' && action === 'domains')
        return send(res, 200, manager.setDomains(id, json));
      else if (req.method === 'POST' && action === 'suspend')
        return send(res, 200, await manager.suspend(id));
      else if (req.method === 'POST' && action === 'resume')
        return send(res, 200, await manager.resume(id));
      else if (req.method === 'POST' && action === 'backup')
        return send(res, 202, manager.backup(id));
      return send(res, 404, { error: 'Not found' });
    } catch (err) {
      const status = err instanceof AgentError ? err.status : 500;
      if (status >= 500) console.error(err);
      return send(res, status, { error: err.message || 'Agent error' });
    }
  });
}

async function health(cfg, manager) {
  let dockerOk = false;
  let dockerVersion = null;
  try {
    dockerVersion = (
      await docker(['version', '--format', '{{.Server.Version}}'])
    ).trim();
    dockerOk = true;
  } catch {}
  let disk = null;
  try {
    const s = fs.statfsSync(cfg.dataDir);
    disk = { free_bytes: s.bavail * s.bsize, total_bytes: s.blocks * s.bsize };
  } catch {}
  const stores = manager.list();
  const count = (st) => stores.filter((s) => s.status === st).length;
  return {
    ok: dockerOk && Boolean(cfg.secret),
    version: AGENT_VERSION,
    docker: dockerVersion,
    tls_mode: cfg.tlsMode,
    cache: {
      woocommerce: fs.existsSync(`${cfg.cacheDir}/woocommerce.zip`),
      storefront: fs.existsSync(`${cfg.cacheDir}/storefront.zip`),
      omnicore_plugin: fs.existsSync(`${cfg.cacheDir}/omnicore-commerce.zip`),
    },
    stores: {
      active: count('active'),
      suspended: count('suspended'),
      provisioning: count('provisioning'),
      failed: count('failed'),
    },
    disk,
  };
}

// Run as a program (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  if (!cfg.secret || cfg.secret.length < 32) {
    console.error('AGENT_SECRET must be set (at least 32 characters).');
    process.exit(1);
  }
  const manager = createStoreManager(cfg);
  createServer(cfg, manager).listen(cfg.port, cfg.bind, () =>
    console.log(
      `OmniCore store agent ${AGENT_VERSION} listening on ${cfg.bind}:${cfg.port} (TLS mode ${cfg.tlsMode})`,
    ),
  );
  setInterval(
    () => manager.runCron().catch((e) => console.error(e)),
    60 * 1000,
  ).unref();
  // Nightly backups at BACKUP_HOUR_UTC.
  setInterval(
    () => {
      if (new Date().getUTCHours() === cfg.backupHourUtc)
        manager.nightly().catch((e) => console.error(e));
    },
    10 * 60 * 1000,
  ).unref();
}
