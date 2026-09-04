FROM node:24-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/ai-service/package.json apps/ai-service/package.json
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
COPY apps/ai-service apps/ai-service

RUN npm run build --workspace @shop/ai-service

FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/ai-service/package.json apps/ai-service/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
RUN npm ci --omit=dev

COPY --from=build /app/apps/ai-service/dist ./apps/ai-service/dist

EXPOSE 8790

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["sh", "-c", "curl -fsS http://127.0.0.1:${PORT:-10000}/api/health || exit 1"]

CMD ["node", "apps/ai-service/dist/index.js"]
