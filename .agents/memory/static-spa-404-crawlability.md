---
name: Static SPA 404 & crawlability
description: How to get real HTTP 404s and honest noindex on a prerendered Vite SPA served static via artifact.toml rewrites
---

For a Vite+React SPA prerendered to static HTML and served static (`serve = "static"`
in `.replit-artifact/artifact.toml`):

- The rewrites schema supports ONLY internal `from`/`to` rewrites (200-style). There is
  no status-code or 301/redirect option. So you cannot 301 `.html` -> clean URLs, and
  you cannot force a 404 status via a rewrite.
- A blanket `/* -> /index.html` catch-all makes every unknown URL return the 200 home
  shell = soft-404 (crawlers see an indexable page). **Fix: delete the catch-all** and
  enumerate only the genuinely client-only (non-prerendered) routes explicitly (e.g.
  `/checkout`). Unmatched paths then fall through to the host's real HTTP 404.
- Ship a prerendered `404.html` with `noindex, follow` for the host to serve on 404.

**Why the client mirror matters:** the prerendered 404's `noindex` head gets overwritten
on hydration if the client SEO effect falls back unknown routes to the home meta
(`index, follow` + canonical `/`). You must give unknown routes dedicated not-found meta
(noindex, no canonical) so `metaForPath()`, `renderHead()` (build) and `applyMeta()`
(client) all agree. Otherwise JS-rendering crawlers see `index,follow` after hydration.

**How to apply:** edit artifact.toml only via `verifyAndReplaceArtifactToml` (temp file),
never directly. Keep the sitemap listing clean URLs only. Canonicals should self-reference
the clean slash URL of each prerendered page.
