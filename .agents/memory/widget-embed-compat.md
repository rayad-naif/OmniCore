---
name: Widget embed backward-compat
description: Why widget-facing endpoint response shapes must stay backward-tolerant
---

# Embedded widget endpoints must tolerate old + new response shapes

`widget.js` is embedded on third-party customer sites and is HTTP-cached by
their visitors' browsers. You cannot force every site to reload the new bundle,
so a **new server can be hit by a stale old bundle** for a while.

**Rule:** when changing a widget-facing endpoint's response shape (e.g.
`GET /api/widget/messages`), keep the client poll/handlers tolerant of BOTH the
old and new shapes, and prefer additive changes (add fields, don't repurpose the
top-level type).

**Why:** `GET /api/widget/messages` was changed from returning a bare array to
returning `{ messages, status, csatRequested, csatScore }`. The new bundle reads
both (`Array.isArray(data) ? data : data.messages`), but an *old cached* bundle
expects an array and silently stops polling against the new object response.
Polling is only a fallback (socket.io is primary), so impact is limited, but it
is a real cross-version degradation.

**How to apply:** before deploying any widget endpoint shape change, confirm the
client tolerates the previous shape, or version the endpoint. Matters most at
deploy time, not in dev.
