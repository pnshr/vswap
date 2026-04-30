import { execa, type Options as ExecaOptions } from "execa";
import { CLI_BIN, OPERATOR_HOME } from "./paths.js";

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface RunCliOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin?: string;
  /** Seconds before the CLI invocation is killed. */
  readonly timeoutSec?: number;
  /** Override `$VSWAP_HOME` (defaults to the operator fixture dir). */
  readonly vswapHome?: string;
}

/**
 * Run `node packages/cli/bin/vswap.js <args>` and capture the result.
 *
 * Every invocation isolates its `$VSWAP_HOME` to the operator fixture
 * directory so pair data persists across tests but never leaks into
 * the developer's real `~/.vswap`.
 */
export async function runCli(
  args: readonly string[],
  opts: RunCliOptions = {},
): Promise<CliResult> {
  const started = Date.now();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(opts.env ?? {}),
    VSWAP_HOME: opts.vswapHome ?? OPERATOR_HOME,
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
  };
  const execaOpts: ExecaOptions = {
    env,
    reject: false,
    stdio: "pipe",
    timeout: (opts.timeoutSec ?? 60) * 1000,
  };
  if (opts.stdin !== undefined) (execaOpts as { input: string }).input = opts.stdin;
  const result = await execa("node", [CLI_BIN, ...args], execaOpts);
  return {
    exitCode: typeof result.exitCode === "number" ? result.exitCode : -1,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    durationMs: Date.now() - started,
  };
}

/** Convenience: parse JSON output from a `vswap ... --json` invocation. */
export function parseJson<T = unknown>(result: CliResult): T {
  return JSON.parse(result.stdout) as T;
}
