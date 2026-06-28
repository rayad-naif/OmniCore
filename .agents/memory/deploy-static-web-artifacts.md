---
name: Deploy static web (vite) artifacts
description: Why vite web artifacts must use static production serving, not a custom run command
---

# Vite web artifacts deploy with `serve = "static"`, not a run command

A `react-vite` web artifact's `artifact.toml` production block must use the
platform's static serving, mirroring the scaffold:

```toml
[services.production]
serve = "static"
publicDir = "artifacts/<slug>/dist/public"

[[services.production.rewrites]]
from = "/*"
to = "/index.html"
```

and the vite config must build to `dist/public` (`build.outDir`). The `base`
must equal the artifact `previewPath` (e.g. `/dashboard/`) so emitted asset
URLs carry the prefix.

**Why:** A hand-written `[services.production.run]` of `npx serve -s dist -l 5174`
caused publish to fail. `serve` is not a declared dependency (npx can't fetch it
in the deploy sandbox), so port 5174 never opened — the deploy aborts with
"not all artifact ports opened within timeout expected=[5174 8080] detected=1"
and healthchecks on `/dashboard` return 500. It also ignored the `/dashboard/`
base path. With `serve = static` there is NO process and NO port to bind, so the
whole class of "port never opened" failures disappears.

**How to apply:** Edit `artifact.toml` only via `verifyAndReplaceArtifactToml`
(temp file → validate → replace). Verify the build locally with
`BASE_PATH=/<slug>/ PORT=<port> NODE_ENV=production pnpm --filter @workspace/<slug> run build`
and confirm `dist/public/index.html` references `/<slug>/assets/...`.
