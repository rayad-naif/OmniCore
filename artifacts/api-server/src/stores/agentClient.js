'use strict';

/**
 * stores/agentClient.js — signed calls to a store host's agent
 * (artifacts/store-agent). Signature: t=<s>,v1=hex(HMAC-SHA256(secret, `${t}.${METHOD}.${path}.${body}`)).
 */

const crypto = require('node:crypto');
const { open } = require('../lib/secretBox');

class AgentError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function signature(secret, method, path, body, now = Date.now()) {
  const t = Math.floor(now / 1000);
  const v1 = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${method.toUpperCase()}.${path}.${body || ''}`)
    .digest('hex');
  return `t=${t},v1=${v1}`;
}

async function call(host, method, path, payload, { timeoutMs = 30000 } = {}) {
  const secret = open(host.secret_sealed);
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const url = `${String(host.agent_url).replace(/\/+$/, '')}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-omnicore-agent-signature': signature(secret, method, path, body),
      },
      body: body || undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new AgentError(
      `Store server ${host.name} is unreachable (${err.cause?.code || err.message})`,
      502,
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new AgentError(
      data.error || `Store server returned HTTP ${res.status}`,
      res.status >= 500 ? 502 : res.status,
    );
  return data;
}

module.exports = { call, signature, AgentError };
