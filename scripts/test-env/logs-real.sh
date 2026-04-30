#!/usr/bin/env bash
# Tail logs from all real-profile services.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.real.yml"
exec docker compose -f "$COMPOSE_FILE" logs -f --tail=100 "$@"
