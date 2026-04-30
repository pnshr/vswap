# vswap — Solana Validator Identity Transfer Tool

## Target user

Professional Solana validator operators running primary/backup
infrastructure. Typically 5–100M SOL of stake, 24/7 uptime
expectations, an existing DevOps stack (Ansible, Terraform, Prometheus,
PagerDuty), and a runbook that already handles identity rotation —
just usually as raw SSH and `bash`.

## Problem

Identity transfer between validator hosts is a frequent operation:

- Scheduled migrations to new hardware.
- Emergency failover during outages.
- Client software upgrades (Agave → Firedancer, version bumps within
  Agave).

Current options are: an SSH-and-`bash` ritual derived from
[Pumpkin's Pool's runbook](https://docs.pumpkinspool.com/), or
single-purpose binaries like `svs` (Rust) and `solv` (Node.js). The
runbook works but is impossible to audit at scale across an operator
team. The binaries work but do not publish an end-to-end key-handling
threat model and do not have a UI a sleepy on-call engineer can use
from a phone.

## Solution

`vswap` is a three-component tool:

1. **`@vswap/agent`** — a TypeScript daemon that runs on each
   validator host. Speaks `agave-validator`'s admin RPC over its unix
   socket, exposes an HTTPS + WSS surface to the operator over mTLS.
2. **`@vswap/cli`** (`vswap`) — the operator CLI. Pairs agents with a
   TOFU fingerprint prompt, runs preflight, drives the swap,
   auto-rolls-back on any error.
3. **`@vswap/web`** — a Next.js dashboard with the same guided flow.
   Hosted at <https://vswap-web.vercel.app> with a disposable sandbox
   flow; production web live mode is self-hosted with
   `VSWAP_ENABLE_LIVE_PROXY=1`.

Identity transfer uses ephemeral X25519 public-key encryption via
libsodium's `crypto_box_seal`. The target generates a session keypair
per swap; the source seals the identity blob against the session
pubkey; the orchestrator only ever forwards opaque bytes between the
two agents. Tower files are handled mandatorily: `requireTower=true` is
enforced in production builds. A pubkey mismatch in the
tower filename hard-rejects the swap before any `setIdentity` call.

## Security story

- Ephemeral X25519 session keypair per swap; orchestrator cannot
  decrypt the blob it forwards.
- Plaintext identity exists only on the source (briefly, before
  sealing) and on the target (briefly, in `/dev/shm`).
- mTLS between operator and agents, plus an Ed25519 signed-envelope
  layer that is independent of the TLS session.
- 24-byte random nonce per envelope, ±30 s timestamp window,
  append-only persisted nonce log so anti-replay survives agent
  restarts.
- Target writes the decrypted identity into `/dev/shm/vswap`,
  scrubs the buffer with `withScrubAsync`, and unlinks the tmpfs file
  in the route's `finally` block.
- External self-audit (April 2026) raised 23 findings, 0 critical after
  remediation; resolution status is published in `docs/audit-log.md`.

## Tested

- 100 / 100 happy-path swaps green across the integration harness
  (10 runs × 10 swaps each).
- 10 chaos scenarios green: preflight failure, missing tower, pubkey
  mismatch, tampered ciphertext, agent crash mid-swap, network
  partition, replay attack, concurrent swap attempts, rollback,
  happy-path.
- Per-swap window: 3–11 ms across 100 invocations.
- Real `agave-validator` profile green against `anzaxyz/agave:v2.0.21`
  for 10/10 happy-path swaps and the tower-pubkey-mismatch guard. The
  v3.1.14 admin-RPC surface is source-compatible by code inspection,
  but not yet executed end-to-end in the Docker harness.
- Web Lighthouse: 100 / 100 / 96 / 100 (perf / a11y / best-practices /
  SEO) on desktop, 99 / 100 / 96 / 100 on mobile.

## Shipping status

- CLI: npm tarball install verified; public `@vswap/cli` publish is
  still gated on explicit release confirmation.
- Agent: local Docker image build verified; public
  `ghcr.io/pnshr/vswap-agent:latest` publish is still gated on explicit
  release confirmation.
- Web sandbox: <https://vswap-web.vercel.app>
- Source: <https://github.com/pnshr/vswap>
- License: MIT

## What's not in scope (yet)

- Full Agave 3.1.14 end-to-end run. Compatibility is documented in
  `docs/agave-compat.md`; the real Docker harness is currently pinned
  to the known-good v2.0.21 image because v2.1.13 regressed
  `setIdentity --require-tower=true`.
- Hosted Vercel as a managed mainnet service. It intentionally runs
  only the disposable sandbox; operators who want web live mode
  self-host the same Next.js app with `VSWAP_ENABLE_LIVE_PROXY=1`.
- Firedancer admin RPC compatibility.
