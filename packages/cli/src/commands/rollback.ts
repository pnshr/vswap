/**
 * `vswap rollback` — recovery command. Forces both peers back to the
 * staked identity via `/swap/rollback`, with an interactive confirm.
 */

import { ExitCode } from "../util/exit-codes.js";
import { resolveConfigPaths } from "../config/paths.js";
import { loadClientConfig } from "../config/load.js";
import { PeersStore } from "../config/peers.js";
import { AgentClient } from "../client/agent-client.js";
import { freshCorrelationId } from "../client/envelope.js";
import { emitJson } from "../ui/json.js";

export interface RollbackOptions {
  readonly from: string;
  readonly to: string;
  readonly configPath?: string;
  readonly yes?: boolean;
  readonly json?: boolean;
  /** Override the session id used in `/swap/rollback`. Tests pass a fixed UUID. */
  readonly sessionId?: string;
}

export interface RollbackDeps {
  readonly agentClient?: AgentClient;
  readonly stdout?: NodeJS.WriteStream;
  readonly confirm?: () => Promise<boolean>;
}

const ZERO_SESSION_ID = "00000000-0000-0000-0000-000000000000";

export async function runRollback(
  opts: RollbackOptions,
  deps: RollbackDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const paths = resolveConfigPaths(opts.configPath);
  const config = await loadClientConfig(paths);
  const peers = await PeersStore.open(paths.peers);
  const source = peers.byLabel(opts.from);
  const target = peers.byLabel(opts.to);
  if (!source || !target) {
    const missing: string[] = [];
    if (!source) missing.push(`--from ${opts.from}`);
    if (!target) missing.push(`--to ${opts.to}`);
    stdout.write(`Unknown peer label(s): ${missing.join(", ")}\n`);
    return ExitCode.Generic;
  }
  const client = deps.agentClient ?? new AgentClient({ config });

  if (opts.json !== true) {
    stdout.write(`Rollback plan:\n`);
    stdout.write(`  Source: ${source.label} (${source.address}) → set staked identity\n`);
    stdout.write(`  Target: ${target.label} (${target.address}) → set staked identity\n`);
    stdout.write("\n");
  }

  if (opts.yes !== true) {
    const ok = await (deps.confirm ?? defaultConfirm)();
    if (!ok) {
      if (opts.json === true) {
        emitJson("rollback.aborted", { reason: "operator did not confirm" }, stdout);
      } else {
        stdout.write("Aborted.\n");
      }
      return ExitCode.AbortedByUser;
    }
  }

  const sessionId = opts.sessionId ?? ZERO_SESSION_ID;
  const results: Array<{ peer: string; ok: boolean; error?: string }> = [];
  for (const peer of [source, target]) {
    try {
      await client.swapRollback(
        peer,
        config.identity,
        sessionId,
        "operator-initiated rollback",
        freshCorrelationId(),
      );
      results.push({ peer: peer.label, ok: true });
    } catch (err) {
      results.push({
        peer: peer.label,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const allOk = results.every((r) => r.ok);
  if (opts.json === true) {
    emitJson("rollback.report", { results, allOk }, stdout);
  } else {
    for (const r of results) {
      stdout.write(`  ${r.peer}: ${r.ok ? "ok" : `FAILED — ${r.error ?? "unknown"}`}\n`);
    }
    stdout.write(allOk ? "Rollback complete.\n" : "Rollback partially failed; investigate manually.\n");
  }
  return allOk ? ExitCode.Success : ExitCode.RollbackNeeded;
}

async function defaultConfirm(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    process.stdout.write(
      "stdin is not a TTY; pass --yes to confirm rollback in non-interactive mode.\n",
    );
    return false;
  }
  process.stdout.write(`Type 'rollback' to proceed, anything else to abort: `);
  const { input } = await import("@inquirer/prompts");
  let answer: string;
  try {
    answer = await input({ message: ">" });
  } catch {
    return false;
  }
  return answer.trim() === "rollback";
}

