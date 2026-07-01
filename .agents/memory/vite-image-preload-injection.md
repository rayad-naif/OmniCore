---
name: Vite image preload injection (marketing-site)
description: Why homepage pages preload every image, and how to stop it without breaking SSR prerender
---

Vite's client build injects `<link rel="preload" as="image">` into `dist/public/index.html` for EVERY image that is statically imported (`import x from './x.png'`) anywhere in the eager module graph. In marketing-site all route components are eagerly imported in `App.tsx`, and `prerender.mjs` reuses the built `index.html` as its template — so every prerendered page inherits preloads for images from ALL pages (e.g. home's index.html preloaded the contact page's logo).

**Constraint:** You cannot `React.lazy` the routes to shrink the graph. `entry-server.tsx` uses `renderToString` (synchronous SSR) for the SEO prerender; a lazy component would render an empty Suspense fallback and produce empty prerendered HTML.

**How to keep an image but drop its eager preload:** move it out of Vite's module graph — put it in `public/` and reference it by URL string (`\`${import.meta.env.BASE_URL}media/foo.webp\``) with `loading="lazy" decoding="async"`. Public assets are opaque to Vite, so no preload is emitted, and the SSR HTML still contains a real `<img>` with alt text for SEO.

**Why:** keep preload only for the single true above-the-fold hero (static import + `fetchPriority="high"`); everything below the fold should be lazy public assets.

**Tradeoff:** public assets are unhashed (no content-hash cache-busting) — version the filename when replacing decorative art, or rely on CDN cache policy. Acceptable for marketing decorative imagery.

**Tooling:** ImageMagick (`convert`/`magick`) is available; no `sharp`, no `cwebp`. WebP at q80–82 with `-resize '1600x1600>'` took the homepage art from ~24MB (7 PNGs) to ~484KB total.
