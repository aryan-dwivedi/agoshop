# Customer journey

The assignment defines eleven stages. Each one below names the concrete UI/API behaviour that implements it and the demo step that observes it (`M2`…`M22` are the manual verification steps in `LIVE_COMMERCE_PLATFORM_PLAN.md`).

| #   | Stage         | What actually happens                                                                                                           | Observed by |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Browse        | Category rails, facet listing, `to_tsvector` search, PDP with variant-level price/stock                                         | M2          |
| 2   | Discover Live | `/live` renders Upcoming / Live now / Watch again from `GET /api/sessions?status=`                                              | M4          |
| 3   | Join          | `POST /api/sessions/:id/join` returns RTC identity + the stored delivery tier; 10 s presence heartbeat                          | M5          |
| 4   | Engage        | Chat via `POST /api/sessions/:id/chat` (server-mediated), 1 Hz reaction aggregates, polls, pinned product cards                 | M6          |
| 5   | Ask AI        | Second RTC client on `ai-<conversationId>`; the agent joins; live audio ducks to volume 15                                      | M9          |
| 6   | Compare       | `compare_products` over the real catalog, rendered in the AI panel and the comparison drawer                                    | M10         |
| 7   | Check         | `check_delivery`, `get_payment_options` (the same function checkout calls), current price + `get_live_offer`                    | M11         |
| 8   | Buy           | `add_to_cart` through `resolveLineContext`, deduplicated by `aiToolCalls`                                                       | M13         |
| 9   | Discount      | `LIVE20` applies only while the line is live-eligible; the saving is stated in the UI _and_ spoken, and volunteered proactively | M13, M9     |
| 10  | Checkout      | Policy validation → pre-authorization → one short stock transaction → order with per-line attribution                           | M17         |
| 11  | Replay        | Browser-recorded video, searchable transcript, summary — and `get_live_offer` returns `active:false`, so `LIVE20` cannot apply  | M18, M19    |

## The core sequence

```mermaid
sequenceDiagram
    autonumber
    actor S as Shopper (browser)
    participant W as Web app
    participant API as API (behind nginx)
    participant PG as Postgres
    participant SIG as Agora Signaling
    participant RTC as Agora SD-RTN
    participant CV as ConvoAI
    participant LLM as LLM provider

    Note over S,W: Stage 1-2 · browse, then discover sessions
    S->>API: GET /api/products?q=…
    S->>API: GET /api/sessions?status=live

    Note over S,RTC: Stage 3 · join
    S->>API: POST /api/sessions/:id/join
    API->>PG: session + frozen chatShardCount
    API-->>S: {rtcToken, uid, chatChannel, shardIndex, deliveryTier}
    S->>RTC: join live-<slug> as audience(level 2)
    RTC-->>S: host video + audio

    Note over S,SIG: Stage 4 · engage (viewers never publish to RTM)
    S->>API: POST /api/sessions/:id/chat {messageId, text}
    API->>PG: reject if muted/banned, else persist
    API->>SIG: publish envelope as `chat-service`
    SIG-->>S: message (publisher == chat-service → rendered)

    Note over S,CV: Stage 5 · private voice AI, live stream still playing
    S->>API: POST /api/ai/conversations
    API-->>S: {rtcChannel, rtcToken, viewerUid, agentUid}
    S->>RTC: join ai-<id> as host, publish mic
    S->>SIG: RtmProvider.subscribe(ai-<id>)  %% before /start, so no transcript is missed
    S->>API: POST /api/ai/conversations/:id/start
    API->>CV: join {llm.vendor:custom, asr:ares, tts:managed}
    CV->>RTC: agent audio into ai-<id>
    S->>S: duck live audio to volume 15

    Note over S,LLM: Stage 6-8 · the AI acts through our tools only
    S-->>CV: "compare it with two cheaper options, then add the better one"
    CV->>API: POST /api/ai/convo/:id/chat/completions (stream:true, signed HMAC headers)
    API->>API: prepend FRESH live-context system message
    API->>LLM: streamChat(messages, SHOPPING_TOOLS)
    LLM-->>API: delta.tool_calls fragments (accumulated by index)
    API->>PG: compare_products, then add_to_cart via resolveLineContext
    API-->>CV: assistant tool_calls msg → tool results → text chunks → [DONE]
    CV-->>S: spoken answer + RTM transcript
    API-->>S: SSE cart.updated + ai.tool_executed

    Note over S,PG: Stage 9-10 · discount, then checkout
    S->>API: GET /api/cart
    API->>PG: resolveLineContext → live-eligible → evaluatePromotions
    API-->>S: line shows LIVE20 −20%, WISHLIST5 suppressed (not_stackable)
    S->>API: POST /api/orders (Idempotency-Key)
    API->>API: preauthorize OUTSIDE any transaction
    API->>PG: one short tx — revalidate, atomic stock decrement, order + per-line liveSessionId
    API-->>S: 201 order

    Note over S,PG: Stage 11 · session ends, eligibility dies with it
    API->>PG: UPDATE … WHERE status='live' RETURNING  (host ends)
    API-->>S: SSE session.status_changed + cart.updated
    S->>API: GET /api/cart
    API-->>S: discount 0, notice live_discount_expired
    S->>API: /replay/<slug> — same assistant, get_live_offer → active:false
```

## The state machine behind stage 9 → 11

```mermaid
stateDiagram-v2
    [*] --> scheduled
    scheduled --> live: POST /start (UPDATE … WHERE status='scheduled')<br/>freezes chatShardCount, starts side services
    live --> ended: POST /end (UPDATE … WHERE status='live')<br/>fans out cart.updated to every bound cart
    ended --> [*]

    state live {
        [*] --> rtc
        rtc --> cdn: pruned viewers ≥ RTC_TIER_MAX_VIEWERS<br/>AND HLS origin ready (Redis CAS, once)
        cdn --> cdn: new joiners read the stored tier
    }

    note right of live
        Line is live-eligible only while ALL hold:
        session exists · status='live'
        · product attached in liveSessionProducts
        · variant belongs to that product
    end note

    note right of ended
        Open carts reprice with no refresh.
        Replay surface evaluates as not-live,
        so LIVE20 can never apply there.
    end note
```

## Degraded paths the journey still survives

| Failure                                | What the shopper sees                                       | Why the journey continues                                                                |
| -------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ConvoAI at capacity (20 agents/App ID) | "Voice agents at capacity — using text assist (degraded)"   | identical tool executor over a non-streaming JSON transport                              |
| No CDN ingest configured               | "CDN tier (simulated-origin)" badge                         | the tier transition and HLS handoff still demonstrate; Media Push is labelled unverified |
| No storage bucket                      | replay plays the browser `MediaRecorder` capture            | Cloud Recording stays behind config, contract-tested only                                |
| `MediaRecorder` mime unsupported       | explicit "cannot record in this browser" state              | the UI never claims a recording it does not have                                         |
| Signaling REST publish unavailable     | chat still persists and arrives over SSE, labelled degraded | moderation authority lives in `POST /chat`, not in the transport                         |
| Session ends mid-checkout              | `409 pricing_changed` with the new totals, re-confirm       | pre-authorization is voided; no order at a stale price                                   |
