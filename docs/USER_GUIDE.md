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

## 8. AI Call Center (phone agents)

An AI receptionist answers your business phone and hands callers to an AI **Sales**
agent (quotes and booking into your HighLevel calendar) or **Support** agent
(existing customers, tickets), and can transfer to a person.

**Set up** (admin): connect GoHighLevel under Integrations, then **AI Call Center → Setup**:

1. Add your Twilio, Vapi and OpenAI keys (you pay them directly; checked and encrypted).
2. Pick an industry template (HVAC, plumbing, roofing, dental, med spa, legal, real
   estate, solar) and adjust business details, services, FAQ, pricing, hours, voice and
   language (English, Spanish or automatic English/Spanish).
3. Choose a booking calendar and which pipeline stage each call outcome moves to.
4. Optional: speed-to-lead (paste the webhook into a HighLevel workflow so the AI calls
   new leads back within seconds), SMS follow-up after calls, alert keywords.
5. **Deploy**. You get a local number; forward your business line to it, or test it.

**Every day:**

| Tab          | What it does                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Command Deck | Live calls with a real-time transcript. Admins and supervisors can **listen**, **whisper** an instruction to the AI, make it **say** a line, mute it, **transfer**, end the call, or **take over** in the browser. |
| Call history | Every call with outcome, QA score and sentiment.                                                                                                                                                                   |
| Leads        | Speed-to-lead calls, attempts and results.                                                                                                                                                                         |
| Reports      | Calls, bookings, booking rate, estimated revenue, return on AI cost, staff hours saved; CSV export.                                                                                                                |

After each call the AI grades it (score, sentiment, outcome, summary, next steps,
coaching) and updates the HighLevel contact (fields, transcript note, tags, opportunity stage).

## 8a. HR (employees, attendance, leave, payroll, hiring)

Plans that include the **HR module** add an **HR** item to the sidebar. Admins click
**Open HR** to work in the HR app without another password (it opens in a new tab).

**First steps (HR admin):**

1. Set your workspace time zone (Settings → Workspace). Attendance, shifts and late
   marks use it.
2. In HR: add **Departments**, **Shift types** and **Employees**. Each employee gets an
   email with their sign-in details and the employee sign-in link.
3. Assign shifts (Shift assignments) and, if you use them, set up payroll details,
   leave balances and roles/permissions.

**Employees** sign in at the link shown under HR → Links (`/hrms/login?w=…`) with email
and password, check in and out, request leave and late arrivals, swap shifts, see their
payslips and profile. Someone who works for two companies on the platform chooses which
one after signing in.

**Managers and HR** approve leave and late requests, review attendance and performance,
run payroll (payslips as PDF, Excel exports), track expenses and earnings, and manage
recruitment (job listings, candidate pipeline, AI resume screening when your plan has AI).

**Devices** (HR → Devices and agents, admins only): create a **device key** for Hikvision
biometric terminals (paste the event URL with the key into the device) and an **activity
agent key** for the desktop activity tracker. Replacing a key disconnects devices that
still use the old one.

## 8c. Invoices and payments

Plans that include **Invoicing & payments** add **Invoices & Payments** to the sidebar.
You get paid straight into your own Paddle, Stripe, PayPal, Square or Authorize.net
account, or by bank transfer, Payoneer or cash on delivery.

1. **Settings:** set your currency, invoice prefix, tax and the footer text, then
   **Connect** each payment method you accept (paste the keys from that processor;
   they are stored encrypted). Bank transfer, Payoneer and cash on delivery only need
   the instructions your customers should see.
2. **Invoices / Estimates:** add the customer, line items (save frequent ones under
   **Products**), tax, a discount or a **coupon**, due date and notes. **Send** emails
   the customer a link; **Copy link** gives you the same link for WhatsApp or SMS.
   Customers can accept an estimate online; **Convert** turns it into an invoice.
3. **Payment links:** a fixed price or "customer chooses the amount" link to put on
   your website, social profiles or chat replies.
4. **Gift cards:** issue a card with a code; customers use it on any invoice.
5. **Payments:** every payment as it arrives (you also get a "Payment received" pop-up).
   Bank transfers, Payoneer and cash on delivery wait here until you press **Confirm**
   (or **Reject**). Card payments can be marked refunded after refunding them in the
   processor. **Record payment** on an invoice logs cash or a cheque you received.
6. **Customers:** totals per customer (invoiced, paid, outstanding).

**Cash on delivery with your own app:** create an API key with the **write** scope
(Integrations → API keys), then your driver or field app calls `GET /api/v1/payments?status=pending`
and `POST /api/v1/payments/<id>/confirm` when the cash is collected.

## 8d. Online stores (WooCommerce)

Plans with **Online stores** add **Online Stores** to the sidebar.

**Launch a store** (New store): give it a name and a web address (`yourname.<store
domain>`), pick one of six designs (Boutique, Fresh market, Tech, Beauty, Home & living,
Minimal), optionally your brand colour, and describe what you sell. If your plan includes
AI, the homepage, About, FAQ and policy pages and your starter products are written for
you; otherwise the design's example copy is used. Your store is usually live in about a
minute, with WooCommerce, a shop page, cart, checkout and customer accounts.

**Run it:** **Open store admin** signs you in to WordPress without a password. Add real
products and photos, shipping rates (new stores start with free shipping) and anything
else WordPress and WooCommerce offer, including other payment plugins.

**Get paid:** customers choose **Pay online** at checkout and pay on your OmniCore payment
page with the methods connected under Invoices & Payments (card processors, PayPal,
bank transfer, cash on delivery, Payoneer). Bank transfers and cash on delivery wait for
you to press Confirm in Invoices & Payments; the order then moves to Processing in your
store automatically.

**Orders:** every order appears in OmniCore (Online Stores → All orders, or a store's
Orders tab) within seconds, its customer is added to Contacts, and you get a "New order"
pop-up.

**Your own domain** (Domain tab): enter it, add the DNS records shown, and it becomes the
store's main address once it points to us. SSL is set up automatically.

**Design tab:** switch design or brand colour, and optionally rewrite the pages; your
products are kept. **Settings:** rename, pause (visitors see "temporarily unavailable"),
show the emergency admin login, or delete (type DELETE to confirm).

**Connect an existing WooCommerce store:** in your WordPress admin create a REST API key
(WooCommerce → Settings → Advanced → REST API, Read/Write) and paste it under Connect
existing store. Orders sync the same way. To offer OmniCore checkout there, download the
plugin from the store's Payments tab, install it, and paste the connection key.

## 8b. Reverse DNS (platform super admins)

Super Admin → **Reverse DNS** finds domains that point to a host or IP you watch, for
example every custom domain that CNAMEs to a white-label platform's host name.

1. **Watchlist**: add a CNAME target (`whitelabel.example.com`) or an IP. It is checked
   continuously; badges show each source's progress (active, finished, rate limited,
   error). **Rescan** walks every source again now; pause or remove targets any time.
2. **Domains found**: everything discovered, searchable, with a CSV export.
3. **Forms found**: pages of those domains that have a form, with its purpose (contact,
   careers, newsletter, login, search) and field names. CSV export.
4. **Quick search**: a one-off lookup that is not saved (3 pages per source).
5. **Sources & API keys**: switch sources on or off, set how many requests per hour each
   may receive, and add keys for SecurityTrails and DNSDB (paid) or Certspotter (higher
   free limit). Keys are encrypted.
6. **Activity log**: what the scheduler and crawler did, including rate limits and errors.

## 9. Agencies (white-label reselling)

Agencies resell the platform under their own brand, like GoHighLevel's agency mode.
The platform owner turns a workspace into an agency (Super Admin → Agencies). The
agency's staff then get an **Agency** item in the sidebar:

| Tab               | What you can do                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client workspaces | Create workspaces for clients (the client admin gets an invitation), set their plan, limits and status, and **Open** one to work inside it.               |
| Branding          | App name, logo, favicon, colours, login text, email sender name, support links, hide "Powered by" in the chat widget, custom CSS. Live preview.           |
| Domains           | Add your own domain (e.g. `app.youragency.com`), create the DNS records shown, verify. Clients sign in there and only ever see your brand.                |
| AI provider       | Use your own Gemini, OpenAI or Anthropic key for the assistant in all your client workspaces.                                                             |
| Custom menu links | Add up to 10 links (your reporting, booking or internal tools) to every client's sidebar, opened inside the app or in a new tab. Set them under Branding. |
| Agency team       | Give colleagues from your own workspace access to the agency console.                                                                                     |

Your brand appears on your domains, in the dashboard after sign-in, in system emails
(invitations, password resets, notices) and in the chat widget of your clients' brands.

## 10. Troubleshooting

| Problem                          | Fix                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Widget does not appear           | Check the brand id in the embed code; open the browser console for errors.              |
| Emails not arriving in the inbox | Confirm forwarding to the brand's address; check the email provider's forwarding rules. |
| Replies not sent by email        | Email / SMTP → _Send test_; check host, port and password.                              |
| AI does not answer               | Add knowledge articles; check Bot Settings; the plan must include AI replies.           |
| Live updates stopped             | Refresh; check your network allows WebSockets (it falls back automatically).            |
| "Workspace locked"               | Billing → update payment method in the Paddle portal.                                   |
