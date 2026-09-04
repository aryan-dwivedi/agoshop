# Dedicated SSE fan-out tier. Session cookie validation is bundled from @shop/api.
FROM node:24-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/sse-gateway/package.json apps/sse-gateway/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/platform/package.json packages/platform/package.json
COPY packages/agora/package.json packages/agora/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/domain-commerce/package.json packages/domain-commerce/package.json
COPY packages/domain-live/package.json packages/domain-live/package.json
RUN npm ci --include=dev

COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/sse-gateway apps/sse-gateway

RUN npm run build --workspace @shop/sse-gateway

FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/sse-gateway/package.json apps/sse-gateway/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev

COPY --from=build /app/apps/sse-gateway/dist ./apps/sse-gateway/dist

EXPOSE 8789

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=6 \
  CMD ["sh", "-c", "curl -fsS http://127.0.0.1:${PORT:-10000}/metrics || exit 1"]

CMD ["node", "apps/sse-gateway/dist/index.js"]
