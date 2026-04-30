# vswap real-validator ops sidecar.
#
# A small Node 20 service that runs alongside `solana-test-validator`
# and re-exposes the same chaos/observation HTTP API the existing mock
# validator implements. Scenarios that already drive the mock (`/state`,
# `/chaos`, `/tower/delete`, `/tower/corrupt`, `/tower/ensure`,
# `/reset-identity`) work unchanged.
#
# The sidecar mounts the validator's ledger volume (RW, for tower-file
# manipulation) and the admin.rpc unix socket (for setIdentity calls
# during reset-identity). It does NOT proxy admin RPC for the agent —
# the agent talks to admin.rpc directly via its own ledger mount.

FROM node:20-alpine

WORKDIR /app

COPY package.json ./
# No external deps — the sidecar uses Node's built-in http/net/fs APIs.
# The empty install keeps the image layer cache happy.
RUN npm install --omit=dev --silent || true

COPY src ./src

ENV NODE_ENV=production
USER node

# Health: a one-shot HTTP GET against /state.
HEALTHCHECK --interval=2s --timeout=2s --retries=20 \
  CMD wget -qO- http://127.0.0.1:${OPS_HTTP_PORT:-7999}/state | grep -q currentIdentity || exit 1

ENTRYPOINT ["node", "/app/src/index.mjs"]
