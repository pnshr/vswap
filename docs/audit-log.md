# Audit log

Status of the 23 findings raised by the external self-audit (April 2026)
against the current tree.

Status legend:

- **fixed** — addressed in code on the current tree.
- **mitigated** — defense-in-depth gap acknowledged with a documented
  workaround and a tracked follow-up issue.
- **wontfix** — closed with reasoning; not blocking.
- **deferred** — accepted as known, scheduled for the next release
  window.

| #     | Severity | Title                                                                  | Status     |
| ----- | -------- | ---------------------------------------------------------------------- | ---------- |
| F-001 | high     | Lock leak on unknown / expired sessionId or tmpfs failure              | **fixed**  |
| F-002 | high     | `keypairJsonBytes` copies secret into non-scrubbable JS Array+String   | **fixed**  |
| F-003 | high     | Nonce persisted to disk *after* in-memory commit (crash → replay)      | **fixed**  |
| F-004 | high     | Session bound to caller-supplied pubkey without peer-store check       | deferred   |
| F-005 | high     | `next@14.2.18` critical advisory + 6 high CVEs in lockfile             | **fixed**  |
| F-006 | high     | No `SECURITY.md`; threat model + out-of-scope not published            | **fixed**  |
| F-007 | medium   | Unbounded TOFU: any mTLS client can self-pair, no rate limit           | mitigated  |
| F-008 | medium   | WSS subscribes by correlationId only, no auth binding to operator      | mitigated  |
| F-009 | medium   | `readTowerBytes` has no size cap → memory exhaustion DoS               | **fixed**  |
| F-010 | medium   | Stale lock from crashed agent never recovered on restart               | **fixed**  |
| F-011 | medium   | `verifyEnvelope` raises `TimestampOutOfWindowError` for version skew   | deferred   |
| F-012 | medium   | No `Content-Security-Policy` header, only X-Frame/X-CTO/Referrer       | **fixed**  |
| F-013 | medium   | `/api/agent/[...path]` permanently returns 503 — live mode broken      | **fixed**  |
| F-014 | medium   | `concurrent-swap-attempts` accepts trivially-passing end states        | deferred   |
| F-015 | low      | `pruneExpired` early-break assumes monotonic insertion order           | **fixed**  |
| F-016 | low      | `bytesEqual` on pubkeys is short-circuit, not constant-time            | **fixed**  |
| F-017 | low      | Reinvented inline base58 decoder duplicates `solana/base58`            | wontfix    |
| F-018 | low      | PBKDF2 iterations = 250 000, below OWASP 2023 (≥ 600 000)              | **fixed**  |
| F-019 | low      | Imported config JSON validated only structurally, no schema strict     | deferred   |
| F-020 | low      | Stale README — references nonexistent `relay/` package, "TBD" license  | **fixed**  |
| F-021 | low      | No install / run / verify instructions for clean Ubuntu                | **fixed**  |
| F-022 | info     | No explicit ignore for `*.pem`, `*.key`, `ledger/`, `vswap-export.json` | **fixed**  |
| F-023 | info     | No unit test asserting nonce persists across agent restart             | **fixed**  |

Headline numbers: **16 fixed**, **2 mitigated**, **4 deferred**, **1
wontfix**, **0 still open without an action**.

## Deferred findings — why we are shipping with them open

Only four findings remain deferred after the hardening pass:

- **F-004 (session pubkey binding).** Operationally mitigated by the
  paired-operator trust boundary, but the clean fix requires an explicit
  source-agent allowlist on the target and a small pairing UX change.
- **F-011 (version-skew error class).** Cosmetic protocol hygiene:
  callers already reject the message, but the error class should be
  `VersionMismatchError`.
- **F-014 (concurrent e2e assertion strength).** The production lock
  path is covered, but the chaos scenario should assert intermediate
  state rather than only final state.
- **F-019 (web import schema strictness).** The hosted sandbox never
  needs operator secrets, but self-hosted live mode should validate the
  imported export file with a strict schema before accepting it.

## Mitigated findings — accepted with a workaround

- **F-007 (unbounded TOFU pairing).** Operationally mitigated by mTLS:
  to even reach `/pair`, an attacker needs a client cert signed by the
  operator's CA, which is only issued to the operator themselves by
  `vswap init`. A hostile mTLS client only opens the door to a denial
  of service on the pair queue, not unauthorised pairing — the
  fingerprint TOFU prompt is operator-driven.
- **F-008 (WSS by correlationId only).** The progress channel emits
  signed envelopes; an unauthorised subscriber sees only that *some*
  swap happened (and timing). Verified that no plaintext key material,
  validator addresses, or operator pubkeys are emitted in the envelope
  payloads. Tracked for a follow-up that binds subscriptions to the
  swap-initiating envelope sender.

## Wontfix findings

- **F-017 (custom base58 vs `@solana/base58`).** The agent does not
  depend on `@solana/web3.js` and pulling in `@solana/base58` to decode
  the 32-byte target identity pubkey would add a 200 KB transitive
  surface for a 14-line function that has unit tests and fuzz coverage.
  Reviewer reasonable, fix not net-positive.

## Audit follow-ups

The audit explicitly flagged dynamic checks as deferred. They remain
deferred but are listed here so reviewers can see the work plan:

- Run `pnpm -F @vswap/e2e test` 10 consecutive times after F-014 lands
  and record P50/P95/P99 swap window.
- `curl` the live agent without mTLS / with expired cert / with flipped
  envelope byte; expect 401/403/SignatureInvalidError each.

## Process notes

The audit was performed by an external reviewer who did not write any
of the code, against the frozen audit branch. Findings were formatted
with severity, location, description, reproduction, and suggested fix.
The author did not redact or downgrade any finding; status decisions in
this document are recorded as-of the audit pass and may change in
subsequent releases.
