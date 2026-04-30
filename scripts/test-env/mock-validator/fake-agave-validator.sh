#!/bin/sh
# Stand-in for `agave-validator` used only by the vswap e2e test env.
# The real agent shells out for a few CLI-only operations during
# preflight (`--version`, `catchup`). This script returns values that
# match the shapes the agent parses from stdout.
#
# IMPORTANT: do NOT extend this with `setIdentity` or other mutations.
# Those must go through the admin RPC unix socket so the mock
# validator's state machine remains the single source of truth.

set -e

# Drop the leading `--ledger <path>` pair that the agent always passes.
if [ "$1" = "--ledger" ]; then
  shift 2
fi

case "$1" in
  --version|-V)
    echo "agave-validator 2.0.0-mock (src:00000000; feat:0000000000)"
    ;;
  catchup)
    echo "45: has caught up"
    ;;
  "")
    echo "fake-agave-validator: no subcommand" >&2
    exit 2
    ;;
  *)
    echo "fake-agave-validator: $1 is a noop in the test env" >&2
    exit 0
    ;;
esac
