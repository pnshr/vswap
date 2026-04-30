/**
 * Classify the `agave-validator --version` string an agent reported in
 * its `PairResponse` against the tested-versions matrix in
 * docs/supported-versions.md. Used by `vswap pair` to print a warning
 * when the operator has paired with a host running a version we have
 * not exercised end-to-end.
 *
 * Matching is intentionally conservative: anything we cannot positively
 * pin to a known-good version is treated as `"untested"`, and anything
 * matching a known-broken regression is treated as `"broken"`. The
 * agent itself never gates on this string — it is purely informational.
 *
 * If you bump `docs/supported-versions.md`, bump `WORKS` and `BROKEN`
 * here at the same time.
 */

/** Versions that have a full real-profile e2e suite green. */
const WORKS: ReadonlyArray<string> = ["2.0.21"];

/**
 * Versions known to break a swap. The `reason` is shown verbatim to the
 * operator alongside a pointer to the supported-versions doc.
 */
const BROKEN: ReadonlyArray<{ version: string; reason: string }> = [
  {
    version: "2.1.13",
    reason:
      "setIdentity --require-tower=true rejects the validator's own freshly-written tower (saved-tower signature verify regression)",
  },
];

export type ValidatorVersionStatus =
  | { kind: "unknown" } // agent did not report a version
  | { kind: "works"; version: string }
  | { kind: "broken"; version: string; reason: string }
  | { kind: "untested"; version: string };

/**
 * Extract the bare semver-ish token from `agave-validator <version>
 * (src:...)`-style output. We do not enforce a strict regex — anything
 * that yields a `MAJOR.MINOR.PATCH` substring is treated as the
 * version. Returns null when the string contains no recognisable
 * version token.
 */
export function extractVersionToken(raw: string): string | null {
  const match = raw.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/);
  return match === null ? null : match[1] ?? null;
}

export function classifyValidatorVersion(
  reported: string | null,
): ValidatorVersionStatus {
  if (reported === null) {
    return { kind: "unknown" };
  }
  const token = extractVersionToken(reported);
  if (token === null) {
    return { kind: "untested", version: reported };
  }
  for (const entry of BROKEN) {
    if (token === entry.version) {
      return { kind: "broken", version: token, reason: entry.reason };
    }
  }
  for (const v of WORKS) {
    if (token === v) {
      return { kind: "works", version: token };
    }
  }
  return { kind: "untested", version: token };
}
