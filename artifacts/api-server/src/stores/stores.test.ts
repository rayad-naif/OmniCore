import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The store agent is plain ESM without type declarations: load it untyped.
const AGENT_AUTH = '../../../store-agent/src/auth.mjs';
const AGENT_TRAEFIK = '../../../store-agent/src/traefik.mjs';

const wc = require('./wc.js');
const design = require('./design.js');
const agentClient = require('./agentClient.js');
const { zipDirectory, crc32 } = require('./zip.js');

/** Port of WC_REST_Authentication::check_oauth_signature (WooCommerce 11). */
function wooVerifies(
  method: string,
  url: string,
  params: Record<string, string>,
  secret: string,
) {
  const rfc = (s: string) =>
    encodeURIComponent(s).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const consumer = params.oauth_signature;
  const rest = { ...params };
  delete rest.oauth_signature;
  const keys = Object.keys(rest).sort();
  const normalized = keys.map((k) => [
    rfc(decodeURIComponent(k)),
    rfc(decodeURIComponent(rest[k])),
  ]);
  const query = normalized.map(([k, v]) => rfc(`${k}=${v}`)).join('%26');
  const toSign = `${method}&${rfc(url)}&${query}`;
  const expected = crypto
    .createHmac('sha256', `${secret}&`)
    .update(toSign)
    .digest('base64');
  return expected === consumer;
}

describe('WooCommerce client', () => {
  it('signs plain-HTTP requests the way WooCommerce verifies them', () => {
    const url = 'http://shop.example.test/wp-json/wc/v3/orders';
    const p = wc.oauthParams(
      'GET',
      url,
      { per_page: '50', modified_after: '2026-01-01T00:00:00' },
      'ck_abc',
      'cs_secret',
    );
    expect(p.oauth_signature_method).toBe('HMAC-SHA256');
    expect(wooVerifies('GET', url, p, 'cs_secret')).toBe(true);
    expect(wooVerifies('GET', url, p, 'cs_other')).toBe(false);
  });

  it('verifies webhook signatures (base64 HMAC-SHA256 of the raw body)', () => {
    const body = Buffer.from('{"id":42,"status":"processing"}');
    const sig = crypto
      .createHmac('sha256', 'hooksecret')
      .update(body)
      .digest('base64');
    expect(wc.verifyWebhook(body, sig, 'hooksecret')).toBe(true);
    expect(wc.verifyWebhook(body, sig, 'other')).toBe(false);
    expect(wc.verifyWebhook(body, '', 'hooksecret')).toBe(false);
  });

  it('normalises store addresses', () => {
    expect(wc.normalizeSiteUrl('https://shop.example.com/?x=1#a')).toBe(
      'https://shop.example.com',
    );
    expect(() => wc.normalizeSiteUrl('ftp://shop.example.com')).toThrow(
      /https/,
    );
    expect(() => wc.normalizeSiteUrl('not a url')).toThrow(
      /full store address/,
    );
  });
});

describe('store design', () => {
  it('offers six templates with colour previews', () => {
    const t = design.catalogTemplates();
    expect(t.map((x: { key: string }) => x.key)).toEqual([
      'boutique',
      'fresh',
      'tech',
      'beauty',
      'home',
      'minimal',
    ]);
    expect(t.every((x: { colors: string[] }) => x.colors.length === 4)).toBe(
      true,
    );
  });

  it('writes template content with prices in the store currency', () => {
    const c = design.fallbackContent(design.TEMPLATES.fresh, {
      name: 'Greenleaf',
      description: 'Plants',
      currency: 'pkr',
      city: 'Lahore',
    });
    expect(c.products).toHaveLength(6);
    expect(Number(c.products[0].price)).toBeGreaterThan(500);
    expect(design.niceprice(49, 'usd')).toBe('48.99');
    expect(design.niceprice(10, 'jpy')).toBe('1500');
  });

  it('cleans AI output and keeps the fallback for missing parts', () => {
    const fallback = design.fallbackContent(design.TEMPLATES.minimal, {
      name: 'X',
      description: 'Y',
      currency: 'usd',
    });
    const raw = design.parseJson(
      '```json\n{"tagline":"' +
        'a'.repeat(200) +
        '","categories":["Mugs","Mugs","Plates"],"products":[{"name":"Mug","price":12,"category":"Mugs"},{"name":"Plate","price":15,"category":"Unknown"},{"name":"Bowl","price":9,"category":"Plates"},{"name":"Free","price":0}]}\n```',
    );
    const c = design.cleanContent(raw, fallback, 'usd');
    expect(c.tagline).toHaveLength(90);
    expect(c.categories).toEqual(['Mugs', 'Plates']);
    expect(c.products.map((p: { name: string }) => p.name)).toEqual([
      'Mug',
      'Plate',
      'Bowl',
    ]);
    expect(c.products[1].category).toBe('Mugs');
    expect(c.products[0].price).toBe('12.00');
    expect(c.faq).toEqual(fallback.faq);
  });

  it('builds the store spec: colours, brand override, pages and menus', () => {
    const content = design.fallbackContent(design.TEMPLATES.tech, {
      name: 'Gadget',
      description: 'Chargers',
      currency: 'usd',
    });
    const spec = design.buildSpec({
      template: 'tech',
      brandColor: '#ff0066',
      content,
      name: 'Gadget',
      email: 'a@b.co',
    });
    expect(spec.design.theme_mods.storefront_button_background_color).toBe(
      '#ff0066',
    );
    expect(spec.design.theme_mods.background_color).toMatch(/^[0-9a-f]{6}$/);
    expect(spec.design.home_sections).toEqual([
      'featured',
      'recent',
      'best_selling',
    ]);
    const slugs = spec.design.pages.map((p: { slug: string }) => p.slug);
    expect(slugs).toEqual(
      expect.arrayContaining([
        'about',
        'contact',
        'faq',
        'shipping-returns',
        'privacy-policy',
        'terms',
      ]),
    );
    expect(spec.design.menu).toContain('shop');
    expect(spec.catalog.products).toHaveLength(6);
    const unknown = design.buildSpec({
      template: 'nope',
      brandColor: 'red',
      content,
      name: 'G',
    });
    expect(unknown.design.theme_mods.storefront_button_background_color).toBe(
      design.TEMPLATES.minimal.palette.primary,
    );
  });
});

describe('store agent protocol', () => {
  it('OmniCore signatures are accepted by the agent and replays are refused', async () => {
    const { verifyRequest } = await import(AGENT_AUTH);
    const secret = 's'.repeat(40);
    const body = JSON.stringify({ id: 's-1' });
    const header = agentClient.signature(secret, 'POST', '/v1/stores', body);
    const seen = new Map();
    expect(
      verifyRequest({
        secret,
        header,
        method: 'POST',
        path: '/v1/stores',
        body,
        seen,
      }),
    ).toBeNull();
    expect(
      verifyRequest({
        secret,
        header,
        method: 'POST',
        path: '/v1/stores',
        body,
        seen,
      }),
    ).toBe('replayed request');
    expect(
      verifyRequest({
        secret,
        header,
        method: 'POST',
        path: '/v1/stores',
        body: body + ' ',
      }),
    ).toBe('bad signature');
    const old = agentClient.signature(
      secret,
      'GET',
      '/v1/health',
      '',
      Date.now() - 10 * 60 * 1000,
    );
    expect(
      verifyRequest({
        secret,
        header: old,
        method: 'GET',
        path: '/v1/health',
        body: '',
      }),
    ).toBe('stale signature');
  });

  it('routes platform and custom hosts with the right certificates', async () => {
    const { routeConfig } = await import(AGENT_TRAEFIK);
    const r = routeConfig({
      id: 'a1',
      hostnames: ['a.stores.test', 'Shop.Example.com', 'bad host'],
      acmeHosts: ['shop.example.com'],
      tlsMode: 'acme',
      parkedUrl: 'http://p',
    });
    expect(r.http.routers['store-a1'].tls).toEqual({});
    expect(r.http.routers['store-a1-custom'].tls).toEqual({
      certResolver: 'le',
    });
    expect(r.http.routers['store-a1-custom'].rule).toBe(
      'Host(`shop.example.com`)',
    );
    const all = routeConfig({
      id: 'a1',
      hostnames: ['a.stores.test'],
      tlsMode: 'acme-all',
      parkedUrl: 'http://p',
    });
    expect(all.http.routers['store-a1'].tls).toEqual({ certResolver: 'le' });
    const parked = routeConfig({
      id: 'a1',
      hostnames: ['a.stores.test'],
      tlsMode: 'off',
      suspended: true,
      parkedUrl: 'http://p',
    });
    expect(
      parked.http.services['store-a1-parked'].loadBalancer.servers[0].url,
    ).toBe('http://p');
    expect(parked.http.routers['store-a1'].entryPoints).toEqual(['web']);
  });
});

describe('plugin download', () => {
  it('zips a folder under its plugin name', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-zip-'));
    fs.mkdirSync(path.join(dir, 'includes'));
    fs.writeFileSync(path.join(dir, 'main.php'), '<?php // hello');
    fs.writeFileSync(path.join(dir, 'includes', 'a.php'), '<?php // a');
    const zip = zipDirectory(dir, 'omnicore-commerce');
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes(Buffer.from('omnicore-commerce/includes/a.php'))).toBe(
      true,
    );
    expect(zip.readUInt16LE(zip.length - 12)).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
