# Responsibility mapping — Agora vs. customer application

The exercise's central question. The rule this codebase follows: **Agora carries media, signalling and speech; the application owns every business decision, every price and every authorization.** Where Agora _could_ have been used but should not be, that is called out explicitly.

## Legend

- **Agora** — provided by an Agora product; we call an API or SDK.
- **Application** — customer-owned code in this repo. A real deployment would own exactly the same.
- **Mocked here** — deliberately faked for the prototype, isolated in `apps/server/src/domain/mock/` or a seeded table, and listed in the README's "what is mocked and why".

## Real-time and media

| Capability                                | Owner                                                  | Where                                                         | Notes                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Host → audience live video/audio          | **Agora** RTC (Interactive Live Streaming)             | `hooks/useHostBroadcast.ts`, `components/live/VideoStage.tsx` | `mode:'live'`; host publishes, viewers join as `audience` at latency level 2                                                                                 |
| OBS / RTMP ingest (professional sellers)  | **Agora** Media Gateway                                | `agora/mediagateway.ts`, `routes/sessions/obs.ts`             | app mints streaming key + fixed uid; Agora ingests RTMP into the RTC channel; replay not captured for OBS in this prototype                                   |
| **Who may publish in a channel**          | **Agora** Co-host Authentication + **Application**   | `agora/tokens.ts`, `routes/tokens.ts`                         | Agora enforces `PUBLISHER` vs `SUBSCRIBER` token roles; app authorizes host, invited co-host, or admin only                                                   |
| **Who is invited as co-host**             | **Application**                                        | `routes/sessions/cohost.ts`, `components/host/CoHostPanel.tsx` | co-host can publish but cannot end, pin, poll, or moderate                                                                                                   |
| Private viewer ↔ AI audio                 | **Agora** RTC, second channel                          | `ai/useVoiceAgent.ts`                                         | `ai-<conversationId>`; agent joins with `remote_rtc_uids:[viewerUid]`                                                                                        |
| Ducking live audio while the agent speaks | Application                                            | `ai/useVoiceAgent.ts`                                         | `remoteAudioTrack.setVolume(15)` → 100                                                                                                                       |
| Token minting                             | Application (with Agora's algorithm)                   | `agora/tokens.ts`                                             | App Certificate never leaves the server; RTC uid from `agora_uid_seq`                                                                                        |
| Chat message transport                    | **Agora** Signaling (RTM)                              | `agora/signaling.ts`, `hooks/useChat.ts`                      | shard channels `chat-<slug>-<shardIndex>`                                                                                                                    |
| **Who may say what in chat**              | **Application**                                        | `POST /api/sessions/:id/chat`, `domain/moderation.ts`         | Viewers never publish to RTM; the server publishes as `chat-service`, so a ban binds on the next message rather than the next token refresh                  |
| Presence / viewer count                   | Application over Redis                                 | `domain/sessions.ts`                                          | sorted set pruned on read; Agora presence is available but we need the count for a business threshold                                                        |
| Mass-scale delivery                       | **Agora** Media Push → customer CDN                    | `agora/mediapush.ts`                                          | Agora pushes RTMP; **HLS packaging is the CDN's job**, not Agora's                                                                                           |
| Delivery-tier decision                    | **Application**                                        | Redis CAS on `session:<id>:deliveryTier`                      | one-way flip, one event, never oscillates                                                                                                                    |
| Session recording                         | **Agora** Cloud Recording _or_ browser `MediaRecorder` | `agora/recording.ts`, `hooks/useHostRecorder.ts`              | Cloud Recording needs a third-party bucket — Agora hosts no storage; the browser path is what the demo actually plays                                        |
| Host captions / transcription             | **Agora** Real-Time STT v7                             | `agora/rtt.ts`                                                | captions arrive as gzip'd JSON **stream messages** in the RTC channel, so the server re-broadcasts them over SSE for the CDN tier, which cannot receive them |

## Voice AI

| Capability                          | Owner                                                                  | Where                                                          | Notes                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ASR                                 | **Agora** ConvoAI (`ares`, managed)                                    | `agora/convoai.ts`                                             | no vendor key needed; `en-US`, `hi-IN`, `es-ES`                                             |
| TTS                                 | **Agora** ConvoAI (managed `openai/tts-1`, fallback managed `minimax`) | `agora/convoai.ts`                                             | managed mode is why this project needs no TTS vendor key at all                             |
| Turn detection, barge-in, interrupt | **Agora** ConvoAI                                                      | `POST …/interrupt`                                             | the strongest argument for ConvoAI over a hand-rolled pipeline                              |
| Transcript delivery                 | **Agora** Signaling                                                    | `RtmProvider` + `AgoraVoiceAI`                                 | agent publishes to an RTM channel named exactly the RTC channel                             |
| **The model itself**                | **Application** → LLM provider                                         | `ai/providers/*`                                               | `llm.vendor:'custom'`: Agora calls _our_ OpenAI-compatible endpoint                         |
| **Tool list and tool execution**    | **Application**                                                        | `ai/executor.ts`, `packages/shared/src/tools.ts`               | Agora never sees the catalog and never calls a business API                                 |
| Callback authentication             | **Application**                                                        | `ai/callbackAuth.ts`                                           | per-conversation HMAC over `<conversationId>.<expires>`; `Authorization` is never consulted |
| Tool-call idempotency               | **Application**                                                        | `aiToolCalls` keyed `(conversationId, turnId, name, argsHash)` | deliberately not `toolCallId` — a retry re-runs the model and mints a fresh id              |
| Agent admission control             | **Application**                                                        | `ai/admission.ts`                                              | encodes Agora's documented 20-agent-per-App-ID default as a Redis lease semaphore           |
| Degraded transport                  | **Application**                                                        | `ai/transports/text.ts`, `ai/useTextAssist.ts`                 | same executor, labelled "degraded"; never presented as voice                                |

## Commerce — all application, by design

| Capability                                                 | Owner           | Where                                                                                    |
| ---------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| Catalog, categories, variants, search                      | Application     | `domain/catalog.ts` (Postgres `to_tsvector`)                                             |
| Product comparison                                         | Application     | `compareProducts` (spec-key union)                                                       |
| **Promotion rule engine**                                  | Application     | `packages/shared/src/promotions.ts` — the only place discount semantics exist            |
| **Live-session eligibility**                               | Application     | `domain/eligibility.ts::resolveLineContext` — the only authority                         |
| Checkout policy (COD ceiling, EMI floor, blocked pincodes) | Application     | `domain/checkoutPolicy.ts` — one function behind both checkout and `get_payment_options` |
| Cart, server-authoritative pricing                         | Application     | `domain/cart.ts`; prices always re-read from `productVariants`                           |
| Atomic stock, no oversell                                  | Application     | conditional `UPDATE … WHERE stock >= $qty RETURNING`                                     |
| Idempotent writes                                          | Application     | `Idempotency-Key` + `UNIQUE (userId, idempotencyKey)`                                    |
| Identity, roles, sessions                                  | Application     | opaque ids in a signed cookie, records in Redis                                          |
| Analytics, seller dashboard                                | Application     | Redis stream → Postgres, drained by one background process                               |
| Privacy mode, retention, erasure                           | Application     | `lib/pii.ts`, `background.ts`, `DELETE /api/me/data`                                     |
| Payment authorization                                      | **Mocked here** | `domain/mock/payments.ts` — 200 ms, in-process, no external call                         |
| Delivery serviceability                                    | **Mocked here** | seeded `pincodes` table                                                                  |
| Tax, shipping, refunds, seller onboarding                  | **Not built**   | out of scope per the brief's pragmatic clause                                            |

## Where we deliberately did _not_ use Agora

| Temptation                                        | Decision                            | Why                                                                                                                                             |
| ------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Agora Chat (dedicated chat product)               | Use **Signaling (RTM)**             | same App ID + certificate, no App Key, no user pre-registration, no room provisioning; we only need a message bus because authorization is ours |
| Let viewers publish chat straight to RTM          | **Server-mediated publish**         | direct publish makes moderation advisory: a ban cannot take effect until the next token refresh. One extra hop buys real authority              |
| `llm.mcp_servers` / letting ConvoAI call our APIs | **Custom-LLM proxy**                | keeps the catalog, the tool loop, argument validation and side-effect deduplication inside our process, and makes the model provider swappable  |
| Agora presence as the viewer count                | **Redis sorted set**                | the count drives a _business_ threshold (the CDN flip) and must be prunable and queryable server-side                                           |
| Agora Studio / a no-code agent                    | **ConvoAI + our own backend**       | the assistant must execute business transactions (add-to-cart) under our authorization rules                                                    |
| RTM per-tap reaction fan-out                      | **1 Hz server aggregate over SSE**  | at scale per-tap fan-out is the largest RTM cost line (1 send to N subscribers bills as 1+N)                                                    |
| Agora webhooks (NCS) as the source of truth       | **Polling + lease sweeper primary** | Agora states NCS delivery is not guaranteed; webhooks only accelerate                                                                           |

## Consequence for the customer's team

A customer adopting this design owns: the catalog and pricing services, the promotion/checkout rule engine, cart and orders, identity and roles, chat authorization and moderation policy, the AI tool surface and its security boundary, analytics, and privacy/retention. They do **not** build: media transport, SFU scaling, echo cancellation, turn detection, ASR/TTS orchestration, transcript delivery, recording infrastructure, or CDN push.

That is the split this prototype is built to make visible in the source tree: `apps/server/src/agora/*` is the Agora surface, `apps/server/src/domain/*` is the business, and `apps/server/src/ai/*` is the boundary between them.
