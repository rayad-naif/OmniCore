---
name: OmniCore stack decisions
description: Non-obvious architectural choices, schema quirks, and demo data for Atelier OmniCore
---

# Socket.io path
Socket.io server is configured with `path: '/api/socket.io'` (not the default `/socket.io`).
**Why:** The Replit reverse proxy routes by path prefix. Only `/api` is wired to port 8080; the default `/socket.io` would miss the proxy and never reach the server.
**How to apply:** Both `socket.service.js` (Server options) and the frontend `io()` call must use `path: '/api/socket.io'`.

# Visitors schema column
Visitors table uses `display_name` (not `name`). All queries must use `COALESCE(v.display_name, v.email, 'Visitor') AS visitor_name`.
**Why:** Schema was designed this way; early controller drafts used `v.name` causing runtime errors.

# Messages sender column
Messages table uses `sender_id` (not `sender_agent_id`). INSERT and JOIN queries must reference `sender_id`.
**Why:** Column was renamed in schema design before the controller was written.

# Demo credentials
- admin@omnicore.test / Admin123! (role: admin, tenantId: 11111111-1111-1111-1111-111111111111)
- sara@omnicore.test / Agent123! (role: agent)

# Seed UUIDs (fixed for deterministic dev data)
- Tenant: 11111111-1111-1111-1111-111111111111
- Brand: 22222222-2222-2222-2222-222222222222 (OmniCore Support)
- Admin agent: 33333333-3333-3333-3333-333333333333
- Sara agent: 44444444-4444-4444-4444-444444444444
- 3 demo visitors: aaaa0001/0002/0003-...
- 3 demo conversations: cccc0001/0002/0003-...

# pgvector
Replit's managed PostgreSQL does not have pgvector extension. The `ai_embeddings` table and vector index in `schema.sql` are skipped in dev setup. Apply tables manually without the vector extension when seeding.

# AuthContext
AuthContext is a `.jsx` file. Dashboard tsconfig has `allowJs: true` to import it from TypeScript. The context uses in-memory access tokens + httpOnly refresh cookie `omnicore_rt` with `path: /api/auth`.

# Schema must be applied manually
No migration runner — apply via executeSql (code_execution sandbox). Schema file at `artifacts/api-server/schema.sql` but skip the `ai_embeddings` / pgvector block. Super-admin.controller.js auto-migrates `upgrade_requests` table and extra tenant columns (`account_status`, `default_timezone`, `ai_auto_reply_enabled`, `plan`) on startup.

# RBAC
Agents (role=agent) only see conversations assigned to them OR unassigned (assigned_agent_id IS NULL). Applied in conversations.controller.js GET /conversations. Sidebar nav is RBAC-aware: agents see Conversations + Settings only; admins add Brands, Team, Billing; super admins add Super Admin panel.

# Super Admin
Controlled by SUPER_ADMIN_EMAIL env var. If unset, super-admin endpoints return 503. isSuperAdmin bool is in JWT payload and safeAgent() response. New controllers: agents.controller.js (GET/POST/DELETE agents, PATCH /me), super-admin.controller.js (tenant list, upgrade requests, status/billing PATCH, purge DELETE).

# JWT_SECRET
Set as a shared env var (not secret) for dev convenience. Value is the 96-char hex string beginning `66a10cf1...`. Ensure it is set before starting api-server or login will throw `JWT_SECRET is not configured`.
