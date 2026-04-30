#!/bin/sh
# Stand-in for `agave-validator` in the vswap real-profile e2e env.
#
# The agent shells out to this binary in only two places:
#
#   * `agave-validator --version` — preflight `validator.cli` check
#     (display only).
#   * `agave-validator catchup --our-localhost` — preflight
#     `validator.catchup` check (warning-only; not a hard fail).
#
# Everything else (setIdentity, addAuthorizedVoter, contactInfo,
# rpcAddress) goes through the `admin.rpc` unix socket, which on the
# real profile is the LIVE socket of `solana-test-validator`. So the
# only fidelity that actually matters here is the message strings the
# agent parses out of stdout — those are documented above and we mimic
# them.
#
# IMPORTANT: do NOT teach this wrapper any mutations. Mutations belong
# on the admin RPC socket of the real validator.

set -e

# Drop the leading `--ledger <path>` pair the agent always passes.
if [ "$1" = "--ledger" ]; then
  shift 2
fi

case "$1" in
  --version|-V)
    # Use the version baked in by the compose env, default to the
    # pinned image tag from docker-compose.real.yml.
    echo "agave-validator ${AGAVE_REPORTED_VERSION:-2.1.13} (vswap-real-profile-test-env)"
    ;;
  catchup)
    # Single-node test-cluster: always caught up. The exact slot we
    # report is irrelevant to the agent — it just regexes for
    # "has caught up".
    echo "0: has caught up"
    ;;
  "")
    echo "vswap-real fake-agave-validator: no subcommand" >&2
    exit 2
    ;;
  *)
    echo "vswap-real fake-agave-validator: $1 is a noop in the test env" >&2
    exit 0
    ;;
esac
