---
name: Socket.io client script behind path proxy
description: Engine.IO's built-in client serving hangs behind Replit's path proxy; serve client-dist via an Express route instead
---

Socket.io's built-in static serving of the browser client (`<path>/socket.io.js`, e.g. `/api/socket.io/socket.io.js`) hangs/502s behind the Replit path-prefix proxy — even when the websocket/polling transport on the same path works fine. Any script tag pointing at it silently fails, so the widget never gets `window.io` and misses ALL real-time events (falls back to 3s polling only).

**Why:** Engine.IO handles the request outside normal Express routing and never responds through the proxy (curl to the port directly also times out).

**How to apply:** Serve the bundle yourself: an Express route (e.g. `GET /api/widget/socket.io.js`) that reads `node_modules/socket.io/client-dist/socket.io.min.js` from disk (resolve via `process.cwd()` candidates — the esbuild-bundled ESM output can't use `require.resolve`) and caches it in memory. Any client that loads socket.io via script tag must use that route. Also keep a non-socket fallback: the widget polling endpoint returns conversation state (`status`, `csatRequested`, `convertedToTicket`) so closures/CSAT surface even if the socket is down; ticket conversions must NOT 403 that endpoint or the fallback breaks.
