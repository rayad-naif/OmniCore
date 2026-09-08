import { describe, expect, it } from 'vitest';
import {
  buildMessageGroups,
  defaultPermsForRole,
  extractEmailDomain,
  fmtMoney,
  safeHref,
  slaColor,
  timeAgo,
} from './dashboardHelpers';
import type { Message } from './dashboardTypes';

const baseMessage = (overrides: Partial<Message>): Message => ({
  id: 'message-1',
  conversation_id: 'conversation-1',
  sender_type: 'visitor',
  sender_name: 'Visitor',
  message_body: 'Hello',
  is_internal_note: false,
  created_at: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

describe('dashboard helpers', () => {
  it('formats relative timestamps at each display boundary', () => {
    const now = Date.parse('2024-01-02T00:00:00.000Z');

    expect(timeAgo('2024-01-01T23:59:30.000Z', now)).toBe('just now');
    expect(timeAgo('2024-01-01T23:58:00.000Z', now)).toBe('2m ago');
    expect(timeAgo('2024-01-01T22:00:00.000Z', now)).toBe('2h ago');
    expect(timeAgo('2023-12-30T00:00:00.000Z', now)).toBe('3d ago');
  });

  it('assigns SLA classes from a supplied clock', () => {
    const now = Date.parse('2024-01-01T12:00:00.000Z');

    expect(slaColor(null, now)).toBe('');
    expect(slaColor('2024-01-01T11:59:59.000Z', now)).toBe('text-red-500');
    expect(slaColor('2024-01-01T12:30:00.000Z', now)).toBe('text-amber-500');
    expect(slaColor('2024-01-01T14:00:00.000Z', now)).toBe('text-slate-400');
  });

  it('allows only HTTP(S) navigation URLs', () => {
    expect(safeHref('https://example.test/path')).toBe(
      'https://example.test/path',
    );
    expect(safeHref('mailto:agent@example.test')).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('not a url')).toBeNull();
  });

  it('groups consecutive system page-view messages without losing single messages', () => {
    const messages = [
      baseMessage({ id: '1', message_body: 'First' }),
      baseMessage({
        id: '2',
        sender_type: 'system',
        message_body: 'Visited: https://example.test/a',
      }),
      baseMessage({
        id: '3',
        sender_type: 'system',
        message_body: 'Visited: https://example.test/b',
      }),
      baseMessage({
        id: '4',
        sender_type: 'system',
        message_body: 'Connected',
      }),
      baseMessage({
        id: '5',
        sender_type: 'system',
        message_body: 'Visited: https://example.test/c',
      }),
    ];

    expect(buildMessageGroups(messages)).toEqual([
      { type: 'single', msg: messages[0], idx: 0 },
      { type: 'journey', msgs: [messages[1], messages[2]] },
      { type: 'single', msg: messages[3], idx: 3 },
      { type: 'single', msg: messages[4], idx: 4 },
    ]);
  });

  it('uses role-specific permissions, currency formatting, and normalized email domains', () => {
    expect(defaultPermsForRole('admin')).toEqual(
      expect.objectContaining({ billing: 'edit', inbox: 'edit' }),
    );
    expect(defaultPermsForRole('supervisor').brands).toBe('read');
    expect(defaultPermsForRole('agent').billing).toBe('none');
    expect(fmtMoney(1299, 'usd')).toBe('$12.99');
    expect(extractEmailDomain(' Support@Example.TEST ')).toBe('example.test');
    expect(extractEmailDomain('not-an-email')).toBe('');
  });
});
