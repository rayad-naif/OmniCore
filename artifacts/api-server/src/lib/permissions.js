'use strict';

/**
 * permissions.js
 * Atelier OmniCore — per-feature RBAC primitives.
 *
 * Each agent has a permission level per feature:
 *   'none'  → cannot see / use the feature
 *   'read'  → can view but not modify
 *   'edit'  → full access (view + modify)
 *
 * Admins always get full ('edit') access to everything regardless of the
 * stored permission map. Non-admins with an empty/missing permission map fall
 * back to sensible role defaults so existing accounts keep working.
 */

// Canonical feature keys. Keep in sync with the dashboard.
const FEATURES = [
  'inbox',          // conversations / chat
  'contacts',       // visitors / contacts directory
  'knowledge_base', // KB articles + AI training
  'brands',         // brand / widget configuration
  'analytics',      // CSAT + reporting
  'billing',        // plans & subscription
  'team',           // agent management
  'settings',       // workspace settings (SMTP, domains, etc.)
];

const LEVELS = { none: 0, read: 1, edit: 2 };

function levelValue(level) {
  return LEVELS[level] ?? 0;
}

// Role fallback maps — only used when an agent has no explicit permissions.
function defaultPermissionsForRole(role) {
  if (role === 'admin') {
    return Object.fromEntries(FEATURES.map((f) => [f, 'edit']));
  }
  if (role === 'supervisor') {
    return {
      inbox: 'edit', contacts: 'edit', knowledge_base: 'edit', brands: 'read',
      analytics: 'read', billing: 'read', team: 'read', settings: 'read',
    };
  }
  // agent
  return {
    inbox: 'edit', contacts: 'read', knowledge_base: 'read', brands: 'none',
    analytics: 'none', billing: 'none', team: 'none', settings: 'none',
  };
}

/**
 * Coerce an arbitrary input object into a complete, valid permission map for
 * the given role. Unknown keys are dropped; missing keys are filled from role
 * defaults; invalid levels are coerced to 'none'.
 */
function normalizePermissions(input, role) {
  const defaults = defaultPermissionsForRole(role);
  const out = {};
  for (const f of FEATURES) {
    const v = input && typeof input === 'object' ? input[f] : undefined;
    out[f] = v && LEVELS[v] !== undefined ? v : defaults[f];
  }
  return out;
}

/**
 * Resolve the effective permission map for an authenticated agent.
 * Admins → everything edit. Non-admins → stored map, or role defaults when empty.
 */
function effectivePermissions(agent) {
  if (!agent) return {};
  if (agent.role === 'admin') {
    return Object.fromEntries(FEATURES.map((f) => [f, 'edit']));
  }
  const stored = agent.permissions;
  const hasStored = stored && typeof stored === 'object' && Object.keys(stored).length > 0;
  return hasStored ? normalizePermissions(stored, agent.role) : defaultPermissionsForRole(agent.role);
}

/** Numeric permission level an agent holds for a feature. */
function permissionLevel(agent, feature) {
  if (agent && agent.role === 'admin') return LEVELS.edit;
  const perms = effectivePermissions(agent);
  return levelValue(perms[feature]);
}

module.exports = {
  FEATURES,
  LEVELS,
  levelValue,
  defaultPermissionsForRole,
  normalizePermissions,
  effectivePermissions,
  permissionLevel,
};
