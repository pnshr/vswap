# Agave admin-RPC compatibility — source-level analysis

Companion document to [supported-versions.md](./supported-versions.md).

This file records, **per Agave method we depend on**, what the upstream
source on the v3.1 branch looks like vs. what our agent expects. It is
the basis for the "source-compat" classification in the matrix when we
cannot yet run a full e2e.

Source of truth: [`anza-xyz/agave` v3.1 branch — `validator/src/admin_rpc_service.rs`](https://github.com/anza-xyz/agave/blob/v3.1/validator/src/admin_rpc_service.rs).
Last read: 2026-04-29.

## Methods and their wire shapes

### `setIdentity(keypair_file: String, require_tower: bool) -> ()`

- Signature unchanged from v2.0.x → v3.1.x.
- The agent calls it via `AdminRpcClient.setIdentity(keypairPath, requireTower)`
  in [packages/agent/src/solana/admin-rpc.ts](../packages/agent/src/solana/admin-rpc.ts):63.
- `require_tower=true` calls `Tower::restore(meta.tower_storage.as_ref(), &identity_keypair.pubkey())`
  internally; on failure returns `invalid_params` with message
  `"Unable to load tower file for identity {pubkey}: {err}"`.
- The inner `Tower::restore` path verifies the saved tower's Ed25519
  signature with `signature.verify(node_pubkey, &data)` and returns
  `TowerError::InvalidSignature` if it fails — observed firing
  spuriously on v2.1.13. Whether v3.1 still exhibits the
  spurious-failure mode is **unverified**.

### `addAuthorizedVoter(keypair_file: String) -> ()`

- Signature unchanged.
- **Not idempotent** on real agave: re-adding a pubkey already in the
  voter set returns an error. The mock validator dedupes silently.
  Production hardening tracked as a follow-up — `runSwapApply` should
  call `removeAllAuthorizedVoters` before `addAuthorizedVoter` so a
  re-targeted target is safe to swap into.

### `removeAllAuthorizedVoters() -> ()`

- Signature unchanged. We call this only in test cleanup
  (ops-sidecar `/reset-identity`); production agent does not call it
  yet, see the open-risk above.

### `contactInfo() -> AdminRpcContactInfo`

- Method name unchanged.
- **Field shape changed between v2.0 and v3.1.**
- v3.1 struct, verbatim from source:

  ```rust
  pub struct AdminRpcContactInfo {
      pub id: String,
      pub gossip: SocketAddr,
      pub tvu: SocketAddr,
      pub tvu_quic: SocketAddr,
      pub serve_repair_quic: SocketAddr,
      pub tpu: SocketAddr,
      pub tpu_forwards: SocketAddr,
      pub tpu_vote: SocketAddr,
      pub rpc: SocketAddr,
      pub rpc_pubsub: SocketAddr,
      pub serve_repair: SocketAddr,
      pub last_updated_timestamp: u64,
      pub shred_version: u16,
  }
  ```

- The fields the agent reads:
  - `id` → `ContactInfo.identity` (`normaliseContactInfo` accepts both
    `id` and `identity` shapes).
  - `rpc` → `ContactInfo.rpcAddress`.
  - `tpu` → `ContactInfo.tpuAddress`.
  - `shred_version` → `ContactInfo.shredVersion`.
  - `version` → `ContactInfo.version`. **No longer present** in
    v3.1's struct; on v2.0.x it was. Our normaliser typed it
    `string | undefined` from the start so the missing field falls
    through as `undefined`. The only consumer is the preflight
    `validator.reachable` check's `context.version` field (display
    only, never gating). Acceptable as-is.

### `rpcAddress() -> Option<SocketAddr>`

- Signature unchanged. Agent maps `null` → `null` and any other shape
  to a string `host:port`.

### CLI `agave-validator --version`

- The validator binary's `--version` output format is what we use to
  report the validator version through `PairResponse`. Unchanged in
  the v3.1 line; output prefix is still `agave-validator <semver>`.

## What the v3.1 CHANGELOG says about all of this

Nothing. We searched
[CHANGELOG.md on the v3.1 branch](https://github.com/anza-xyz/agave/blob/v3.1/CHANGELOG.md)
for the literal strings: `admin RPC`, `setIdentity`, `set-identity`,
`contactInfo`, `contact-info`, `tower`, `voter`, `--require-tower`,
`AdminRpcContactInfo`, `AdminRpcRequestMetadata`. Zero hits across all
of v2.0 → v3.1.

The Breaking-section entries that exist between v2.0 and v3.1 are
unrelated: `simulateTransaction()` error attachment shape (RPC, not
admin RPC), XDP capability requirement (kernel-level), Blockstore Index
column format (storage, not RPC), snapshot format SIMD-215 (storage),
`TimedTracedEvent` ABI (tracing), and removal of obsolete RPC v1
endpoints (public RPC, not admin RPC).

## Open risks

1. **v2.1 tower-signature regression on v3.1.** Until we run a full
   real-profile e2e against `anzaxyz/agave:v3.1.14` we cannot promote
   the v3.1 row from `source-compat` to `works`. This is the single
   most important follow-up.
2. **Voter-list query.** Agave admin RPC has never exposed a
   `getAuthorizedVoters` method. Production swap flow does not need it
   (we always set the voter set ourselves), but the e2e harness
   currently leans on the ops sidecar synthesising the field.
3. **Field-name drift.** If a future major moves from `id` → `identity`
   or vice versa in `AdminRpcContactInfo`, our `normaliseContactInfo`
   already accepts both shapes, but a third name (`pubkey`, etc.)
   would silently fail. Worth a re-check on each major bump.
4. **`agave-validator --version` output format.** Our parser is
   deliberately permissive — it stores the entire stdout line. If the
   binary ever drops the `agave-validator ` prefix the warn-on-unknown
   logic in `vswap pair` would flag everything as untested; the agent
   itself does not gate on this string.
