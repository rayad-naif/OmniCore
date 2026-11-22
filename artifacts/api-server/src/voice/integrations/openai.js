'use strict';
/* OpenAI with the agency's own key: key validation + structured QA grading. */
const { createHttp } = require('./http');

function createOpenAI(cfg, fetchImpl) {
  const http = createHttp('OpenAI', fetchImpl, { timeoutMs: 45000 });
  const base = cfg.openai.apiBase;

  function client(apiKey) {
    const call = (method, path, body) =>
      http(base + path, {
        method,
        headers: Object.assign(
          { Authorization: 'Bearer ' + apiKey },
          body ? { 'Content-Type': 'application/json' } : {},
        ),
        body: body ? JSON.stringify(body) : undefined,
      });
    return {
      listModels: () => call('GET', '/models'),
      // Chat completion that must return JSON matching `schema`.
      async json({ model, system, user, schema, name }) {
        const r = await call('POST', '/chat/completions', {
          model: model || cfg.openai.graderModel,
          temperature: 0.2,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: name || 'result', strict: true, schema },
          },
        });
        const content =
          r &&
          r.choices &&
          r.choices[0] &&
          r.choices[0].message &&
          r.choices[0].message.content;
        if (!content) throw new Error('OpenAI returned no content');
        return JSON.parse(content);
      },
    };
  }
  return { client };
}

module.exports = { createOpenAI };
