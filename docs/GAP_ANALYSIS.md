# OmniCore gap analysis

What the platform has today, what is still missing compared with GoHighLevel-style
white-label platforms and modern helpdesks, and what to build next. Written after the
audit-log, integrations, GoHighLevel app, agency white-label, AI assistant and AI
Call Center work (November 2026).

## 1. What OmniCore has now

| Area               | Status                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox & tickets    | Live chat and email in one inbox, tickets, attachments, notes, canned replies, CSAT, contacts, PDF/CSV export                                                                                                                   |
| AI                 | Gemini answers from the knowledge base with human handover; rephrase; summaries; built-in **AI assistant** that explains the product and performs tasks with approval (Gemini, or the agency's own OpenAI/Anthropic/Gemini key) |
| AI Call Center     | Ported from the AI-Call-Center repo: AI receptionist/sales/support phone agents, Command Deck (listen, whisper, take over), QA grading, CRM sync, speed-to-lead, SMS follow-up, reports                                         |
| Integrations       | GoHighLevel two-way app, signed webhooks, REST API v1, Slack/Teams/Discord, Zapier/Make/n8n                                                                                                                                     |
| White-label        | Agencies with client workspaces, branding (name, logo, favicon, colours, login text, custom CSS, email sender, widget "powered by"), custom domains with DNS verification, custom menu links, own AI key                        |
| Admin & compliance | Roles and per-feature permissions, detailed audit log (workspace and platform), super admin console                                                                                                                             |
| Billing            | Paddle checkout, portal, webhooks, plan manager synced to Paddle, trials, grace periods                                                                                                                                         |
| Hosting            | OCI + Cloudflare, Render, Vercel (frontends), Docker; full docs                                                                                                                                                                 |

## 2. Gaps for white-label reselling (GoHighLevel parity)

| #   | Gap                                                                                                                                                                          | Why it matters                                             | Effort                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------- |
| W1  | **Agency rebilling (SaaS mode).** Agencies cannot charge their own clients through their own Paddle/Stripe account or set their own prices; client plans are platform plans. | The main way agencies make money from a reseller platform. | Large                         |
| W2  | **Agency-defined plans and feature toggles** per client (e.g. turn the AI Call Center or integrations on per client). Today: platform plans plus limits.                     | Agencies package tiers for their market.                   | Medium                        |
| W3  | **Snapshots / templates**: copy a configured workspace (knowledge base, canned replies, AI prompts, widget settings, voice setup) into new clients.                          | GHL's most-used agency feature; speeds onboarding.         | Medium                        |
| W4  | **Sender email domain per agency.** Emails show the agency's name and links, but the From address is the platform's SMTP.                                                    | Deliverability and brand consistency.                      | Small                         |
| W5  | **Per-workspace branding for direct customers** (non-agency) on their own domain.                                                                                            | Upsell for single businesses.                              | Small (reuse agency branding) |
| W6  | **Developer apps / marketplace**: third parties register OAuth apps that agencies install (beyond API keys and webhooks).                                                    | "Build and integrate their own features" at scale.         | Large                         |
| W7  | **Branded mobile app** for agents.                                                                                                                                           | GHL offers a white-label mobile app.                       | Large                         |
| W8  | **Public help center** per brand on a custom domain (a `help_center_cname` column exists but is unused).                                                                     | Self-service deflection, SEO.                              | Medium                        |

Deliberately **not** offered: custom JavaScript injection into the dashboard (security
risk for every client of an agency). Custom CSS and embedded custom menu links cover
most needs.

## 3. Product gaps (helpdesk features)

| #   | Gap                                                                                                                                                                                                                           | Effort       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| P1  | **Automation rules** (if conversation matches X → assign/tag/reply/notify) and **SLA timers**. `services/ticket.service.js` contains SLA escalation code that is never called; wire it to a scheduler and brand SLA settings. | Medium       |
| P2  | **Tags** on conversations and contacts, and **custom fields** on contacts/tickets.                                                                                                                                            | Medium       |
| P3  | **Native WhatsApp, SMS, Facebook/Instagram** channels (today only through the GoHighLevel integration).                                                                                                                       | Large        |
| P4  | **Two-factor sign-in** and **SSO (SAML/OIDC)** for enterprise customers.                                                                                                                                                      | Medium       |
| P5  | **Data protection tools**: export/erase a contact's data, retention policies for conversations.                                                                                                                               | Small–medium |
| P6  | **Multi-language** dashboard and chat widget.                                                                                                                                                                                 | Medium       |
| P7  | **Advanced reporting**: first-response/resolution time trends, agent leaderboards beyond CSAT, scheduled report emails.                                                                                                       | Medium       |

## 4. Requested items still blocked

| Item                                                  | Status                                                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HRMS** (super admin manages, plan-gated for users)  | Done: HR module (`/hrms/`), plan switch "HR module", Super Admin → HR. Finance pages still assume PKR/USD (see below).                                   |
| **Reverse DNS tool** (super admin only)               | Done: Super Admin → Reverse DNS.                                                                                                                         |
| **WooCommerce stores** (create, host, design, deploy) | Done: Online Stores (plan feature): hosted stores on store servers, AI/template design, sub-domain + custom domain, connected stores, OmniCore checkout. |
| **Invoicing & client payments** (InvoiceNow)          | Done: Invoices & Payments (plan feature). Paddle, Stripe, PayPal, Square, Authorize.net, Payoneer, bank transfer, COD.                                   |

## 5. Repository hygiene to fix before launch

| Issue                                                                                                          | Recommendation                                                                |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| An RSA **private key** is committed in `attached_assets/` of a public repository.                              | Revoke it, rotate the OCI key, delete the file and purge it from git history. |
| **Customer uploads** from the Replit era are committed under `artifacts/uploads/` (now ignored for new files). | Remove them from the repository and history.                                  |
| Homepage **testimonial** ("Sarah Jenkins, TechFlow") and "thousands of teams" claim.                           | Replace with real customers or remove.                                        |
| **Pricing page** is hard-coded; plans live in the database.                                                    | Render the pricing page from `/api/billing/plans` (public endpoint).          |
| Legacy **Stripe** code paths remain (switched off).                                                            | Remove once no Stripe customers remain.                                       |
| `attached_assets/` contains many prompt notes and screenshots.                                                 | Move out of the repository.                                                   |

## 6. Suggested order

1. Section 5 (security and honesty items) before any public launch.
2. P1 automations + SLA, P2 tags/custom fields: the most-asked helpdesk features.
3. W1–W3 (rebilling, agency plans, snapshots) to make the agency offer complete.
4. Next phases requested: native versions of the GoHighLevel apps (LEAF affiliates, LoyaltyLoop, App Package, Customizer) and the dashboard
   redesign.
5. HR follow-ups: the expenses/earnings and finance pages of the HR app still use PKR and a
   USD→PKR rate from the original company; make the currency a workspace setting before
   selling HR outside Pakistan. HR in-app notification links point to paths that do not
   exist in the HR app (inherited); fix when touching notifications.
6. Payments follow-ups: recurring invoices and subscriptions, refunds issued from the
   dashboard through the processor (today: refund in the processor, then mark refunded),
   and PDF invoices. None of the processors was exercised with a live account from the
   build environment; run one test payment per processor in sandbox mode before launch.
7. Online stores follow-ups: move a store between store servers, product photos from AI,
   off-server backup upload (today: copy the backups folder) and per-store resource graphs.
   Starter products from templates are examples to replace when AI is off.
8. P4 2FA/SSO, P5 data tools before selling to larger companies.
