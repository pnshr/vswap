# Multi-stage build for @vswap/agent
# --------------------------------------------------------------------

FROM node:20-alpine AS builder
WORKDIR /build

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/agent/package.json ./packages/agent/

RUN pnpm install --frozen-lockfile --filter '@vswap/protocol...' --filter '@vswap/agent...'

COPY packages/protocol ./packages/protocol
COPY packages/agent ./packages/agent

RUN pnpm --filter @vswap/protocol build \
 && pnpm --filter @vswap/agent build \
 && pnpm --filter @vswap/agent deploy --prod /deploy

# --------------------------------------------------------------------

FROM node:20-alpine AS runtime

RUN addgroup -S -g 10001 vswap \
 && adduser -S -D -G vswap -u 10001 -h /app vswap \
 && mkdir -p /etc/vswap /var/lib/vswap /dev/shm/vswap \
 && chown -R vswap:vswap /etc/vswap /var/lib/vswap /dev/shm/vswap

WORKDIR /app
COPY --from=builder --chown=vswap:vswap /deploy /app

USER vswap

VOLUME ["/etc/vswap", "/var/lib/vswap", "/dev/shm/vswap"]

EXPOSE 7872

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- --no-check-certificate https://127.0.0.1:7872/health || exit 1

ENTRYPOINT ["node", "/app/dist/index.js"]
