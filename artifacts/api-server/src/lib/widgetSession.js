'use strict';

/**
 * Small, dependency-free decisions used by the public widget endpoints.
 * Keeping these here makes the rules independently testable from Express/PG.
 */

function validateWidgetSessionInput(body) {
  const brandId = typeof body?.brandId === 'string' ? body.brandId.trim() : '';
  if (!brandId) return { ok: false, error: 'brandId is required' };
  return { ok: true, value: { brandId } };
}

function initialConversationStatus(tenant) {
  return tenant?.ai_feature_enabled && tenant?.ai_auto_reply_enabled
    ? 'ai_handling'
    : 'open';
}

async function pickInitialStatus(query, tenantId) {
  try {
    const { rows } = await query(
      'SELECT ai_feature_enabled, ai_auto_reply_enabled FROM tenants WHERE id = $1',
      [tenantId],
    );
    return initialConversationStatus(rows[0]);
  } catch {
    return 'open';
  }
}

// Intentionally preserves the widget's existing truthy-field update semantics.
function visitorUpdateFields({ visitorName, visitorEmail, timezone } = {}) {
  const fields = [];
  const values = [];
  if (visitorName) {
    fields.push('display_name');
    values.push(visitorName);
  }
  if (visitorEmail) {
    fields.push('email');
    values.push(visitorEmail);
  }
  if (timezone) {
    fields.push('timezone');
    values.push(timezone);
  }
  return { fields, values };
}

function visitorOwnsConversation(conversation, visitorId) {
  return Boolean(conversation) && conversation.visitor_id === visitorId;
}

function widgetMessageAccessError(conversation, visitorId) {
  if (!visitorOwnsConversation(conversation, visitorId))
    return 'Conversation not found';
  if (conversation.is_ticket)
    return 'Conversation has been moved to an email ticket';
  if (conversation.status === 'closed') return 'Conversation is closed';
  return null;
}

module.exports = {
  validateWidgetSessionInput,
  initialConversationStatus,
  pickInitialStatus,
  visitorUpdateFields,
  visitorOwnsConversation,
  widgetMessageAccessError,
};
