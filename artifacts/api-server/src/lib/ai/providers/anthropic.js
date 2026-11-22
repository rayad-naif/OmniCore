'use strict';

/**
 * Anthropic (Claude) adapter for the copilot — official SDK, manual tool loop.
 *
 * Conventions for current Claude models:
 *  - Default model claude-opus-5-5 (agencies may pick another in Agency → AI).
 *  - tool_choice stays "auto": forcing a tool returns 400 on current models.
 *  - The full `response.content` (including thinking blocks) is appended to the
 *    transcript unchanged, so multi-turn tool use keeps working.
 *  - Effort is set explicitly (Claude Opus 5.5 defaults to "medium").
 *  - stop_reason "refusal" is checked before reading content.
 *  - Server-side refusal fallbacks are enabled for models that support them
 *    (beta `server-side-fallback-2026-07-01`, `fallbacks: "default"`).
 */

const AnthropicModule = require('@anthropic-ai/sdk');

const Anthropic = AnthropicModule.default || AnthropicModule;
const DEFAULT_MODEL = 'claude-opus-5-5';
const FALLBACK_MODELS = new Set([
  'claude-fable-5-2',
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);
const EFFORT_MODELS =
  /claude-(fable|mythos|opus-5|sonnet-5|haiku-5|opus-4-[678]|sonnet-4-6)/;

function client(apiKey) {
  return new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
}

function toolsFor(tools) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'invalid API key';
  if (err instanceof Anthropic.PermissionDeniedError)
    return 'the key is not allowed to use this model';
  if (err instanceof Anthropic.NotFoundError) return 'model not found';
  if (err instanceof Anthropic.RateLimitError)
    return 'rate limited, try again shortly';
  if (err instanceof Anthropic.BadRequestError)
    return `bad request: ${err.message}`;
  if (err instanceof Anthropic.APIError)
    return `Anthropic API error ${err.status ?? ''}: ${err.message}`;
  return err?.message || String(err);
}

module.exports = {
  id: 'anthropic',
  DEFAULT_MODEL,

  userMessage(text) {
    return { role: 'user', content: text };
  },

  toolResultsMessage(results) {
    // All results for one assistant turn go back in a single user message.
    return {
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        content:
          typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
        ...(r.isError ? { is_error: true } : {}),
      })),
    };
  },

  async turn({ apiKey, model, system, messages, tools }) {
    const m = model || DEFAULT_MODEL;
    const params = {
      model: m,
      max_tokens: 16000,
      system: [
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
      ],
      tools: toolsFor(tools),
      tool_choice: { type: 'auto' },
      messages,
      ...(EFFORT_MODELS.test(m) ? { output_config: { effort: 'medium' } } : {}),
    };
    let response;
    try {
      response = FALLBACK_MODELS.has(m)
        ? await client(apiKey).beta.messages.create({
            ...params,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          })
        : await client(apiKey).messages.create(params);
    } catch (err) {
      throw Object.assign(new Error(describeError(err)), { status: 502 });
    }

    if (response.stop_reason === 'refusal') {
      return {
        assistant: { role: 'assistant', content: response.content },
        text: "I can't help with that request.",
        toolCalls: [],
        refused: true,
      };
    }
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const toolCalls = response.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input || {} }));
    return {
      assistant: { role: 'assistant', content: response.content },
      text:
        response.stop_reason === 'max_tokens' && !text
          ? 'My answer was cut off. Please ask again more specifically.'
          : text,
      toolCalls,
      usage: response.usage,
    };
  },

  /** Validates key + model without spending tokens. */
  async test({ apiKey, model }) {
    try {
      await client(apiKey).models.retrieve(model || DEFAULT_MODEL);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  },
};
