'use strict';

/**
 * copilot.js
 * In-app AI assistant: answers "how do I…" questions from the product manual
 * and performs tasks through tools, pausing for the user's approval before
 * anything is changed.
 *
 * Transcripts are stored per session in the provider's native message format
 * (copilot_sessions.messages) so provider-specific parts — Claude thinking
 * blocks, Gemini thought signatures, OpenAI tool_calls — replay unchanged.
 */

const { pool } = require('../db');
const logger = require('../../utils/logger');
const { getProvider, resolveAiConfig } = require('./providers');
const tools = require('./copilotTools');
const { appKnowledge } = require('./appKnowledge');

const MAX_STEPS = 6;

let ready = null;
function ensureCopilotSchema() {
  if (!ready) {
    ready = pool
      .query(
        `CREATE TABLE IF NOT EXISTS copilot_sessions (
           id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           tenant_id   UUID NOT NULL,
           agent_id    UUID NOT NULL,
           provider    TEXT NOT NULL,
           model       TEXT,
           messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
           pending     JSONB,
           created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
         );
         CREATE INDEX IF NOT EXISTS idx_copilot_sessions_agent ON copilot_sessions (agent_id, updated_at DESC);
         CREATE TABLE IF NOT EXISTS copilot_usage (
           tenant_id UUID NOT NULL,
           day       DATE NOT NULL DEFAULT CURRENT_DATE,
           requests  INTEGER NOT NULL DEFAULT 0,
           PRIMARY KEY (tenant_id, day)
         );`,
      )
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

async function consumeQuota(tenantId) {
  const limit = parseInt(process.env.COPILOT_DAILY_LIMIT || '300', 10);
  const { rows } = await pool.query(
    `INSERT INTO copilot_usage (tenant_id, day, requests) VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (tenant_id, day) DO UPDATE SET requests = copilot_usage.requests + 1
     RETURNING requests`,
    [tenantId],
  );
  if (limit > 0 && rows[0].requests > limit) {
    throw Object.assign(
      new Error(
        `The assistant's daily limit (${limit} messages) for this workspace is reached. It resets tomorrow.`,
      ),
      {
        status: 429,
      },
    );
  }
}

function systemPrompt({ appName, agent, workspaceName, section }) {
  return `${appKnowledge(appName)}

## Current user
- Name: ${agent.name || 'unknown'} (${agent.email || ''})
- Role: ${agent.role}${agent.workspaceOverride ? ' (platform admin viewing this workspace)' : ''}
- Workspace: ${workspaceName || 'unknown'}
- Currently viewing: ${section || 'dashboard'}
- Today: ${new Date().toISOString().slice(0, 10)}

You are the built-in ${appName} assistant. Help this person learn and use ${appName}, and carry out
tasks for them with the tools. Answer in the user's language.`;
}

function appendResults(provider, messages, results) {
  const msg = provider.toolResultsMessage(results);
  return Array.isArray(msg) ? [...messages, ...msg] : [...messages, msg];
}

/**
 * Runs model turns until it answers, or until it proposes write actions that
 * need approval. Returns { reply, pending, actions, messages, pendingState }.
 */
async function runLoop({
  provider,
  cfg,
  system,
  messages,
  req,
  tenantId,
  carry,
}) {
  let msgs = messages;
  const actions = [];
  let reply = '';
  let resolved = carry || null;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (resolved) {
      msgs = appendResults(provider, msgs, resolved);
      resolved = null;
    }
    const out = await provider.turn({
      apiKey: cfg.apiKey,
      model: cfg.model,
      system,
      messages: msgs,
      tools: tools.definitions(),
    });
    if (out.assistant) msgs = [...msgs, out.assistant];
    reply = out.text || reply;
    if (!out.toolCalls.length)
      return {
        reply,
        pending: [],
        actions,
        messages: msgs,
        pendingState: null,
      };

    const results = [];
    const writes = [];
    for (const call of out.toolCalls) {
      const def = tools.BY_NAME[call.name];
      if (!def) {
        results.push({
          id: call.id,
          name: call.name,
          content: `Unknown tool ${call.name}`,
          isError: true,
        });
      } else if (def.kind === 'ui') {
        if (tools.SECTIONS.includes(call.input?.section))
          actions.push({ type: 'open_section', section: call.input.section });
        results.push({
          id: call.id,
          name: call.name,
          content: { opened: call.input?.section },
        });
      } else if (def.kind === 'read') {
        const r = await tools.execute(call.name, call.input, { req, tenantId });
        results.push({ id: call.id, name: call.name, ...r });
      } else {
        writes.push({
          id: call.id,
          name: call.name,
          input: call.input || {},
          summary: def.summary ? def.summary(call.input || {}) : call.name,
        });
      }
    }
    if (writes.length) {
      return {
        reply,
        pending: writes,
        actions,
        messages: msgs,
        pendingState: { writes, resolved: results },
      };
    }
    resolved = results;
  }
  return {
    reply:
      reply ||
      'I stopped after several steps. Tell me how you would like to continue.',
    pending: [],
    actions,
    messages: resolved ? appendResults(provider, msgs, resolved) : msgs,
    pendingState: null,
  };
}

async function context(req) {
  const tenantId = req.agent.tenantId;
  const cfg = await resolveAiConfig(tenantId);
  if (!cfg.apiKey)
    throw Object.assign(
      new Error('The AI assistant is not configured (no AI key).'),
      { status: 503 },
    );
  const { brandingForTenant } = require('../agencies');
  const [{ branding }, ws] = await Promise.all([
    brandingForTenant(tenantId),
    pool.query(`SELECT company_name FROM tenants WHERE id = $1`, [tenantId]),
  ]);
  return {
    tenantId,
    cfg,
    appName: branding.appName,
    workspaceName: ws.rows[0]?.company_name,
  };
}

/** POST /api/copilot/chat */
async function chat(req, { sessionId, message, section }) {
  await ensureCopilotSchema();
  const ctx = await context(req);
  await consumeQuota(ctx.tenantId);
  const provider = getProvider(ctx.cfg.provider);

  let session = null;
  if (sessionId) {
    const { rows } = await pool.query(
      `SELECT * FROM copilot_sessions WHERE id = $1 AND agent_id = $2 AND tenant_id = $3`,
      [sessionId, req.agent.id, ctx.tenantId],
    );
    session = rows[0] || null;
    if (session?.pending) {
      throw Object.assign(
        new Error('Approve or cancel the pending action first.'),
        { status: 409 },
      );
    }
    // A different provider can't read another provider's transcript: start over.
    if (session && session.provider !== ctx.cfg.provider) session = null;
  }
  const history = session ? session.messages : [];
  const messages = [
    ...history,
    provider.userMessage(String(message).slice(0, 8000)),
  ];
  const system = systemPrompt({
    appName: ctx.appName,
    agent: req.agent,
    workspaceName: ctx.workspaceName,
    section,
  });

  const result = await runLoop({
    provider,
    cfg: ctx.cfg,
    system,
    messages,
    req,
    tenantId: ctx.tenantId,
  });

  const { rows } = session
    ? await pool.query(
        `UPDATE copilot_sessions SET messages = $2, pending = $3, model = $4, updated_at = NOW() WHERE id = $1 RETURNING id`,
        [
          session.id,
          JSON.stringify(result.messages),
          result.pendingState ? JSON.stringify(result.pendingState) : null,
          ctx.cfg.model,
        ],
      )
    : await pool.query(
        `INSERT INTO copilot_sessions (tenant_id, agent_id, provider, model, messages, pending)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          ctx.tenantId,
          req.agent.id,
          ctx.cfg.provider,
          ctx.cfg.model,
          JSON.stringify(result.messages),
          result.pendingState ? JSON.stringify(result.pendingState) : null,
        ],
      );
  return {
    session_id: rows[0].id,
    reply: result.reply,
    pending: result.pending,
    actions: result.actions,
  };
}

/** POST /api/copilot/sessions/:id/confirm */
async function confirm(req, { sessionId, approve, section }) {
  await ensureCopilotSchema();
  const ctx = await context(req);
  const { rows } = await pool.query(
    `SELECT * FROM copilot_sessions WHERE id = $1 AND agent_id = $2 AND tenant_id = $3`,
    [sessionId, req.agent.id, ctx.tenantId],
  );
  const session = rows[0];
  if (!session?.pending)
    throw Object.assign(new Error('Nothing is waiting for approval.'), {
      status: 409,
    });
  const provider = getProvider(session.provider);
  const { writes, resolved } = session.pending;

  const results = [...resolved];
  const done = [];
  for (const w of writes) {
    if (!approve) {
      results.push({
        id: w.id,
        name: w.name,
        content:
          'The user declined this action. Do not retry it unless they ask.',
        isError: true,
      });
      continue;
    }
    const r = await tools.execute(w.name, w.input, {
      req,
      tenantId: ctx.tenantId,
    });
    results.push({ id: w.id, name: w.name, ...r });
    done.push({
      name: w.name,
      summary: w.summary,
      ok: !r.isError,
      error: r.isError ? r.content : undefined,
    });
  }
  logger.info(
    { sessionId, approve, actions: writes.map((w) => w.name) },
    'copilot_actions_decided',
  );

  const system = systemPrompt({
    appName: ctx.appName,
    agent: req.agent,
    workspaceName: ctx.workspaceName,
    section,
  });
  const result = await runLoop({
    provider,
    cfg:
      session.provider === ctx.cfg.provider
        ? ctx.cfg
        : { ...ctx.cfg, provider: session.provider },
    system,
    messages: session.messages,
    req,
    tenantId: ctx.tenantId,
    carry: results,
  });
  await pool.query(
    `UPDATE copilot_sessions SET messages = $2, pending = $3, updated_at = NOW() WHERE id = $1`,
    [
      session.id,
      JSON.stringify(result.messages),
      result.pendingState ? JSON.stringify(result.pendingState) : null,
    ],
  );
  return {
    session_id: session.id,
    reply: result.reply,
    pending: result.pending,
    actions: result.actions,
    executed: done,
  };
}

async function status(req) {
  const cfg = await resolveAiConfig(req.agent.tenantId);
  const { brandingForTenant } = require('../agencies');
  const { branding } = await brandingForTenant(req.agent.tenantId);
  return {
    enabled: Boolean(cfg.apiKey),
    provider: cfg.provider,
    model: cfg.model,
    source: cfg.source,
    appName: branding.appName,
  };
}

module.exports = {
  chat,
  confirm,
  status,
  runLoop,
  systemPrompt,
  ensureCopilotSchema,
};
