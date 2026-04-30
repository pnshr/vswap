# Real-validator container for the vswap e2e harness.
#
# Wraps the upstream `anzaxyz/agave` image with our deterministic
# entrypoint. We do not rebuild Agave; we only inject the entrypoint and
# sane defaults for `solana-test-validator`.
#
# The pinned image tag matches the row marked **works** in
# `docs/supported-versions.md` — bump both at the same time.

ARG AGAVE_VERSION=v2.0.21
FROM anzaxyz/agave:${AGAVE_VERSION}

# Re-declare ARG after FROM so it survives into the layer.
ARG AGAVE_VERSION

# Minimal toolbelt so the entrypoint can mkdir, sleep, etc. The
# upstream image is debian:bookworm-slim based and already ships
# coreutils + bash, but we install `wget` for healthchecks.
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/vswap-test-validator-entrypoint.sh
RUN chmod 0755 /usr/local/bin/vswap-test-validator-entrypoint.sh

ENV LEDGER_PATH=/var/ledger
ENV DATA_DIR=/var/lib/agave
ENV RPC_HTTP_PORT=8899
ENV RPC_WS_PORT=8900
ENV FAUCET_PORT=9900
ENV GOSSIP_PORT=8001
# RESET=true on first boot wipes ledger + data dirs and forces a
# fresh genesis. up-real.sh sets this on the initial run; subsequent
# runs leave it false so the validator's identity (and accumulated
# tower) survive across compose restarts.
ENV RESET=false

# admin.rpc is a unix socket inside the ledger volume — no port to
# expose. We expose only the JSON-RPC HTTP/WS pair so the sidecar can
# poll getSlot / getVersion.
EXPOSE 8899 8900

# Healthcheck: agave-validator writes `init-completed` once it
# finishes its bootstrap sequence (post-tower, post-vote-account
# setup). This is the same signal `solana-run.sh` uses, and it flips
# materially earlier than `getHealth=ok` on a fresh boot. We
# additionally confirm the JSON-RPC HTTP endpoint accepts traffic so
# the sidecar's getSlot/getVersion probe will not race.
HEALTHCHECK --interval=3s --timeout=3s --retries=80 --start-period=10s \
  CMD test -f "${DATA_DIR}/init-completed" \
   && wget -q --post-data='{"jsonrpc":"2.0","id":"hc","method":"getHealth"}' \
        --header='content-type: application/json' \
        -O- "http://127.0.0.1:${RPC_HTTP_PORT}" 2>/dev/null \
      | grep -q '"result"' || exit 1

ENTRYPOINT ["/usr/local/bin/vswap-test-validator-entrypoint.sh"]
