#!/usr/bin/env bash
# Boot a full `agave-validator` single-node cluster for the vswap
# real-profile e2e env.
#
# Why not solana-test-validator: that wrapper keeps `start_progress`
# wedged at a state that makes the admin RPC server permanently reject
# `contactInfo` and `setIdentity` with "Retry once validator start up
# is complete" — the agent depends on both. So we run the lower-level
# `agave-validator` directly, with a hand-crafted single-node genesis
# (same shape as upstream `solana-run.sh`).
#
# Layout:
#   <LEDGER>/                  ledger + admin.rpc unix socket
#   <LEDGER>/validator-keypair.json   the boot identity (we copy
#                                       validator-identity.json here so
#                                       up-real.sh's mirror step finds it)
#   <DATA>/validator-identity.json    primary identity keypair
#   <DATA>/validator-vote-account.json
#   <DATA>/validator-stake-account.json
#   <DATA>/init-completed             agave-validator writes this when
#                                       fully initialised (we use it as
#                                       the readiness signal)
#
# Required env (defaulted):
#   LEDGER_PATH                 default /var/ledger
#   DATA_DIR                    default /var/lib/agave (keypairs)
#   RPC_HTTP_PORT               default 8899
#   GOSSIP_PORT                 default 8001
#   FAUCET_PORT                 default 9900
#   RESET                       "true" → wipe ledger + data on boot
#   EXTRA_VALIDATOR_ARGS        appended to the agave-validator command

set -euo pipefail

LEDGER_PATH="${LEDGER_PATH:-/var/ledger}"
DATA_DIR="${DATA_DIR:-/var/lib/agave}"
RPC_HTTP_PORT="${RPC_HTTP_PORT:-8899}"
GOSSIP_PORT="${GOSSIP_PORT:-8001}"
FAUCET_PORT="${FAUCET_PORT:-9900}"
RESET="${RESET:-false}"
EXTRA_VALIDATOR_ARGS="${EXTRA_VALIDATOR_ARGS:-}"

mkdir -p "$LEDGER_PATH" "$DATA_DIR"

if [ "$RESET" = "true" ]; then
  echo "[vswap-real] RESET=true — wiping ledger + data dir contents"
  # The mount points themselves are not removable (they are docker
  # volume bind targets); empty their contents instead.
  find "$LEDGER_PATH" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  find "$DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi

VALIDATOR_IDENTITY="$DATA_DIR/validator-identity.json"
VALIDATOR_VOTE="$DATA_DIR/validator-vote-account.json"
VALIDATOR_STAKE="$DATA_DIR/validator-stake-account.json"
INIT_COMPLETE="$DATA_DIR/init-completed"

# Generate the three keypairs on first boot. `--no-passphrase --silent`
# keeps stdout clean.
ensure_keypair() {
  local path="$1"
  if [ ! -f "$path" ]; then
    echo "[vswap-real] generating $(basename "$path")"
    solana-keygen new --no-passphrase -so "$path" >/dev/null
  fi
}
ensure_keypair "$VALIDATOR_IDENTITY"
ensure_keypair "$VALIDATOR_VOTE"
ensure_keypair "$VALIDATOR_STAKE"

# Genesis: only build when none exists. Re-using a genesis across runs
# keeps the validator's identity stable so the e2e fixture stays in
# sync.
if [ ! -f "$LEDGER_PATH/genesis.bin" ] && [ ! -f "$LEDGER_PATH/genesis.tar.bz2" ]; then
  echo "[vswap-real] building genesis"
  # Solana-genesis needs a faucet pubkey when --faucet-lamports is
  # passed. We reuse the validator's identity pubkey for that role —
  # the test env never airdrops to anything other than itself, so a
  # shared key is fine.
  faucet_pubkey="$(solana-keygen pubkey "$VALIDATOR_IDENTITY")"
  solana-genesis \
    --hashes-per-tick sleep \
    --faucet-lamports 500000000000000000 \
    --faucet-pubkey "$faucet_pubkey" \
    --bootstrap-validator \
      "$VALIDATOR_IDENTITY" \
      "$VALIDATOR_VOTE" \
      "$VALIDATOR_STAKE" \
    --ledger "$LEDGER_PATH" \
    --cluster-type development >/dev/null
fi

# Mirror validator-identity.json into the ledger directory under the
# canonical Solana CLI name so up-real.sh's existing mirror step finds
# it without needing to know about $DATA_DIR.
cp "$VALIDATOR_IDENTITY" "$LEDGER_PATH/validator-keypair.json"
chmod 0600 "$LEDGER_PATH/validator-keypair.json"

# Faucet runs in the background to honour airdrops requested by the
# validator boot path.
solana-faucet --keypair "$VALIDATOR_IDENTITY" --port "$FAUCET_PORT" \
  >"$DATA_DIR/faucet.log" 2>&1 &
FAUCET_PID=$!
trap 'kill "$FAUCET_PID" 2>/dev/null || true' EXIT

# Remove any prior init-completed marker; agave-validator rewrites it
# on each successful boot.
rm -f "$INIT_COMPLETE"

ARGS=(
  --identity "$VALIDATOR_IDENTITY"
  --vote-account "$VALIDATOR_VOTE"
  --ledger "$LEDGER_PATH"
  --gossip-port "$GOSSIP_PORT"
  --rpc-port "$RPC_HTTP_PORT"
  --rpc-faucet-address "127.0.0.1:$FAUCET_PORT"
  --full-rpc-api
  --enable-rpc-transaction-history
  --no-wait-for-vote-to-start-leader
  --no-os-network-limits-test
  --log -
  --init-complete-file "$INIT_COMPLETE"
  --allow-private-addr
)

# --require-tower is the production flag, but the very first boot has
# no tower yet — agave-validator creates one on the first vote. We add
# it from the second boot onward (when a tower file already exists).
if compgen -G "$LEDGER_PATH/tower-*.bin" > /dev/null; then
  ARGS+=(--require-tower)
fi

# shellcheck disable=SC2206
ARGS+=($EXTRA_VALIDATOR_ARGS)

echo "[vswap-real] starting agave-validator: ledger=$LEDGER_PATH rpc=$RPC_HTTP_PORT"
exec agave-validator "${ARGS[@]}"
