#!/usr/bin/env bash
# Full reset: stop containers, wipe volumes and fixtures, regenerate.
# Equivalent to `down.sh --all && up.sh`.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/down.sh" --all
bash "$SCRIPT_DIR/up.sh"
