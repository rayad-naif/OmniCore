# Atelier OmniCore — Complete File Tree

```
atelier-omnicore/
├── .agents/
│   ├── agent_assets_metadata.toml
│   └── memory/
│       ├── MEMORY.md
│       ├── dashboard-overlay-layering.md
│       ├── deploy-static-web-artifacts.md
│       ├── omnicore-stack.md
│       ├── paddle-integration.md
│       ├── static-spa-404-crawlability.md
│       ├── vite-image-preload-injection.md
│       └── widget-embed-compat.md
├── artifacts/
│   ├── api-server/
│   │   ├── .replit-artifact/
│   │   │   └── artifact.toml
│   │   ├── brand-logo.jpg
│   │   ├── build.mjs
│   │   ├── package.json
│   │   ├── schema.sql
│   │   ├── server.js
│   │   ├── tsconfig.json
│   │   ├── public/
│   │   │   └── omnicore-widget.js
│   │   └── src/
│   │       ├── index.ts                     — server entrypoint (boot + Stripe init)
│   │       ├── app.ts                       — Express app & middleware chain
│   │       ├── brand-logo.jpg
│   │       ├── package.json
│   │       ├── controllers/
│   │       │   ├── agents.controller.js
│   │       │   ├── auth.controller.js
│   │       │   ├── billing.controller.js
│   │       │   ├── canned-responses.controller.js
│   │       │   ├── contacts.controller.js
│   │       │   ├── conversations.controller.js
│   │       │   ├── email.webhook.controller.js
│   │       │   ├── signup.controller.js
│   │       │   ├── super-admin.controller.js
│   │       │   ├── tenant.controller.js
│   │       │   └── widget.controller.js
│   │       ├── lib/
│   │       │   ├── billingProvider.js
│   │       │   ├── db.js
│   │       │   ├── env.js
│   │       │   ├── logger.ts
│   │       │   ├── paddleClient.js
│   │       │   ├── permissions.js
│   │       │   ├── plansRepo.js
│   │       │   ├── r2.js
│   │       │   └── stripeClient.ts
│   │       ├── middleware/
│   │       │   └── auth.js
│   │       ├── middlewares/
│   │       │   └── .gitkeep
│   │       ├── routes/
│   │       │   ├── ai.router.js
│   │       │   ├── billing.router.js
│   │       │   ├── health.ts
│   │       │   └── index.ts
│   │       ├── services/
│   │       │   ├── ai.service.js
│   │       │   ├── email.service.js
│   │       │   ├── export.service.js
│   │       │   ├── socket.service.js
│   │       │   └── ticket.service.js
│   │       ├── utils/
│   │       │   └── logger.js
│   │       └── workers/
│   │           └── crawler.worker.js
│   ├── dashboard/
│   │   ├── .replit-artifact/
│   │   │   └── artifact.toml
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── public/
│   │   │   ├── apple-touch-icon.png
│   │   │   ├── favicon-32.png
│   │   │   ├── icon-192.png
│   │   │   ├── icon-512.png
│   │   │   ├── manifest.webmanifest
│   │   │   └── sw.js
│   │   ├── src/
│   │   │   ├── App.tsx                  — main dashboard (all sections + API client + Chat)
│   │   │   ├── main.tsx
│   │   │   ├── index.css
│   │   │   ├── vite-env.d.ts
│   │   │   ├── assets/
│   │   │   │   └── omnicore-logo.png
│   │   │   ├── components/
│   │   │   │   ├── ArticleEditor.jsx
│   │   │   │   ├── CrawlerModal.jsx
│   │   │   │   └── TrialGateway.jsx
│   │   │   ├── context/
│   │   │   │   └── AuthContext.jsx
│   │   │   ├── layouts/
│   │   │   │   └── DashboardLayout.jsx
│   │   │   └── pages/
│   │   │       ├── Billing.jsx
│   │   │       ├── BrandSettings.jsx
│   │   │       ├── Inbox.jsx
│   │   │       ├── KnowledgeBase.jsx
│   │   │       └── Login.jsx
│   │   └── dist/
│   ├── marketing-site/
│   │   ├── .replit-artifact/
│   │   │   └── artifact.toml
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── components.json
│   │   ├── prerender.mjs
│   │   ├── public/
│   │   │   ├── favicon.jpg
│   │   │   ├── favicon.svg
│   │   │   ├── llms.txt
│   │   │   ├── robots.txt
│   │   │   ├── sitemap.xml
│   │   │   ├── media/
│   │   │   │   ├── abstract-1.webp
│   │   │   │   ├── abstract-2.webp
│   │   │   │   ├── core-benefits.webp
│   │   │   │   ├── core-features.webp
│   │   │   │   ├── feature-1.webp
│   │   │   │   └── feature-2.webp
│   │   │   └── opengraph.jpg
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   ├── entry-server.tsx
│   │   │   ├── index.css
│   │   │   ├── assets/
│   │   │   │   └── hero.webp
│   │   │   ├── components/
│   │   │   │   ├── booking-calendar.tsx
│   │   │   │   ├── layout.tsx
│   │   │   │   └── ui/                      — Radix UI primitives (full shadcn-style set)
│   │   │   │       ├── accordion.tsx
│   │   │   │       ├── alert-dialog.tsx
│   │   │   │       ├── alert.tsx
│   │   │   │       ├── aspect-ratio.tsx
│   │   │   │       ├── avatar.tsx
│   │   │   │       ├── badge.tsx
│   │   │   │       ├── breadcrumb.tsx
│   │   │   │       ├── button-group.tsx
│   │   │   │       ├── button.tsx
│   │   │   │       ├── calendar.tsx
│   │   │   │       ├── card.tsx
│   │   │   │       ├── carousel.tsx
│   │   │   │       ├── chart.tsx
│   │   │   │       ├── checkbox.tsx
│   │   │   │       ├── collapsible.tsx
│   │   │   │       ├── command.tsx
│   │   │   │       ├── context-menu.tsx
│   │   │   │       ├── dialog.tsx
│   │   │   │       ├── drawer.tsx
│   │   │   │       ├── dropdown-menu.tsx
│   │   │   │       ├── empty.tsx
│   │   │   │       ├── field.tsx
│   │   │   │       ├── form.tsx
│   │   │   │       ├── hover-card.tsx
│   │   │   │       ├── input-group.tsx
│   │   │   │       ├── input-otp.tsx
│   │   │   │       ├── input.tsx
│   │   │   │       ├── item.tsx
│   │   │   │       ├── kbd.tsx
│   │   │   │       ├── label.tsx
│   │   │   │       ├── menubar.tsx
│   │   │   │       ├── navigation-menu.tsx
│   │   │   │       ├── pagination.tsx
│   │   │   │       ├── popover.tsx
│   │   │   │       ├── progress.tsx
│   │   │   │       ├── radio-group.tsx
│   │   │   │       ├── resizable.tsx
│   │   │   │       ├── scroll-area.tsx
│   │   │   │       ├── select.tsx
│   │   │   │       ├── separator.tsx
│   │   │   │       ├── sheet.tsx
│   │   │   │       ├── sidebar.tsx
│   │   │   │       ├── skeleton.tsx
│   │   │   │       ├── slider.tsx
│   │   │   │       ├── sonner.tsx
│   │   │   │       ├── spinner.tsx
│   │   │   │       ├── switch.tsx
│   │   │   │       ├── table.tsx
│   │   │   │       ├── tabs.tsx
│   │   │   │       ├── textarea.tsx
│   │   │   │       ├── toaster.tsx
│   │   │   │       ├── toast.tsx
│   │   │   │       ├── toggle-group.tsx
│   │   │   │       ├── toggle.tsx
│   │   │   │       └── tooltip.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── use-mobile.tsx
│   │   │   │   └── use-toast.ts
│   │   │   ├── lib/
│   │   │   │   ├── seo.ts
│   │   │   │   └── utils.ts
│   │   │   └── pages/
│   │   │       ├── checkout-success.tsx
│   │   │       ├── checkout.tsx
│   │   │       ├── contact.tsx
│   │   │       ├── help-ai-bot-setup.tsx
│   │   │       ├── help-google-workspace-forwarding.tsx
│   │   │       ├── help-microsoft-365-email-setup.tsx
│   │   │       ├── help.tsx
│   │   │       ├── home.tsx
│   │   │       ├── not-found.tsx
│   │   │       ├── pricing.tsx
│   │   │       ├── privacy.tsx
│   │   │       ├── refunds.tsx
│   │   │       └── terms.tsx
│   │   └── dist/
│   ├── mockup-sandbox/
│   │   ├── .replit-artifact/
│   │   │   └── artifact.toml
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── components.json
│   │   ├── mockupPreviewPlugin.ts
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   ├── index.css
│   │   │   ├── .generated/
│   │   │   │   └── mockup-components.ts
│   │   │   ├── components/
│   │   │   │   ├── mockups/
│   │   │   │   └── ui/                      — same Radix/shadcn UI primitives
│   │   │   ├── hooks/
│   │   │   │   ├── use-mobile.tsx
│   │   │   │   └── use-toast.ts
│   │   │   └── lib/
│   │   │       └── utils.ts
│   │   └── dist/
│   └── uploads/
│       └── 1782*.{csv,png,txt}               — runtime uploaded files
├── docs/
│   ├── OmniCore-Developer-Guide.pdf
│   └── project-file-tree.md               — this file
├── lib/
│   ├── api-client-react/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── custom-fetch.ts
│   │       └── generated/
│   │           ├── api.schemas.ts
│   │           └── api.ts
│   ├── api-spec/
│   │   ├── package.json
│   │   ├── orval.config.ts
│   │   └── openapi.yaml
│   ├── api-zod/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       └── generated/
│   │           ├── api.ts
│   │           └── types/
│   │               ├── healthStatus.ts
│   │               └── index.ts
│   └── db/
│       ├── package.json
│       ├── tsconfig.json
│       ├── drizzle.config.ts
│       └── src/
│           ├── index.ts
│           └── schema/
│               └── index.ts
├── scripts/
│   ├── package.json
│   ├── tsconfig.json
│   ├── post-merge.sh
│   ├── generate-dev-guide.mjs
│   └── src/
│       ├── hello.ts
│       ├── seed-paddle-products.ts
│       ├── seed-stripe-products.ts
│       └── stripeClient.ts
├── Root config files
│   ├── package.json
│   ├── pnpm-workspace.yaml
│   ├── tsconfig.base.json
│   ├── tsconfig.json
│   ├── README.md
│   ├── replit.md
│   └── seo_strategy.md
└── attached_assets/
    └── (design assets, screenshots, reference files)
```
