---
name: Cookie Secure flag on self-hosted HTTP
description: Auth refresh cookie requires COOKIE_SECURE=false on plain-HTTP deployments; otherwise sessions die on every reload
---

## Rule
Set `COOKIE_SECURE=false` in the Oracle VM `.env` (and any non-HTTPS self-hosted env).
The auth cookie in `artifacts/api-server/src/controllers/auth.controller.js` uses:
```js
secure: process.env.COOKIE_SECURE !== undefined
  ? process.env.COOKIE_SECURE === 'true'
  : process.env.NODE_ENV === 'production'
```

**Why:** Without this, `NODE_ENV=production` + HTTP = cookie sent with `Secure` flag, browser silently drops it on each reload, session lost.

**How to apply:** Any new non-HTTPS deployment needs `COOKIE_SECURE=false` in its env. HTTPS deployments leave it unset (defaults to `true` in production).

PM2 note: `pm2 restart --update-env` does NOT re-read the `.env` file. You must `pm2 delete && pm2 start ecosystem.config.cjs` to pick up new env vars.
