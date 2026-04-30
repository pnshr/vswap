#!/usr/bin/env bash
# Teardown the @vswap/e2e test environment. Leaves fixtures on disk so
# a subsequent `up.sh` is fast. Pass `--all` to wipe volumes and
# fixtures too.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
COMPOSE_OVERRIDE="$SCRIPT_DIR/docker-compose.override.yml"
COMPOSE_ARGS=(-f "$COMPOSE_FILE")
if [ -f "$COMPOSE_OVERRIDE" ]; then
  COMPOSE_ARGS+=(-f "$COMPOSE_OVERRIDE")
fi

WIPE=0
for arg in "$@"; do
  case "$arg" in
    --all) WIPE=1 ;;
    *) echo "down.sh: unknown flag: $arg" >&2 ; exit 2 ;;
  esac
done

echo "[down] docker compose down --remove-orphans"
if [ "$WIPE" -eq 1 ]; then
  docker compose "${COMPOSE_ARGS[@]}" down -v --remove-orphans || true
  rm -rf "$SCRIPT_DIR/fixtures"
else
  docker compose "${COMPOSE_ARGS[@]}" down --remove-orphans || true
fi
