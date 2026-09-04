# Scale and capacity

What would break first at Big-Billion-Days scale, and what is the ceiling? Extrapolation from Agora's documented limits, with the quotas that need a support ticket named.

Nothing here is presented as "capacity proven".

## 1. Verified Agora limits (the constraints the design obeys)

| Limit                              | Value                    | Where it shows up in the code                                |
| ---------------------------------- | ------------------------ | ------------------------------------------------------------ |
| Users per RTC channel              | 1,000,000                | not the binding constraint; the project quota is             |
| Concurrent hosts per channel       | 128                      | one host per session here                                    |
| Client subscribes to at most       | 50 hosts                 | irrelevant for a single-host session                         |
| **Project regional quota**         | **10,000 PCU / 10 Gbps** | the real trigger for the CDN flip                            |
| RTM channels subscribed per client | **50**                   | `MAX_CHAT_SHARDS = 49`, leaving one channel of headroom      |
| RTM client API calls/s             | **20**                   | the host subscribes to shards in paced batches (~3 s for 49) |
| RTM messages/s per client          | 60                       | irrelevant: viewers never publish to RTM                     |
| **RTM REST req/s per App ID**      | **500 (default)**        | the server-side chat publish budget                          |
| RTM users per single channel       | 50,000 (default)         | why chat is sharded at all                                   |
| **ConvoAI agents per App ID**      | **20 (default)**         | `CONVOAI_MAX_CONCURRENT_AGENTS=15` + lease semaphore         |
| ConvoAI price                      | $0.10/min per audio task | the reason admission control exists at all                   |
| Cloud Recording                    | 50 PCW / 10 QPS          | browser capture is the demonstrated path                     |
| Media Push transcoding             | $7.99/1,000 min HD H.264 | one converter per live session                               |

Agora publishes **no numeric RTC→CDN cutover**. The defensible statement: the interactive tier runs on RTC up to the project's 10k PCU / 10 Gbps regional quota (raisable toward the 1M-per-channel ceiling), and the passive tier moves to Broadcast Streaming audience role or Media Push → CDN.

## 2. Where the capacity model actually bends

Walk one large seller: 500,000 concurrent viewers on one session.

| Layer          | At 500k viewers                                  | First thing that breaks                                                                   | Mitigation, in the order we would apply it                                                                                                                                                   |
| -------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Video**      | 1 host, 500k audience                            | the project's 10k PCU / 10 Gbps regional quota, long before the 1M/channel ceiling        | the tier flip is already built: interactive tier stays on RTC below `RTC_TIER_MAX_VIEWERS`, everyone else on HLS via Media Push. Raise the project quota with Agora for the interactive tier |
| **Chat read**  | 500k subscribers                                 | RTM's 50,000-users-per-channel default                                                    | already sharded: `clamp(ceil(expectedPeakViewers / target), 1, 49)`. 49 shards × 50k = 2.45M _subscribers_, and the shard count is frozen at go-live so nobody is re-routed mid-session      |
| **Chat write** | say 1% of viewers post once a minute ⇒ ~83 msg/s | the 500 REST req/s per App ID **App-ID-wide**, shared with every other concurrent session | this is the real ceiling and we do not pretend otherwise: a quota increase plus a dedicated moderation/publisher tier. 49 shards alone prove nothing about millions of moderated publishers  |
| **Reactions**  | 500k taps/s at peak                              | RTM cost, not throughput — one send to N subscribers bills as 1+N                         | already aggregated: `HINCRBY` + a 1 Hz aggregate over SSE from the single background process. Per-tap fan-out would be the largest line on the bill                                          |
| **Voice AI**   | 20 concurrent agents by default                  | ConvoAI PCU, immediately                                                                  | admission control + the labelled text fallback means the journey degrades instead of dead-ending. Raising it is a support ticket _and_ a budget decision at $0.10/min                        |
| **Commerce**   | order burst at a drop                            | Postgres connections and the synchronous checkout                                         | read replicas for catalog, then the async pipeline below                                                                                                                                     |
| **Analytics**  | ~1M events/s at the extreme                      | the drain, at 2,000 rows/s per background process                                         | `ANALYTICS_DRAIN_BATCH`/`_INTERVAL_MS`, then partition `analytics_events` by day, then move ingestion to a columnar store                                                                    |
| **SSE**        | 500k open connections                            | file descriptors and memory per replica, not Redis                                        | one subscriber connection per process already; add replicas, then move the fan-out edge to a dedicated SSE tier                                                                              |

### Many simultaneous sellers

Per-session state is keyed by session id throughout (`session:<id>:*` in Redis, `liveSessions` rows, shard channels named from the slug), so sellers are independent by construction. The shared, App-ID-wide ceilings are what serialise them: **ConvoAI 20 PCU, RTM 500 REST req/s, Cloud Recording 50 PCW, 10 QPS**. Those are the four numbers to take to Agora support before a launch, and they are per _App ID_ — not per session, not per seller.

## 3. What a real BBD system needs that this prototype does not build

Checkout here is synchronous behind an atomic decrement. That is correct and provable at prototype scale, and wrong at scale, because a 200 ms payment call sits on the request path.

The production shape:

```
POST /api/orders
  → authorize payment (async, idempotent, provider-side)
  → reserve stock with a TTL   (reservation row, not a decrement)
  → enqueue capture
  → 202 Accepted + order in `pending`
Worker: capture → confirm reservation → order `paid` → fulfilment events
Reconciler: expire stale reservations, void uncaptured authorizations
```

This adds: a reservations table with expiry, a durable queue, a capture worker, an expiry reconciler, and order states beyond `paid`. It also changes the client contract from "201 with a paid order" to "202 plus an order that becomes paid" — which is why it is a deliberate non-goal here rather than a half-built pipeline. A database rollback cannot undo an external charge; the current code is honest about that by voiding the pre-authorization explicitly on every abort path.
