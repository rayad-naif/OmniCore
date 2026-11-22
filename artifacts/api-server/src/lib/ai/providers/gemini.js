'use strict';

/**
 * Google Gemini adapter for the copilot (REST, function calling).
 * The model's `content` is stored and replayed unchanged so Gemini's
 * thought signatures on function calls survive multi-turn tool use.
 */

const DEFAULT_MODEL = 'gemini-2.5-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini accepts an OpenAPI subset: drop JSON-Schema keywords it rejects. */
function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === '$schema') continue;
    out[k] = typeof v === 'object' ? geminiSchema(v) : v;
  }
  return out;
}

async function call(apiKey, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(
      new Error(json.error?.message || `Gemini API error ${res.status}`),
      { status: 502 },
    );
  }
  return json;
}

module.exports = {
  id: 'gemini',
  DEFAULT_MODEL,

  userMessage(text) {
    return { role: 'user', parts: [{ text }] };
  },

  toolResultsMessage(results) {
    return {
      role: 'user',
      parts: results.map((r) => ({
        functionResponse: {
          name: r.name,
          response: r.isError ? { error: r.content } : { result: r.content },
        },
      })),
    };
  },

  async turn({ apiKey, model, system, messages, tools }) {
    const m = model || DEFAULT_MODEL;
    const json = await call(
      apiKey,
      `/models/${encodeURIComponent(m)}:generateContent`,
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages,
        // A plain completion (no tools) must not send an empty tool list.
        ...(tools.length
          ? {
              tools: [
                {
                  // Gemini rejects OBJECT schemas without properties: omit them.
                  functionDeclarations: tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    ...(Object.keys(t.parameters?.properties || {}).length
                      ? { parameters: geminiSchema(t.parameters) }
                      : {}),
                  })),
                },
              ],
              toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
            }
          : {}),
        generationConfig: { maxOutputTokens: 8192 },
      },
    );
    const cand = json.candidates?.[0];
    if (!cand) {
      const reason = json.promptFeedback?.blockReason;
      return {
        assistant: null,
        text: reason
          ? "I can't help with that request."
          : 'No response from the AI.',
        toolCalls: [],
        refused: Boolean(reason),
      };
    }
    const content = cand.content || { role: 'model', parts: [] };
    const parts = content.parts || [];
    const text = parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('\n')
      .trim();
    const toolCalls = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        id: `${p.functionCall.name}_${i}`,
        name: p.functionCall.name,
        input: p.functionCall.args || {},
      }));
    return {
      assistant: { role: 'model', parts },
      text:
        cand.finishReason === 'SAFETY' && !text
          ? "I can't help with that request."
          : text,
      toolCalls,
      usage: json.usageMetadata,
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

  geminiSchema,
};
