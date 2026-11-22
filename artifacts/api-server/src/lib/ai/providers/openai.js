'use strict';

/** OpenAI adapter for the copilot (Chat Completions REST, function tools). */

const DEFAULT_MODEL = 'gpt-4.1-mini';
const BASE = 'https://api.openai.com/v1';

async function call(apiKey, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(
      new Error(json.error?.message || `OpenAI API error ${res.status}`),
      { status: 502 },
    );
  }
  return json;
}

module.exports = {
  id: 'openai',
  DEFAULT_MODEL,
  systemInMessages: true,

  userMessage(text) {
    return { role: 'user', content: text };
  },

  // OpenAI wants one "tool" message per call, so this returns an array.
  toolResultsMessage(results) {
    return results.map((r) => ({
      role: 'tool',
      tool_call_id: r.id,
      content:
        typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
    }));
  },

  async turn({ apiKey, model, system, messages, tools }) {
    const json = await call(apiKey, '/chat/completions', {
      model: model || DEFAULT_MODEL,
      messages: [{ role: 'system', content: system }, ...messages],
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            })),
            tool_choice: 'auto',
          }
        : {}),
    });
    const msg = json.choices?.[0]?.message || {
      role: 'assistant',
      content: '',
    };
    const toolCalls = (msg.tool_calls || []).map((c) => {
      let input = {};
      try {
        input = JSON.parse(c.function?.arguments || '{}');
      } catch {
        input = {};
      }
      return { id: c.id, name: c.function?.name, input };
    });
    return {
      assistant: {
        role: 'assistant',
        content: msg.content ?? null,
        ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
      },
      text: (msg.content || msg.refusal || '').trim(),
      toolCalls,
      refused: Boolean(msg.refusal),
      usage: json.usage,
    };
  },

  async test({ apiKey, model }) {
    try {
      await call(
        apiKey,
        `/models/${encodeURIComponent(model || DEFAULT_MODEL)}`,
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
