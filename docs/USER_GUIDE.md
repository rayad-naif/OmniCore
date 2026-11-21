# OmniCore user guide

For workspace owners, admins, supervisors and agents. The platform owner's setup
(super admin, plans, platform email) is in [ENVIRONMENT.md §3](ENVIRONMENT.md#3-super-admin-platform-owner).

Sign in at **https://omnicore.irofficial.com/dashboard/** (or your own domain).

---

## 1. Getting started (workspace owner)

1. **Start a trial** from the website's Pricing page, or accept the invitation email
   your administrator sent. Set your password from the link (valid 7 days).
2. **Brands** → _New brand_: name, logo, colour, website. Each brand gets its own
   chat widget and email address.
3. **Install the chat widget**: Brands → your brand → copy the embed code into
   your website just before `</body>`:

   ```html
   <script>
     window.OmniCoreConfig = {
       brandId: 'YOUR_BRAND_ID',
       primaryColor: '#6366f1',
     };
   </script>
   <script
     src="https://omnicore.irofficial.com/api/widget/widget.js"
     async
   ></script>
   ```

4. **Email** (optional): forward your support mailbox to the brand's forwarding
   address (see Help → _Google Workspace_ or _Microsoft 365_), and set your own
   SMTP under **Email / SMTP** so replies come from your domain.
5. **AI Training**: add articles, crawl your website, upload PDFs, paste text or FAQ
   pairs; under _Bot Settings_ set the bot's persona and instructions.
6. **Team** → invite colleagues and choose their role and permissions.
7. **Integrations** (optional): Slack/Teams/Discord alerts, GoHighLevel, Zapier, webhooks, API keys.

## 2. Roles and permissions

| Role       | Default access                                                                |
| ---------- | ----------------------------------------------------------------------------- |
| Admin      | Everything, including billing, team, settings, integrations and the audit log |
| Supervisor | Inbox, tickets, contacts, CSAT and knowledge base; limited settings           |
| Agent      | Inbox, tickets and contacts                                                   |

Admins can fine-tune each person per feature (_no access / read / edit_): inbox,
contacts, knowledge base, analytics, brands, team, billing, settings.

## 3. Daily work

**Inbox.** All chats and emails in one list with _All / Open / Pending / AI / Closed_
filters and search. Open a conversation to see the visitor's details, the page they
are on, and their history.

- Reply, attach files, or add an **internal note** (never shown to the customer).
- Type `/` to insert a **canned response**.
- **Rephrase** rewrites your draft in a chosen tone.
- Assign, change priority, convert to a **ticket**, or close. Closing can send a
  **CSAT** rating request.
- Conversations handled by the AI show _AI_. When a visitor asks for a person, the
  AI hands over and assigns an agent automatically.

**Tickets.** Conversations marked as tickets (also created by the widget's offline
form, email, the API or HighLevel), with ticket numbers and priority.

**Contacts.** Everyone who has contacted you, with full history; export to CSV.

**CSAT.** Ratings and agent performance (assigned, closed today, average rating,
first-response time), filterable by brand and date.

## 4. Settings and administration

| Screen       | What you can do                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Brands       | Logos, colours, widget settings, auto-close for idle chats, inbound email address                            |
| Email / SMTP | Your outgoing mail server, with a connection test                                                            |
| Team         | Invite, change role and permissions, reset passwords, remove                                                 |
| Billing      | Plan, trial status, usage meters, upgrade, manage payment method and invoices (Paddle portal)                |
| Integrations | See [API_AND_INTEGRATIONS.md](API_AND_INTEGRATIONS.md)                                                       |
| Settings     | Profile, workspace name, notification and webhook options                                                    |
| Audit Log    | (admins) every change, sign-in and export: who, when, from which IP, what changed. Filter and export to CSV. |

## 5. Billing

- Paid plans start with a free trial; your card is charged when it ends unless you cancel.
- **Billing → Manage subscription** opens Paddle's secure portal to change the card,
  download invoices or cancel.
- If a payment fails, the workspace keeps working through a grace period while Paddle
  retries; admins are notified by email.

## 6. Integrations in one minute

- **Slack / Teams / Discord:** paste an incoming-webhook URL, choose events, _Test_.
- **GoHighLevel:** _Connect_, choose your sub-account, pick the brand, toggle sync
  options. HighLevel SMS/email/WhatsApp/social messages then appear in your inbox, and
  your replies go back through HighLevel.
- **Zapier / Make / n8n:** add their webhook URL under Webhooks (trigger) and create
  an API key (actions).
- **Your own code:** webhooks (signed) and the REST API, documented in
  [API_AND_INTEGRATIONS.md](API_AND_INTEGRATIONS.md).

## 7. The AI assistant

Click **Ask AI** (bottom right) on any screen. It knows the whole product and can:

- answer "how do I…" questions and open the right screen for you;
- look things up: conversations, tickets, contacts, team, plan and usage, knowledge
  articles, integrations, recent activity;
- do things for you: reply to a conversation or add a note, change status, priority or
  assignee, create saved replies and knowledge articles, create a brand, invite a
  colleague, add a webhook, connect Slack/Teams/Discord.

It always shows exactly what it is about to change and waits for **Approve**. It acts
with your own permissions, and everything it does is recorded in the audit log as
_via AI assistant_.

## 8. Agencies (white-label reselling)

Agencies resell the platform under their own brand, like GoHighLevel's agency mode.
The platform owner turns a workspace into an agency (Super Admin → Agencies). The
agency's staff then get an **Agency** item in the sidebar:

| Tab               | What you can do                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Client workspaces | Create workspaces for clients (the client admin gets an invitation), set their plan, limits and status, and **Open** one to work inside it.     |
| Branding          | App name, logo, favicon, colours, login text, email sender name, support links, hide "Powered by" in the chat widget, custom CSS. Live preview. |
| Domains           | Add your own domain (e.g. `app.youragency.com`), create the DNS records shown, verify. Clients sign in there and only ever see your brand.      |
| AI provider       | Use your own Gemini, OpenAI or Anthropic key for the assistant in all your client workspaces.                                                   |
| Agency team       | Give colleagues from your own workspace access to the agency console.                                                                           |

Your brand appears on your domains, in the dashboard after sign-in, in system emails
(invitations, password resets, notices) and in the chat widget of your clients' brands.

## 9. Troubleshooting

| Problem                          | Fix                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Widget does not appear           | Check the brand id in the embed code; open the browser console for errors.              |
| Emails not arriving in the inbox | Confirm forwarding to the brand's address; check the email provider's forwarding rules. |
| Replies not sent by email        | Email / SMTP → _Send test_; check host, port and password.                              |
| AI does not answer               | Add knowledge articles; check Bot Settings; the plan must include AI replies.           |
| Live updates stopped             | Refresh; check your network allows WebSockets (it falls back automatically).            |
| "Workspace locked"               | Billing → update payment method in the Paddle portal.                                   |
