/**
 * Top-level commander wiring. Every subcommand is implemented in its
 * own module under `commands/`; this file's only job is to define the
 * surface area of the binary and route invocations.
 *
 * The dispatch is async-aware: each handler returns a promise that
 * resolves to the desired process exit code. The `run` function below
 * awaits the handler then exits with that code.
 */

import { Command, Option } from "commander";
import { CLI_VERSION, runVersion } from "./commands/version.js";
import { runInit } from "./commands/init.js";
import { runPair } from "./commands/pair.js";
import { runStatus } from "./commands/status.js";
import { runPreflight } from "./commands/preflight.js";
import { runSwap } from "./commands/swap.js";
import { runRollback } from "./commands/rollback.js";
import { runExport } from "./commands/export.js";
import { ExitCode, EXIT_CODE_DOCS } from "./util/exit-codes.js";
import { detectTerminal } from "./util/tty.js";
import { formatError } from "./ui/errors.js";

export interface RunOptions {
  /**
   * Stop the process at the end of the run by calling `process.exit`.
   * Tests pass `false` to inspect the resolved exit code.
   */
  readonly exit?: boolean;
}

/**
 * Build (but do not yet run) the commander tree. Exposed for tests.
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name("vswap")
    .description(
      "Operator CLI for hot-swapping a Solana validator identity between two paired vswap agents.",
    )
    .version(CLI_VERSION, "-v, --version", "Print the CLI and protocol versions.")
    .addOption(new Option("--json", "Emit machine-readable JSON lines instead of human prose.").default(false))
    .addOption(new Option("--config-path <path>", "Override the operator config dir (default: $VSWAP_HOME or ~/.vswap)."))
    .showHelpAfterError(true);

  attachExitCodeFooter(program);

  program
    .command("init")
    .description("First-run setup: generates operator key, mTLS PKI, peer store.")
    .option("--force", "Overwrite an existing config dir (rotates the operator key).")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  $ vswap init",
        "  $ vswap init --config-path /tmp/vswap-staging",
        "  $ vswap init --force                  # rotate everything",
      ].join("\n"),
    )
    .action(async (cmdOpts: { force?: boolean }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<{
        force?: boolean;
        configPath?: string;
        json?: boolean;
      }>();
      const exitCode = await runInit({
        ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
        ...(cmdOpts.force === true ? { force: true } : {}),
        ...(opts.json === true ? { json: true } : {}),
      });
      finish(exitCode);
    });

  program
    .command("pair")
    .description("Pair this CLI with an agent and persist the agent's long-term pubkey.")
    .requiredOption("--agent <host:port>", "Agent address (no scheme).")
    .requiredOption("--label <name>", "Operator-assigned label, used by --from / --to.")
    .option("--note <text>", "Free-form note stored alongside the peer.")
    .option("--yes", "Skip the fingerprint confirmation prompt (CI use).")
    .option("--force", "Replace an existing peer with the same label.")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  $ vswap pair --agent node-a.example.com:7872 --label node-a",
        "  $ vswap pair --agent 10.0.0.7:7872 --label backup --note 'spare host'",
      ].join("\n"),
    )
    .action(async (cmdOpts: PairCmdOpts, cmd: Command) => {
      const opts = cmd.optsWithGlobals<{ configPath?: string; json?: boolean }>();
      const exitCode = await runPair({
        agent: cmdOpts.agent,
        label: cmdOpts.label,
        ...(cmdOpts.note !== undefined ? { note: cmdOpts.note } : {}),
        ...(cmdOpts.yes === true ? { yes: true } : {}),
        ...(cmdOpts.force === true ? { force: true } : {}),
        ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
        ...(opts.json === true ? { json: true } : {}),
      });
      finish(exitCode);
    });

  program
    .command("status")
    .description("Print connectivity + validator state for one or all paired peers.")
    .option("--peer <label>", "Restrict output to a single paired peer.")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  $ vswap status",
        "  $ vswap status --peer node-a",
        "  $ vswap --json status | jq '.payload.label'",
      ].join("\n"),
    )
    .action(async (cmdOpts: { peer?: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<{ configPath?: string; json?: boolean }>();
      const exitCode = await runStatus({
        ...(cmdOpts.peer !== undefined ? { peer: cmdOpts.peer } : {}),
        ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
        ...(opts.json === true ? { json: true } : {}),
      });
      finish(exitCode);
    });

  program
    .command("preflight")
    .description("Run preflight on both peers (no state change). Exits non-zero on any fail.")
    .requiredOption("--from <label>", "Source peer label.")
    .requiredOption("--to <label>", "Target peer label.")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  $ vswap preflight --from node-a --to node-b",
      ].join("\n"),
    )
    .action(async (cmdOpts: { from: string; to: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<{ configPath?: string; json?: boolean }>();
      const exitCode = await runPreflight({
        from: cmdOpts.from,
        to: cmdOpts.to,
        ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
        ...(opts.json === true ? { json: true } : {}),
      });
      finish(exitCode);
    });

  program
    .command("swap")
    .description("Hot-swap validator identity from --from to --to.")
    .requiredOption("--from <label>", "Source peer label.")
    .requiredOption("--to <label>", "Target peer label.")
    .option("--dry-run", "Print plan, run preflight, then exit before any state change.")
    .option("--yes", "Skip the interactive 'swap' confirmation prompt.")
    .option(
      "--timeout <seconds>",
      "Per-call request timeout (default 30).",
      (v) => Number.parseInt(v, 10),
    )
    .option("--no-preflight", "Skip the embedded preflight call (use only for offline testing).")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  $ vswap swap --from node-a --to node-b --dry-run",
        "  $ vswap swap --from node-a --to node-b",
        "  $ vswap swap --from node-a --to node-b --yes --json",
        "",
        "Use `vswap rollback --from node-a --to node-b` if a swap is interrupted.",
      ].join("\n"),
    )
    .action(async (cmdOpts: SwapCmdOpts, cmd: Command) => {
      const opts = cmd.optsWithGlobals<{ configPath?: string; json?: boolean }>();
      const exitCode = await runSwap({
        from: cmdOpts.from,
        to: cmdOpts.to,
        ...(cmdOpts.dryRun === true ? { dryRun: true } : {}),
        ...(cmdOpts.yes === true ? { yes: true } : {}),
        ...(typeof cmdOpts.timeout === "number" ? { timeout: cmdOpts.timeout } : {}),
        ...(cmdOpts.preflight === false ? { noPreflight: true } : {}),
        ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
        ...(opts.json === true ? { json: true } : {}),
      });
      finish(exitCode);
    });

  program
    .command("rollback")
    .description("Force both peers back to the staked identity (recovery command).")
    .requiredOption("--from <label>", "Source peer label.")
    .requiredOption("--to <label>", "Target peer label.")
    .option("--yes", "Skip the interactive 'rollback' confirmation prompt.")
    .option("--session-id <uuid>", "Session id to include in the rollback request (default: zeroed).")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  $ vswap rollback --from node-a --to node-b",
        "  $ vswap rollback --from node-a --to node-b --yes",
      ].join("\n"),
    )
    .action(async (cmdOpts: RollbackCmdOpts, cmd: Command) => {
      const opts = cmd.optsWithGlobals<{ configPath?: string; json?: boolean }>();
      const exitCode = await runRollback({
        from: cmdOpts.from,
        to: cmdOpts.to,
        ...(cmdOpts.yes === true ? { yes: true } : {}),
        ...(cmdOpts.sessionId !== undefined ? { sessionId: cmdOpts.sessionId } : {}),
        ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
        ...(opts.json === true ? { json: true } : {}),
      });
      finish(exitCode);
    });

  program
    .command("export")
    .description("Export operator metadata and secrets for the encrypted web dashboard import flow.")
    .option("--for-web", "Write a vswap-export.json-compatible bundle to stdout.")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  $ vswap export --for-web > vswap-export.json",
      ].join("\n"),
    )
    .action(async (cmdOpts: { forWeb?: boolean }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<{ configPath?: string }>();
      const exitCode = await runExport({
        ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
        ...(cmdOpts.forWeb === true ? { forWeb: true } : {}),
      });
      finish(exitCode);
    });

  program
    .command("version")
    .description("Print CLI version, protocol version, and supported validator builds.")
    .action((_cmdOpts: unknown, cmd: Command) => {
      const opts = cmd.optsWithGlobals<{ json?: boolean }>();
      finish(runVersion({ ...(opts.json === true ? { json: true } : {}) }));
    });

  return program;
}

interface PairCmdOpts {
  readonly agent: string;
  readonly label: string;
  readonly note?: string;
  readonly yes?: boolean;
  readonly force?: boolean;
}

interface SwapCmdOpts {
  readonly from: string;
  readonly to: string;
  readonly dryRun?: boolean;
  readonly yes?: boolean;
  readonly timeout?: number;
  /** Inverted by `--no-preflight`. */
  readonly preflight?: boolean;
}

interface RollbackCmdOpts {
  readonly from: string;
  readonly to: string;
  readonly yes?: boolean;
  readonly sessionId?: string;
}

let pendingExit: number | null = null;
function finish(code: number): void {
  pendingExit = code;
}

function attachExitCodeFooter(program: Command): void {
  const lines = [
    "",
    "Exit codes:",
    ...EXIT_CODE_DOCS.map(
      (e) => `  ${e.code.toString().padStart(2, " ")}  ${e.name.padEnd(20)} ${e.description}`,
    ),
  ];
  program.addHelpText("after", lines.join("\n"));
}

/**
 * Entry point invoked by `bin/vswap.js`. Parses argv, awaits the
 * handler chain, and exits with the recorded code.
 */
export async function run(argv: ReadonlyArray<string>, opts: RunOptions = {}): Promise<number> {
  const program = buildProgram();
  pendingExit = null;
  try {
    await program.parseAsync([...argv]);
  } catch (err) {
    const term = detectTerminal();
    process.stderr.write(
      `${formatError(
        {
          headline: err instanceof Error ? err.message : String(err),
          context: [],
          nextSteps: ["Re-run with --json to capture the structured error.", "Pass --debug to write a verbose log under ~/.vswap/logs."],
        },
        term,
      )}\n`,
    );
    pendingExit = ExitCode.Generic;
  }
  const code = pendingExit ?? ExitCode.Success;
  if (opts.exit !== false) {
    process.exit(code);
  }
  return code;
}
