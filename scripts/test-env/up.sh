#!/usr/bin/env bash
# Boot the @vswap/e2e mock test environment. Idempotent:
#   - Generates fixtures if missing (see gen-fixtures.mjs).
#   - docker compose up -d --build.
#   - Polls each agent's /health until it reports ok.
#   - Runs `vswap pair` for both agents from the operator's config dir.
#   - Exits 0 once everything is green, non-zero on any timeout.
#
# Usage:
#   bash scripts/test-env/up.sh            # reuse existing fixtures
#   bash scripts/test-env/up.sh --reset    # wipe fixtures + containers first
#
# Host port overrides:
#   On Windows, TCP 7981–8080 is reserved by Hyper-V (validator chaos
#   ports collide). Set the environment variables below to remap. The
#   defaults match the in-tree compose ports for a clean Linux host.
#     VSWAP_E2E_AGENT_A_ADDR  default 127.0.0.1:7872
#     VSWAP_E2E_AGENT_B_ADDR  default 127.0.0.1:7873
#   When `scripts/test-env/docker-compose.override.yml` is present it
#   shifts the host-side ports; export the matching addresses here so
#   `vswap pair` reaches the right ports.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
COMPOSE_OVERRIDE="$SCRIPT_DIR/docker-compose.override.yml"
COMPOSE_ARGS=(-f "$COMPOSE_FILE")
if [ -f "$COMPOSE_OVERRIDE" ]; then
  COMPOSE_ARGS+=(-f "$COMPOSE_OVERRIDE")
fi
STATE_DIR="$SCRIPT_DIR/state"

mkdir -p "$STATE_DIR"

RESET=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    *) echo "up.sh: unknown flag: $arg" >&2 ; exit 2 ;;
  esac
done

if [ "$RESET" -eq 1 ]; then
  echo "[up] resetting test env: compose down -v + wipe fixtures"
  docker compose "${COMPOSE_ARGS[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$FIXTURES_DIR"
fi

# 1. Fixtures.
if [ ! -f "$FIXTURES_DIR/manifest.json" ]; then
  echo "[up] generating fixtures"
  (cd "$REPO_ROOT" && pnpm --filter @vswap/e2e gen-fixtures)
fi

# 2. Compose.
echo "[up] docker compose up --build -d"
docker compose "${COMPOSE_ARGS[@]}" up --build -d >/dev/null

# 3. Wait for agents to report healthy via the Docker healthcheck. This
#    mirrors what `depends_on: condition: service_healthy` would
#    guarantee for a client container, but we are on the host.
wait_for_health() {
  local name="$1"
  local tries=60
  while [ $tries -gt 0 ]; do
    local status
    status=$(docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null || echo "starting")
    if [ "$status" = "healthy" ]; then
      echo "[up] $name healthy"
      return 0
    fi
    tries=$((tries - 1))
    sleep 1
  done
  echo "[up] ERROR: $name never became healthy" >&2
  docker logs --tail 60 "$name" >&2 || true
  return 1
}

wait_for_health vswap-validator-a
wait_for_health vswap-validator-b
wait_for_health vswap-agent-a
wait_for_health vswap-agent-b

# 4. Pair from the operator. `vswap pair --yes` skips the fingerprint
#    prompt so this script stays non-interactive. We shell out to the
#    built CLI entrypoint rather than a docker exec so tests run
#    against the same binary operators will use in prod.
export VSWAP_HOME="$FIXTURES_DIR/operator/.vswap"
export NODE_TLS_REJECT_UNAUTHORIZED=0

# Ensure the CLI has been built.
if [ ! -f "$REPO_ROOT/packages/cli/dist/cli.js" ]; then
  echo "[up] building @vswap/cli"
  (cd "$REPO_ROOT" && pnpm --filter @vswap/protocol build >/dev/null && pnpm --filter @vswap/cli build >/dev/null)
fi

VSWAP_BIN="$REPO_ROOT/packages/cli/bin/vswap.js"

AGENT_A_ADDR="${VSWAP_E2E_AGENT_A_ADDR:-127.0.0.1:7872}"
AGENT_B_ADDR="${VSWAP_E2E_AGENT_B_ADDR:-127.0.0.1:7873}"

pair_once() {
  local label="$1"
  local addr="$2"
  # Skip when already paired — makes up.sh idempotent.
  if grep -q "\"label\": \"$label\"" "$VSWAP_HOME/peers.json" 2>/dev/null; then
    echo "[up] already paired: $label ($addr)"
    return 0
  fi
  echo "[up] pair --label $label --agent $addr"
  node "$VSWAP_BIN" pair --agent "$addr" --label "$label" --yes >/dev/null
}

pair_once "node-a" "$AGENT_A_ADDR"
pair_once "node-b" "$AGENT_B_ADDR"

CHAOS_A_URL="${VSWAP_E2E_CHAOS_A_URL:-}"
CHAOS_B_URL="${VSWAP_E2E_CHAOS_B_URL:-}"
CHAOS_A_PORT="${CHAOS_A_URL##*:}"
CHAOS_B_PORT="${CHAOS_B_URL##*:}"
CHAOS_A_PORT="${CHAOS_A_PORT:-7999}"
CHAOS_B_PORT="${CHAOS_B_PORT:-7998}"

echo "[up] e2e environment ready. VSWAP_HOME=$VSWAP_HOME"
echo "[up] agents: $AGENT_A_ADDR (node-a) · $AGENT_B_ADDR (node-b)"
echo "[up] chaos: 127.0.0.1:$CHAOS_A_PORT (validator-a) · 127.0.0.1:$CHAOS_B_PORT (validator-b)"
