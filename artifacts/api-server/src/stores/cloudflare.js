'use strict';

/**
 * stores/cloudflare.js — optional Cloudflare for SaaS custom hostnames.
 *
 * With CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID set (the zone that serves the store
 * domain, with Cloudflare for SaaS enabled and a fallback origin pointing at the store
 * server), each custom domain is registered as a custom hostname: Cloudflare issues the
 * edge certificate and the customer only adds a CNAME (plus the TXT record if asked).
 * Without them, customers point DNS straight at the store server and the server's
 * Traefik gets a Let's Encrypt certificate.
 */

const BASE = 'https://api.cloudflare.com/client/v4';

const configured = () =>
  Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID);

async function cf(method, path, body) {
  const res = await fetch(
    `${BASE}/zones/${process.env.CLOUDFLARE_ZONE_ID}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg =
      json.errors?.map((e) => e.message).join('; ') ||
      `Cloudflare API error ${res.status}`;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return json.result;
}

/** Shape the parts the dashboard needs: status and the DNS records to add. */
function describe(r) {
  const records = [];
  if (r.ownership_verification?.name)
    records.push({
      type: r.ownership_verification.type?.toUpperCase() || 'TXT',
      name: r.ownership_verification.name,
      value: r.ownership_verification.value,
      purpose: 'ownership',
    });
  for (const v of r.ssl?.validation_records || []) {
    if (v.txt_name)
      records.push({
        type: 'TXT',
        name: v.txt_name,
        value: v.txt_value,
        purpose: 'certificate',
      });
  }
  return {
    id: r.id,
    status: r.status,
    ssl_status: r.ssl?.status || null,
    records,
    errors: [
      ...(r.verification_errors || []),
      ...(r.ssl?.validation_errors || []).map((e) => e.message),
    ].filter(Boolean),
  };
}

async function createHostname(hostname) {
  return describe(
    await cf('POST', '/custom_hostnames', {
      hostname,
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
    }),
  );
}

async function getHostname(id) {
  return describe(
    await cf('GET', `/custom_hostnames/${encodeURIComponent(id)}`),
  );
}

async function deleteHostname(id) {
  await cf('DELETE', `/custom_hostnames/${encodeURIComponent(id)}`).catch(
    () => {},
  );
}

module.exports = { configured, createHostname, getHostname, deleteHostname };
