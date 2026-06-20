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
- Brand Acme: 22222222-2222-2222-2222-222222222221
- Brand DevCo: 22222222-2222-2222-2222-222222222222
- Admin agent: 33333333-3333-3333-3333-333333333331
- Sara agent: 33333333-3333-3333-3333-333333333332
- 6 visitors/conversations: 444.../555... with sequential last digits 1-6

# pgvector
Replit's managed PostgreSQL does not have pgvector extension. The `ai_embeddings` table and vector index in `schema.sql` are skipped in dev setup. Apply tables manually without the vector extension when seeding.

# AuthContext
AuthContext is a `.jsx` file. Dashboard tsconfig has `allowJs: true` to import it from TypeScript. The context uses in-memory access tokens + httpOnly refresh cookie `omnicore_rt` with `path: /api/auth`.

# JWT_SECRET
Set as a shared env var (not secret) for dev convenience. Value is the 96-char hex string beginning `66a10cf1...`. Ensure it is set before starting api-server or login will throw `JWT_SECRET is not configured`.
