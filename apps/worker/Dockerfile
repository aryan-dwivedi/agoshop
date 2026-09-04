# Worker: bundled background jobs with Redis leader election for singleton loops.
FROM node:24-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/package.json
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
COPY apps/worker apps/worker

RUN npm run build --workspace @shop/worker

FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
RUN npm ci --omit=dev

COPY --from=build /app/apps/worker/dist ./apps/worker/dist

RUN mkdir -p /var/lib/live-commerce/recordings/simulated-origin

CMD ["node", "apps/worker/dist/index.js"]
