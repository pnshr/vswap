# Mock Solana admin RPC validator used by @vswap/e2e. Pure Node, no
# native deps — tiny image, fast cold start.
FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

RUN adduser -S -D -u 10001 mock && \
    mkdir -p /var/ledger && chown -R mock:wheel /var/ledger

USER mock
ENV LEDGER_PATH=/var/ledger
EXPOSE 7999
ENTRYPOINT ["node", "src/index.mjs"]
