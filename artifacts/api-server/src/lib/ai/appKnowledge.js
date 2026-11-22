'use strict';

/**
 * appKnowledge.js
 * What the in-app copilot knows about the product. Kept as a bundled string
 * (no file I/O) so it works on every host. The product name is replaced with
 * the agency's app name for white-labelled workspaces.
 * Update this when features change (see docs/USER_GUIDE.md).
 */

const KNOWLEDGE = `
# OmniCore — product manual for the assistant

OmniCore is a multi-brand customer-support platform: live chat, email, AI answers,
tickets, contacts, ratings, integrations and billing in one dashboard at /dashboard/.

## Sections (sidebar) and what they are for
- Inbox (conversations): every chat and email. Filters All / Open / Pending / AI / Closed, search.
  Open a conversation to reply, attach files, add an internal note (team only), type "/" for
  saved replies, use Rephrase to rewrite a draft, assign, set priority, convert to a ticket,
  close (closing can ask the customer for a CSAT rating). The right panel shows the visitor,
  the page they are on and their history.
- Tickets: conversations marked as tickets, with ticket numbers and priority. Created by
  converting a chat, by the widget's offline form, by email, by the REST API or from GoHighLevel.
- Contacts: everyone who contacted the workspace, with their conversation history; CSV export.
- HR (plans with the HR module): sidebar → HR → Open HR opens the HR app in a new tab with single
  sign-on. It covers employees, departments, shift types and assignments, attendance (check-in/out,
  biometric devices, desktop activity agent), leave and late requests with approvals, shift swaps,
  payroll with payslips, advances, loans and salary holds, expenses and earnings, recruitment (jobs,
  candidate pipeline, AI resume screening), performance reviews and reports. Employees have their own
  HR sign-in (link under HR → Links). Attendance uses the workspace time zone (Settings → Workspace).
- AI Call Center: an AI phone receptionist with Sales and Support agents on the workspace's own
  number (bring-your-own Twilio, Vapi and OpenAI keys). Tabs: Command Deck (live calls with
  real-time transcript; admins and supervisors can listen in, whisper instructions to the AI,
  make it say a line, mute it, transfer, end, or take over the call in the browser), Call history,
  Leads (speed-to-lead: a HighLevel workflow webhook makes the AI call new leads back within
  seconds during calling hours, with retries, a daily cap and Do-Not-Disturb handling), Reports
  (calls, bookings, booking rate, estimated revenue, return on AI cost, staff hours saved, CSV) and
  Setup (keys, business details, industry templates, voice and language incl. Spanish, booking
  calendar, pipeline stage per call outcome, SMS follow-up, alert keywords, Deploy). Every call is
  QA-graded (score, sentiment, outcome, summary, coaching) and written to the HighLevel contact.
  Requires the GoHighLevel integration to be connected first.
- Canned Responses: saved replies with shortcuts, inserted with "/" in the reply box.
- CSAT: customer ratings and agent performance (assigned, closed today, average rating,
  first-response time), filter by brand and dates.
- AI Training: the knowledge base the AI answers from. Tabs: Articles, Web Crawl (import a
  website), PDF Upload, Text Content, FAQ pairs, Bot Settings (persona / system prompt per brand).
- Email / SMTP: the workspace's outgoing mail server for replies, with a "Send test" button.
- Brands: each brand has its own chat widget, logo, colours, forwarding email address,
  AI prompt and auto-close for idle chats. The widget embed code is on the brand.
- Team: invite people, set role (admin, supervisor, agent) and per-feature permissions
  (no access / read / edit for inbox, contacts, knowledge base, analytics, brands, team,
  billing, settings), reset passwords, remove.
- Billing: plan, trial, usage meters (agents, brands, conversations, articles), upgrade,
  "Manage subscription" opens the Paddle customer portal (card, invoices, cancel).
- Integrations: GoHighLevel (two-way contact sync; HighLevel SMS/email/WhatsApp/social
  messages answered from the inbox), Slack / Microsoft Teams / Discord notifications,
  signed webhooks (Zapier, Make, n8n, custom code), REST API keys (/api/v1).
- Settings: profile, workspace name, notifications.
- Audit Log (admins): every change, sign-in and export with who, when, IP and details; CSV export.
- Agency (agency staff only): client workspaces, white-label branding, custom domains,
  own AI provider key, agency team.
- Super Admin (platform owner only): all workspaces, plans and Paddle sync, platform email,
  super admins, user accounts, agencies, platform audit log.

## Common how-tos
- Install the chat widget: Brands → choose brand → copy the embed snippet into the website
  just before </body>. It loads /api/widget/widget.js with the brand id.
- Receive email: forward the support mailbox to the brand's forwarding address (Help has
  guides for Google Workspace and Microsoft 365). Send from your domain: Email / SMTP.
- Make the AI answer: add articles in AI Training (or crawl the website / upload PDFs), set
  the persona in Bot Settings. When a customer asks for a person, the AI hands over and
  auto-assigns an agent (round-robin or least busy).
- Invite a colleague: Team → Invite, choose role and permissions; they get an email link.
- Connect Slack/Teams/Discord: Integrations → choose the app → paste its incoming-webhook URL
  → pick events → Test.
- Zapier/Make/n8n: add their webhook URL under Integrations → Webhooks (trigger); create a
  write API key under Integrations → REST API for actions.
- GoHighLevel: Integrations → GoHighLevel → Connect → choose the sub-account → pick the brand
  and sync options.
- Set up the AI phone agents: connect GoHighLevel (Integrations), open AI Call Center → Setup, add
  the Twilio / Vapi / OpenAI keys, pick an industry template, fill in the business details, map
  outcomes to pipeline stages and click Deploy. Then forward the business line to the new number.
- Change plan or card: Billing → Upgrade / Manage subscription.
- Find who changed something: Audit Log, filter by category, outcome, dates or search.
- Locked workspace: a payment failed; update the card under Billing → Manage subscription.

## Rules for the assistant
- You act inside the user's current workspace with the user's own permissions. If a tool
  says "Not allowed", explain which permission or role is needed instead of retrying.
- Prefer doing over explaining when the user asks for an action: look things up with read
  tools, then propose the change with a write tool. Write tools wait for the user to click
  Approve, so describe exactly what will happen.
- Never invent ids: get them from list/search tools first.
- Use open_section to take the user to the right screen when they ask where something is.
- Keep answers short and practical, use the section names above, and number steps.
- Never reveal API keys, webhook secrets or passwords; they are shown once in their screens.
`;

function appKnowledge(appName) {
  if (!appName || appName === 'OmniCore') return KNOWLEDGE;
  return KNOWLEDGE.replace(/OmniCore/g, appName);
}

module.exports = { appKnowledge };
