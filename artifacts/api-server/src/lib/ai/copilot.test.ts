import { afterEach, describe, expect, it, vi } from 'vitest';

const copilot = require('./copilot.js');
const tools = require('./copilotTools.js');
const gemini = require('./providers/gemini.js');

/** A scripted provider: returns the queued turns in order and records inputs. */
function fakeProvider(
  turns: Array<{
    text?: string;
    toolCalls?: Array<{ id: string; name: string; input: object }>;
  }>,
) {
  const seen: unknown[][] = [];
  return {
    seen,
    userMessage: (text: string) => ({ role: 'user', text }),
    toolResultsMessage: (results: unknown[]) => ({ role: 'tool', results }),
    async turn({ messages }: { messages: unknown[] }) {
      seen.push([...messages]);
      const t = turns.shift() || { text: 'done' };
      return {
        assistant: { role: 'assistant', t },
        text: t.text || '',
        toolCalls: t.toolCalls || [],
      };
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('copilot loop', () => {
  it('runs read tools immediately and answers', async () => {
    const exec = vi
      .spyOn(tools, 'execute')
      .mockResolvedValue({ content: [{ id: 'c1', status: 'open' }] });
    const provider = fakeProvider([
      {
        toolCalls: [
          { id: 't1', name: 'list_conversations', input: { status: 'open' } },
        ],
      },
      { text: 'You have 1 open conversation.' },
    ]);
    const out = await copilot.runLoop({
      provider,
      cfg: {},
      system: 's',
      messages: [provider.userMessage('hi')],
      req: {},
      tenantId: 'T',
    });
    expect(exec).toHaveBeenCalledWith(
      'list_conversations',
      { status: 'open' },
      { req: {}, tenantId: 'T' },
    );
    expect(out.reply).toBe('You have 1 open conversation.');
    expect(out.pending).toEqual([]);
    // second model call saw: user, assistant(tool call), tool results
    expect(provider.seen[1]).toHaveLength(3);
  });

  it('pauses on write tools and keeps read results for the same turn', async () => {
    const exec = vi
      .spyOn(tools, 'execute')
      .mockResolvedValue({ content: 'ok' });
    const provider = fakeProvider([
      {
        text: 'I will add that reply.',
        toolCalls: [
          { id: 'r1', name: 'list_team', input: {} },
          {
            id: 'w1',
            name: 'create_canned_response',
            input: { name: 'Refund', body: 'We refund within 30 days.' },
          },
          {
            id: 'u1',
            name: 'open_section',
            input: { section: 'canned_responses' },
          },
        ],
      },
    ]);
    const out = await copilot.runLoop({
      provider,
      cfg: {},
      system: 's',
      messages: [],
      req: {},
      tenantId: 'T',
    });
    expect(exec).toHaveBeenCalledTimes(1); // only the read tool ran
    expect(out.pending).toEqual([
      {
        id: 'w1',
        name: 'create_canned_response',
        input: { name: 'Refund', body: 'We refund within 30 days.' },
        summary: 'Create saved reply “Refund”',
      },
    ]);
    expect(out.actions).toEqual([
      { type: 'open_section', section: 'canned_responses' },
    ]);
    expect(out.pendingState.resolved.map((r: { id: string }) => r.id)).toEqual([
      'r1',
      'u1',
    ]);
  });

  it('resumes after approval with all tool results in one message', async () => {
    const provider = fakeProvider([{ text: 'Created your saved reply.' }]);
    const carry = [
      { id: 'r1', name: 'list_team', content: [] },
      { id: 'w1', name: 'create_canned_response', content: { created: true } },
    ];
    const out = await copilot.runLoop({
      provider,
      cfg: {},
      system: 's',
      messages: [{ role: 'assistant' }],
      req: {},
      tenantId: 'T',
      carry,
    });
    expect(out.reply).toBe('Created your saved reply.');
    const sent = provider.seen[0] as Array<{
      role: string;
      results?: unknown[];
    }>;
    expect(sent[sent.length - 1]).toEqual({ role: 'tool', results: carry });
  });

  it('ignores navigation to unknown sections', async () => {
    const provider = fakeProvider([
      {
        toolCalls: [
          { id: 'u', name: 'open_section', input: { section: 'hack' } },
        ],
      },
      { text: 'ok' },
    ]);
    const out = await copilot.runLoop({
      provider,
      cfg: {},
      system: 's',
      messages: [],
      req: {},
      tenantId: 'T',
    });
    expect(out.actions).toEqual([]);
  });
});

describe('copilot tools', () => {
  it('declares every tool with a kind and an object schema', () => {
    for (const t of tools.TOOLS) {
      expect(['read', 'write', 'ui']).toContain(t.kind);
      expect(t.parameters.type).toBe('object');
      if (t.kind === 'write') expect(typeof t.summary).toBe('function');
      if (t.kind !== 'ui') expect(typeof (t.run || t.request)).toBe('function');
    }
  });

  it('never exposes secrets through tool output', () => {
    const hook = tools.BY_NAME.create_webhook;
    expect(hook.shape({ id: 'w', secret: 'whsec_x' })).not.toHaveProperty(
      'secret',
    );
  });

  it('strips JSON-Schema keywords Gemini rejects', () => {
    const s = gemini.geminiSchema({
      type: 'object',
      additionalProperties: false,
      properties: { a: { type: 'object', additionalProperties: false } },
    });
    expect(JSON.stringify(s)).not.toContain('additionalProperties');
  });
});

describe('copilot system prompt', () => {
  it('white-labels the product name and includes the user context', () => {
    const p = copilot.systemPrompt({
      appName: 'Acme Desk',
      agent: { name: 'Ana', email: 'a@x', role: 'admin' },
      workspaceName: 'Shop',
      section: 'billing',
    });
    expect(p).toContain('Acme Desk');
    expect(p).not.toContain('OmniCore');
    expect(p).toContain('Currently viewing: billing');
  });
});
