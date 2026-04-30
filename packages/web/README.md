# @vswap/web

Operator dashboard for vswap. Next.js 15 App Router, TypeScript strict, Tailwind CSS,
TanStack Query.

## Local dev

```bash
pnpm install
pnpm -F @vswap/protocol build
pnpm -F @vswap/web dev          # http://localhost:3000
```

`@vswap/protocol` must be built once before the web app boots — TypeScript types
are read from its `dist/` entry point.

## Pages

| Path                    | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `/`                     | Landing — value prop, architecture diagram, security model.             |
| `/connect`              | Import operator config (JSON exported by the CLI). Encrypts the cert + signing key under a passphrase you choose. |
| `/dashboard`            | Cluster overview — paired node status cards.                            |
| `/dashboard/preflight`  | Per-node preflight checklist.                                           |
| `/dashboard/swap`       | Multi-step swap wizard (direction → preflight → plan → confirm → execute → result). |
| `/dashboard/history`    | Local swap history (IndexedDB), JSON export, clear.                     |
| `/api/agent/[...path]`  | Hosted sandbox API plus opt-in self-hosted mTLS agent proxy. |

## Hosted sandbox

When no operator config is imported, the dashboard calls `/api/agent/*` in
`sandbox` mode. The route performs a disposable sealed-box identity transfer
with synthetic validator state, so reviewers can walk the full flow without
standing up real agents. Sandbox mode is always labelled with a yellow badge in
the header.

## Self-hosted live mode

For real validators, export the operator bundle from the CLI and import it on a
self-hosted dashboard:

```bash
vswap export --for-web > vswap-export.json
VSWAP_ENABLE_LIVE_PROXY=1 pnpm -F @vswap/web start
```

The browser encrypts the bundle at rest in IndexedDB. When unlocked, the
dashboard sends the operator mTLS cert and signing key to `/api/agent/*` for the
single request being made; the route builds signed protocol envelopes and opens
an outbound mTLS connection to the selected agent.

## Security

- Operator client cert + signing key are encrypted at rest in IndexedDB using
  PBKDF2-HMAC-SHA256 (600 000 iterations) + AES-GCM-256. The passphrase is
  never sent to any server; decryption happens in the browser via WebCrypto.
- The `/api/agent/*` proxy never logs request or response bodies.
- The proxy never persists operator credentials on the server — they live in
  per-request scope only.
- The public Vercel deploy intentionally refuses real validator mTLS traffic by
  leaving `VSWAP_ENABLE_LIVE_PROXY` unset. Operators use the CLI or self-host
  the dashboard for production validators.

## Deploy

The package targets Vercel. The repo root contains a `vercel.json` aimed at
`packages/web` that runs `pnpm install --frozen-lockfile`, builds
`@vswap/protocol`, then builds `@vswap/web`.

To deploy:

1. Import the repo into Vercel.
2. Set the project root to `packages/web`.
3. Vercel auto-detects the Next.js framework. No environment variables are
   required for the hosted sandbox. Set `VSWAP_ENABLE_LIVE_PROXY=1` only on a
   private/self-hosted deployment that can reach your validator agents.

## Quality bar

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- ESLint via `next lint` clean.
- No `console.log` in source.
- Lighthouse perf > 85, a11y > 95 on a typical run.
- Mobile viewport works.
