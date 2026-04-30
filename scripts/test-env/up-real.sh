#!/usr/bin/env bash
# Boot the @vswap/e2e real-validator profile.
#
# Real solana-test-validator does not accept an external --identity. It
# always generates its own validator-keypair.json inside the ledger
# directory. The bring-up therefore runs in two stages:
#
#   Stage 1 — validators only.
#     gen-fixtures creates the e2e CA + agent keys + an *unstaked*
#     keypair per validator. We then boot only validator-a and
#     validator-b (the agents and ops sidecars stay down). Once each
#     validator's getHealth flips to ok and its tower file appears, we
#     copy `<ledger>/validator-keypair.json` out to
#     `fixtures/validator-{a,b}/staked.json` (and `identity.json`).
#     The fixture's `pubkeys.json` and the manifest are updated to
#     reflect the live identity.
#
#   Stage 2 — bring up the rest.
#     With the staked.json fixtures now matching the validators' real
#     identities, the agents and ops sidecars are started, paired
#     with the operator CLI, and tests can run.
#
# Idempotency:
#   * No-arg run: reuses the ledger volume so identities/towers persist.
#   * --reset: wipes the ledger volume + fixtures and re-bootstraps.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.real.yml"
STATE_DIR="$SCRIPT_DIR/state"

mkdir -p "$STATE_DIR"

RESET=0
# AGAVE_VERSION can be passed in the environment; --agave overrides it.
# Both flow into docker-compose.real.yml's AGAVE_VERSION build-arg, and
# the bare version (without the leading `v`) is fed to the agent
# container as AGAVE_REPORTED_VERSION so the agent's preflight + pair
# version-probe report what is actually running. Default is the v2.0.21
# baseline; see docs/supported-versions.md for the matrix.
while [ $# -gt 0 ]; do
  case "$1" in
    --reset) RESET=1 ; shift ;;
    --agave)
      if [ $# -lt 2 ]; then
        echo "up-real.sh: --agave requires a version argument (e.g. v3.1.14)" >&2
        exit 2
      fi
      AGAVE_VERSION="$2"
      shift 2
      ;;
    --agave=*)
      AGAVE_VERSION="${1#--agave=}"
      shift
      ;;
    *) echo "up-real.sh: unknown flag: $1" >&2 ; exit 2 ;;
  esac
done

if [ -n "${AGAVE_VERSION:-}" ]; then
  export AGAVE_VERSION
  export AGAVE_REPORTED_VERSION="${AGAVE_REPORTED_VERSION:-${AGAVE_VERSION#v}}"
  echo "[up-real] AGAVE_VERSION=$AGAVE_VERSION (reported as $AGAVE_REPORTED_VERSION)"
fi

if [ "$RESET" -eq 1 ]; then
  echo "[up-real] resetting: compose down -v + wipe fixtures"
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$FIXTURES_DIR"
fi

# 1. Fixtures (CA + agent material + unstaked.json + a placeholder
#    staked.json that we overwrite in step 4).
if [ ! -f "$FIXTURES_DIR/manifest.json" ]; then
  echo "[up-real] generating base fixtures"
  (cd "$REPO_ROOT" && pnpm --filter @vswap/e2e gen-fixtures)
fi

# 2. Decide whether the validators need a fresh genesis. If the named
#    ledger volumes already hold a validator-keypair.json we keep them;
#    otherwise we set RESET=true so the validator builds its genesis
#    on first boot.
needs_reset() {
  local volume="$1"
  # `docker run --rm` against the volume can fail if the volume does
  # not yet exist; we treat any failure as "needs reset".
  if ! MSYS_NO_PATHCONV=1 docker run --rm \
        -v "$volume":/v alpine:3.20 \
        sh -c "test -f /v/validator-keypair.json" 2>/dev/null; then
    return 0
  fi
  return 1
}

VOLUME_PREFIX="vswap-e2e-real_"
RESET_FLAG="false"
if needs_reset "${VOLUME_PREFIX}ledger-a" || needs_reset "${VOLUME_PREFIX}ledger-b"; then
  RESET_FLAG="true"
fi
export VSWAP_E2E_VALIDATOR_RESET="$RESET_FLAG"
echo "[up-real] validator RESET=$RESET_FLAG"

# 3. Stage 1 — start only the two validator services. `--no-recreate`
#    is critical: subsequent up-real.sh invocations (e.g. vitest's
#    startEnv) must NOT rebuild validators, because that would wipe
#    the existing tower file and shift the validator's identity,
#    invalidating the staked.json fixture mirror from the prior boot.
echo "[up-real] stage 1: starting validators"
docker compose -f "$COMPOSE_FILE" up --build --no-recreate -d validator-a validator-b >/dev/null

wait_for_health() {
  local name="$1"
  local tries="${2:-180}"
  while [ "$tries" -gt 0 ]; do
    local status
    status=$(docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null || echo "starting")
    if [ "$status" = "healthy" ]; then
      echo "[up-real] $name healthy"
      return 0
    fi
    tries=$((tries - 1))
    sleep 1
  done
  echo "[up-real] ERROR: $name never became healthy" >&2
  docker logs --tail 80 "$name" >&2 || true
  return 1
}

wait_for_health vswap-validator-a 240
wait_for_health vswap-validator-b 240

# 3b. Wait for admin RPC to leave its "Retry once validator start up is
#     complete" window. getHealth=ok flips before admin.rpc accepts
#     contactInfo; querying contactInfo through the validator's own
#     command line is the cheapest way to gate.
wait_for_admin_rpc() {
  local container="$1"
  local tries=120
  while [ $tries -gt 0 ]; do
    local out
    out=$(MSYS_NO_PATHCONV=1 docker exec "$container" \
            agave-validator --ledger /var/ledger contact-info 2>&1 \
            || echo "ERR")
    if ! echo "$out" | grep -q -i "retry once"; then
      if echo "$out" | grep -q -E "(Identity:|Pubkey:|Gossip:|RPC:)"; then
        echo "[up-real] $container admin RPC ready"
        return 0
      fi
    fi
    tries=$((tries - 1))
    sleep 1
  done
  echo "[up-real] ERROR: $container admin RPC did not become ready" >&2
  return 1
}

wait_for_admin_rpc vswap-validator-a
wait_for_admin_rpc vswap-validator-b

# 4. Mirror validator-keypair.json from the live ledger volume into the
#    fixture's `staked.json` and `identity.json`, then update
#    `pubkeys.json` and `manifest.json`. We also wait for the tower to
#    appear before declaring the side ready — the swap source flow
#    needs to read it.
sync_identity() {
  local side="$1"            # "a" or "b"
  local container="vswap-validator-$side"
  local fixture_dir="$FIXTURES_DIR/validator-$side"
  local staked_path="$fixture_dir/staked.json"
  local identity_path="$fixture_dir/identity.json"

  mkdir -p "$fixture_dir"

  echo "[up-real] mirroring validator-$side identity from container"
  MSYS_NO_PATHCONV=1 docker exec "$container" \
    sh -c "cat /var/ledger/validator-keypair.json" > "$staked_path"
  cp "$staked_path" "$identity_path"
  chmod 0600 "$staked_path" "$identity_path"

  # Wait for the tower file (it appears within a couple of slots after
  # getHealth flips, but not always at the exact same moment).
  local tries=120
  while [ $tries -gt 0 ]; do
    if MSYS_NO_PATHCONV=1 docker exec "$container" \
          sh -c "ls /var/ledger/tower-*.bin 2>/dev/null | head -1" \
          | grep -q "tower-"; then
      echo "[up-real] validator-$side tower present"
      break
    fi
    tries=$((tries - 1))
    sleep 1
  done
  if [ $tries -eq 0 ]; then
    echo "[up-real] ERROR: validator-$side never produced a tower" >&2
    return 1
  fi

  # agave 2.1.13's tower file is created with a filename embedding a
  # pubkey that does NOT match the validator's identity (the internal
  # Tower.node_pubkey is correct, only the filename is wrong). The
  # agent's findTowerFile / requireTower path looks the file up by
  # filename, so we mirror the actual tower as a second file with the
  # canonical identity-based name.
  local identity_pubkey
  identity_pubkey=$(node --input-type=module -e '
    import { readFile } from "node:fs/promises";
    const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    function encodeBase58(bytes) {
      if (!bytes.length) return "";
      let zeros = 0;
      while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
      const source = Array.from(bytes);
      const size = Math.ceil((bytes.length * 138) / 100) + 1;
      const b58 = new Uint8Array(size);
      let length = 0;
      for (let i = zeros; i < source.length; i++) {
        let carry = source[i]; let j = 0;
        for (let it = size - 1; (carry !== 0 || j < length) && it >= 0; it--, j++) {
          carry += 256 * b58[it]; b58[it] = carry % 58; carry = Math.floor(carry / 58);
        }
        length = j;
      }
      let iter = size - length;
      while (iter < size && b58[iter] === 0) iter++;
      let out = "1".repeat(zeros);
      while (iter < size) out += BASE58[b58[iter++]];
      return out;
    }
    const arr = JSON.parse(await readFile(process.argv[1], "utf8"));
    process.stdout.write(encodeBase58(new Uint8Array(arr).slice(32)));
  ' "$staked_path")
  echo "[up-real] mirroring validator-$side tower file under identity $identity_pubkey"
  MSYS_NO_PATHCONV=1 docker exec "$container" sh -c "
    src=\$(ls /var/ledger/tower-*.bin 2>/dev/null | head -1)
    dst=/var/ledger/tower-1_9-$identity_pubkey.bin
    if [ \"\$src\" != \"\$dst\" ]; then
      cp \"\$src\" \"\$dst\"
      echo \"copied \$src -> \$dst\"
    fi
  "
  return 0
}

sync_identity a
sync_identity b

# 4b. Update the fixture pubkeys + manifest to match the live identity.
#     We re-derive the base58 pubkey from the just-mirrored staked.json
#     using a tiny Node one-liner — same logic gen-fixtures.mjs uses.
update_manifest() {
  node --input-type=module - <<'NODE'
import { readFile, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = process.env.FIXTURES_DIR;

const BASE58 =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function encodeBase58(bytes) {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const source = Array.from(bytes);
  const size = Math.ceil((bytes.length * 138) / 100) + 1;
  const b58 = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < source.length; i++) {
    let carry = source[i];
    let j = 0;
    for (let it = size - 1; (carry !== 0 || j < length) && it >= 0; it--, j++) {
      carry += 256 * b58[it];
      b58[it] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }
  let iter = size - length;
  while (iter < size && b58[iter] === 0) iter++;
  let out = "1".repeat(zeros);
  while (iter < size) out += BASE58[b58[iter++]];
  return out;
}

async function pubkeyOf(path) {
  const arr = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(arr) || arr.length !== 64) {
    throw new Error(`invalid keypair file: ${path}`);
  }
  return encodeBase58(new Uint8Array(arr).slice(32));
}

const aStaked = await pubkeyOf(join(FIXTURES, "validator-a/staked.json"));
const aUnstaked = await pubkeyOf(join(FIXTURES, "validator-a/unstaked.json"));
const bStaked = await pubkeyOf(join(FIXTURES, "validator-b/staked.json"));
const bUnstaked = await pubkeyOf(join(FIXTURES, "validator-b/unstaked.json"));

await writeFile(
  join(FIXTURES, "validator-a/pubkeys.json"),
  JSON.stringify({ staked: aStaked, unstaked: aUnstaked }, null, 2),
);
await writeFile(
  join(FIXTURES, "validator-b/pubkeys.json"),
  JSON.stringify({ staked: bStaked, unstaked: bUnstaked }, null, 2),
);

const manifest = JSON.parse(
  await readFile(join(FIXTURES, "manifest.json"), "utf8"),
);
manifest.validators["validator-a"].staked = aStaked;
manifest.validators["validator-a"].unstaked = aUnstaked;
manifest.validators["validator-b"].staked = bStaked;
manifest.validators["validator-b"].unstaked = bUnstaked;
manifest.profile = "real";
await writeFile(
  join(FIXTURES, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(`[up-real] manifest updated: validator-a=${aStaked}, validator-b=${bStaked}`);
NODE
}

FIXTURES_DIR="$FIXTURES_DIR" update_manifest

# 4c. Fix file modes on the agent fixtures. gen-fixtures.mjs writes
#     them with chmod 0600 on Linux/macOS, but on Windows hosts NTFS
#     does not honour POSIX modes — the agent's KeyfilePermissionsUnsafe
#     guard (correctly) refuses to start. We re-chmod inside an
#     ephemeral container so the metadata is forced into Docker's
#     view of the bind mount.
echo "[up-real] normalising agent + validator fixture file modes"
for side in a b; do
  MSYS_NO_PATHCONV=1 docker run --rm \
    -v "$FIXTURES_DIR/agent-$side":/agent \
    -v "$FIXTURES_DIR/validator-$side":/val \
    alpine:3.20 sh -c '
      chmod 0600 /agent/long-term.sk /agent/server.key 2>/dev/null || true
      chmod 0644 /agent/long-term.pk /agent/long-term.base58 /agent/server.crt /agent/agent.yaml /agent/ca.crt 2>/dev/null || true
      chmod 0600 /val/staked.json /val/unstaked.json /val/identity.json 2>/dev/null || true
      chmod 0644 /val/pubkeys.json 2>/dev/null || true
    '
done

# 5. Stage 2 — start the rest (ops sidecars + agents). We force
#    RESET=false here so compose's dependency check does not recreate
#    the validators with a fresh genesis (which would invalidate the
#    fixture mirroring we just did). `--no-recreate` belt-and-braces.
export VSWAP_E2E_VALIDATOR_RESET="false"
echo "[up-real] stage 2: starting ops sidecars + agents"
docker compose -f "$COMPOSE_FILE" up --build --no-recreate -d ops-a ops-b agent-a agent-b >/dev/null

wait_for_health vswap-ops-a 60
wait_for_health vswap-ops-b 60

OPS_A_URL="${VSWAP_E2E_CHAOS_A_URL:-http://127.0.0.1:17999}"
OPS_B_URL="${VSWAP_E2E_CHAOS_B_URL:-http://127.0.0.1:17998}"

# 6. Wait for the ops sidecars to capture the initial-tower snapshot.
wait_for_snapshot() {
  local url="$1"
  local label="$2"
  local tries=120
  while [ $tries -gt 0 ]; do
    local body
    body=$(curl -fsS -X POST "$url/snapshot" 2>/dev/null || echo "")
    if echo "$body" | grep -q '"captured":true'; then
      echo "[up-real] $label initial-tower snapshot captured"
      return 0
    fi
    tries=$((tries - 1))
    sleep 1
  done
  echo "[up-real] ERROR: $label never produced a tower file" >&2
  return 1
}

wait_for_snapshot "$OPS_A_URL" "validator-a"
wait_for_snapshot "$OPS_B_URL" "validator-b"

wait_for_health vswap-agent-a 60
wait_for_health vswap-agent-b 60

# 7. Pair from the operator.
export VSWAP_HOME="$FIXTURES_DIR/operator/.vswap"
export NODE_TLS_REJECT_UNAUTHORIZED=0

if [ ! -f "$REPO_ROOT/packages/cli/dist/cli.js" ]; then
  echo "[up-real] building @vswap/cli"
  (cd "$REPO_ROOT" && pnpm --filter @vswap/protocol build >/dev/null && pnpm --filter @vswap/cli build >/dev/null)
fi

VSWAP_BIN="$REPO_ROOT/packages/cli/bin/vswap.js"

AGENT_A_ADDR="${VSWAP_E2E_AGENT_A_ADDR:-127.0.0.1:17872}"
AGENT_B_ADDR="${VSWAP_E2E_AGENT_B_ADDR:-127.0.0.1:17873}"

pair_once() {
  local label="$1"
  local addr="$2"
  if grep -q "\"label\": \"$label\"" "$VSWAP_HOME/peers.json" 2>/dev/null; then
    echo "[up-real] already paired: $label ($addr)"
    return 0
  fi
  echo "[up-real] pair --label $label --agent $addr"
  node "$VSWAP_BIN" pair --agent "$addr" --label "$label" --yes >/dev/null
}

pair_once "node-a" "$AGENT_A_ADDR"
pair_once "node-b" "$AGENT_B_ADDR"

echo "[up-real] real-profile environment ready. VSWAP_HOME=$VSWAP_HOME"
echo "[up-real] agents: $AGENT_A_ADDR (node-a) · $AGENT_B_ADDR (node-b)"
echo "[up-real] chaos: $OPS_A_URL (validator-a) · $OPS_B_URL (validator-b)"
echo "[up-real] export VSWAP_E2E_PROFILE=real before running vitest"
