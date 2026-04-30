import { execa } from "execa";
import { CliFailedError } from "../errors.js";

export interface CliOptions {
  readonly binary: string;
  readonly ledgerPath: string;
  readonly timeoutMs?: number;
}

export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Thin `agave-validator` CLI wrapper. Used as a fallback when a given
 * admin RPC method is unavailable, and for preflight operations that
 * are CLI-only (e.g. `catchup`).
 */
export class ValidatorCli {
  private readonly binary: string;
  private readonly ledgerPath: string;
  private readonly timeoutMs: number;

  constructor(opts: CliOptions) {
    this.binary = opts.binary;
    this.ledgerPath = opts.ledgerPath;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** Invoke `<binary> --ledger <ledger> <args...>`. Returns stdout/stderr. */
  async run(args: ReadonlyArray<string>, timeoutMs?: number): Promise<CliResult> {
    const fullArgs = ["--ledger", this.ledgerPath, ...args];
    const timeout = timeoutMs ?? this.timeoutMs;
    try {
      const result = await execa(this.binary, fullArgs, {
        timeout,
        reject: false,
        stripFinalNewline: true,
      });
      const exitCode = result.exitCode ?? -1;
      if (exitCode !== 0) {
        throw new CliFailedError(
          `agave-validator ${args[0] ?? ""} failed with exit ${exitCode.toString()}`,
          {
            args: [...args],
            exitCode,
            stderr: truncate(result.stderr ?? "", 1024),
          },
        );
      }
      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode,
      };
    } catch (err) {
      if (err instanceof CliFailedError) {
        throw err;
      }
      throw new CliFailedError("agave-validator invocation failed", {
        args: [...args],
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Version string as reported by `agave-validator --version`. */
  async version(): Promise<string> {
    const result = await this.run(["--version"]);
    return result.stdout.trim();
  }

  /**
   * Run `agave-validator catchup` against the local validator. Returns
   * the raw stdout on success; the caller decides how to interpret the
   * progress lines.
   */
  async catchup(timeoutMs = 30_000): Promise<string> {
    const result = await this.run(["catchup", "--our-localhost"], timeoutMs);
    return result.stdout;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
