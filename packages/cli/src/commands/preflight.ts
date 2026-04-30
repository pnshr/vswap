/**
 * `vswap preflight` — run preflight checks on both source and target
 * agents and render the result. Any `fail` row maps to a non-zero
 * exit.
 */

import { ExitCode } from "../util/exit-codes.js";
import { resolveConfigPaths } from "../config/paths.js";
import { loadClientConfig } from "../config/load.js";
import { PeersStore, type PairedPeer } from "../config/peers.js";
import { AgentClient } from "../client/agent-client.js";
import type { PreflightResponse, SigningSecretKey } from "@vswap/protocol";
import { emitJson } from "../ui/json.js";

export interface PreflightOptions {
  readonly from: string;
  readonly to: string;
  readonly configPath?: string;
  readonly json?: boolean;
}

export type PreflightStatus = "ok" | "warn" | "fail" | "skip";

export interface PreflightCheckRow {
  /** Use {@link PreflightStatus} for the documented values; agent extensions may add more. */
  readonly status: string;
  readonly name: string;
  readonly message: string;
}

export interface PreflightSideReport {
  readonly role: "source" | "target";
  readonly peer: string;
  readonly checks: ReadonlyArray<PreflightCheckRow>;
}

export interface PreflightCombinedReport {
  readonly source: PreflightSideReport;
  readonly target: PreflightSideReport;
  readonly anyFailed: boolean;
}

export async function runPreflight(
  opts: PreflightOptions,
  stdout: NodeJS.WriteStream = process.stdout,
  client?: AgentClient,
): Promise<number> {
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
  const c = client ?? new AgentClient({ config });
  const report = await runBothPreflights(c, source, target, config.identity);

  if (opts.json === true) {
    emitJson("preflight.report", report, stdout);
  } else {
    renderHuman(report, stdout);
  }
  return report.anyFailed ? ExitCode.PreflightFailed : ExitCode.Success;
}

export interface PreflightIdentity {
  readonly secretKey: SigningSecretKey;
  readonly publicKey: Uint8Array;
}

export async function runBothPreflights(
  client: AgentClient,
  source: PairedPeer,
  target: PairedPeer,
  identity: PreflightIdentity,
): Promise<PreflightCombinedReport> {
  const [src, tgt] = await Promise.all([
    runOne(client, source, "source", identity),
    runOne(client, target, "target", identity),
  ]);
  const anyFailed =
    src.checks.some((c) => c.status === "fail") ||
    tgt.checks.some((c) => c.status === "fail");
  return { source: src, target: tgt, anyFailed };
}

async function runOne(
  client: AgentClient,
  peer: PairedPeer,
  role: "source" | "target",
  identity: PreflightIdentity,
): Promise<PreflightSideReport> {
  const resp = await client.preflight(peer, identity, role);
  return {
    role,
    peer: peer.label,
    checks: parsePreflightRows(resp.message),
  };
}

/**
 * Parse the agent's `startProgress` blob into structured rows.
 *
 * The agent renders one header line `role=<source|target>` followed by
 * tab-delimited `status\tname\tmessage` lines.
 */
export function parsePreflightRows(
  message: PreflightResponse,
): ReadonlyArray<PreflightCheckRow> {
  const rows: PreflightCheckRow[] = [];
  for (const line of message.startProgress.split(/\r?\n/)) {
    if (line.length === 0) continue;
    if (line.startsWith("role=")) continue;
    const parts = line.split("\t");
    if (parts.length < 3) {
      rows.push({ status: "warn", name: "(unparsed)", message: line });
      continue;
    }
    const [status, name, ...rest] = parts;
    rows.push({
      status: status ?? "warn",
      name: name ?? "(unnamed)",
      message: rest.join("\t"),
    });
  }
  return rows;
}

function renderHuman(
  report: PreflightCombinedReport,
  stdout: NodeJS.WriteStream,
): void {
  for (const side of [report.source, report.target] as const) {
    stdout.write(`[${side.role}] ${side.peer}\n`);
    if (side.checks.length === 0) {
      stdout.write("  (no checks reported)\n");
      continue;
    }
    for (const check of side.checks) {
      stdout.write(`  ${check.status.padEnd(4)} ${check.name}: ${check.message}\n`);
    }
  }
  stdout.write(report.anyFailed ? "preflight: FAIL\n" : "preflight: ok\n");
}
