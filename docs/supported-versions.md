# Supported Agave versions

Authoritative matrix for which Agave releases the vswap agent has been
**actually exercised** against, plus the basis on which we believe the
untested ones will (or will not) work. Bump this file at the same time
as `scripts/test-env/docker-compose.real.yml`'s `AGAVE_VERSION` build-arg
and the README's "Supported validators" section.

Last updated: 2026-04-29.

## Status legend

| Status | Meaning |
| --- | --- |
| **works** | full e2e suite green against this version |
| **partial** | some scenarios green, some known to fail; see notes |
| **broken** | a hard regression that vswap cannot work around; see notes |
| **source-compat** | not exercised end-to-end yet; admin RPC surface read out of the upstream source confirms our assumptions hold |
| **not-tested** | we have no signal either way |

## Matrix

| Agave version | Released | mainnet-beta status | vswap status | Notes |
| --- | --- | --- | --- | --- |
| **v2.0.21** | 2025-02 era | superseded | **works** | Real-profile baseline. Both `happy-path` (10/10) and `tower-pubkey-mismatch` green. The pinned image in `scripts/test-env/docker-compose.real.yml`. |
| **v2.1.13** | 2025 | superseded | **broken** | `setIdentity --require-tower=true` rejects the validator's own freshly-written tower with `"The signature on the saved tower is invalid"` (`solana_tower::tower_storage::SavedTower::try_into_tower`). We have not been able to determine whether this is the validator's bug or our bug; it survives across forks and even targets the validator's own running identity. |
| **v2.2.x / v2.3.x** | 2025 | superseded | **not-tested** | Skipped — gap between the v2.1 regression and the v3.x line we now consider current. Admin RPC surface unchanged in source. |
| **v3.1.11 – v3.1.14** | 2026-03 → 2026-04 | **current stable mainnet** ([v3.1.14, 2026-04-24](https://github.com/anza-xyz/agave/releases/tag/v3.1.14)) | **source-compat** | All five admin RPC methods we depend on (`setIdentity`, `addAuthorizedVoter`, `removeAllAuthorizedVoters`, `contactInfo`, `rpcAddress`) still present in [`validator/src/admin_rpc_service.rs`](https://github.com/anza-xyz/agave/blob/v3.1/validator/src/admin_rpc_service.rs) with the same signatures. `AdminRpcContactInfo` lost its top-level `version` field in the v3.x line — our `normaliseContactInfo` already typed it `string \| undefined` and degrades cleanly. CHANGELOG.md for v2.0 → v3.1 contains zero entries that mention `admin RPC`, `setIdentity`, `tower`, or authorised voters. **The v2.1 tower-signature regression's status on v3.1 is unverified** — that is the single biggest open risk in this matrix and the next thing to actually run an e2e against. |
| **v4.0.0-rc.0** | 2026-04-24 | testnet/devnet RC | **not-tested** | Source unread. Out of scope until v4 reaches mainnet-beta. |
| **Jito (Agave fork)** | various | downstream of Agave | **not-tested** | Same admin RPC surface as the Agave version it's based on. Status inherits from the matched Agave row above; we do not run a Jito CI lane. |
| **Firedancer** | various | independent client | **not-tested** | Admin RPC surface intentionally not promised compatible. Agent will refuse the swap if `getIdentity` returns an unknown shape rather than guess. Out of scope for this submission. |

## What "works" actually verifies

When a row says **works** we mean: every assertion the e2e harness
makes against that version passed in CI on **this dev host**:

- `up-real.sh --reset` brings up two single-node clusters from a fresh
  genesis without operator intervention.
- The agent's admin-RPC client (unix-socket JSON-RPC over the ledger's
  `admin.rpc` socket) round-trips every method the swap flow uses:
  `contactInfo`, `rpcAddress`, `setIdentity`, `addAuthorizedVoter`,
  `removeAllAuthorizedVoters`.
- Both target scenarios (`happy-path`, `tower-pubkey-mismatch`) finish
  green; the per-swap window is in the second-or-less range.

A row promoted from **source-compat** to **works** requires re-running
the full real-profile suite (ten-iteration `happy-path` plus all the
failure-mode scenarios). Source-code reading alone is not enough.

## How the version is reported at runtime

The agent calls `agave-validator --version` on boot and includes the
trimmed version string in the `PairResponse` it returns to the operator
CLI. The CLI logs it on every `vswap pair` and prints a warning when
the reported version is not in the **works** column above. The warning
is informational only — it does **not** abort the pair.

If you operate against a version this matrix does not list, please
file an issue with:

1. The full output of `agave-validator --version`.
2. The output of `bash scripts/test-env/up-real.sh --agave <your-version>`
   running the `happy-path` scenario.
3. Any error string the agent surfaced during preflight or apply.
