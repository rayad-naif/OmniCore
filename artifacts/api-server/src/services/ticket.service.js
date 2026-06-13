'use strict';

/**
 * ticket.service.js
 * Atelier OmniCore — Agent Assignment Engine
 *
 * Assignment strategies:
 *  - ROUND_ROBIN   — cycles through eligible agents in order of least-recently assigned
 *  - LEAST_LOAD    — assigns to the agent with the fewest open conversations
 *  - MANUAL        — no auto-assignment; relies on explicit agent selection
 *
 * Eligibility rules (all must be met):
 *  1. agent.is_active = TRUE
 *  2. agent.tenant_id = conversation.tenant_id
 *  3. brand_id is in agent.brand_access_array  (or agent is an admin)
 *
 * SLA: after assignment, sla_breach_at is set to NOW() + brand-level SLA window
 * (defaults to 8 hours if not configured in widget_config_json).
 */

const { pool } = require('../lib/db');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STRATEGY       = Object.freeze({ ROUND_ROBIN: 'round_robin', LEAST_LOAD: 'least_load', MANUAL: 'manual' });
const DEFAULT_SLA_H  = 8;     // hours until SLA breach if not set on brand

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fetch eligible agents for a brand within a tenant.
 * Returns agents ordered by last_assigned_at ASC (oldest first = round-robin order).
 */
async function getEligibleAgents(client, { tenantId, brandId }) {
  const { rows } = await client.query(
    `SELECT a.id, a.name, a.role,
            COALESCE(MAX(c.updated_at), '1970-01-01') AS last_assigned_at,
            COUNT(c.id) FILTER (WHERE c.status IN ('open','ai_handling')) AS open_count
     FROM agents a
     LEFT JOIN conversations c ON c.assigned_agent_id = a.id
     WHERE a.tenant_id  = $1
       AND a.is_active  = TRUE
       AND (
             a.role = 'admin'
          OR $2 = ANY(a.brand_access_array)
       )
     GROUP BY a.id, a.name, a.role
     ORDER BY last_assigned_at ASC, open_count ASC`,
    [tenantId, brandId]
  );
  return rows;
}

/**
 * Read the SLA window (hours) from brand widget_config_json.
 * Falls back to DEFAULT_SLA_H.
 */
async function getSlaHours(client, brandId) {
  const { rows } = await client.query(
    `SELECT widget_config_json->>'sla_first_response_hours' AS sla_h
     FROM brands WHERE id = $1`,
    [brandId]
  );
  const raw = rows[0]?.sla_h;
  const h   = raw ? parseFloat(raw) : NaN;
  return isNaN(h) || h <= 0 ? DEFAULT_SLA_H : h;
}

/**
 * Apply assignment: update the conversation row and return the updated record.
 */
async function applyAssignment(client, { conversationId, agentId, slaHours }) {
  const { rows } = await client.query(
    `UPDATE conversations
     SET assigned_agent_id = $1,
         status            = CASE WHEN status = 'ai_handling' THEN 'open' ELSE status END,
         sla_breach_at     = NOW() + ($2 || ' hours')::INTERVAL,
         updated_at        = NOW()
     WHERE id = $3
     RETURNING id, assigned_agent_id, status, sla_breach_at`,
    [agentId, slaHours.toString(), conversationId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * assignAgent
 *
 * Assigns an agent to a conversation using the specified strategy.
 *
 * @param {object} opts
 * @param {string} opts.conversationId  UUID of the target conversation
 * @param {string} [opts.strategy]      One of STRATEGY values; defaults to ROUND_ROBIN
 * @param {string} [opts.manualAgentId] Required when strategy = MANUAL
 * @param {object} [opts.io]            Optional Socket.io instance for real-time notification
 *
 * @returns {{ conversation, agent } | { error: string }}
 */
async function assignAgent({
  conversationId,
  strategy = STRATEGY.ROUND_ROBIN,
  manualAgentId = null,
  io = null,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the conversation row to prevent concurrent double-assignment
    const { rows: convRows } = await client.query(
      `SELECT id, tenant_id, brand_id, assigned_agent_id, status
       FROM conversations WHERE id = $1 FOR UPDATE`,
      [conversationId]
    );

    if (!convRows.length) {
      await client.query('ROLLBACK');
      return { error: 'CONVERSATION_NOT_FOUND' };
    }

    const conv = convRows[0];

    if (conv.status === 'closed') {
      await client.query('ROLLBACK');
      return { error: 'CONVERSATION_CLOSED' };
    }

    let selectedAgent = null;

    if (strategy === STRATEGY.MANUAL) {
      if (!manualAgentId) {
        await client.query('ROLLBACK');
        return { error: 'MANUAL_AGENT_ID_REQUIRED' };
      }
      const { rows } = await client.query(
        `SELECT id, name FROM agents
         WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE`,
        [manualAgentId, conv.tenant_id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return { error: 'AGENT_NOT_ELIGIBLE' };
      }
      selectedAgent = rows[0];

    } else {
      const eligible = await getEligibleAgents(client, {
        tenantId: conv.tenant_id,
        brandId:  conv.brand_id,
      });

      if (!eligible.length) {
        await client.query('ROLLBACK');
        return { error: 'NO_ELIGIBLE_AGENTS' };
      }

      if (strategy === STRATEGY.LEAST_LOAD) {
        // eligible is already sorted by open_count ASC (secondary sort in getEligibleAgents)
        selectedAgent = eligible.reduce((min, a) =>
          Number(a.open_count) < Number(min.open_count) ? a : min
        );
      } else {
        // ROUND_ROBIN: pick the agent with the oldest last_assigned_at
        // eligible is already sorted last_assigned_at ASC
        selectedAgent = eligible[0];
      }
    }

    const slaHours   = await getSlaHours(client, conv.brand_id);
    const updated    = await applyAssignment(client, {
      conversationId,
      agentId: selectedAgent.id,
      slaHours,
    });

    await client.query('COMMIT');

    // Real-time notification
    if (io) {
      io.to(`conv:${conversationId}`).emit('server:conversation_assigned', {
        conversationId,
        agentId:     selectedAgent.id,
        agentName:   selectedAgent.name,
        slaBreachAt: updated.sla_breach_at,
      });

      // Personal notification socket room per agent  (join via 'join:agent_room' event)
      io.to(`agent:${selectedAgent.id}`).emit('server:ticket_assigned', {
        conversationId,
        slaBreachAt: updated.sla_breach_at,
      });
    }

    return { conversation: updated, agent: selectedAgent };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ticket.service] assignAgent error', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * unassignAgent
 * Removes the assigned agent from a conversation and clears sla_breach_at.
 * tenantId is required — enforces cross-tenant isolation.
 */
async function unassignAgent({ conversationId, tenantId, io = null }) {
  if (!tenantId) throw new Error('tenantId is required in unassignAgent');
  const { rows } = await pool.query(
    `UPDATE conversations
     SET assigned_agent_id = NULL,
         sla_breach_at     = NULL,
         updated_at        = NOW()
     WHERE id = $1
       AND tenant_id = $2
     RETURNING id, status, updated_at`,
    [conversationId, tenantId]
  );
  if (!rows.length) return { error: 'CONVERSATION_NOT_FOUND' };

  if (io) {
    io.to(`conv:${conversationId}`).emit('server:conversation_unassigned', { conversationId });
  }

  return { conversation: rows[0] };
}

/**
 * autoAssignIncoming
 * Convenience wrapper called when a new conversation arrives (AI handover or new inbound email).
 * Uses ROUND_ROBIN by default.
 */
async function autoAssignIncoming({ conversationId, io = null }) {
  return assignAgent({ conversationId, strategy: STRATEGY.ROUND_ROBIN, io });
}

/**
 * checkSlaBreaches
 * Returns conversations that have breached SLA and are still open.
 * Call this from a scheduled job (e.g. every 5 min via setInterval or a BullMQ cron).
 */
async function checkSlaBreaches({ tenantId } = {}) {
  const conditions = ['c.sla_breach_at <= NOW()', "c.status IN ('open','ai_handling')"];
  const values     = [];

  if (tenantId) {
    conditions.push(`c.tenant_id = $${values.length + 1}`);
    values.push(tenantId);
  }

  const { rows } = await pool.query(
    `SELECT c.id, c.tenant_id, c.brand_id, c.assigned_agent_id,
            c.sla_breach_at, c.status, c.priority,
            v.email AS visitor_email
     FROM conversations c
     JOIN visitors v ON v.id = c.visitor_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.sla_breach_at ASC`,
    values
  );
  return rows;
}

/**
 * escalateSlaBreaches
 * Marks breached conversations as high/urgent priority and notifies supervisors.
 * Designed to be called by a periodic scheduler.
 *
 * @param {object} opts
 * @param {object} [opts.io]  Socket.io instance for real-time escalation events
 */
async function escalateSlaBreaches({ io = null } = {}) {
  const breached = await checkSlaBreaches();
  if (!breached.length) return { escalated: 0 };

  const ids = breached.map(r => r.id);

  await pool.query(
    `UPDATE conversations
     SET priority   = CASE WHEN priority = 'normal' THEN 'high'
                           WHEN priority = 'high'   THEN 'urgent'
                           ELSE priority END,
         updated_at = NOW()
     WHERE id = ANY($1::uuid[])`,
    [ids]
  );

  if (io) {
    for (const conv of breached) {
      io.to(`conv:${conv.id}`).emit('server:sla_breach', {
        conversationId: conv.id,
        slaBreachAt:    conv.sla_breach_at,
      });
      // Notify supervisors in the tenant's admin room
      io.to(`tenant:${conv.tenant_id}:supervisors`).emit('server:sla_breach', conv);
    }
  }

  console.log(`[ticket.service] escalated ${ids.length} SLA-breached conversations`);
  return { escalated: ids.length, conversationIds: ids };
}

module.exports = {
  STRATEGY,
  assignAgent,
  unassignAgent,
  autoAssignIncoming,
  checkSlaBreaches,
  escalateSlaBreaches,
};
