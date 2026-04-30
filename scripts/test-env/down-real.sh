#!/usr/bin/env bash
# Tear down the real-profile e2e env. Use --volumes to also wipe ledger
# state (re-genesis on next up-real.sh).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.real.yml"

VOLUMES_FLAG=""
for arg in "$@"; do
  case "$arg" in
    --volumes) VOLUMES_FLAG="-v" ;;
    *) echo "down-real.sh: unknown flag: $arg" >&2 ; exit 2 ;;
  esac
done

docker compose -f "$COMPOSE_FILE" down --remove-orphans $VOLUMES_FLAG
