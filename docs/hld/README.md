# High-level design — interview one-pager

Open either artifact:

- [`hld-one-page.excalidraw`](hld-one-page.excalidraw) — editable source for Excalidraw
- [`hld-one-page.svg`](hld-one-page.svg) — rendered preview

The page is intentionally simple enough to redraw and explain in an interview. It uses architectural names rather than deployment-product names: the current nginx process is shown as a circular **Load Balancer**, two identical Express processes are one stacked **Application API**, and persistence is split into a **Primary Database**, **Cache + Event Bus**, and **Recording Storage**.

## What the diagram says

1. Customer and seller web clients send HTTPS and SSE traffic through the load balancer to stateless API replicas.
2. PostgreSQL owns durable commerce data. Redis owns hot sessions, presence, pub/sub, SSE fan-out, leases, and queued work.
3. Exactly one background worker consumes jobs, emits aggregates, and runs retention work.
4. Browsers connect directly to Agora for RTC media and RTM messaging; video does not pass through the application API.
5. The API exchanges tokens and lifecycle calls with Agora. Agora's voice-agent flow calls the signed AI callback on the API, which invokes the OpenAI-compatible model provider and executes commerce tools.
6. The optional mass-audience path pushes RTMP from Agora to a CDN and returns HLS to viewers.

These components and flows are derived from the code and deployment definitions in `apps/web`, `apps/server`, and `infra/docker-compose.yml`.

## Back-of-the-envelope panel

The capacity figures are estimates, not measured results. The panel states every assumption and keeps the arithmetic visible:

- 10M DAU × 20 API actions/day = 200M requests/day = about 2.3K average QPS; a 5× peak factor gives about 12K peak QPS.
- 10% live participation × 20 minutes/day gives about 14K average and 70K peak concurrent viewers.
- 70K viewers × 1.5 Mbps gives about 105 Gbps peak CDN egress; one million daily viewers at that duration and bitrate consume about 225 TB/day.
- Six chat/reaction events per viewer per minute at peak gives about 7K events/second.

The 1.5 Mbps estimate matches the configured 720p Media Push bitrate in `apps/server/src/agora/mediapush.ts`.

## Regenerating

```bash
python3 scripts/make-hld-diagrams.py
```

The generator writes both artifacts and fails before writing if any two arrows cross or share a corridor. All arrows remain bound to their nodes in Excalidraw.
