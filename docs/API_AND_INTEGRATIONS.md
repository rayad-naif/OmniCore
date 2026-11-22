# Integrations, REST API & GoHighLevel Marketplace app

Workspace admins manage everything here under **Dashboard → Integrations**
(requires the _Settings_ permission). Every change is recorded in the audit log.

| Integration             | Direction             | Set up in                                        |
| ----------------------- | --------------------- | ------------------------------------------------ |
| Webhooks                | OmniCore → your URL   | Integrations → Webhooks                          |
| REST API v1             | your code → OmniCore  | Integrations → REST API                          |
| Slack / Discord / Teams | OmniCore → channel    | Integrations → Slack / Discord / Microsoft Teams |
| Zapier / Make / n8n     | both (webhooks + API) | Integrations → Zapier / Make / n8n               |
| GoHighLevel             | two-way sync          | Integrations → GoHighLevel                       |

---

## 1. Events

Every integration is fed by the same event stream. Events are produced by database
triggers, so they fire no matter where the change came from (chat widget, email,
agent, AI, API, HighLevel).

| Event                           | When                                                   |
| ------------------------------- | ------------------------------------------------------ |
| `conversation.created`          | New conversation (chat, email, API, HighLevel)         |
| `conversation.closed`           | Conversation closed                                    |
| `conversation.reopened`         | Closed conversation reopened                           |
| `conversation.status_changed`   | Status changed between open / pending / AI-handling    |
| `conversation.assigned`         | Assigned or unassigned                                 |
| `conversation.priority_changed` | Priority changed                                       |
| `message.created`               | Visitor, agent or AI message                           |
| `note.created`                  | Internal note                                          |
| `ticket.created`                | Ticket created, or a conversation turned into a ticket |
| `csat.submitted`                | Customer rating (1–5)                                  |
| `contact.created`               | New contact                                            |

Subscriptions accept `*` (everything), exact names, or prefixes like `conversation.*`.

## 2. Webhooks

**Payload** (`POST`, `Content-Type: application/json`):

```json
{
  "id": "evt_1842",
  "type": "message.created",
  "created_at": "2026-11-21T18:30:00.000Z",
  "tenant_id": "6f1c…",
  "data": {
    "conversation_id": "a12b…",
    "sender_type": "visitor",
    "message": {
      "id": "…",
      "body": "Hi, where is my order?",
      "sender_type": "visitor",
      "attachments": [],
      "created_at": "…"
    },
    "conversation": {
      "id": "a12b…",
      "status": "open",
      "priority": "normal",
      "channel": "widget",
      "brand": { "id": "…", "name": "Acme" },
      "contact": { "id": "…", "name": "Ana", "email": "ana@example.com" },
      "assignee": null,
      "is_ticket": false,
      "ticket_number": null,
      "csat_score": null,
      "url": "https://omnicore.irofficial.com/dashboard/?conversation=a12b…"
    }
  }
}
```

`contact.created` carries `data.contact`; conversation events carry `data.conversation`.

**Headers**

| Header               | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| `OmniCore-Event`     | event type                                                        |
| `OmniCore-Delivery`  | delivery id (use it to de-duplicate retries)                      |
| `OmniCore-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>` |

**Verify the signature** (reject if older than 5 minutes):

```js
// Node.js / Express — use the raw body
const crypto = require('crypto');
function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(
    header.split(',').map((p) => p.split('=')),
  );
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
```

```python
# Python
import hmac, hashlib, time
def verify(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    if abs(time.time() - int(parts["t"])) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])
```

```php
// PHP
function verify(string $raw, string $header, string $secret): bool {
  parse_str(str_replace(',', '&', $header), $p);
  if (abs(time() - (int)$p['t']) > 300) return false;
  return hash_equals(hash_hmac('sha256', $p['t'] . '.' . $raw, $secret), $p['v1']);
}
```

**Delivery and retries:** respond with any 2xx within 10 seconds. Otherwise
OmniCore retries after 1 m, 5 m, 30 m, 2 h, 6 h and 12 h, then marks the delivery
failed. **Deliveries** shows the last 100 attempts with status and error, and lets
you retry. **Test** sends a signed `ping`. **Rotate secret** issues a new secret
(shown once).

**Security:** URLs must be `https://` and may not resolve to private or internal
addresses (SSRF protection; see `WEBHOOKS_ALLOW_*` in ENVIRONMENT.md).

## 3. REST API v1

Base URL `https://<your-domain>/api/v1`. Create keys under **Integrations → REST API**.
A key is shown once; OmniCore stores only its hash.

```
Authorization: Bearer ock_…        (or)   X-API-Key: ock_…
```

- Scopes: `read` (GET), `write` (POST/PATCH). Keys can expire and be revoked.
- Rate limit: 120 requests/minute per key (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After` on 429).
- Lists accept `limit` (≤100, messages ≤200) and `page`.
- Errors: `{ "error": "…" }` with 400/401/403/404/429.

| Method  | Path                          | Scope | Body / query                                                              |
| ------- | ----------------------------- | ----- | ------------------------------------------------------------------------- |
| `GET`   | `/me`                         | read  | Workspace and key info                                                    |
| `GET`   | `/brands`                     | read  |                                                                           |
| `GET`   | `/agents`                     | read  |                                                                           |
| `GET`   | `/conversations`              | read  | `status`, `brand_id`, `is_ticket`, `updated_since` (ISO), `limit`, `page` |
| `GET`   | `/conversations/:id`          | read  |                                                                           |
| `PATCH` | `/conversations/:id`          | write | `{ status?, priority?, assigned_agent_id? }`                              |
| `GET`   | `/conversations/:id/messages` | read  | `limit`, `page`                                                           |
| `POST`  | `/conversations/:id/messages` | write | `{ body, internal? }`, delivered live to the widget unless `internal`     |
| `POST`  | `/tickets`                    | write | `{ brand_id, email, name?, subject, description?, priority? }`            |
| `GET`   | `/contacts`                   | read  | `email`, `q`, `limit`, `page`                                             |
| `GET`   | `/contacts/:id`               | read  |                                                                           |
| `GET`   | `/contacts/:id/conversations` | read  |                                                                           |

Statuses: `open`, `pending`, `ai_handling`, `closed`, `submitted`, `in_progress`,
`waiting_on_customer`, `resolved`. Priorities: `low`, `normal`, `high`, `urgent`.

```bash
curl -H "Authorization: Bearer ock_xxx" "https://omnicore.irofficial.com/api/v1/conversations?status=open&limit=10"
```

```bash
curl -X POST -H "Authorization: Bearer ock_xxx" -H "Content-Type: application/json" -d '{"brand_id":"…","email":"ana@example.com","subject":"Refund","description":"Order 123","priority":"high"}' https://omnicore.irofficial.com/api/v1/tickets
```

## 4. Slack, Discord, Microsoft Teams

Paste the channel's incoming-webhook URL and pick events (default: new
conversations, tickets and ratings). Message events notify only for customer
messages. URLs are validated per provider and stored encrypted.

- **Slack:** api.slack.com/apps → your app → Incoming Webhooks → Add New Webhook to Workspace.
- **Discord:** channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy URL.
- **Teams:** channel → ••• → Workflows → _Post to a channel when a webhook request is received_ (or the classic Incoming Webhook connector).

## 5. Zapier, Make, n8n

- **Trigger:** create a _Webhooks by Zapier → Catch Hook_ (Make: _Custom webhook_;
  n8n: _Webhook_ node), copy its URL, and add it under **Integrations → Webhooks**.
- **Action:** create a `write` API key and use _Webhooks by Zapier → Custom Request_
  (Make: _HTTP → Make a request_; n8n: _HTTP Request_) against the REST API.

## 6. GoHighLevel Marketplace app

### 6.1 What it does

| Setting (per connected location) | Behaviour                                                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync contacts both ways          | New OmniCore contacts are upserted into HighLevel (tag `omnicore`); new/updated HighLevel contacts with an email appear in OmniCore.                                                                |
| Tag tickets and CSAT             | Adds `omnicore-ticket` and `omnicore-csat-<score>` tags to the HighLevel contact.                                                                                                                   |
| Transcript notes                 | When a conversation closes, its transcript is added as a note on the HighLevel contact.                                                                                                             |
| Inbound messages                 | HighLevel SMS, email, WhatsApp, Facebook, Instagram and live-chat messages become OmniCore conversations (channel `api`); agent and AI replies are sent back through HighLevel on the same channel. |

### 6.2 Create the app in HighLevel (platform owner, once)

1. Sign in at [marketplace.gohighlevel.com](https://marketplace.gohighlevel.com) with
   your agency account → **My Apps → Create App**.
2. **Basic info:** name _OmniCore_, type _Public_ (or _Private_ for your own agency),
   distribution **Sub-Account**.
3. **Advanced Settings → Auth:**
   - Scopes: `contacts.readonly contacts.write conversations.readonly conversations.write conversations/message.readonly conversations/message.write locations.readonly opportunities.readonly opportunities.write calendars.readonly calendars/events.readonly calendars/events.write locations/customFields.readonly locations/customFields.write users.readonly` (the last eight are used by the AI Call Center for booking, pipelines and AI result fields)
   - Redirect URL: `https://omnicore.irofficial.com/api/integrations/ghl/callback`
   - Create a **client key** → copy _Client ID_ and _Client Secret_ into
     `GHL_CLIENT_ID` and `GHL_CLIENT_SECRET`.
4. **Advanced Settings → Webhooks:** URL
   `https://omnicore.irofficial.com/api/integrations/ghl/webhook`; enable
   `AppInstall`, `AppUninstall`, `ContactCreate`, `ContactUpdate`, `ContactDelete`,
   `InboundMessage`.
5. Copy HighLevel's webhook **public key** from their webhook documentation into
   `GHL_WEBHOOK_ED25519_PUBLIC_KEY` (for `x-ghl-signature`) and/or
   `GHL_WEBHOOK_PUBLIC_KEY` (legacy `x-wh-signature`). Unsigned webhooks are rejected.
6. Restart the API. **Integrations → GoHighLevel** now shows a **Connect** button.
7. Listing (public apps): add the description, screenshots and support URL, then
   submit for HighLevel's review.

### 6.3 Install flows

- **From OmniCore:** Integrations → GoHighLevel → Connect → choose the location →
  you return connected to this workspace.
- **From the HighLevel Marketplace:** after install, HighLevel sends the user to
  OmniCore's dashboard with a one-hour claim link. When an admin signs in, the
  location is linked to their workspace automatically.

After connecting, choose the **brand** that HighLevel conversations belong to and
toggle the sync options. Access tokens are refreshed automatically and stored
encrypted. Uninstalling in HighLevel marks the connection _uninstalled_.

## 7. Audit log API

| Method | Path                                 | Who                              |
| ------ | ------------------------------------ | -------------------------------- |
| `GET`  | `/api/audit-logs`                    | workspace admins                 |
| `GET`  | `/api/audit-logs/export`             | workspace admins (CSV)           |
| `GET`  | `/api/audit-logs/facets`             | workspace admins                 |
| `GET`  | `/api/super-admin/audit-logs`        | super admins (`tenantId` filter) |
| `GET`  | `/api/super-admin/audit-logs/export` | super admins (CSV)               |

Filters: `from`, `to`, `actor`, `actorType`, `action`, `category`, `resourceType`,
`resourceId`, `outcome`, `ip`, `q`, `page`, `limit` (≤500).
