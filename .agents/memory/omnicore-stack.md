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
- superadmin@omnicore.test / SuperAdmin1! (role: admin, isSuperAdmin: true, UUID: 55555555-5555-5555-5555-555555555555)

# Gemini model
GEMINI_API_KEY works with `gemini-2.5-flash` only (gemini-1.5-flash and gemini-2.0-flash both 404). Set GENERATION_MODEL = 'gemini-2.5-flash' in ai.service.js.
**Why:** The user's API key only has access to specific model versions in the v1beta endpoint.

# Forgot-password flow
password_reset_tokens table (id, agent_id, token, expires_at, used_at) added to DB manually. POST /api/auth/forgot-password returns reset_link in dev (NODE_ENV !== production). POST /api/auth/reset-password validates token + expiry. UI views: ForgotPasswordPage, ResetPasswordPage. Root App detects ?reset_token= param on load to auto-route to reset view.

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
No migration runner. Schema file at `artifacts/api-server/schema.sql` but skip pgvector extension and `ai_embeddings` table. Run seed script from `artifacts/api-server/` directory using `bcryptjs` (not `bcrypt`). Extra tenant columns (`account_status`, `default_timezone`, `ai_auto_reply_enabled`, `plan`, `smtp_config_json`, `max_brands_allowed`, `max_agents_allowed`, `ai_feature_enabled`, `smtp_feature_enabled`, `conversation_limit`, `custom_domain`) are all included directly in the CREATE TABLE — no separate ALTER needed. `visitors` table needs `timezone TEXT` column. `messages` table needs `updated_at` column. `upgrade_requests` table must be in base schema (not auto-migrated).

# Notes (internal notes) send chain
Frontend sends `{ body, isInternalNote }` (camelCase) to POST /conversations/:id/messages. The API reads `isInternalNote` from req.body. The `EmailComposeBox.onSend` signature is `(body: string, isInternalNote?: boolean) => Promise<void>`. `handleSend` in Dashboard passes `isInternalNote` through to `api.sendMessage(activeId, body, isInternalNote)`. Do NOT use snake_case `is_internal_note` in the frontend JSON body.

# RBAC
Agents (role=agent) only see conversations assigned to them OR unassigned (assigned_agent_id IS NULL). Applied in conversations.controller.js GET /conversations. Sidebar nav is RBAC-aware: agents see Conversations + Settings only; admins add Brands, Team, Billing; super admins add Super Admin panel.

# Super Admin
Controlled by SUPER_ADMIN_EMAIL env var. If unset, super-admin endpoints return 503. isSuperAdmin bool is in JWT payload and safeAgent() response. New controllers: agents.controller.js (GET/POST/DELETE agents, PATCH /me), super-admin.controller.js (tenant list, upgrade requests, status/billing PATCH, purge DELETE). Super admins management panel (add/remove) at GET/POST/DELETE /api/super-admin/super-admins — already fully implemented on backend.

# req.db vs pool — critical pattern
All controllers must import pool directly: `const { pool } = require('../lib/db')`. Express does NOT attach a `req.db` property — any controller using `req.db.query(...)` will throw "Cannot read properties of undefined". Always use `pool.query()` directly, never `req.db`.
**Why:** Discovered that tenant.controller.js and email.webhook.controller.js both used req.db throughout, causing all their endpoints to throw 500 errors at runtime.

# Widget socket authentication
The embeddable widget must pass `auth: { sessionToken: state.sessionToken }` to the socket.io options when calling `w.io(API_ORIGIN, { ..., auth: { sessionToken: state.sessionToken } })`. Without it, the socket middleware rejects the connection as UNAUTHENTICATED.
**Why:** socket.service.js checks `socket.handshake.auth.sessionToken` to identify widget visitors. Missing auth causes all widget messages to be silently dropped.

# Inbound email webhook routes
Two routes registered: `/inbound-mail` (legacy) and `/email/inbound` (canonical). Both handled by the same `handleInboundEmail` async function. The Settings UI shows the canonical URL. Handler must call `res.status(200).json({ received: true })` synchronously before doing async DB work — email providers retry on non-2xx.

# Typing indicators — socket events
Socket events: `visitor:is_typing` → payload `{conversationId, displayName}`, `visitor:typing_stopped` → `{conversationId}`. Same pattern for `agent:is_typing` / `agent:typing_stopped`. Dashboard maintains `typingInfo: Record<string,string>` state with 5s auto-clear timers (stored in `typingTimers` ref). The `typingWho` prop flows into ChatPanel and is displayed above EmailComposeBox as an animated bouncing dots indicator.

# JWT_SECRET
Set as a shared env var (not secret) for dev convenience. Value is the 96-char hex string beginning `66a10cf1...`. Ensure it is set before starting api-server or login will throw `JWT_SECRET is not configured`.

# Active dashboard is App.tsx — Inbox.jsx is DEAD CODE
`main.tsx` renders `App.tsx`. `pages/Inbox.jsx` is NOT imported anywhere and is dead code. Any agent-facing dashboard feature (composer, canned responses, page tracking, telemetry) must be implemented in `App.tsx`. The composer is `EmailComposeBox` (TipTap/ProseMirror, not a plain textarea) — slash-command UX must hook `editorProps.handleKeyDown` + `onUpdate`, using refs to avoid stale closures since `useEditor` config is captured once.
**Why:** Time was lost building canned responses in Inbox.jsx before realizing it's unused.

# Two widget implementations — demo uses the embedded one
The customer/demo widget served at `GET /api/widget/widget.js` is the embedded IIFE bundle inside `widget.controller.js` (the big template literal). `artifacts/api-server/public/omnicore-widget.js` is a SEPARATE, unused-by-demo file. Widget behavior changes (SPA URL tracking, conversation:closed handling) must go in the embedded bundle in `widget.controller.js`, not the public file.
**Why:** SPA tracking was first added to the wrong (public) file, so it appeared "not working" on the demo.

# Page-URL tracking is socket-only + persisted fallback
Widget emits `visitor:page_change` (full url) and `client:page_view` (url+path, debounced) only when a conversationId exists and socket connected. Real-time forwarding only reaches agents already in the `conv:<id>` room. For reliability, `conversations.current_url` (self-healing column) is persisted in both socket handlers; the dashboard falls back to `conv.current_url` so "Current Page" shows on open regardless of room timing. `client:page_view` also inserts `Visited: <path>` system messages → page history.

# Convert-to-ticket closes the widget conversation
PATCH /conversations/:id with `is_ticket:true` (when not already a ticket) also sets `channel='email'` and `status='submitted'` (unless status explicitly provided), assigns ticket_number, and emits `conversation:closed` (converted_to_ticket:true) to the visitor + conv room so the widget bubble closes. Widget session lookup excludes `is_ticket=true` rows (tickets never reload into the widget) and the widget message endpoint rejects is_ticket conversations (409). Tickets are email conversations, not widget-accessible.
