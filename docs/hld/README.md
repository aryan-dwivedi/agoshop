# High-level design — one-pager

Open the editable source: [`hld-one-page.excalidraw`](hld-one-page.excalidraw)

The page is intentionally simple enough to redraw and explain clearly. It uses architectural names rather than deployment-product names: the current nginx process is shown as a circular **Load Balancer**; three backend pools (Commerce API, SSE Gateway, AI Service), each with two replicas, are one stacked **Backend services** block; and persistence is split into a **Primary Database**, **Cache + Event Bus**, and **Recording Storage**.

## What the diagram says

1. Three web origins (customer storefront, seller console, support dashboard) send HTTPS and SSE through the load balancer. nginx routes `/api/events` to the SSE pool, `/mcp` to the AI pool (sticky on `X-Convo-Id`), and the rest to the Commerce API pool.
2. PostgreSQL owns durable commerce data. Redis owns hot sessions, presence, pub/sub, SSE fan-out, leases, and queued work.
3. Two background worker replicas share stream consumers; leader-elected singleton loops emit aggregates and run retention work.
4. Browsers connect directly to Agora for RTC media and RTM messaging; video does not pass through the application tier.
5. The Commerce API exchanges tokens and lifecycle calls with Agora. Agora's managed ConvoAI stack (ASR + LLM + TTS) calls `/mcp` on the AI service with per-conversation HMAC headers; tool handlers read and write Postgres. Text chat uses `LLM_PROVIDER` in-process on the Commerce API.
6. The optional mass-audience path pushes RTMP from Agora to a CDN and returns HLS to viewers.

These components and flows are derived from the code and deployment definitions in `apps/web`, `apps/api`, `apps/sse-gateway`, `apps/ai-service`, `apps/worker`, and `infra/docker-compose.yml`.

## Back-of-the-envelope panel

The capacity figures are estimates, not measured results. The panel states every assumption and keeps the arithmetic visible:

- 10M DAU × 20 API actions/day = 200M requests/day = about 2.3K average QPS; a 5× peak factor gives about 12K peak QPS.
- 10% live participation × 20 minutes/day gives about 14K average and 70K peak concurrent viewers.
- 70K viewers × 1.5 Mbps gives about 105 Gbps peak CDN egress; one million daily viewers at that duration and bitrate consume about 225 TB/day.
- Six chat/reaction events per viewer per minute at peak gives about 7K events/second.

The 1.5 Mbps estimate matches the configured 720p Media Push bitrate in `packages/agora/src/mediapush.ts`.
