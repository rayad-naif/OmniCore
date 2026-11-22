// Writes one Traefik dynamic-configuration file per store (file provider watches the folder).
import fs from 'node:fs';
import path from 'node:path';

const HOST_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function validHostname(h) {
  return HOST_RE.test(String(h || '').toLowerCase());
}

/**
 * Builds the routing document for a store.
 * hostnames: every host that serves the store. acmeHosts: the subset that needs a
 * Let's Encrypt certificate (custom domains); the rest use Traefik's default certificate
 * (the platform's wildcard / Cloudflare origin certificate).
 */
export function routeConfig({
  id,
  hostnames,
  acmeHosts = [],
  suspended = false,
  tlsMode,
  parkedUrl,
}) {
  const hosts = [
    ...new Set(hostnames.map((h) => h.toLowerCase()).filter(validHostname)),
  ];
  const acme = new Set(acmeHosts.map((h) => h.toLowerCase()));
  const name = `store-${id}`;
  const service = suspended ? `${name}-parked` : name;
  const rule = (list) => list.map((h) => `Host(\`${h}\`)`).join(' || ');
  const routers = {};
  const platformHosts = hosts.filter((h) => !acme.has(h));
  const customHosts = hosts.filter((h) => acme.has(h));
  if (tlsMode === 'off') {
    if (hosts.length)
      routers[name] = { rule: rule(hosts), entryPoints: ['web'], service };
  } else if (tlsMode === 'acme-all') {
    // No wildcard certificate on this server: Let's Encrypt for every host.
    if (hosts.length)
      routers[name] = {
        rule: rule(hosts),
        entryPoints: ['websecure'],
        service,
        tls: { certResolver: 'le' },
      };
  } else {
    if (platformHosts.length)
      routers[name] = {
        rule: rule(platformHosts),
        entryPoints: ['websecure'],
        service,
        tls: {},
      };
    if (customHosts.length)
      routers[`${name}-custom`] = {
        rule: rule(customHosts),
        entryPoints: ['websecure'],
        service,
        tls: { certResolver: 'le' },
      };
  }
  const services = suspended
    ? {
        [service]: {
          loadBalancer: {
            passHostHeader: false,
            servers: [{ url: parkedUrl }],
          },
        },
      }
    : {
        [service]: {
          loadBalancer: {
            passHostHeader: true,
            servers: [{ url: `http://${name}:80` }],
          },
        },
      };
  return { http: { routers, services } };
}

export function writeRoute(dir, id, doc) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `store-${id}.yml`);
  const tmp = `${file}.tmp`;
  // JSON is valid YAML, so Traefik's file provider reads it as-is.
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
  fs.renameSync(tmp, file);
  return file;
}

export function removeRoute(dir, id) {
  fs.rmSync(path.join(dir, `store-${id}.yml`), { force: true });
}
