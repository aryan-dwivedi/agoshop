# agoshop — AI-powered live commerce

A working web prototype for the Agora Solutions Architect exercise: a conventional multi-category storefront that grows **live shopping** and a **voice-first AI shopping assistant** on top of it, with a **20% discount that exists only while the relevant live session is actually live** — enforced as business logic, not presentation text.

Start here: [`docs/hld/hld-one-page.excalidraw`](docs/hld/hld-one-page.excalidraw) (the whole design on one Excalidraw page) · [`docs/architecture.md`](docs/architecture.md) · [`docs/LIVE_COMMERCE_PLATFORM_PLAN.md`](docs/LIVE_COMMERCE_PLATFORM_PLAN.md) (verification plan).

## What it does

- **Storefront** — 6 categories, 56 curated products plus marketplace listings seeded from real e-commerce CSV samples, Postgres full-text search, PDP with PIN-code serviceability and product comparison, cart, checkout, order history, wishlist.
- **Live shopping** — a seller goes live from the browser over Agora RTC; viewers join, chat (server-mediated), react, vote in polls and follow the host's pinned product. Scheduled / live / recorded sessions are all discoverable.
- **Voice AI** — inside a live room, a replay, or **anywhere on the storefront**, the shopper opens a private voice conversation. The assistant answers from the real catalog, shows tappable recommendations while speaking, compares products, checks delivery and payment options, adds to cart, and hands off to checkout.
- **The live-only discount** — one `promotions` row, one pure evaluator, one relational eligibility resolver. It applies while the session is live, disappears from open carts the moment it ends, and can never be applied on a replay.
- **Scale primitives** — chat sharding, a one-way RTC→CDN delivery-tier transition, two stateless API replicas behind nginx, and aggregated high-frequency signals.

## Architecture

The one-page HLD is in [`docs/hld/hld-one-page.excalidraw`](docs/hld/hld-one-page.excalidraw). Longer narrative: [`docs/architecture.md`](docs/architecture.md).

**Boundary rule:** Agora moves live media, Signaling chat and the voice-agent audio path. The application owns catalog, pricing, promotions, inventory, cart, orders, chat authorization and every business decision. Video never passes through the commerce API.

```mermaid
graph TB
  subgraph Clients["Three web origins"]
    SHOP["Storefront :5173"]
    STUDIO["Seller Studio :5174"]
    SUPPORT["Support :5175"]
  end

  subgraph Edge["Load balancer :8080 (Compose / Render)"]
    NGINX["nginx — route by path"]
  end

  subgraph App["Customer-owned backend"]
    API["Commerce API ×2<br/>:8787"]
    SSE["SSE gateway ×2<br/>:8789"]
    AI["AI service ×2<br/>:8790 · /mcp"]
    WORKER["Worker ×2<br/>leader-elected timers"]
    PG[("PostgreSQL<br/>catalog · cart · orders")]
    RS[("Redis<br/>sessions · pub/sub · presence")]
    REC[["Recording storage"]]
  end

  subgraph Agora["Agora platform"]
    RTC["RTC · live + private AI channel"]
    RTM["Signaling · chat shards"]
    CONVO["ConvoAI · ASR + managed LLM + TTS"]
    RTT["Real-Time STT · host captions"]
    PUSH["Media Push → RTMP"]
  end

  CDN["CDN / HLS<br/>mass audience"]

  SHOP & STUDIO & SUPPORT -->|"HTTPS commerce"| NGINX
  SHOP & STUDIO & SUPPORT -->|"SSE /api/events"| NGINX
  NGINX --> API & SSE & AI
  API & WORKER --> PG & RS
  API --> REC
  NGINX -->|"/media/recordings"| REC

  SHOP & STUDIO -->|"RTC media + RTM chat"| RTC & RTM
  SHOP -->|"private ai-&lt;id&gt; voice"| RTC
  CONVO -->|"agent audio"| RTC
  CONVO ==>|"MCP tools + HMAC headers"| AI
  API -->|"join / leave agent"| CONVO
  API --> RTT
  PUSH --> CDN
  SHOP -->|"HLS after tier flip"| CDN
```

| Path                    | What travels                                                                 | Why                                                                |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Browser → API           | HTTPS JSON for catalog, cart, checkout, session control                      | authoritative commerce state                                       |
| Browser → Agora RTC/RTM | live video/audio, chat, private voice channel                                | sub-100 ms media; keeps video off our servers                      |
| ConvoAI → `/mcp`        | signed MCP tool calls (`X-Convo-Id`, `X-Convo-Expires`, `X-Convo-Signature`) | Agora's managed LLM reasons; **we** execute tools against Postgres |
| API → Redis → SSE       | `session.*`, `cart.*`, `promotions.changed`                                  | one pub/sub fan-out path; clients refetch snapshots on reconnect   |
| Media Push → CDN        | RTMP when viewer count crosses `RTC_TIER_MAX_VIEWERS`                        | interactive RTC for small rooms; HLS for mass audience             |

Local `npm run dev` collapses the edge: Vite proxies `/api` and `/mcp` to `:8787`, `/api/events` to `:8789`. Docker Compose and Render put nginx in front and route `/mcp` to the AI service pool so API, SSE and MCP scale independently.

## Prerequisites

| Requirement                           | Notes                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| Node **≥ 22**                         | required by `openai@7`; built and tested on Node 24                               |
| PostgreSQL **≥ 15**                   | `UNIQUE NULLS NOT DISTINCT` is load-bearing for cart lines                        |
| Redis 7                               | sessions, presence, leases, streams, pub/sub                                      |
| PostgreSQL + Redis running locally    | or start both via `infra/docker-compose.yml` (see below)                          |
| ngrok                                 | so Agora can reach `/mcp` in dev (optional if `PUBLIC_API_URL` is already public) |
| MinIO _(or any S3-compatible bucket)_ | stores session recordings; `brew install minio` runs it locally                   |
| ffmpeg                                | speech-format encoding; also builds media fixtures and the simulated-HLS ladder   |
| MediaMTX _(optional)_                 | free local RTMP→HLS origin for the CDN tier — `infra/mediamtx.yml`                |

**Credentials.** Agora App ID + Certificate + Customer ID/Secret (ConvoAI + RTT). For text chat, set `LLM_PROVIDER=openrouter` and `LLM_API_KEY` — voice does not need them.

### Agora Console (enable before demo)

Turn **ON** in your project (each takes ~5 minutes to propagate):

| Service                      | Console location      | Required for                           |
| ---------------------------- | --------------------- | -------------------------------------- |
| **Signaling**                | Messaging & Signaling | Chat, AI transcripts                   |
| **Conversational AI Engine** | Intelligence          | Voice shopping assistant               |
| **Real-Time Speech-to-Text** | Intelligence          | Host captions                          |
| **Co-host Authentication**   | Infrastructure        | Publisher vs subscriber token roles    |
| **Media Gateway**            | Media Services        | OBS / RTMP ingest (enabled by default) |

Also ensure **Primary Certificate** is enabled on the project.

## Run it

```bash
cp .env.example .env          # then fill in Agora credentials (+ LLM_API_KEY for text chat)
npm install

# PostgreSQL and Redis must be reachable at DATABASE_URL / REDIS_URL
npm run db:push               # migrations + FTS indexes + the agora_uid_seq sequence
npm run db:seed               # catalog, personas, promotions, live sessions, replay fixtures

ngrok http 8787               # copy the https URL into PUBLIC_API_URL in .env

npm run dev                   # api (:8787) + worker + SSE (:8789) + AI (:8790) + storefront (:5173) + seller console (:5174) + support (:5175)
```

Open <http://localhost:5173> for the storefront, <http://localhost:5174> for the seller console (Studio), and <http://localhost:5175> for the support dashboard — three Vite apps built from the one `apps/web` source tree. They are deliberately separate origins because they serve different audiences and ship on different schedules: a shopper never downloads console code, and Studio can be redeployed or firewalled without touching the storefront. What they share is the API and the identity — the session cookie is host-scoped to `localhost` and cookies ignore the port, so the one-click demo login you press on the storefront is already signed in on the console.

In local dev, each Vite server proxies `/api`, `/mcp`, and `/media` to the API on `:8787` and `/api/events` to the SSE gateway on `:8789`. nginx on `:8080` is only required for the multi-replica Docker Compose stack below.

The storefront header's account menu has one-click **Customer / Seller** logins; Seller opens the console on :5174 in a new tab.

The seller console owns these routes on :5174:

| Path on :5174           | Page                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                     | overview — peak/unique viewers, chat/reaction/poll counts, AI conversations and tool calls, add-to-carts, orders, GMV, conversion, discount by promotion code |
| `/shows`                | show list and scheduling                                                                                                                                      |
| `/shows/:id/report`     | per-show analytics                                                                                                                                            |
| `/catalog`              | inventory and stock                                                                                                                                           |
| `/catalog/new`          | list a product (`POST /api/seller/products`)                                                                                                                  |
| `/orders`               | paid orders                                                                                                                                                   |
| `/payouts`              | sales and payout totals                                                                                                                                       |
| `/audience`             | moderation log                                                                                                                                                |
| `/live/:slug/preflight` | device and source check                                                                                                                                       |
| `/live/:slug`           | host console — publish, pin, polls, moderation, product sharing                                                                                               |

`infra/docker-compose.yml` is the portable multi-replica stack — postgres, redis, two API replicas, two workers (leader-elected singleton loops), two SSE gateways, two AI replicas, and nginx on `:8080` in front. Run from the repo root:

```bash
docker compose -f infra/docker-compose.yml --env-file .env up --build
```

For first-time schema and seed inside Compose, use the `tools` profile:

```bash
docker compose -f infra/docker-compose.yml --env-file .env --profile tools run --rm migrate
docker compose -f infra/docker-compose.yml --env-file .env --profile tools run --rm seed
```

When using Compose, set `PUBLIC_API_URL=http://localhost:8080` and point ngrok at nginx so Agora's callback traverses the load balancer and proves the API is stateless.

## Deploy on Render

The root [`render.yaml`](render.yaml) is a Render Blueprint that collapses the stack
into **one free web service** plus free Postgres and free Key Value. API, SSE, worker,
and the static edge all run in a single container (`infra/Dockerfile.free`). Every
browser surface shares one origin (`/`, `/studio`, `/support`), so the generated
`onrender.com` domain works without custom DNS and preserves the host-only session
cookie.

### Create the Blueprint

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint**, connect the repository, and use `render.yaml`.
3. When prompted, supply the Agora credentials and `LLM_API_KEY` (`sync: false` in
   the Blueprint). `PUBLIC_API_URL` and `WEB_ORIGIN` are wired from
   `RENDER_EXTERNAL_URL` automatically.
4. Apply the Blueprint. Migrations and the first-time seed run automatically when the
   container starts (`infra/start-free.sh`); free-tier services cannot use Render's
   pre-deploy hook.

**Free-tier limits to expect:**

| Limit                          | Effect                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Spin-down after ~15 min idle   | First request after idle can take ~1 minute; free Postgres also hibernates and may need up to ~60s to wake |
| Postgres expires after 30 days | Upgrade the database before expiry to keep data                                                            |
| 512 MB RAM, no persistent disk | Voice uses Agora managed TTS (no Kokoro in-process); recordings are ephemeral                              |
| No private services / workers  | Everything runs in-process in the one web container                                                        |

After deploy:

```text
https://<your-service>.onrender.com/          customer storefront
https://<your-service>.onrender.com/studio/     seller console
https://<your-service>.onrender.com/support/    support console
https://<your-service>.onrender.com/api/health
```

Log in with the demo accounts below. Ensure `PUBLIC_API_URL` points at
`https://<your-service>.onrender.com` so Agora can reach `/mcp` (no ngrok needed on Render).

### The second replica

`npm run dev` starts one API. To run the two-replica topology:

```bash
PORT=8787 npm run start --workspace @shop/api
PORT=8788 npm run start --workspace @shop/api
npm run start --workspace @shop/worker
```

Only **one** worker leader may run at a time: it owns every timer (the 1 Hz aggregates, the analytics drain, the lease sweeper, retention), which is what keeps two replicas from double-emitting.

### Live video sources

Every surface that shows moving video reads from one of two places, and **both are supported**:

| Surface                                                    | Camera                                                       | Video file                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host console (`/live/<slug>` on the seller console, :5174) | `Publish → Camera & mic` publishes the webcam and microphone | `Publish → Video file` decodes `/media/recordings/live-source.mp4` into `<video>.captureStream()` and publishes it as custom RTC tracks — same channel, same publisher token, same `client.publish`, and the browser recorder captures the same tracks, so the replay is what viewers saw |
| Viewer room (`/live/<slug>` on the storefront, :5173)      | subscribes to the host's RTC publish                         | while the channel has **no publisher**, the room plays the file as a **standby feed**, labelled `Standby feed — no host is publishing yet` and muted until you press _Unmute standby feed_. A real publisher takes the stage the instant it arrives                                       |
| CDN tier                                                   | —                                                            | the simulated HLS origin is cut from the same file, so the `RTC → CDN` handoff shows the same content it was showing a second earlier                                                                                                                                                     |
| Replay (`/replay/<slug>`)                                  | the uploaded browser recording of an actual session          | before any session has been recorded, the seeded `ended` session points at the 10-minute `sample-session.mp4` cut from the same file                                                                                                                                                      |

The source switch is locked while a session is live: swapping tracks mid-broadcast would renegotiate the publish on every viewer.

Seeded sessions ship with `live-source.mp4` and per-room clips under `/media/recordings/`. Drop your own h264/aac files into `var/recordings/` as `live-<slug>.mp4` before seeding, or replace the files after seed — the host console and standby feed read from the same paths.

## Demo accounts

| Persona                         | Email                 | Why                                                                                                       |
| ------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------- |
| Customer                        | `shopper@demo.test`   | starts with a wishlisted product, so `WISHLIST5` is _eligible_ and its suppression by `LIVE20` is visible |
| Pulse Audio seller / host       | `seller@demo.test`    | owns the audio catalog and hosts the primary demo sessions                                                |
| Cellverse seller / host         | `cellverse@demo.test` | owns the phone catalog and `phones-live`                                                                  |
| Casa Nido seller / host         | `casanido@demo.test`  | owns the home catalog and `decor-live`                                                                    |
| FlexFit Athletics seller / host | `flexfit@demo.test`   | owns apparel and lifestyle products and `gym-live`                                                        |
| Glow Atelier seller / host      | `glow@demo.test`      | owns cosmetics and `glow-live`                                                                            |
| Admin                           | `admin@demo.test`     | promotion rule changes via `/api/admin/promotions`                                                        |
| Support agent                   | `support@demo.test`   | accepts AI escalations and joins voice handoffs on :5175                                                  |
| Loyal shopper                   | `loyal@demo.test`     | has 3 paid orders, so the `loyalty_3plus` segment is reachable                                            |

Password for all listed accounts: `demo1234`.

Seeded sessions: `scheduled` (+2 h) · **`ready-to-go-live`** (start this one in the demo) · five already live — `headphones-live` (the room carrying a 20% markdown), `phones-live`, `decor-live`, `gym-live`, and `glow-live` — and `ended` (replay with a recording, transcript, and poll results). The first four live rooms show extracted cover art in discovery cards; `glow-live` intentionally has no cover and falls back to its video preview. Each room plays its own clip, positioned by the session clock, so "everyone sees the same frame" is something you can actually check.

No sign-in is needed to watch or to buy. A first request without a session cookie is given a guest `users` row and the ordinary signed cookie (`POST /api/auth/guest`, `ensureIdentity`), so the cart, orders, chat, reactions, SSE and the assistant all run on one identity-keyed code path instead of a parallel anonymous one. Signing in afterwards carries the guest's cart onto the account.

## Demo walkthrough

The fifteen journey stages, in the order the plan's manual verification steps run them.

1. **Browse** — home rails, a category with facets, a search, a PDP: variants, specs, PIN-code check, comparison, wishlist.
2. **Ask the assistant from the storefront** — the dock is on every page. _"I need a gift under ₹5,000 with long battery life"_ → _"narrow it to two and compare"_ → _"add the better one"_. `get_live_offer` returns `active:false` here, and the cart line carries **no** discount: the live rule is session-bound, not global.
3. **Discover live** — `/live` shows Upcoming, Live now and Watch again.
4. **Go live** — Tab A: `seller@demo.test` → the console's `/live/<ready-to-go-live>` on :5174 → pick a publish source (**Camera & mic**, **Video file**, or **OBS / RTMP**) → start the preview → accept the recording notice → **Go live**. Tab B: `shopper@demo.test` → `/live/<slug>` on the storefront sees the host feed over RTC and the viewer count rises. Open the viewer room _before_ anyone goes live and it plays the labelled standby feed instead of a black rectangle.
   Two other ways to start, both from the console's `/shows` → **Schedule a session**: attach an mp4/webm and pick **Premiere the video** to have the server flip the room live at its start time with nobody at a console (`startDuePremieres`, background worker, every 5 s), or pick **Go live right now** to have the session created already live. A viewer who opens a room before its start time gets the cover art and a countdown on the server's clock, not a black rectangle.
   **Co-host:** in the broadcast sidebar, create and copy a one-time co-host link, then send it to the second camera operator. Opening the link claims the slot for that browser identity — no seller account is required. The co-host publishes camera/mic and appears in the host's PiP as a second publisher, not a second owner. Agora **Co-host Authentication** enforces `PUBLISHER` tokens; the app decides who may receive one.
   **OBS:** choose **OBS / RTMP** in pre-flight, go live, copy the RTMP server + stream key into OBS, start streaming. The host monitor shows the feed when Media Gateway connects. Browser replay is not captured for OBS shows.
5. **Engage** — chat both ways (note the viewer POSTs to the API and the message comes back published by `chat-service`), reactions aggregate at 1 Hz, open a poll, pin a product and watch the rail reorder.
6. **Moderate** — from a third account post something offensive; the host deletes it and mutes the user, whose _next_ send is refused.
7. **Ask AI in the live room** — _"what are the specs of the featured product?"_ The live audio ducks while the agent speaks and the transcript fills. The assistant volunteers the live offer unprompted.
8. **Compare, check, buy** — _"compare it with two cheaper alternatives"_, _"deliver to 560001, and can I pay cash on delivery?"_ (then `744101`, which is not serviceable), _"what does it cost and are there offers?"_, then _"add it to my cart"_.
9. **Discount** — the cart shows **LIVE20 −20%** with the exact saving, and `WELCOME10`/`WISHLIST5` listed as _cannot be combined_.
10. **Rules change, no redeploy** — as `admin@demo.test`, call `PATCH /api/admin/promotions/:id` (or use the admin promotions API) to set `LIVE20` to 15% restricted to `electronics`. Open carts reprice with no refresh, and non-electronics lines fall through to whichever rule is next-best.
11. **Scale up the tier** — open a third tab so the viewer count reaches `RTC_TIER_MAX_VIEWERS`: one `session.delivery_tier_changed`, every viewer starts HLS _before_ leaving the RTC channel, and the badge reads **"CDN tier (simulated-origin)"**. Chat, reactions, captions and the AI all keep working.
12. **Checkout** — `/cart` → `/checkout` → UPI. `/orders` shows the order with **per-line** live-session attribution. Retry with a card ending `0000` and see that nothing is written and no stock moves.
13. **End the session** — the shopper's open cart instantly drops the discount and explains why; `get_live_offer` returns `active:false`.
14. **Replay** — `/replay/<slug>` plays the recording, transcript search seeks the video, the summary and poll results render, and the assistant there offers no live discount.
15. **Operate** — the console's `/` overview on :5174 shows peak/unique viewers, chat/reaction/poll counts, AI conversations and tool calls, add-to-carts, orders, GMV, conversion and discount by promotion code; `/audience` lists step 6. List a new product from `/catalog/new` (`POST /api/seller/products`) and it appears in `/catalog` and on the storefront.

## Verify it

```bash
npm test          # unit tests + 5 integration checks against real PG/Redis
npm run typecheck # all apps and packages
npm run lint
```

The integration checks are also runnable individually and print their own assertions:

```bash
node --env-file=.env --import tsx packages/domain-commerce/src/__checks__/commerce.check.ts
node --env-file=.env --import tsx packages/domain-live/src/__checks__/live.check.ts
node --env-file=.env --import tsx packages/ai/src/__checks__/ai.check.ts
node --env-file=.env --import tsx packages/ai/src/mcp/__checks__/mcp.check.ts
node --env-file=.env --import tsx packages/domain-commerce/src/__checks__/seller.check.ts
node --env-file=.env --import tsx packages/domain-commerce/src/__checks__/support.check.ts
```

### Support escalation demo

1. As `shopper@demo.test`, start a voice AI conversation and ask _"where is my order?"_ — the assistant uses `list_my_orders` / `get_order_status` (demo tracking is seeded on loyal shopper orders).
2. If the AI cannot resolve the issue, it calls `escalate_to_human` (or use `POST /api/support/escalate` from the UI).
3. Open the **support dashboard** at `http://localhost:5175` (`npm run dev:support -w @shop/web`), sign in as `support@demo.test` / `demo1234`, accept the ticket, and join the shopper's `ai-<conversationId>` RTC channel.
4. The shopper UI shows a handoff notice while waiting for the agent.

## Voice AI: Agora ConvoAI + MCP

Voice is **fully Agora-managed** for speech I/O; commerce stays in our stack.

1. **ASR** — ARES transcribes the shopper in the private `ai-<conversationId>` RTC channel.
2. **LLM** — Agora's managed OpenAI-compatible model (`AGORA_MANAGED_LLM_MODEL`, default `gpt-4o-mini`) plans and calls tools.
3. **Tools** — ConvoAI reaches `${PUBLIC_API_URL}/mcp` (streamable HTTP MCP). Per-conversation HMAC headers scope every tool call to one shopper session. Tool handlers live in `@shop/ai` and read/write Postgres — the catalog never enters an Agora prompt.
4. **TTS** — Agora managed TTS (MiniMax `speech-2.8-turbo` by default, set in `packages/agora/src/convoai.ts`, not env vars) speaks the reply back into the RTC channel.

Text chat (degraded mode when voice is unavailable) uses `LLM_PROVIDER` + `LLM_API_KEY` against the same tool handlers in-process — no Agora agent required.

## What is mocked, and why

The brief explicitly permits mock inventory, product, serviceability, payment and checkout services, and asks for depth in architecture, real-time integration, voice AI and business logic instead. So:

| Area                                       | Status                                                                                                                                   | Why                                                                                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment authorization                      | **Mock** — `packages/domain-commerce/src/mock/payments.ts`, 200 ms, in-process, **no external call**; any card ending `0000` is declined | The interesting part is the _ordering_: pre-authorization runs **outside** the stock transaction, so no row lock is ever held across payment latency, and a decline writes no order |
| Delivery serviceability                    | **Mock** — a seeded `pincodes` table                                                                                                     | Real coverage APIs add nothing to the journey                                                                                                                                       |
| Tax, shipping                              | **Not built** — totals are subtotal minus promotions                                                                                     | Out of scope per the brief                                                                                                                                                          |
| Refunds, returns, seller onboarding, fraud | **Not built**                                                                                                                            | Out of scope per the brief                                                                                                                                                          |
| Order queue / fulfilment pipeline          | **Demo tracking fields only** — `fulfilment_status`, carrier, ETA on paid orders for AI `get_order_status`; no carrier webhooks          | production fulfilment engine                                                                                                                                                        |
| Search relevance                           | Postgres full-text only                                                                                                                  | a search cluster would be theatre at this catalog size                                                                                                                              |

**Real, because the exercise grades them:** the promotion rule engine, live-session eligibility and expiry, atomic stock (no oversell), idempotent writes, server-authoritative pricing, server-authoritative chat moderation, and the AI tool contract.

## Honest status of the externally-gated pieces

Nothing below is claimed as working when it cannot be. This table is repeated verbatim from the plan.

| Capability                                                  | Status                                                                                                                                                                                                                                                                                     | Missing prerequisite                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| ConvoAI voice pipeline (ARES ASR + managed LLM + MCP + TTS) | **Built** — join body wires managed LLM + MCP at `/mcp`; managed TTS in `packages/agora/src/convoai.ts`                                                                                                                                                                                    | public `PUBLIC_API_URL` in dev (ngrok) |
| Host captions (Real-Time STT v7)                            | **Verified with real credentials** — join → `RUNNING` → query → leave, 5/5 (`packages/agora/src/__checks__/rtt.check.ts`)                                                                                                                                                                  | —                                      |
| Session recording → object storage → replay                 | **Verified end to end** against MinIO: upload → object stored → public `GET 200`, `206` on range requests → `DELETE` removes object + local copy + row                                                                                                                                     | —                                      |
| Chat sharding, moderation authority, stateless routing      | **Built** below the default 500 REST req/s per App ID                                                                                                                                                                                                                                      | an Agora quota increase for more       |
| Media Push → real CDN/HLS, end to end                       | **`unverified — external RTMP/HLS origin required`.** The converter call, the threshold, the single transition event and the client HLS handoff are built and exercised against a **`simulated-origin`** HLS file. That is _not_ evidence that video traversed Agora Media Push.           | CDN RTMP ingest + HLS origin           |
| Agora Cloud Recording                                       | **Not used — deliberately dropped.** A **paid add-on** (`400 invalid_appid` until purchased), and it adds nothing over browser capture + a real object store. Kept behind `RECORDING_PROVIDER=agora`, including the `vendor: 11` S3-compatible `storageConfig`, for a customer who has it. | the paid add-on                        |
| PSTN                                                        | **Stub routes only** (`POST /api/pstn/incoming`, `POST /api/pstn/callback`). In-app human handoff via support dashboard is built.                                                                                                                                                          | phone number / SIP trunk               |

If `MEDIA_PUSH_ENABLED=false` (the default), every surface — UI badge, API response and analytics — says `simulated-origin`.

## Repository map

```
apps/
  api/              Express 5 commerce API (:8787) — routes, DB access, recording retention
  worker/           background timers, aggregates, retention (Redis leader-elected singleton)
  sse-gateway/      long-lived SSE fan-out (:8789)
  ai-service/       hot-path AI routes (:8790)
  web/              one tree, three Vite entries
    customer/       storefront (:5173)
    seller/         Studio console (:5174)
    support/        support-agent queue + RTC handoff (:5175)
    realtime/       RtmProvider — one Signaling client per browser session
    ai/             useVoiceAgent, AiPanel, AssistantDock, useTextAssist
    hooks/          useLiveSession, useChat, useHostBroadcast, useHostRecorder
packages/
  shared/           promotion evaluator, AI tool contract, shared types
  domain-commerce/  catalog, cart, orders, promotions, support
  domain-live/      sessions, chat, moderation, delivery tier
  ai/               MCP server, LLM providers, tool execution
  agora/            tokens, signaling, convoai, recording, RTT, mediapush
  platform/         env validation, redis, session middleware, SSE helpers
  db/               Drizzle schema
  search/           Postgres / OpenSearch providers
infra/              docker-compose.yml, nginx configs, Dockerfile.free
```

## Configuration worth knowing

| Variable                          | Default                 | Effect                                                                                                                                                                   |
| --------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RTC_TIER_MAX_VIEWERS`            | `3`                     | viewer count that flips a session to the CDN tier. 3 so three tabs demonstrate it; the load stack uses 150; production derives from the 10k PCU / 10 Gbps regional quota |
| `RTM_CHAT_SHARD_TARGET`           | `2`                     | viewers per chat shard. `clamp(ceil(expectedPeakViewers / target), 1, 49)` is frozen at go-live and never recomputed                                                     |
| `CONVOAI_MAX_CONCURRENT_AGENTS`   | `15`                    | under Agora's documented default of 20 per App ID. On exhaustion the client degrades to a labelled text transport                                                        |
| `AGORA_MANAGED_LLM_MODEL`         | `gpt-4o-mini`           | managed LLM Agora uses for voice reasoning + MCP tool calls (ignored when `AGORA_STUDIO_PIPELINE_ID` is set)                                                             |
| `AGORA_STUDIO_PIPELINE_ID`        | _(empty)_               | optional published Agent Studio `pipeline_id`; voice uses the Console agent as-is (API only supplies RTC channel + token)                                                |
| `CONVOAI_SUPPORTED_LANGUAGES`     | `en-US,hi-IN,es-ES`     | languages offered in the assistant UI and passed to ConvoAI ASR                                                                                                          |
| `LLM_PROVIDER`                    | `mock`                  | `mock` for dev/Render free tier; set `openrouter` + `LLM_API_KEY` for real text chat                                                                                     |
| `PRIVACY_MODE`                    | `standard`              | `strict` stops persisting transcript and AI message bodies, and requires viewer recording consent before video renders                                                   |
| `MAX_TOTAL_DISCOUNT_PCT`          | `50`                    | cap applied to the winning promotion candidate                                                                                                                           |
| `TRANSCRIPTION_PROVIDER`          | `agora`                 | Real-Time STT v7 host captions and transcript replay; set `off` only to disable locally                                                                                  |
| `TRANSCRIPTION_LANGUAGES`         | `en-US,hi-IN,es-ES`     | comma-separated caption languages (up to 4); the session language is always merged in when the show goes live                                                            |
| `TRANSCRIPTION_TRANSLATE_TARGETS` | `en-US,hi-IN`           | comma-separated caption translation targets; each transcribed language is translated into the other targets (set empty to disable)                                       |
| `ANALYTICS_RETENTION_DAYS`        | `90`                    | analytics events retained in Postgres; drain runs continuously in the background worker (always on)                                                                      |
| `MEDIA_GATEWAY_ENABLED`           | `true`                  | OBS/RTMP ingest via Agora Media Gateway (`POST /api/sessions/:id/obs-ingest`); set `false` only to disable locally                                                       |
| `MEDIA_GATEWAY_REGION`            | `ap`                    | Agora region for streaming-key minting (`ap`, `na`, `eu`, `cn`)                                                                                                          |
| `RECORDING_PROVIDER`              | `browser`               | browser capture on every show (`POST /api/sessions/:id/recording`); set `off` only to disable locally; `agora`/`auto` for Cloud Recording + object store                 |
| `VITE_CUSTOMER_ORIGIN`            | `http://localhost:5173` | storefront origin `apps/web/src/lib/origins.ts` builds console→storefront links from; set it when the storefront is not on :5173                                         |
| `VITE_SELLER_ORIGIN`              | `http://localhost:5174` | seller-console origin used for storefront→console links                                                                                                                  |
