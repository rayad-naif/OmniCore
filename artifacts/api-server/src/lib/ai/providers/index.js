'use strict';

/**
 * AI provider registry for the copilot.
 *
 * Resolution: an agency's own key (Agency → AI, encrypted) wins for every
 * workspace under that agency; otherwise the platform's Gemini key
 * (GEMINI_API_KEY) with COPILOT_MODEL (default gemini-2.5-flash).
 *
 * Every adapter implements:
 *   userMessage(text) → native message
 *   toolResultsMessage([{ id, name, content, isError }]) → native message (or array)
 *   turn({ apiKey, model, system, messages, tools }) → { assistant, text, toolCalls[{id,name,input}], refused? }
 *   test({ apiKey, model }) → { ok, error? }
 */

const providers = {
  gemini: require('./gemini'),
  openai: require('./openai'),
  anthropic: require('./anthropic'),
};

function getProvider(id) {
  const p = providers[id];
  if (!p)
    throw Object.assign(new Error(`Unknown AI provider "${id}"`), {
      status: 400,
    });
  return p;
}

async function testProvider({ provider, model, apiKey }) {
  return getProvider(provider).test({ apiKey, model });
}

/** Returns { provider, model, apiKey, source } for a workspace. */
async function resolveAiConfig(tenantId) {
  const { agencyForTenant } = require('../../agencies');
  const { openJson } = require('../../secretBox');
  const agency = await agencyForTenant(tenantId).catch(() => null);
  if (agency?.ai_config_sealed) {
    const cfg = openJson(agency.ai_config_sealed);
    if (cfg?.provider && cfg.apiKey) {
      return {
        provider: cfg.provider,
        model: cfg.model,
        apiKey: cfg.apiKey,
        source: 'agency',
      };
    }
  }
  return {
    provider: 'gemini',
    model: process.env.COPILOT_MODEL || providers.gemini.DEFAULT_MODEL,
    apiKey: process.env.GEMINI_API_KEY,
    source: 'platform',
  };
}

module.exports = { providers, getProvider, testProvider, resolveAiConfig };
