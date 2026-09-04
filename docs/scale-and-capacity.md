# Scale and capacity

Two separate questions, deliberately kept apart:

1. **What did we actually measure?** — the k6 suite below, on one laptop, in dev mode. Local scale and component evidence.
2. **What would break first at Big-Billion-Days scale, and what is the ceiling?** — extrapolation from Agora's documented limits, with the quotas that need a support ticket named.

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

## 2. Measured results

**Hardware and topology.** Apple M3 Pro (11 cores), 1 host running _everything_: 2 API replicas, the background process, nginx, PostgreSQL 17, Redis 7 and the k6 generator. The API runs under `tsx` (transpile-on-import) — **dev mode, not a built artifact**. `LLM_PROVIDER=mock`. Load env: `RTC_TIER_MAX_VIEWERS=150`, `RTM_CHAT_SHARD_TARGET=2` with `expectedPeakViewers:300`, which clamps to **49 chat shards**.

`loadtest/reset.ts` runs before each scenario, restoring stock, carts, poll votes, presence, redemptions, stream consumer state and the load session's one-way delivery tier — so the suite is repeatable, not merely correct on a cold database.

| #   | Scenario         | Offered load                               | Result                                                                                                           | p95             | Threshold   | Verdict                             |
| --- | ---------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------- | ----------- | ----------------------------------- |
| L1  | `browse`         | 200 VUs / 60 s                             | 99,837 reqs, **1,658 rps**, 0% failed                                                                            | **76 ms**       | < 200 ms    | **PASS**                            |
| L2  | `live-join`      | 300 VUs, join + 5 heartbeats               | 0% failed; **1 tier transition, 0 reverts**; 151 joins saw `cdn`, 149 `rtc`                                      | 562 ms          | < 250 ms    | scale assertions PASS, latency FAIL |
| L3  | `engagement`     | 300 VUs / 60 s, 1 chat + 1 reaction/s each | 32,964 reqs, **540 rps**, 0% failed; backlog **0** at end, drained in **0.018 s**                                | **203 ms**      | < 250 ms    | **PASS**                            |
| L4  | `checkout-burst` | ramp 50→200 iters/s over 30 s              | 2,969 orders; 7.3% failed, 309 dropped iterations                                                                | 3,769 ms        | < 750 ms    | FAIL (saturated)                    |
| L5  | `oversell`       | 500 unique users vs. stock 100             | **exactly 100 paid, final stock 0, 0 idempotency replays**                                                       | 1,638 ms        | correctness | **invariant PASS** (see below)      |
| L6  | `ai-proxy`       | 100 VUs, mock provider                     | 5,305 reqs, 0% failed, **0 bad SSE frames, 0 auth failures**, 100 fragmented-tool-call and 100 replay iterations | TTFB **207 ms** | < 150 ms    | correctness PASS, latency FAIL      |

### What passed, precisely

- **No oversell, exactly.** k6's L5 reported 100 paid but a slightly ragged response mix (365 `out_of_stock` + 18 unexpected + dropped iterations) under a 500-VU ramp on a contended host. Re-run as a _true_ 500-way simultaneous race driven directly against nginx, the distribution is exact:

  ```
  racers: 500   wall: 4.7 s
  201 ok             : 100
  409 out_of_stock   : 400
  final stock        : 0
  order lines         : 100
  ```

  The conditional `UPDATE product_variants SET stock = stock - $qty WHERE id = $id AND stock >= $qty RETURNING` makes overselling structurally impossible, and the 200 ms mock pre-authorization is outside the transaction, so no row lock is ever held across payment latency.

- **The delivery tier flips exactly once and never reverts** (L2: 1 transition, 0 reverts, and later joins read the stored `cdn` tier).
- **The analytics drain outruns the input.** L3 offers ≈600 events/s against a 2,000 rows/s configured drain: backlog 0 at test end, drained in 18 ms.
- **Chat stays inside the RTM budget by construction.** L3's 300 VUs sending 1 chat/s each is ≤300 REST publishes/s against the 500/s default — 60% utilisation, with the remaining headroom reserved for host fan-out (49 publishes per host message) and moderation broadcasts.
- **The AI callback contract holds under concurrency.** L6: zero malformed SSE frames, zero callback-auth failures, and the fragmented-tool-call and replay-dedupe paths exercised 100 times each.

### Why the latency thresholds failed, honestly

The thresholds in the plan were written for a built artifact on dedicated hardware. Three environment factors dominate the measured p95, and none of them is a design defect:

1. **Dev-mode runtime.** The API runs through `tsx`, not a compiled bundle.
2. **Everything on one box.** Two replicas, the background process, Postgres, Redis and the load generator all share 11 cores; the generator competes with the system under test.
3. **L2 and L5 model a thundering herd, not steady state.** L2 is "1 iteration for each of 300 VUs", so all 300 joins arrive at once against cold connection pools. Removing other load actually made L2 _worse_ (1,377 ms), which confirms the number is measuring burst admission, not sustained throughput — L1's 1,658 rps at 76 ms is the honest steady-state figure.
4. **L4 is genuinely saturated, and the arithmetic says so.** 200 orders/s × 200 ms mock pre-authorization ⇒ ≥40 concurrent in-flight pre-authorizations, against `PG_POOL_MAX=20` per replica. 2,969 orders did complete correctly; the queue simply grew. The fix is not a code change but the production design in §4: pre-authorization belongs off the request path.

We did **not** relax any threshold to make the suite green. The suite is checked in with the numbers the plan specified so the gap stays visible.

## 3. Where the capacity model actually bends

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

## 4. What a real BBD system needs that this prototype does not build

Checkout here is synchronous behind an atomic decrement. That is correct and provable at prototype scale, and wrong at scale, because a 200 ms payment call sits on the request path (exactly what L4 measured).

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

## 5. Reproducing the measurements

```bash
npm run stack:up
npm run db:push && npm run db:seed
npm run loadtest:seed                      # 600 load users, fixtures, 100 AI conversations
RTC_TIER_MAX_VIEWERS=150 npm run loadtest  # both API replicas need this value
```

Results land in `loadtest/results/summary.json` (per-scenario metrics and the exact breached thresholds). Both replicas must share the load env: if one still has `RTC_TIER_MAX_VIEWERS=3`, the replicas disagree about the tier threshold and L2's assertion becomes meaningless.
