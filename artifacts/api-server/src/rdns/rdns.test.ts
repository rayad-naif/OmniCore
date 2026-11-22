import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  SOURCES,
  isValidDomain,
  walkJsonForDomains,
  applies,
} = require('./sources.js');
const crawler = require('./crawler.js');

function mockFetch(
  handler: (
    url: string,
    init?: RequestInit,
  ) => { status?: number; body: unknown; type?: string },
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const r = handler(String(url), init);
      const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      return new Response(text, {
        status: r.status ?? 200,
        headers: { 'content-type': r.type ?? 'application/json' },
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Reverse DNS sources', () => {
  it('validates and extracts domains', () => {
    expect(isValidDomain('shop.example.com')).toBe(true);
    expect(isValidDomain('not a domain')).toBe(false);
    expect(isValidDomain('203.0.113.7')).toBe(false);
    const out = new Set();
    walkJsonForDomains(
      { a: ['x.example.com.', { b: 'NOPE' }, 'Y.Example.org'] },
      out,
    );
    expect([...out].sort()).toEqual(['x.example.com', 'y.example.org']);
    expect(applies(SOURCES.otx, 'A')).toBe(true);
    expect(applies(SOURCES.otx, 'CNAME')).toBe(false);
    expect(applies(SOURCES.rapiddns, 'CNAME')).toBe(true);
  });

  it('parses crt.sh certificate names (wildcards stripped)', async () => {
    mockFetch(() => ({
      body: [
        { name_value: '*.a.example.com\nb.example.com' },
        { name_value: 'junk value' },
      ],
    }));
    const r = await SOURCES.crtsh.fn('example.com', 'CNAME', {});
    expect([...r.domains].sort()).toEqual(['a.example.com', 'b.example.com']);
    expect(r.exhausted).toBe(true);
  });

  it('parses RapidDNS result tables', async () => {
    mockFetch(() => ({
      type: 'text/html',
      body: '<table><tr><td>1</td><td><a>shop.client.com</a></td><td>CNAME</td></tr><tr><td>app.other.io</td></tr></table>',
    }));
    const r = await SOURCES.rapiddns.fn('whitelabel.example.com', 'CNAME', {});
    expect([...r.domains].sort()).toEqual(['app.other.io', 'shop.client.com']);
  });

  it('walks Robtex pages by offset and stops on a short page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      o: `site${i}.example.com`,
    }));
    mockFetch((url) => ({
      body: url.includes('offset=0') ? full : [{ o: 'last.example.com' }],
    }));
    const first = await SOURCES.robtex.fn('cname.example.com', 'CNAME', {});
    expect(first.domains.size).toBe(100);
    expect(first.nextState).toBe('100');
    expect(first.exhausted).toBe(false);
    const second = await SOURCES.robtex.fn('cname.example.com', 'CNAME', {
      state: '100',
    });
    expect(second.exhausted).toBe(true);
    expect(second.nextState).toBeNull();
  });

  it('carries the IP.THC page state forward', async () => {
    mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      return {
        body: body.page_state
          ? { domains: ['z.example.com'] }
          : { domains: ['y.example.com'], next_page_state: 'abc' },
      };
    });
    const p1 = await SOURCES.ipthc.fn('cname.example.com', 'CNAME', {});
    expect(p1.nextState).toBe('abc');
    expect(p1.exhausted).toBe(false);
    const p2 = await SOURCES.ipthc.fn('cname.example.com', 'CNAME', {
      state: 'abc',
    });
    expect([...p2.domains]).toEqual(['z.example.com']);
    expect(p2.exhausted).toBe(true);
  });

  it('reports 429 as rate limited and keeps the cursor', async () => {
    mockFetch(() => ({ status: 429, body: {} }));
    const r = await SOURCES.robtex.fn('cname.example.com', 'CNAME', {
      state: '300',
    });
    expect(r.rateLimited).toBe(true);
    expect(r.nextState).toBe('300');
    expect(r.exhausted).toBe(false);
  });

  it('skips paid sources without an API key and sends the key when set', async () => {
    const r = await SOURCES.securitytrails.fn('cname.example.com', 'CNAME', {});
    expect(r.domains.size).toBe(0);
    mockFetch((_url, init) => {
      expect((init?.headers as Record<string, string>).APIKEY).toBe('k');
      return { body: { records: [{ hostname: 'paid.example.com' }] } };
    });
    const p = await SOURCES.securitytrails.fn('cname.example.com', 'CNAME', {
      apiKey: 'k',
    });
    expect([...p.domains]).toEqual(['paid.example.com']);
  });

  it('turns network failures into errors instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('fetch failed'))),
    );
    const r = await SOURCES.otx.fn('203.0.113.7', 'A', {});
    expect(r.error).toBe('fetch failed');
  });
});

describe('Reverse DNS pacing', () => {
  const { pacing } = require('./scheduler.js');
  it('spaces requests, backs off on 429 and errors, and waits to rescan', () => {
    expect(pacing.interval(60)).toBe(60);
    expect(pacing.afterRateLimited(0)).toEqual({ delay: 60, backoff: 60 });
    expect(pacing.afterRateLimited(3000).backoff).toBe(3600);
    expect(pacing.afterError(0).backoff).toBe(30);
    expect(pacing.afterError(800).backoff).toBe(900);
    expect(pacing.afterExhausted(12).delay).toBe(12 * 3600);
  });
});

describe('Forms crawler', () => {
  it('reads robots.txt rules', () => {
    const r = crawler.parseRobots(
      'User-agent: *\nDisallow: /admin\nDisallow:\nCrawl-delay: 5\nSitemap: https://x.example.com/sm.xml # main',
    );
    expect(r.disallow).toEqual(['/admin']);
    expect(r.crawlDelay).toBe(5);
    expect(r.sitemaps).toEqual(['https://x.example.com/sm.xml']);
    expect(crawler.isDisallowed('/admin/users', r.disallow)).toBe(true);
    expect(crawler.isDisallowed('/contact', r.disallow)).toBe(false);
  });

  it('records form structure (field names only), links and the title', () => {
    const page = crawler.parsePage(
      `<html><head><title>Contact us</title></head><body>
        <form method="post" action="/send"><input name="email" value="someone@example.com"><textarea name="message"></textarea><input type="submit"></form>
        <a href="/careers">Jobs</a><a href="https://other.com/">x</a></body></html>`,
      'https://shop.example.com/contact',
    );
    expect(page.title).toBe('Contact us');
    expect(page.forms).toHaveLength(1);
    expect(page.forms[0]).toMatchObject({
      method: 'POST',
      action: 'https://shop.example.com/send',
      fields: ['email', 'message'],
    });
    expect(JSON.stringify(page)).not.toContain('someone@example.com');
    expect(page.links).toEqual(['/careers', 'https://other.com/']);
    expect(
      crawler.guessPurpose(
        'https://shop.example.com/contact',
        'Contact us',
        '/send',
      ),
    ).toBe('contact');
    expect(crawler.guessPurpose('https://x.com/a', '', '')).toBe('unknown');
    expect(crawler.onDomain('blog.shop.example.com', 'shop.example.com')).toBe(
      true,
    );
    expect(crawler.onDomain('evilshop.example.com', 'shop.example.com')).toBe(
      false,
    );
  });

  it('refuses private and loopback hosts', async () => {
    expect(await crawler.isSafeHost('127.0.0.1')).toBe(false);
    expect(await crawler.isSafeHost('10.1.2.3')).toBe(false);
    expect(await crawler.isSafeHost('169.254.169.254')).toBe(false);
    const r = await crawler.safeFetch('http://127.0.0.1:8080/');
    expect(r.error).toMatch(/private/);
  });
});
