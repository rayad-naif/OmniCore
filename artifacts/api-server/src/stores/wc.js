'use strict';

/**
 * stores/wc.js — WooCommerce REST API (wc/v3) client.
 *
 * HTTPS sites use Basic auth with the consumer key/secret. Plain-HTTP sites use
 * one-legged OAuth 1.0a (HMAC-SHA256), signed exactly as WooCommerce verifies it
 * (WC_REST_Authentication::check_oauth_signature).
 */

const crypto = require('node:crypto');

class WcError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const rfc3986 = (s) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** OAuth 1.0a query parameters for `method url` with `params` (query string only). */
function oauthParams(method, url, params, key, secret, now = Date.now()) {
  const all = {
    ...params,
    oauth_consumer_key: key,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: String(Math.floor(now / 1000)),
  };
  const keys = Object.keys(all).sort();
  const pairs = keys.map((k) =>
    rfc3986(`${rfc3986(safeDecode(k))}=${rfc3986(safeDecode(String(all[k])))}`),
  );
  const base = `${method.toUpperCase()}&${rfc3986(url)}&${pairs.join('%26')}`;
  const signature = crypto
    .createHmac('sha256', `${secret}&`)
    .update(base)
    .digest('base64');
  return { ...all, oauth_signature: signature };
}

function normalizeSiteUrl(u) {
  let url;
  try {
    url = new URL(String(u || '').trim());
  } catch {
    throw new WcError(
      'Enter the full store address, e.g. https://shop.example.com',
      400,
    );
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new WcError('The store address must start with https://', 400);
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

/**
 * Calls the store. `conn` = { site_url, consumer_key, consumer_secret }.
 * Returns { data, headers, status }.
 */
async function request(
  conn,
  method,
  path,
  { query = {}, body, timeoutMs = 20000 } = {},
) {
  const base = normalizeSiteUrl(conn.site_url);
  const endpoint = `${base}/wp-json/wc/v3${path}`;
  const https = endpoint.startsWith('https:');
  const params = https
    ? query
    : oauthParams(
        method,
        endpoint,
        query,
        conn.consumer_key,
        conn.consumer_secret,
      );
  const qs = Object.entries(params)
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(String(v))}`)
    .join('&');
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'OmniCore-Stores/1.0',
  };
  if (https)
    headers.Authorization = `Basic ${Buffer.from(`${conn.consumer_key}:${conn.consumer_secret}`).toString('base64')}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(qs ? `${endpoint}?${qs}` : endpoint, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new WcError(
      `Could not reach the store (${err.cause?.code || err.message})`,
      502,
    );
  }
  if (res.status >= 300 && res.status < 400)
    throw new WcError(
      `The store redirected to ${res.headers.get('location') || 'another address'}; use the store's final address (including https://).`,
      400,
    );
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 404 && !data)
      throw new WcError(
        'The WooCommerce REST API was not found. Is WooCommerce active and are permalinks enabled?',
        400,
      );
    if (res.status === 401 || res.status === 403)
      throw new WcError(
        `WooCommerce refused the API key (${data?.message || res.status}). Create a Read/Write key in WooCommerce → Settings → Advanced → REST API.`,
        400,
      );
    throw new WcError(
      data?.message || `WooCommerce returned HTTP ${res.status}`,
      502,
    );
  }
  return { data, headers: res.headers, status: res.status };
}

const total = (headers) => Number(headers.get('x-wp-total') || 0);

/** Verifies the key and returns basic store facts. */
async function probe(conn) {
  const cur = await request(conn, 'GET', '/data/currencies/current');
  const products = await request(conn, 'GET', '/products', {
    query: { per_page: 1 },
  });
  const orders = await request(conn, 'GET', '/orders', {
    query: { per_page: 1 },
  });
  return {
    currency: String(cur.data?.code || '').toLowerCase() || null,
    products: total(products.headers),
    orders: total(orders.headers),
  };
}

async function listOrders(
  conn,
  { page = 1, perPage = 50, modifiedAfter } = {},
) {
  const query = { page, per_page: perPage, orderby: 'modified', order: 'asc' };
  if (modifiedAfter)
    query.modified_after = new Date(modifiedAfter).toISOString().slice(0, 19);
  const r = await request(conn, 'GET', '/orders', { query });
  return {
    orders: r.data || [],
    totalPages: Number(r.headers.get('x-wp-totalpages') || 1),
  };
}

async function counts(conn) {
  const [products, customers] = await Promise.all([
    request(conn, 'GET', '/products', { query: { per_page: 1 } }),
    request(conn, 'GET', '/customers', {
      query: { per_page: 1, role: 'all' },
    }).catch(() => null),
  ]);
  return {
    products: total(products.headers),
    customers: customers ? total(customers.headers) : null,
  };
}

async function createWebhook(conn, { name, topic, deliveryUrl, secret }) {
  const r = await request(conn, 'POST', '/webhooks', {
    body: {
      name,
      topic,
      delivery_url: deliveryUrl,
      secret,
      status: 'active',
      api_version: 'wp_api_v3',
    },
  });
  return r.data?.id;
}

async function deleteWebhook(conn, id) {
  await request(conn, 'DELETE', `/webhooks/${Number(id)}`, {
    query: { force: true },
  }).catch(() => {});
}

/** X-WC-Webhook-Signature = base64(HMAC-SHA256(raw body, secret)). */
function verifyWebhook(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  WcError,
  request,
  probe,
  listOrders,
  counts,
  createWebhook,
  deleteWebhook,
  verifyWebhook,
  oauthParams,
  normalizeSiteUrl,
};
