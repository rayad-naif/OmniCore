import { describe, expect, it, vi } from 'vitest';

const {
  initialConversationStatus,
  pickInitialStatus,
  validateWidgetSessionInput,
  visitorUpdateFields,
  visitorOwnsConversation,
  widgetMessageAccessError,
} = require('./widgetSession.js');

describe('widget session decisions', () => {
  it('starts with AI only when both tenant switches are enabled', () => {
    expect(initialConversationStatus()).toBe('open');
    expect(
      initialConversationStatus({
        ai_feature_enabled: true,
        ai_auto_reply_enabled: false,
      }),
    ).toBe('open');
    expect(
      initialConversationStatus({
        ai_feature_enabled: true,
        ai_auto_reply_enabled: true,
      }),
    ).toBe('ai_handling');
  });

  it('uses a query seam and safely falls back to the human queue', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ ai_feature_enabled: true, ai_auto_reply_enabled: true }],
    });
    await expect(pickInitialStatus(query, 'tenant-1')).resolves.toBe(
      'ai_handling',
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM tenants'),
      ['tenant-1'],
    );
    await expect(
      pickInitialStatus(
        vi.fn().mockRejectedValue(new Error('unavailable')),
        'tenant-1',
      ),
    ).resolves.toBe('open');
  });

  it('validates and normalizes the public brand identifier', () => {
    expect(validateWidgetSessionInput({ brandId: ' brand-1 ' })).toEqual({
      ok: true,
      value: { brandId: 'brand-1' },
    });
    expect(validateWidgetSessionInput({ brandId: 1 })).toEqual({
      ok: false,
      error: 'brandId is required',
    });
  });

  it('builds only truthy visitor identity updates', () => {
    expect(
      visitorUpdateFields({
        visitorName: 'Ada',
        visitorEmail: '',
        timezone: 'UTC',
      }),
    ).toEqual({
      fields: ['display_name', 'timezone'],
      values: ['Ada', 'UTC'],
    });
  });

  it('requires the session visitor to own a conversation before messages are allowed', () => {
    const conversation = {
      visitor_id: 'visitor-1',
      status: 'open',
      is_ticket: false,
    };
    expect(visitorOwnsConversation(conversation, 'visitor-1')).toBe(true);
    expect(visitorOwnsConversation(conversation, 'visitor-2')).toBe(false);
    expect(widgetMessageAccessError(conversation, 'visitor-2')).toBe(
      'Conversation not found',
    );
    expect(
      widgetMessageAccessError(
        { ...conversation, is_ticket: true },
        'visitor-1',
      ),
    ).toBe('Conversation has been moved to an email ticket');
    expect(
      widgetMessageAccessError(
        { ...conversation, status: 'closed' },
        'visitor-1',
      ),
    ).toBe('Conversation is closed');
  });
});
