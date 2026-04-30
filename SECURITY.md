# Security

## Threat model

### Assets we protect

- **The staked validator identity private key.** A 64-byte Ed25519
  secret key, in the on-disk format `agave-validator` accepts from
  `setIdentityFromBytes`. Compromise allows anyone to vote on behalf
  of the stake, which on Solana means slashing exposure and revenue
  loss.
- **The tower file.** Per-validator local consensus state. Losing or
  reusing it across two hosts that both vote at the same time is a
  direct path to slashing.
- **The orchestrator's long-term Ed25519 signing key.** The CLI / web
  uses this to sign every envelope it sends to a paired agent.
- **The agent's long-term Ed25519 signing key.** Each agent uses this
  to sign every reply and every blob it produces.

### Attackers we considered

- **Network attacker (active MITM between operator and agents).**
  Mitigated by mandatory mTLS with operator-issued client and server
  certs, plus an Ed25519-signed envelope layer that is independent of
  the TLS session. Forging a valid envelope without the long-term key
  is equivalent to forging an Ed25519 signature.
- **Compromised orchestrator (stolen CLI laptop, compromised web
  backend).** Mitigated by ephemeral X25519 sealed-box public-key
  encryption: the target agent generates the session keypair fresh per
  swap, and only the target's session secret can decrypt the
  `IdentityBlob`. The orchestrator only forwards opaque bytes between
  source and target. A compromised orchestrator can refuse to swap
  (denial of service), trigger a swap to the wrong target if it has
  been paired with one, or signal rollback — but it cannot extract the
  identity key.
- **Read-only filesystem snapshot of the target after a swap.**
  Mitigated by writing the decrypted identity only to `/dev/shm/vswap`,
  with explicit `memzero` of the in-memory copy and `unlink` of the
  tmpfs file in the route's `finally` block. The on-disk validator
  identity at `/etc/vswap/identity.json` is never written to by the
  agent.
- **Replay attacker with a captured envelope.** Mitigated by a 24-byte
  random nonce per envelope plus a ±30 s timestamp window. The agent
  caches every accepted nonce in memory and persists it to an append-
  only log under `/var/lib/vswap/nonces.log` so the cache survives
  process restarts.
- **Compromised CA (the operator's `ca.key` is stolen).** The attacker
  can mint client certs that mTLS-authenticate to every paired agent,
  but they still need the operator's Ed25519 long-term secret key to
  build envelopes the agent will accept. Both keys live next to each
  other under `~/.vswap/`; treat the directory as a single trust
  boundary.

### Out of scope

- **Local root on the source validator.** The agent must be able to
  read the staked identity to do its job; a local root attacker on
  the same host can read the same file directly. No wrapper protects
  against this.
- **A malicious `agave-validator` binary on the target.** The agent
  hands the identity to the validator process via admin RPC; if the
  validator itself is hostile it can do anything it wants with it.
- **Cryptographic compromise of Ed25519, X25519, or
  XSalsa20-Poly1305.** We use the libsodium primitives via
  `libsodium-wrappers@0.7.15` as-is.
- **Slashing caused by infrastructure issues unrelated to the swap.**
  Two validators independently configured against the same identity
  (without going through `vswap`) is the classic example. `vswap` only
  sequences the source's `setIdentity('unstaked')` and the target's
  `setIdentity(staked)`; it does not police anything outside its own
  invocation.

## Key handling invariants

These hold under every code path; the audit re-verified each one.

1. **The identity private key only exists in plaintext on the source
   validator host (during `getIdentity` / sealing) and on the target
   validator host (in `/dev/shm/vswap` during apply).** Every
   intermediate representation is the libsodium sealed-box ciphertext,
   indistinguishable from random bytes without the target's session
   secret.
2. **Every wire message is signed (Ed25519 detached) by its sender's
   long-term key, carries a 24-byte anti-replay nonce, and a Unix
   timestamp validated against a ±30 s window.** Signature verification
   happens *before* zod schema parsing, so malformed payloads cannot
   reach decoder logic.
3. **Tower-file handling is mandatory.** `--require-tower` is the
   default and the only supported mode in production. If the tower
   file's pubkey doesn't match the swapped identity, the target hard-
   rejects the swap before any `setIdentity` call — there is no flag
   to override this.
4. **Secret keys are wrapped in opaque classes (`SigningSecretKey`,
   `SealingSecretKey`).** They serialise to `"[redacted]"` in
   `JSON.stringify`, `toString()`, and `util.inspect`. Verified by
   unit tests in `packages/protocol/tests/crypto/`.
5. **Sensitive intermediate buffers go through `withScrubAsync`,**
   which zeroes the underlying `Uint8Array` in `finally` after the
   inner promise settles. Verified by a unit test that retains a
   reference to the buffer across the `await`.
6. **mTLS is mandatory.** The agent refuses to start if any of
   `tls.certPath`, `tls.keyPath`, `tls.caPath` is missing, empty, or
   unreadable. There is no `insecure` flag.

## Audit history

An external self-audit was performed in April 2026 by a reviewer who
was not the implementing engineer, against the audit branch at commit
`8bd6824`. Twenty-three findings were raised and tracked to resolution:
16 fixed, 2 mitigated with operational workarounds, 4 deferred with
rationale, 1 wontfix, and 0 critical findings remaining. Each finding's
description, repro, and current resolution status is in
[`docs/audit-log.md`](./docs/audit-log.md).

The cryptographic core (sealed-box, signing, envelope verification,
scrubbing) was specifically searched for finding-warranted issues and
came back clean. The only deferred `high`-severity item is an
operational peer-store binding hardening task; the lock leak,
replay-window restart edge case, and dependency CVEs are fixed on the
current tree.

The audit deliberately did not run dynamic / heap-dump checks; those
are tracked as follow-ups in the same document.

## Reporting vulnerabilities

If you believe you've found a vulnerability that is exploitable
against a deployed `vswap` operator, please email **security@vswap.dev**
with a description, a reproduction, and any suggested mitigation. We
aim to acknowledge within 72 hours.

You can also open a GitHub Security Advisory on this repository, which
keeps the report private until a fix is ready.

Please do **not** open a public GitHub issue for security reports.
