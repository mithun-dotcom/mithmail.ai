# MithMill

Cold email automation and deliverability platform. **Smart outbound scales horizontally:** instead of pushing one inbox hard, MithMill spreads volume across many warmed inboxes, each sending a small, randomized daily amount, with DNS authentication checked every day.

## Features

| Area | What you get |
|---|---|
| **Inboxes** | Unlimited Google / Microsoft (OAuth) and SMTP/IMAP inboxes, bulk CSV import, AES-256-GCM encrypted credentials, live connection test, per-inbox daily limit and send gap |
| **Deliverability** | Daily SPF / DKIM / DMARC / MX checks per domain with fix hints, inbox placement tests against seed mailboxes, custom tracking domains (CNAME verified), ESP matching (Gmail → Google inbox, Outlook → Microsoft inbox) |
| **Warm-up** | Peer network across workspaces: ramp-up schedule, AI-written conversations, spam-folder rescue, mark important, delayed human-like replies, placement stats |
| **Campaigns** | Multi-step sequences, A/B variants with weights, nested spintax `{Hi\|Hey}`, merge tags `{{first_name\|there}}`, custom CSV variables, send windows per timezone, daily new-lead caps, stop-on-reply, threaded follow-ups, subsequences triggered by reply labels |
| **AI** | Sequence writer (OpenAI, JSON output), per-lead icebreakers (`{{icebreaker}}`, generated in the background), reply classification (interested / meeting booked / not interested / out of office / wrong person / unsubscribe), suggested replies in the Unibox, warm-up content. Heuristic fallbacks when no API key is set |
| **Sending engine** | BullMQ scheduler + workers: inbox rotation, sticky sender per lead, randomized pacing, SMTP error classification (hard bounce / auth / retry), open pixel, signed click redirects, RFC 8058 one-click unsubscribe |
| **Unibox** | Every reply from every inbox, auto-labelled, reply in thread from the original inbox, relabel, unread tracking |
| **Analytics** | Dashboard KPIs, sends per day, open / reply rate trends, per-campaign / per-step / per-variant stats |
| **Platform** | Multi-tenant workspaces with Owner/Admin/Viewer roles, global blocklist, REST API with API keys, signed webhooks, plan quotas |

## Architecture

```
               ┌──────────── Next.js 15 (App Router) ────────────┐
 Browser ────▶ │ UI (server components + server actions)          │
 Tracking ───▶ │ /t/o /t/c /t/u   open · click · unsubscribe      │
 API clients ▶ │ /api/v1/*        API-key REST API                │
               └──────────────┬──────────────────────┬───────────┘
                              │ Prisma               │ BullMQ (Redis)
                         PostgreSQL           ┌──────┴────────────────────────┐
                              ▲               │ workers/ (npm run worker)     │
                              └───────────────│  campaign-scheduler  every 1m │
                                              │  send-email          SMTP     │
                                              │  fetch-replies       IMAP 5m  │
                                              │  warmup-sync         every 15m│
                                              │  dns-check           daily    │
                                              │  webhooks            retries  │
                                              │  placement-test · ai-tasks    │
                                              └───────────────────────────────┘
```

* **Scheduler** (`src/server/sending/scheduler.ts`): the single place inbox capacity is allocated. Each tick it checks every active campaign's send window, gives follow-ups to the inbox that started the thread, assigns new leads across free inboxes (ESP-matched where it can), respects daily limits, monthly plan quota and per-inbox pacing, then queues one `send-email` job per claimed lead.
* **Sender** (`src/server/sending/sender.ts`): re-validates state, renders the email (`compose.ts`), sends through a pooled transport, records the result and advances the lead.
* **Reply detection** (`src/server/inbox/`): IMAP sync by UID. Replies are matched by `In-Reply-To`/`References` → `EmailLog.messageId`, falling back to the sender's address. It also parses bounce reports (DSNs) and handles warm-up traffic.
* Queue names are `send-email`, `fetch-replies`, `warmup-sync`, `dns-check`, `campaign-scheduler`, `webhooks` (BullMQ doesn't allow `:` in queue names).

## SalesBlink engine

A workspace can use **SalesBlink** as its engine instead of MithMill's own SMTP/IMAP workers. SalesBlink then does the sending, warm-up and inbox monitoring, and MithMill remains the product your users see. Switch it on in **Settings → Sending engine**: pick SalesBlink and paste the API key from run.salesblink.io → Account → Integration → API. The key is verified, then stored encrypted. `SALESBLINK_API_KEY` in the environment is used when a workspace has no key of its own.

| MithMill | SalesBlink |
|---|---|
| Email accounts | Senders are synced every 30 min (health score, warm-up state). New inboxes are connected on SalesBlink's page (Google/Outlook) or through the SMTP form, which calls `add-sender` |
| Inbox settings / Warm-up page | Daily limit, warm-up on/off, ramp-up and max are pushed with `PATCH /senders/{id}` |
| Campaign launch | Creates a list, pushes the leads, creates one template per step and the sequence (schedule, timezone, random delay, stop-on-reply, provider matching), then starts it |
| Personalisation | SalesBlink templates only support plain merge tags. MithMill renders each lead's emails itself (spintax, `{{var\|fallback}}`, A/B variants, AI icebreakers) and sends them as the contact fields `mm_subject_N` / `mm_body_N`. The templates are just `{{mm_subject_N}}` / `{{mm_body_N}}` |
| Pause / resume / delete | `POST /sequences/{id}/status` |
| Leads added later / removed | Pushed to or removed from the SalesBlink list in the background |
| Analytics | The sent / opens / clicks / replies feeds are written into MithMill's email log every 5 min, so the dashboards are unchanged. Bounces and unsubscribes are read from sequence lead status |
| Unibox | SalesBlink inbox threads are imported and AI-labelled. Replies, labels (outcome) and read state go back through the SalesBlink inbox API |
| Blocklist | Entries are mirrored to SalesBlink's blocklist |

Notes:
- SalesBlink's limits are 30 GET/min, 15 POST+PATCH/min and 10 PUT+DELETE/min per key. The client shares a Redis rate limiter across all processes and retries 429s. Launching large campaigns takes a few minutes (500 leads per call).
- A campaign that is live on SalesBlink has its emails already queued there. To change its sequence, duplicate the campaign. Individual leads can't be paused through the API; remove them instead.
- Each SalesBlink API key belongs to exactly one SalesBlink workspace. Use a separate key per MithMill workspace to keep tenants apart.
- The API spec is in `docs/salesblink-openapi.json`. `tests/integration/salesblink.test.ts` runs the whole flow against a mock that follows it.

## Quick start

```bash
cp .env.example .env            # then fill in AUTH_SECRET and ENCRYPTION_KEY (openssl rand -base64 32)
docker compose up -d            # Postgres + Redis
npm install
npx prisma migrate deploy       # create tables (use `npm run db:migrate` when changing the schema)
npm run db:seed                 # optional demo workspace (demo@mithmill.test)

npm run dev                     # web app on :3000
npm run worker                  # background workers (separate terminal)
npm run dev:smtp                # optional: local SMTP on :2525 that captures mail to .dev-mail/
```

In development the login page has a **dev login** (any email, no password). It is off in production unless `ENABLE_DEV_LOGIN=1`.

### Environment

See `.env.example`. The important ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` | PostgreSQL (Supabase / Neon / local) |
| `REDIS_URL` | BullMQ + rate limiting + pacing |
| `AUTH_SECRET` | Auth.js session secret; also signs tracking links |
| `ENCRYPTION_KEY` | 32 bytes, base64. Encrypts SMTP/IMAP passwords, OAuth refresh tokens, webhook secrets. **Rotating it makes stored credentials unreadable.** |
| `AUTH_GOOGLE_ID/SECRET` | Google sign-in **and** Gmail inbox OAuth (scope `https://mail.google.com/`) |
| `AUTH_MICROSOFT_ENTRA_ID_ID/SECRET` | Microsoft sign-in and Outlook inbox OAuth (SMTP.Send + IMAP.AccessAsUser.All) |
| `EMAIL_SERVER`, `EMAIL_FROM` | Magic-link login emails |
| `APP_URL` | Default tracking host |
| `TRACKING_CNAME_TARGET` | Host that customer tracking domains must CNAME to |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | AI features (default `gpt-4o`) |
| `WORKERS` | Optional, e.g. `send,replies`, to run only some queues in a process |
| `SEND_CONCURRENCY`, `IMAP_CONCURRENCY` | Worker concurrency |

OAuth redirect URIs to register:
`{APP_URL}/api/auth/callback/google`, `{APP_URL}/api/auth/callback/microsoft-entra-id` (sign-in) and
`{APP_URL}/api/oauth/google/callback`, `{APP_URL}/api/oauth/microsoft/callback` (inbox connection).

## Deployment

### Render (one click)

`render.yaml` is a Render Blueprint that creates the web app, the worker, Postgres and Redis.

1. In Render: **New → Blueprint**, connect this GitHub repo and choose the branch.
2. Fill in the prompted values:
   - `ADMIN_LOGIN_EMAIL` / `ADMIN_LOGIN_PASSWORD` (12+ characters): your login.
   - `APP_URL`: the web service URL, e.g. `https://mithmill-web.onrender.com`. You can leave it blank at first; the web app falls back to Render's URL, but the worker needs it for tracking links.
   - `SALESBLINK_API_KEY`, `OPENAI_API_KEY`: optional.
3. **Apply**. The first deploy runs the database migrations. Open the web URL, sign in, and create a workspace.

The worker uses Render's Starter plan (there are no free workers). Render's free Postgres expires after 30 days, so upgrade it to keep your data. The free web service sleeps when idle, so the first request after a while takes ~30 s.

### Other hosts

* **Web:** deploy the Next.js app (Vercel, or the `Dockerfile`). Tracking routes (`/t/*`) must be reachable at every custom tracking domain, over HTTPS. Terminate TLS for customer CNAMEs at the edge, for example Vercel domains, Cloudflare for SaaS, or Caddy on-demand TLS.
* **Workers:** run `npm run worker` on a long-lived host (Fly.io, Railway, ECS, a VM). They are stateless; scale horizontally, and split queues with `WORKERS=`. Run **exactly one** process that includes `scheduler`.
* **Redis:** set `maxmemory-policy noeviction` (BullMQ requirement).
* Run `npx prisma migrate deploy` on release.

## REST API

`GET /api/v1` lists the endpoints. Authenticate with `Authorization: Bearer mm_live_…` (create keys in Settings). There is a limit of 120 requests per minute per key.

```bash
curl -X POST $APP_URL/api/v1/campaigns/$CAMPAIGN_ID/leads \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"leads":[{"email":"jane@acme.com","firstName":"Jane","customVariables":{"Job Title":"CTO"}}]}'
```

## Webhooks

The events are `email.sent`, `email.opened`, `email.clicked`, `email.bounced`, `lead.replied`, `lead.interested`, `lead.meeting_booked`, `lead.not_interested`, `lead.unsubscribed` and `campaign.completed`.
Each POST carries `x-mithmill-event`, `x-mithmill-timestamp` and `x-mithmill-signature: sha256=HMAC_SHA256(secret, "{timestamp}.{body}")`. Failed deliveries retry with exponential backoff. In production, URLs that resolve to private addresses are refused.

```js
const expected = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(`sha256=${expected}`), Buffer.from(signatureHeader));
```

## Development

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

`npm run test:integration` runs the whole pipeline against real PostgreSQL + Redis with in-process SMTP/IMAP servers. It covers inbox rotation, follow-up priority and threading, hard bounces, IMAP reply detection with stop-on-reply, and a full warm-up cycle (spam rescue → flag → reply).

Unit tests cover the template engine (spintax / variables), DNS evaluators, crypto, scheduling windows, inbox assignment, email composition and tracking, SMTP error classification, the SSRF guard, reply heuristics and warm-up ramp-up.

## Roadmap

* Stripe billing wired to `SubscriptionTier` / `PLANS` (limits are enforced today; plans are set manually)
* Lead finder / enrichment and a Chrome extension
* CRM integrations (HubSpot, Pipedrive) on top of the webhook events
* Agency mode: client workspaces with white-label branding
