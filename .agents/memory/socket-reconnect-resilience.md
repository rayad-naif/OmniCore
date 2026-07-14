---
name: Socket.io client reconnect resilience
description: Why capped reconnection attempts + short-lived JWT auth silently kills dashboard real-time updates
---

Rule: never cap socket.io client `reconnectionAttempts` when the server can restart (dev workflow restarts rebuild for ~15s+), and never let reconnects reuse a stale short-lived JWT.

**Why:** The dashboard socket used `reconnectionAttempts: 5` with a 15-min access token in `auth`. An API server restart outlasted the 5 retries, so the socket gave up permanently — no toasts or live messages until the token-refresh remount (up to ~14 min). Symptom looked like "broadcast doesn't work" but the server was fine; the tell in logs was the new conversation appearing exactly on the 30s polling tick instead of instantly.

**How to apply:**
- Retry forever (socket.io default) and refresh `socket.auth` from a token ref on every `reconnect_attempt`.
- A middleware auth rejection (`connect_error` with `socket.active === false`) stops auto-retry — needs a guarded manual `socket.connect()` retry with a fresh token.
- On every `connect`, re-join rooms AND refresh list state to recover events missed while offline.
