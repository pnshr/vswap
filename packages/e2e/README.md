# @vswap/e2e

End-to-end test suite for the vswap hot-swap flow. The suite boots a
reproducible Docker Compose topology (two mock Solana validators + two
`@vswap/agent` instances) and drives the full swap orchestration via
the `@vswap/cli` binary exactly as an operator would.

## Quick start

```bash
# 1. From the repo root — install + build.
pnpm install
pnpm -r run build

# 2. Start the environment (idempotent — regenerates fixtures on first run).
bash scripts/test-env/up.sh

# 3. Run every scenario.
pnpm -F @vswap/e2e test

# 4. Tear down when finished.
bash scripts/test-env/down.sh
```

The docker compose stack is isolated on a private bridge network
(`vswap-e2e-net`) and requires no internet access once images have been
pulled.

## Scenarios

Each `src/scenarios/*.test.ts` is a standalone file that can be run in
isolation via `pnpm -F @vswap/e2e test -- <name>`.

| Scenario | What it proves |
| -------- | -------------- |
| `happy-path` | 10 consecutive swaps all complete in <5s; identity moves A→B cleanly. |
| `preflight-fails` | Missing source tower is caught before any admin RPC mutation. |
| `tower-missing` | The source agent refuses to ship a blob when its own tower is absent. |
| `tower-pubkey-mismatch` | A tower whose filename embeds a foreign pubkey is rejected. |
| `tampered-ciphertext` | A target that refuses to take the new identity causes the source to roll back. |
| `agent-crash-mid-swap` | Stopping `agent-b` fails fast (<20s); `vswap rollback` restores source. |
| `network-partition` | Loss of connectivity mid-swap yields the same safe rollback. |
| `replay-attack` | A signed envelope replayed through raw HTTPS is rejected by the nonce cache. |
| `concurrent-swap-attempts` | Two parallel CLIs never cause split-brain; final state is consistent. |
| `rollback` | A forced inconsistent state recovers after `vswap rollback --yes`. |

## Test reliability

The happy-path scenario executes 10 consecutive `vswap swap` runs under
`it.each`. Ten sequential invocations of the file on a developer
laptop (16 GB, Docker Desktop, Linux kernel 6.8) produced 10/10 green
runs with per-run totals of 4.56 – 4.68 s.

## Harness

The `src/harness/` module exposes the primitives each scenario uses:

- `compose.up() / compose.down() / compose.stop(service)` — docker
  orchestration around `scripts/test-env/`.
- `runCli(args, opts)` — spawns `node packages/cli/bin/vswap.js …`
  with an isolated `$VSWAP_HOME`.
- `validator.state(label) / validator.setChaos(label, flags)` — direct
  HTTP admin plane on the mock validators (ports 7999/7998) for
  assertions and fault injection.
- `startEnv() / resetScenario() / stopEnv()` — lifecycle helpers the
  scenarios wire into `beforeAll` / `beforeEach` / `afterAll`.

## Fixtures

All cryptographic fixtures (CA, agent keys, client certs, validator
keypairs) are **generated** by `scripts/gen-fixtures.mjs` on the first
`up.sh` invocation. They live in `scripts/test-env/fixtures/` which is
fully git-ignored. Re-running `bash scripts/test-env/reset.sh` wipes
and regenerates the fixture set.

## Caveats

- The mock validator speaks admin-RPC JSON-RPC over a unix socket and a
  chaos/observation HTTP plane, but it does **not** run Solana
  consensus. These tests verify *semantic* swap behaviour (identity
  file is written, admin RPC is called with the right arguments,
  tower file is transported, authorized voters are updated). Full
  on-chain voting latency is out of scope for the mock profile — see
  the real-validator profile for that.
- mTLS is enforced; tests set `NODE_TLS_REJECT_UNAUTHORIZED=0` because
  the fixture CA is self-signed. Production operators must not do
  this — the CLI should be pointed at the real CA chain.
