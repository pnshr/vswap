# vswap

> Hot-swap a Solana validator's identity between two hosts in a sub-second
> window. End-to-end encrypted, tower-safe, mTLS everywhere, written in
> TypeScript.

[![CI](https://github.com/pnshr/vswap/actions/workflows/ci.yml/badge.svg)](https://github.com/pnshr/vswap/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](#requirements)

## Demo

Four-minute walkthrough — preflight, dry-run, sub-second swap, tower-safe
rollback, plus the web wizard cutaway:
[**youtu.be/iCxeUHRHsgw**](https://youtu.be/iCxeUHRHsgw).

## Why

Every Solana validator operator who runs primary/backup infrastructure
has the same recurring chore: move the staked voting identity from one
host to the other. It happens during scheduled hardware migrations,
mid-incident failover, and client upgrades (Agave → Firedancer).

Today this is either an SSH-and-bash ritual derived from
[Pumpkin's Pool's runbook](https://docs.pumpkinspool.com/), or a
single-purpose binary like `svs` (Rust) or `solv` (Node). All of them
work. None of them publish an end-to-end key-handling threat model, and
none of them have a web UI you can drive from a phone.

`vswap` is one tool that bundles the runbook, encrypts the identity in
flight against an ephemeral key the orchestrator can never see, refuses
to skip the tower file, and exposes the same flow through a CLI **and** a
web dashboard.

## How it works

Three independently-deployed components:

| Component | Where it runs | What it does |
| --- | --- | --- |
| `@vswap/agent` | one daemon per validator host | Talks to `agave-validator`'s admin RPC socket. Reads the staked identity + tower on the source; writes them into `/dev/shm` and calls `setIdentityFromBytes` on the target. |
| `@vswap/cli` (`vswap`) | operator workstation | Pairs agents (TOFU on Ed25519 fingerprint), runs preflight, drives the swap, handles rollback. Six commands, documented exit codes. |
| `@vswap/web` | hosted sandbox + self-hostable dashboard | Public reviewers can run the full flow against disposable sandbox validators at <https://vswap-web.vercel.app>. Real validator live mode is self-hosted with `VSWAP_ENABLE_LIVE_PROXY=1`. |

During a production CLI swap, the source agent generates an `IdentityBlob`
containing the 64-byte Ed25519 secret key and the tower file, encrypts it
with libsodium's `crypto_box_seal` against an X25519 session public key
the target generated for *that* swap, and sends the resulting bytes over
the wire. The CLI / self-hosted web dashboard never sees plaintext — it
only forwards the opaque blob between agents. On the target, the blob is
opened in memory, written to `/dev/shm/vswap`, handed to
`setIdentityFromBytes`, then zeroed and unlinked.

For the full message flow see [`docs/architecture.md`](./docs/architecture.md).

## Quickstart

### Requirements

- Two validator hosts, each running `agave-validator` with the admin RPC
  socket enabled. Tested against Agave 2.0.x.
- One operator workstation with Node 20+ and `npm`.
- Docker on each validator host (or use the systemd unit shipped with
  the agent image).

### 1. Install the agent on each validator host

Until the GHCR publish lands, build the image from source:

```bash
git clone https://github.com/pnshr/vswap.git
cd vswap
corepack enable
corepack prepare pnpm@9.15.1 --activate
pnpm install --frozen-lockfile
pnpm -r build
docker build -f packages/agent/Dockerfile -t vswap-agent:local .
```

```bash
docker run -d \
  --name vswap-agent \
  --restart unless-stopped \
  --network host \
  -v /etc/vswap:/etc/vswap:ro \
  -v /var/lib/vswap:/var/lib/vswap \
  -v /solana/ledger:/solana/ledger \
  -v /solana/ledger/admin.rpc:/solana/ledger/admin.rpc \
  vswap-agent:local
```

`/etc/vswap/config.yml` and the agent's mTLS material (`agent.crt`,
`agent.key`, `ca.crt`) must be mounted in by the operator. The config
schema lives in [`packages/agent/src/config.ts`](./packages/agent/src/config.ts)
and the systemd unit ships at
[`packages/agent/systemd/vswap-agent.service`](./packages/agent/systemd/vswap-agent.service).
The intended pull path once published is `ghcr.io/pnshr/vswap-agent:latest`.

### 2. Install the operator CLI

Until `@vswap/*` is published to npm, pack and install from the source
checkout:

```bash
pnpm --dir packages/protocol pack --pack-destination .tmp-pack
pnpm --dir packages/cli pack --pack-destination .tmp-pack
npm install -g .tmp-pack/vswap-protocol-0.1.0.tgz .tmp-pack/vswap-cli-0.1.0.tgz
vswap init                                   # generates ~/.vswap/{ca,client,...}
vswap pair --agent host-a.example:7872 --label primary
vswap pair --agent host-b.example:7872 --label backup
```

The operator's CA cert (`~/.vswap/ca.crt`) needs to be distributed to
each validator host so the agent's mTLS server trusts the operator
client. The output of `vswap init` prints the exact path.

### 3. Dry-run the swap

```bash
vswap preflight --from primary --to backup
vswap swap --from primary --to backup --dry-run
```

The dry-run prints the full plan (identity / tower pubkeys, target
admin-RPC socket, expected window) without calling `setIdentity`.

### 4. Execute

```bash
vswap swap --from primary --to backup
```

You will be prompted to type the literal word `swap` to confirm. Pass
`--yes` in CI. On any error the CLI auto-runs `vswap rollback`; if
rollback itself fails it exits with code `6` and tells you what to do
manually.

### 5. (Optional) Use the web dashboard

The dashboard is live at <https://vswap-web.vercel.app>. The hosted
deployment runs a real end-to-end sandbox flow backed by disposable
validator identities: preflight, plan, word confirmation, sealed-box
transfer, result, and history all work without touching mainnet keys.

To drive real agents from the web UI, self-host the same Next.js app
where it can reach your private agents and opt in to live proxying:

```bash
vswap export --for-web > vswap-export.json
VSWAP_ENABLE_LIVE_PROXY=1 pnpm -F @vswap/web start
```

Drag-drop `vswap-export.json` onto `/connect`, encrypt it with the
passphrase you set, then unlock the tab before running preflight or a
swap. The public Vercel deployment intentionally leaves live proxying
disabled; it is a safe sandbox, not a managed validator service.

## Performance

Two test profiles, deliberately separated.

**Mock profile** — fast hermetic CI. Two `@vswap/agent` containers
plus two Node mock validators that emulate just enough of agave's
admin RPC. Run with `bash scripts/test-env/up.sh && pnpm -F @vswap/e2e test`.

| Metric | Mock |
| --- | --- |
| Per-swap window (CLI-reported `Swap completed in N ms`) | 3–11 ms |
| Wall-time per 10-swap test file (incl. CLI startup × 10) | 4.56–4.68 s |
| Full 10-scenario suite wall-time | 32.3 s |
| Happy-path success rate | 100 / 100 |

**Real profile** — production-fidelity. Same agent plus
`anzaxyz/agave:v2.0.21` running `agave-validator` on each side, plus a
Node ops sidecar that re-exposes the chaos plane the scenarios need.
Run with `bash scripts/test-env/up-real.sh --reset && pnpm -F @vswap/e2e test:real`.

| Metric | Real |
| --- | --- |
| Per-swap window (CLI direct, no test framework) | ~74 ms |
| Per-swap window (CLI in vitest, mean of 5 fresh resets) | 873 ms (645–946 range) |
| Wall-time per 10-swap test file | 54.7 s |
| `tower-pubkey-mismatch` wall-time | 25.3 s |
| Cold `up-real.sh --reset` wall-time | ~70 s (image build + genesis + validator boot) |

The real profile is two orders of magnitude slower — every step actually
does work (fsync, tower validation, voter state update); none of the
slowdown is in the agent itself.

The web dashboard ships fresh Lighthouse scores of 100 / 100 / 96 / 100
(perf / a11y / best-practices / SEO) on desktop and 99 / 100 / 96 / 100
on mobile, against the production Vercel deployment.

## Security

Read [`SECURITY.md`](./SECURITY.md) for the threat model and audit
notes. Short version:

- The identity private key and tower file never exist in plaintext on
  any machine other than the source validator (during read) and the
  target validator (in `/dev/shm` during apply).
- The orchestrator (CLI or web) sees only opaque encrypted blobs.
- Every agent ↔ orchestrator message is mTLS-protected and additionally
  signed (Ed25519, detached) with the sender's long-term key.
- Anti-replay: 24-byte nonce per envelope plus a ±30 s timestamp window;
  nonces are persisted to an append-only log so they survive restarts.
- `requireTower=true` is enforced in production builds; mismatched
  tower-file pubkeys hard-reject before any `setIdentity` call.

An external self-audit was performed in April 2026 against the current
tree. Twenty-three findings are listed individually in
[`docs/audit-log.md`](./docs/audit-log.md): 16 fixed, 2 mitigated, 4
deferred with rationale, 1 wontfix, and 0 critical findings remaining.

## Repository layout

```
packages/
  protocol/     # @vswap/protocol — wire format, crypto, errors, zod schemas
  agent/        # @vswap/agent    — daemon (HTTPS + WSS, mTLS, /dev/shm)
  cli/          # @vswap/cli      — operator CLI (vswap init/pair/swap/...)
  web/          # @vswap/web      — Next.js dashboard, live on Vercel
  e2e/          # @vswap/e2e      — Vitest scenarios + Docker test env
docs/           # architecture, threat model, audit log, compat matrix
scripts/        # test-env helpers (docker compose for the e2e harness)
```

## Supported validators

Authoritative matrix in [`docs/supported-versions.md`](./docs/supported-versions.md).
Short version:

- **Agave 2.0.21** — primary target, used in CI and the e2e harness;
  full real-profile suite green.
- **Agave 2.1.13** — known-broken: `setIdentity --require-tower=true`
  rejects the validator's own freshly-written tower.
- **Agave 3.1.x (current mainnet stable, including v3.1.14)** —
  source-compatible: every admin-RPC method we call is unchanged in
  signature in the upstream v3.1 branch; the v3.1 CHANGELOG contains
  zero entries touching admin RPC, set-identity, or tower handling.
  Not yet exercised end-to-end in our harness. Detail in
  [`docs/agave-compat.md`](./docs/agave-compat.md).
- **Jito (Agave fork)** — same admin RPC surface; expected to work,
  not exercised in CI.
- **Firedancer** — admin RPC compatibility is a moving target. Not
  tested. The agent will refuse the swap if `getIdentity` returns an
  unknown shape rather than guess.

The agent reports `agave-validator --version` back to the operator in
the `PairResponse`. The CLI prints it on every `vswap pair` and warns
when the version is outside the **works** column above. The warning is
informational; vswap does not block the pair.

The Docker harness's Agave version is overrideable for local
verification: `AGAVE_VERSION=v3.1.14 bash scripts/test-env/up-real.sh --reset`
(or `bash scripts/test-env/up-real.sh --reset --agave v3.1.14`).

## Project status

Submitted to [Superteam Ukraine — Solana Validator Identity Transfer
Tool](https://earn.superteam.fun), April 2026.

This is not a managed service and the team behind it is not on call.
Run it on devnet/testnet against your own infrastructure before pointing
it at a mainnet identity.

## License

[MIT](./LICENSE).
