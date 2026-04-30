/**
 * Stable, documented exit codes for `vswap`.
 *
 * Operators script around these — never re-number an existing code,
 * only add new ones.
 */
export const ExitCode = {
  /** Command completed successfully. */
  Success: 0,
  /** Generic / unclassified failure. */
  Generic: 1,
  /** Preflight checks reported a `fail` status on at least one peer. */
  PreflightFailed: 2,
  /** Network or connectivity error talking to a paired agent. */
  Network: 3,
  /** Cryptographic failure: signature, decryption, or pubkey mismatch. */
  Crypto: 4,
  /** Operator declined a confirmation prompt. */
  AbortedByUser: 5,
  /**
   * Swap left agents in an inconsistent state and rollback is required.
   * Re-run `vswap rollback --from <a> --to <b>` to recover.
   */
  RollbackNeeded: 6,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export const EXIT_CODE_DOCS: ReadonlyArray<{
  readonly code: ExitCodeValue;
  readonly name: string;
  readonly description: string;
}> = [
  { code: ExitCode.Success, name: "success", description: "Command completed successfully." },
  { code: ExitCode.Generic, name: "generic", description: "Generic or unclassified failure." },
  {
    code: ExitCode.PreflightFailed,
    name: "preflight-failed",
    description: "Preflight reported a fail status on at least one peer.",
  },
  { code: ExitCode.Network, name: "network", description: "Network or connectivity error." },
  {
    code: ExitCode.Crypto,
    name: "crypto",
    description: "Cryptographic failure (signature, decryption, or pubkey mismatch).",
  },
  {
    code: ExitCode.AbortedByUser,
    name: "aborted-by-user",
    description: "Operator declined a confirmation prompt.",
  },
  {
    code: ExitCode.RollbackNeeded,
    name: "rollback-needed",
    description: "Swap left agents in an inconsistent state; run `vswap rollback`.",
  },
];
