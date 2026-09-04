# Technology rationale

Every choice below is defended by what it buys for _this_ problem, and named with what would change the answer.

## The Agora choices

### Conversational AI Engine, not Agora Studio, not a browser-side pipeline

The assistant must be **voice-first, interruptible, low-latency, and able to execute business transactions**. Three options were live:

| Option                         | Why not / why yes                                                                                                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser-side STT → LLM → TTS   | Rejected. You hand raw microphone audio to the client, then build turn detection, barge-in, echo handling and jitter tolerance yourself, per browser. Latency is the sum of three round trips through the client. Nothing about it is reusable for PSTN later. |
| Agora Studio / a no-code agent | Rejected. Good for a demo conversation, wrong for a transaction: our assistant must add to cart under our authorization rules, with argument validation and side-effect deduplication.                                                                         |
| **ConvoAI Engine**             | Chosen. Server-managed ASR/LLM/TTS orchestration with barge-in and turn detection; one token; transcripts delivered over Signaling; the raw audio never becomes the browser's problem; and the same conversation API a SIP gateway would call.                 |

**What would change the answer:** if the requirement were text-first chat, ConvoAI is overkill — a plain streaming completion endpoint would do. If a customer mandated a specific on-prem ASR with no managed option, the `VoiceTransport` seam exists precisely so a third implementation can be added without touching the tool layer.

### `llm.vendor:"custom"` — Agora calls us, not the reverse

This inversion is the single most important integration decision. ConvoAI POSTs an OpenAI-compatible `/chat/completions` to our endpoint, and our proxy owns the tool list and executes tools in-process.

- The catalog never leaves the application, so no answer can be based on a stale prompt-embedded price.
- Tool execution is authenticated as _our_ user, inside _our_ transaction boundary, with zod-validated arguments.
- The model provider is swappable behind one interface, because Agora's contract with us is unchanged by it.

The alternative — `llm.mcp_servers`, or letting ConvoAI call business APIs directly — would push authorization, argument validation and side-effect deduplication out to a vendor we do not control.

Two hard consequences we implement rather than hope about: Agora **rejects non-streaming responses**, so the route is SSE end to end (and `compression` is excluded from it, and nginx runs `proxy_buffering off`); and a retried callback re-runs the model, which mints a **new** `tool_call_id` — so tool-call idempotency is keyed on `(conversationId, turnId, name, argsHash)`, never on the id.

### Signaling (RTM) over Agora Chat

Agora Chat is a full chat product: rosters, offline history, user provisioning, its own App Key. We need a **message bus**, because message authority is ours. Signaling gives it on the same App ID and certificate, with no user pre-registration and no room provisioning, plus presence and the channel ConvoAI already publishes transcripts on — so chat and transcripts share one client.

**What would change the answer:** if the product needed 1:1 DM history, offline push and message search, Agora Chat becomes the right tool and this decision inverts.

### Server-mediated chat, accepting a network hop

Letting viewers publish directly to RTM is faster and is what most demos do. It also makes moderation _advisory_: a banned user keeps publishing until their token is refreshed. We publish from the backend as a fixed `chat-service` account and have clients render only messages whose `publisher` is that account. A ban therefore binds on the very next message. One hop for real authority is the right trade for a commerce platform.

### Two RTC channels, one Signaling client

`remote_rtc_uids` accepts one user id, so per-viewer AI means a per-viewer channel — hence two `IAgoraRTCClient` instances (audience in `live-<slug>`, host in `ai-<conversationId>`). Signaling is the opposite: Agora documents **one client instance per app/client**, so `RtmProvider` owns exactly one, reference-counts subscriptions, and hands the same instance to `AgoraVoiceAI.init({ rtcEngine, rtmEngine })`. Getting this backwards — a second RTM client inside a hook — is the most common way this integration breaks, and it also doubles the account's RTM concurrency footprint.

## The application stack

| Layer                | Choice                                                    | Why this, for this                                                                                                                                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend             | **Vite + React 18 + TypeScript**, TanStack Query, Zustand | Query owns server state and is invalidated by SSE, which is exactly the shape of this app: everything is server-authoritative and pushed. Zustand holds only local RTC/AI session state (tracks, agent status) where a query cache would be wrong.                                                          |
| Styling              | **Tailwind**                                              | A live-commerce UI is dense and bespoke; a component kit would be fought, not used.                                                                                                                                                                                                                         |
| Backend              | **Express 5 + tsx**                                       | Express 5 forwards async rejections to the error handler, and the streaming AI callback needs unbuffered, hand-controlled SSE — a heavier framework adds abstraction exactly where we need direct control of the response.                                                                                  |
| Database             | **PostgreSQL 16+**                                        | Two features are load-bearing: `UNIQUE NULLS NOT DISTINCT` (so browse cart lines with a `NULL` session coalesce instead of duplicating) and `to_tsvector`/GIN for catalog and transcript search. A conditional `UPDATE … WHERE stock >= $qty RETURNING` gives no-oversell without an external lock manager. |
| ORM                  | **Drizzle**                                               | SQL-shaped, so the atomic decrement, the `NULLS NOT DISTINCT` constraint and the composite primary keys are written as intended rather than negotiated with an abstraction; migrations are generated and applied non-interactively.                                                                         |
| Cache / coordination | **Redis 7**                                               | Four distinct jobs, all a natural fit: sessions, viewer presence (sorted set pruned on read), the ConvoAI lease semaphore (Lua for atomic prune-and-take), and pub/sub behind cross-replica SSE. Streams give durable deferred work without adding a queue dependency.                                      |
| Money                | **integer paise**                                         | Floats have no place in pricing; every column is suffixed `MinorUnits`.                                                                                                                                                                                                                                     |
| Shared code          | `packages/shared` as **TypeScript source**, no build step | The promotion evaluator and tool schemas must be _the same code_ on both sides. A build step here buys nothing and adds a stale-artifact failure mode.                                                                                                                                                      |
| Load balancer        | **nginx**, two replicas                                   | The prototype must _prove_ statelessness, not assert it. ngrok points at nginx, so even Agora's callback traverses the balancer.                                                                                                                                                                            |
| Deployment           | Docker Compose, plus a native `scripts/stack.mjs`         | Compose is the portable artifact; the native script exists because the machine this was built on has no Docker, and the topology is identical either way.                                                                                                                                                   |

## Deliberate non-choices

- **No job queue.** Deferred work is a Redis stream with a consumer group, `XACK`ed only after the durable write. Adding BullMQ would add a dependency for one consumer.
- **No order/fulfilment pipeline.** Checkout is synchronous behind an atomic decrement. The async reservation → capture → fulfilment split a real BBD system needs is designed in `scale-and-capacity.md`; building it is exactly the production commerce engine the brief says to skip.
- **No tax/shipping engine, no refunds, no seller onboarding.** Mocked or omitted, and listed in the README.
- **No sticky sessions.** Session records live in Redis, recordings on a shared volume, events in pub/sub — so any replica can serve any request.
- **No BYOK ASR/TTS vendor key.** ARES supplies ASR without a customer key. The TTS seam is BYOK because this Agora SKU rejected managed mode, but its default endpoint runs the open-weight Kokoro model inside `ai-service`; a hosted OpenAI-compatible endpoint remains a configuration-only switch.

## Where the boring choice was deliberately kept

Session cookies over JWTs (revocation matters more than statelessness when a ban must bind immediately). `bcryptjs` over argon2 (no native build for a prototype). Postgres full-text over a search cluster (24 products; a search service would be theatre). Polling Cloud Recording `query` rather than trusting webhooks (Agora itself states NCS delivery is not guaranteed).
