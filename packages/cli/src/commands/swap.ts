/**
 * `vswap swap` — orchestrate a hot-swap of validator identity from
 * `--from` to `--to`. The command always prints a plan, runs preflight,
 * confirms with the operator, then drives the agent calls in order.
 *
 * Failure handling: any error after `swap/send` triggers an automatic
 * rollback attempt on the source. Operator interruption (Ctrl+C) also
 * fires a best-effort rollback when the swap has crossed the point
 * where the source is no longer voting.
 */

import { ExitCode } from "../util/exit-codes.js";
import { resolveConfigPaths } from "../config/paths.js";
import { loadClientConfig, type LoadedClientConfig } from "../config/load.js";
import { PeersStore, type PairedPeer } from "../config/peers.js";
import { AgentClient, AgentResponseError, AgentTransportError } from "../client/agent-client.js";
import { ProgressClient } from "../client/ws-client.js";
import { freshCorrelationId } from "../client/envelope.js";
import { detectTerminal } from "../util/tty.js";
import { renderPlan, type PlanInputs } from "../ui/plan.js";
import { confirmSwap } from "../ui/confirm.js";
import { createProgressView, type ProgressView } from "../ui/progress.js";
import { emitJson } from "../ui/json.js";
import { encodeBase58 } from "../util/base58.js";
import { runBothPreflights } from "./preflight.js";
import type {
  SwapCompleted,
  SwapPayload,
  SwapProgressEvent,
  SwapSessionInit,
} from "@vswap/protocol";

export interface SwapOptions {
  readonly from: string;
  readonly to: string;
  readonly configPath?: string;
  readonly dryRun?: boolean;
  readonly yes?: boolean;
  readonly timeout?: number;
  readonly json?: boolean;
  readonly noPreflight?: boolean;
}

/** Default expected swap window for the human-readable plan + prompt. */
const DEFAULT_SWAP_WINDOW_MS: readonly [number, number] = [1000, 3000];

/**
 * Placeholder used in the rendered plan when /status did not expose a
 * parseable identity. `runSwap` refuses to proceed if it sees this so
 * we never send `?expectedPubkey=(unknown)` to the agent.
 */
const UNKNOWN_PUBKEY_PLACEHOLDER = "(unknown)";

export interface SwapDeps {
  readonly agentClient?: AgentClient;
  readonly progressClient?: ProgressClient;
  readonly stdout?: NodeJS.WriteStream;
  readonly autoConfirm?: boolean;
  /**
   * Override the confirmation prompt — used by tests so a real TTY is
   * not required. Returns `true` to proceed.
   */
  readonly confirm?: (correlationId: string) => Promise<boolean>;
}

export async function runSwap(opts: SwapOptions, deps: SwapDeps = {}): Promise<number> {
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
  const client =
    deps.agentClient ??
    new AgentClient({
      config,
      // CLI flag is in seconds; AgentClient expects milliseconds.
      ...(opts.timeout !== undefined ? { requestTimeoutMs: opts.timeout * 1000 } : {}),
    });

  // 1. Connectivity: refuse to proceed if either agent is unreachable.
  const [srcUp, tgtUp] = await Promise.all([client.health(source), client.health(target)]);
  if (!srcUp || !tgtUp) {
    stdout.write(
      `Connectivity check failed: source=${srcUp ? "ok" : "down"}, target=${tgtUp ? "ok" : "down"}\n`,
    );
    return ExitCode.Network;
  }

  // 2. Preflight, unless explicitly skipped (still requires `--yes`).
  if (opts.noPreflight !== true) {
    const report = await runBothPreflights(client, source, target, config.identity);
    if (report.anyFailed) {
      stdout.write("Preflight failed; refusing to swap. Run `vswap preflight` for details.\n");
      if (opts.json === true) {
        emitJson("swap.preflight_failed", report, stdout);
      }
      return ExitCode.PreflightFailed;
    }
  }

  // 3. Build & render the plan.
  const correlationId = freshCorrelationId();
  const plan = await buildPlan(client, source, target, config, correlationId);
  if (opts.json === true) {
    emitJson("swap.plan", plan, stdout);
  } else {
    stdout.write(`${renderPlan(plan)}\n`);
  }

  // 3a. Refuse to swap if the source's current identity could not be
  // parsed from /status. We need it as `expectedPubkey` on /swap/send;
  // sending the literal "(unknown)" is a confusing failure mode.
  if (plan.source.identityPubkey === UNKNOWN_PUBKEY_PLACEHOLDER) {
    const msg =
      `Could not determine the source validator's current identity pubkey from ${source.label}'s /status response. ` +
      `Refusing to swap. Run \`vswap status --peer ${source.label}\` to inspect.\n`;
    if (opts.json === true) {
      emitJson(
        "swap.aborted",
        { reason: "source identity unknown", correlationId, peer: source.label },
        stdout,
      );
    } else {
      stdout.write(msg);
    }
    return ExitCode.Generic;
  }

  if (opts.dryRun === true) {
    if (opts.json === true) {
      emitJson("swap.dry_run", { correlationId }, stdout);
    } else {
      stdout.write("\n--dry-run: stopping before any state change.\n");
    }
    return ExitCode.Success;
  }

  // 4. Confirmation.
  const accepted = await acquireConfirmation(opts, deps, correlationId, source, target, plan);
  if (!accepted) {
    if (opts.json === true) {
      emitJson("swap.aborted", { reason: "operator did not confirm", correlationId }, stdout);
    } else {
      stdout.write("\nAborted: confirmation not given.\n");
    }
    return ExitCode.AbortedByUser;
  }

  // 5. Drive the swap.
  return executeSwap(opts, deps, client, source, target, plan, config, correlationId, stdout);
}

async function buildPlan(
  client: AgentClient,
  source: PairedPeer,
  target: PairedPeer,
  config: LoadedClientConfig,
  correlationId: string,
): Promise<PlanInputs> {
  const [srcStatus, tgtStatus] = await Promise.all([
    client.status(source, config.identity),
    client.status(target, config.identity),
  ]);
  const srcInfo = parseValidatorInfoOrEmpty(srcStatus.message.startProgress);
  const tgtInfo = parseValidatorInfoOrEmpty(tgtStatus.message.startProgress);
  return {
    correlationId,
    source: {
      label: source.label,
      identityPubkey: srcInfo.identity ?? UNKNOWN_PUBKEY_PLACEHOLDER,
      currentSlot: srcInfo.slot ?? 0,
    },
    target: {
      label: target.label,
      identityPubkey: tgtInfo.identity ?? UNKNOWN_PUBKEY_PLACEHOLDER,
      currentSlot: tgtInfo.slot ?? 0,
    },
    tower: null,
    expectedSwapWindowMs: DEFAULT_SWAP_WINDOW_MS,
  };
}

interface ParsedValidatorInfo {
  readonly identity: string | null;
  readonly slot: number | null;
}

function parseValidatorInfoOrEmpty(blob: string): ParsedValidatorInfo {
  try {
    const parsed: unknown = JSON.parse(blob);
    if (parsed === null || typeof parsed !== "object") {
      return { identity: null, slot: null };
    }
    const obj = parsed as {
      contactInfo?: { id?: unknown; identity?: unknown; slot?: unknown };
    };
    // The agent's `gatherValidatorInfo` returns the field as
    // `identity`; some older mocks / unit tests use `id`. Accept either
    // so the contract stays backward-compatible with both shapes.
    const identityVal =
      obj.contactInfo &&
      (typeof obj.contactInfo.identity === "string"
        ? obj.contactInfo.identity
        : typeof obj.contactInfo.id === "string"
          ? obj.contactInfo.id
          : null);
    const slot =
      obj.contactInfo && typeof obj.contactInfo.slot === "number"
        ? obj.contactInfo.slot
        : null;
    return { identity: identityVal ?? null, slot };
  } catch {
    return { identity: null, slot: null };
  }
}

async function acquireConfirmation(
  opts: SwapOptions,
  deps: SwapDeps,
  correlationId: string,
  source: PairedPeer,
  target: PairedPeer,
  plan: PlanInputs,
): Promise<boolean> {
  if (opts.yes === true || deps.autoConfirm === true) {
    return true;
  }
  if (deps.confirm !== undefined) {
    return deps.confirm(correlationId);
  }
  return confirmSwap({
    sourceLabel: source.label,
    targetLabel: target.label,
    identityPubkey: plan.source.identityPubkey,
    expectedSwapWindowSeconds: [
      Math.floor(DEFAULT_SWAP_WINDOW_MS[0] / 1000),
      Math.floor(DEFAULT_SWAP_WINDOW_MS[1] / 1000),
    ],
  });
}

interface SwapState {
  readonly correlationId: string;
  init: SwapSessionInit | null;
  payload: SwapPayload | null;
  /** True once /swap/send succeeded — meaning source paused voting. */
  sourcePaused: boolean;
  /** True once /swap/apply succeeded — target now holds staked identity. */
  applied: boolean;
}

async function executeSwap(
  opts: SwapOptions,
  deps: SwapDeps,
  client: AgentClient,
  source: PairedPeer,
  target: PairedPeer,
  plan: PlanInputs,
  config: LoadedClientConfig,
  correlationId: string,
  stdout: NodeJS.WriteStream,
): Promise<number> {
  const term = detectTerminal();
  const view = createProgressView(term, stdout);
  const startedAt = Date.now();

  const state: SwapState = {
    correlationId,
    init: null,
    payload: null,
    sourcePaused: false,
    applied: false,
  };

  const progressClient = deps.progressClient ?? new ProgressClient({ config });
  const subs = subscribeProgress(progressClient, source, target, correlationId, view);
  const interruptHandler = installInterruptHandler(state, client, source, config, stdout);

  try {
    state.init = (
      await client.swapInit(
        target,
        config.identity,
        correlationId,
        source.longTermPubkey,
      )
    ).message;
    const sourcePubkey = plan.source.identityPubkey;
    const sendResp = await client.swapSend(
      source,
      config.identity,
      state.init,
      sourcePubkey,
      correlationId,
    );
    state.payload = sendResp.message;
    state.sourcePaused = true;
    const applyResp = await client.swapApply(
      target,
      config.identity,
      state.payload,
      sourcePubkey,
      true,
      correlationId,
    );
    state.applied = true;
    view.done();
    const summary = renderCompleted(applyResp.message, startedAt);
    if (opts.json === true) {
      emitJson("swap.completed", summary, stdout);
    } else {
      stdout.write(`\n${summary.text}\n`);
    }
    return ExitCode.Success;
  } catch (err) {
    view.fail();
    return handleFailure(err, state, client, source, config, opts, stdout);
  } finally {
    subs.close();
    interruptHandler.uninstall();
  }
}

function subscribeProgress(
  progressClient: ProgressClient,
  source: PairedPeer,
  target: PairedPeer,
  correlationId: string,
  view: ProgressView,
): { close(): void } {
  const handlers = {
    onEvent: (event: SwapProgressEvent): void => {
      view.update(event);
    },
    onError: (): void => {
      /* swallow — progress is informational */
    },
  };
  const a = progressClient.subscribe(source, correlationId, handlers);
  const b = progressClient.subscribe(target, correlationId, handlers);
  return {
    close(): void {
      a.close();
      b.close();
    },
  };
}

interface InterruptHandle {
  uninstall(): void;
}

function installInterruptHandler(
  state: SwapState,
  client: AgentClient,
  source: PairedPeer,
  config: LoadedClientConfig,
  stdout: NodeJS.WriteStream,
): InterruptHandle {
  const handler = (): void => {
    stdout.write(
      "\nReceived SIGINT during swap. Attempting source rollback before exit...\n",
    );
    if (!state.sourcePaused || state.applied) {
      // Either we never crossed the pause line, or the swap already
      // landed on the target — no rollback work to do.
      process.exit(ExitCode.AbortedByUser);
      return;
    }
    // Bound the rollback so a hung agent never traps the operator.
    const watchdog = setTimeout(() => {
      stdout.write(
        "Rollback timed out after 5s; exiting. Run `vswap rollback --from <src> --to <dst>` manually.\n",
      );
      process.exit(ExitCode.RollbackNeeded);
    }, 5_000);
    watchdog.unref();
    client
      .swapRollback(
        source,
        config.identity,
        state.init?.sessionId ?? "00000000-0000-0000-0000-000000000000",
        "sigint",
      )
      .then(
        () => {
          clearTimeout(watchdog);
          stdout.write("Source rollback completed.\n");
          process.exit(ExitCode.AbortedByUser);
        },
        (err: unknown) => {
          clearTimeout(watchdog);
          const msg = err instanceof Error ? err.message : String(err);
          stdout.write(
            `Source rollback FAILED: ${msg}\nRun \`vswap rollback --from <src> --to <dst>\` to recover.\n`,
          );
          process.exit(ExitCode.RollbackNeeded);
        },
      );
  };
  process.on("SIGINT", handler);
  return {
    uninstall: () => process.off("SIGINT", handler),
  };
}

interface CompletedSummary {
  readonly text: string;
  readonly finalIdentityPubkey: string;
  readonly durationMs: number;
}

function renderCompleted(msg: SwapCompleted, startedAt: number): CompletedSummary {
  const final = encodeBase58(msg.finalIdentityPubkey);
  const elapsed = Date.now() - startedAt;
  const text = [
    `\u2713 Swap completed in ${msg.durationMs > 0 ? msg.durationMs.toString() : elapsed.toString()} ms`,
    `  Final identity pubkey: ${final}`,
  ].join("\n");
  return { text, finalIdentityPubkey: final, durationMs: msg.durationMs };
}

async function handleFailure(
  err: unknown,
  state: SwapState,
  client: AgentClient,
  source: PairedPeer,
  config: LoadedClientConfig,
  opts: SwapOptions,
  stdout: NodeJS.WriteStream,
): Promise<number> {
  const message = err instanceof Error ? err.message : String(err);
  if (opts.json === true) {
    emitJson(
      "swap.failed",
      { correlationId: state.correlationId, error: message, sourcePaused: state.sourcePaused },
      stdout,
    );
  } else {
    stdout.write(`\nSwap failed: ${message}\n`);
  }
  if (state.sourcePaused && !state.applied) {
    stdout.write("Attempting automatic rollback on source...\n");
    try {
      await client.swapRollback(
        source,
        config.identity,
        state.init?.sessionId ?? "00000000-0000-0000-0000-000000000000",
        `automatic rollback after ${message}`,
      );
      stdout.write("Rollback acknowledged by source.\n");
    } catch (rollbackErr) {
      stdout.write(
        `Rollback FAILED: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}\n`,
      );
      stdout.write(
        "Source may still be running with the unstaked identity. Run `vswap rollback --from <src> --to <tgt>` immediately.\n",
      );
      return ExitCode.RollbackNeeded;
    }
  }
  if (err instanceof AgentTransportError) return ExitCode.Network;
  if (err instanceof AgentResponseError) {
    if (
      err.code === "SIGNATURE_INVALID" ||
      err.code === "DECRYPTION_FAILED" ||
      err.code === "PUBKEY_MISMATCH"
    ) {
      return ExitCode.Crypto;
    }
  }
  return ExitCode.Generic;
}
