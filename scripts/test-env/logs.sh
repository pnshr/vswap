#!/usr/bin/env bash
# Stream aggregated logs from every test-env container. Pass `--tail N`
# to docker compose (default: 200). Pass `--follow` to keep streaming.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
exec docker compose -f "$COMPOSE_FILE" logs "$@"
