# Multi-stage API image: build a single bundled entry, run without tsx in production.
FROM node:24-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/search/package.json packages/search/package.json
RUN npm ci --include=dev

COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/search packages/search
COPY apps/api apps/api
COPY scripts scripts

RUN npm run build --workspace @shop/api

FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends espeak-ng ffmpeg curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV MIGRATIONS_DIR=/app/apps/api/drizzle
ENV EXTRA_SQL_PATH=/app/apps/api/extra.sql

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/search/package.json packages/search/package.json
RUN npm ci --omit=dev

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/drizzle ./apps/api/drizzle
COPY apps/api/src/db/extra.sql ./apps/api/extra.sql
COPY apps/api/package.json apps/api/package.json
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/search packages/search
COPY scripts scripts
RUN node scripts/cache-tts-model.mjs

RUN mkdir -p /var/lib/live-commerce/recordings/simulated-origin

EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["sh", "-c", "curl -fsS http://127.0.0.1:${PORT:-10000}/api/health/live || exit 1"]

# Runtime env is injected by docker-compose / orchestrator — not read from a .env file.
CMD ["node", "apps/api/dist/index.js"]
