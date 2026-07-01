---
name: Dashboard overlay layering
description: z-index constraint for floating/fixed UI in the agent dashboard so it never covers the trial-lock overlay
---

# Dashboard overlay layering

The dashboard's `TrialGateway` (artifacts/dashboard/src/components/TrialGateway.tsx) renders a full-screen blocking overlay at `zIndex: 9999`, mounted near the end of the `Dashboard()` component in App.tsx (after most content).

**Rule:** Any new floating/fixed element added to the dashboard shell (e.g. the WhatsApp contact button) must use a standard UI layer such as Tailwind `z-50`, NOT `z-[9999]`.

**Why:** With equal z-index, later DOM order wins. A fixed element rendered *after* TrialGateway with the same z-index (9999) stacks *above* the lock/grace overlay that is meant to block all interaction — letting a locked/expired tenant still click it. Keeping floating UI at z-50 guarantees blocking overlays and modals always sit on top.

**How to apply:** When adding fixed/floating widgets to App.tsx's Dashboard shell, cap their z-index well below 9999. Reserve the 9999 tier for full-screen blocking overlays only.
