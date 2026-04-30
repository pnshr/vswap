/**
 * `vswap status` — query one or all paired peers and render a small
 * table summarising connectivity + validator state.
 */

import { ExitCode } from "../util/exit-codes.js";
import { resolveConfigPaths } from "../config/paths.js";
import { loadClientConfig } from "../config/load.js";
import { PeersStore, type PairedPeer } from "../config/peers.js";
import { AgentClient } from "../client/agent-client.js";
import { detectTerminal, shortPubkey } from "../util/tty.js";
import { emitJson } from "../ui/json.js";
import type { SigningSecretKey } from "@vswap/protocol";

export interface StatusOptions {
  readonly peer?: string;
  readonly configPath?: string;
  readonly json?: boolean;
}

export interface StatusEntry {
  readonly label: string;
  readonly address: string;
  readonly reachable: boolean;
  readonly longTermPubkey: string;
  readonly validatorInfo: ValidatorInfoView | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

export interface ValidatorInfoView {
  readonly contactInfo: Readonly<Record<string, unknown>>;
  readonly rpcAddress: string | null;
}

export async function runStatus(
  opts: StatusOptions,
  stdout: NodeJS.WriteStream = process.stdout,
  client?: AgentClient,
): Promise<number> {
  const paths = resolveConfigPaths(opts.configPath);
  const config = await loadClientConfig(paths);
  const peers = await PeersStore.open(paths.peers);
  const peerList = selectPeers(peers, opts.peer);
  if (peerList.length === 0) {
    stdout.write(
      opts.peer !== undefined
        ? `No paired peer with label '${opts.peer}'. Run \`vswap pair ...\` first.\n`
        : "No paired peers. Run `vswap pair --agent <host:port> --label <name>` first.\n",
    );
    return ExitCode.Generic;
  }
  const c = client ?? new AgentClient({ config });
  const entries: StatusEntry[] = [];
  for (const peer of peerList) {
    entries.push(await probeOne(c, peer, config.identity));
  }

  if (opts.json === true) {
    for (const entry of entries) {
      emitJson("status.peer", entry, stdout);
    }
  } else {
    renderTable(entries, stdout);
  }

  const someUnreachable = entries.some((e) => !e.reachable || e.error !== null);
  return someUnreachable ? ExitCode.Network : ExitCode.Success;
}

function selectPeers(
  peers: PeersStore,
  label: string | undefined,
): ReadonlyArray<PairedPeer> {
  if (label === undefined) {
    return peers.list();
  }
  const found = peers.byLabel(label);
  return found ? [found] : [];
}

interface StatusIdentity {
  readonly secretKey: SigningSecretKey;
  readonly publicKey: Uint8Array;
}

async function probeOne(
  client: AgentClient,
  peer: PairedPeer,
  identity: StatusIdentity,
): Promise<StatusEntry> {
  const reachable = await client.health(peer);
  if (!reachable) {
    return {
      label: peer.label,
      address: peer.address,
      reachable: false,
      longTermPubkey: peer.longTermPubkey,
      validatorInfo: null,
      error: { code: "UNREACHABLE", message: "GET /health failed" },
    };
  }
  try {
    const resp = await client.status(peer, identity);
    return {
      label: peer.label,
      address: peer.address,
      reachable: true,
      longTermPubkey: peer.longTermPubkey,
      validatorInfo: parseValidatorInfo(resp.message.startProgress),
      error: null,
    };
  } catch (err) {
    return {
      label: peer.label,
      address: peer.address,
      reachable: true,
      longTermPubkey: peer.longTermPubkey,
      validatorInfo: null,
      error: {
        code: codeFor(err),
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function parseValidatorInfo(blob: string): ValidatorInfoView | null {
  try {
    const parsed: unknown = JSON.parse(blob);
    if (parsed === null || typeof parsed !== "object") return null;
    const obj = parsed as { contactInfo?: unknown; rpcAddress?: unknown };
    return {
      contactInfo:
        obj.contactInfo && typeof obj.contactInfo === "object"
          ? (obj.contactInfo as Readonly<Record<string, unknown>>)
          : {},
      rpcAddress: typeof obj.rpcAddress === "string" ? obj.rpcAddress : null,
    };
  } catch {
    return null;
  }
}

function codeFor(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code: unknown }).code;
    if (typeof c === "string") return c;
  }
  return "STATUS_FAILED";
}

function renderTable(
  entries: ReadonlyArray<StatusEntry>,
  stdout: NodeJS.WriteStream,
): void {
  const term = detectTerminal();
  void term;
  const header = ["LABEL", "ADDRESS", "STATE", "PUBKEY", "RPC"].join("\t");
  stdout.write(`${header}\n`);
  for (const e of entries) {
    const state = !e.reachable
      ? "unreachable"
      : e.error !== null
        ? `error (${e.error.code})`
        : "ok";
    const rpc = e.validatorInfo?.rpcAddress ?? "-";
    stdout.write(
      `${e.label}\t${e.address}\t${state}\t${shortPubkey(e.longTermPubkey)}\t${rpc}\n`,
    );
  }
}
