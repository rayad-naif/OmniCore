# Atelier OmniCore

Multi-tenant SaaS omnichannel helpdesk and AI customer support platform. Agents handle conversations from a real-time dashboard; visitors chat via an embeddable JS widget.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server on port 8080
- `pnpm --filter @workspace/dashboard run dev` — React dashboard on port 5174
- `pnpm run typecheck` — full typecheck across all packages
- Required env: `DATABASE_URL`, `JWT_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Socket.io (real-time)
- DB: PostgreSQL (Replit managed)
- Auth: JWT (15 min access token in-memory) + httpOnly refresh cookie (7 days)
- Dashboard: React 19 + Vite + Tailwind v4
- Widget: Vanilla JS, embeds on any site
- AI: Gemini 1.5 Flash (needs `GEMINI_API_KEY`)
- Billing: Lemon Squeezy (needs `LEMON_SQUEEZY_*`)
- Export: Cloudflare R2 (needs `R2_*`)

## Where things live

- `artifacts/api-server/src/` — Express API + socket.io
  - `controllers/auth.controller.js` — login / refresh / logout
  - `controllers/conversations.controller.js` — conversations + messages CRUD
  - `controllers/widget.controller.js` — widget session + widget.js bundle
  - `services/socket.service.js` — Socket.io server (path: `/api/socket.io`)
  - `schema.sql` — PostgreSQL schema (apply manually; no Drizzle)
- `artifacts/dashboard/src/` — React agent dashboard
  - `App.tsx` — full dashboard (Login, Conversations, Chat, Brands, Billing, Settings)
  - `context/AuthContext.jsx` — JWT auth context with silent refresh
- Widget demo: `GET /api/widget/demo`
- Widget embed: `GET /api/widget/widget.js`

## Architecture decisions

- Socket.io path is `/api/socket.io` (not default `/socket.io`) so Replit's path-prefix proxy routes it to port 8080.
- Visitors table uses `display_name` (not `name`). All queries use `COALESCE(v.display_name, v.email, 'Visitor')`.
- Messages table uses `sender_id` (not `sender_agent_id`).
- Widget session endpoint at `/api/widget/session` is unauthenticated + CORS `*` — visitor-facing.
- `AuthContext.jsx` kept as JSX; `allowJs: true` in dashboard tsconfig.

## Product

- **Agent Dashboard** — `/dashboard/` — login, conversation list with status/priority/search filters, real-time chat via socket.io, status changes, Export PDF
- **Embeddable Widget** — `<script src=".../api/widget/widget.js" data-brand-id="...">` — floating chat bubble on customer sites
- **Multi-tenant** — tenants → brands → agents/visitors
- **Real-time** — socket.io broadcasts agent/visitor messages instantly

## Demo credentials

- admin@omnicore.test / Admin123!
- sara@omnicore.test / Agent123!

## Gotchas

- Always restart api-server after env var changes (JWT_SECRET must be present or login throws)
- `pnpm --filter @workspace/dashboard install` needed after adding new dashboard deps
- pgvector extension not available on Replit Postgres — `ai_embeddings` table is excluded from schema
- Widget demo page: `GET /api/widget/demo` — loads real widget on a test page

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._
