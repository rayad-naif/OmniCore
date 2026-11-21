import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const {
  isPrivateIp,
  subscribed,
  sign,
  assertSafeUrl,
  chatBody,
} = require('./dispatcher.js');

describe('webhook SSRF guard', () => {
  it('flags private, loopback, link-local and metadata addresses', () => {
    for (const ip of [
      '10.0.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.5.4',
      '192.168.1.1',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });

  it('rejects private targets and non-https in production', async () => {
    const env = { ...process.env };
    process.env.NODE_ENV = 'production';
    delete process.env.WEBHOOKS_ALLOW_HTTP;
    delete process.env.WEBHOOKS_ALLOW_PRIVATE;
    await expect(assertSafeUrl('http://example.com/hook')).rejects.toThrow(
      /https/,
    );
    await expect(assertSafeUrl('https://127.0.0.1/hook')).rejects.toThrow(
      /private/,
    );
    await expect(assertSafeUrl('https://[::1]/hook')).rejects.toThrow(
      /private/,
    );
    process.env = env;
  });
});

describe('event subscriptions', () => {
  it('supports wildcard, exact and prefix subscriptions', () => {
    expect(subscribed(['*'], 'message.created')).toBe(true);
    expect(subscribed(['message.created'], 'message.created')).toBe(true);
    expect(subscribed(['conversation.*'], 'conversation.closed')).toBe(true);
    expect(subscribed(['conversation.*'], 'message.created')).toBe(false);
    expect(subscribed([], 'message.created')).toBe(false);
  });
});

describe('webhook signing', () => {
  it('produces a Stripe-style t=,v1= HMAC over "t.body"', () => {
    const header = sign('whsec_test', '{"a":1}', 1700000000);
    const expected = createHmac('sha256', 'whsec_test')
      .update('1700000000.{"a":1}')
      .digest('hex');
    expect(header).toBe(`t=1700000000,v1=${expected}`);
  });
});

describe('chat formatting', () => {
  const env = {
    type: 'ticket.created',
    data: {
      conversation: {
        ticket_number: 42,
        priority: 'high',
        subject: 'Refund',
        contact: { name: 'Ana' },
        brand: { name: 'Acme' },
        url: 'https://x/dashboard/?conversation=1',
      },
    },
  };
  it('formats Slack, Discord and Teams payloads', () => {
    expect(chatBody('slack', env).text).toContain(
      'Ticket #42 (high) from Ana · Acme: Refund',
    );
    expect(chatBody('discord', env).allowed_mentions).toEqual({ parse: [] });
    expect(chatBody('teams', env)['@type']).toBe('MessageCard');
  });
});
