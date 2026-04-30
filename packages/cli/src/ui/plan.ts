/**
 * Renderer for the swap "plan" — printed before every confirmation
 * regardless of `--yes` or `--dry-run`.
 *
 * Tests use this module's pure render function via snapshot tests.
 */

import { shortPubkey } from "../util/tty.js";

export interface PlanInputs {
  readonly source: PlanPeer;
  readonly target: PlanPeer;
  readonly tower: {
    readonly fileName: string;
    readonly slot: number;
    readonly sizeBytes: number;
  } | null;
  readonly expectedSwapWindowMs: readonly [number, number];
  readonly correlationId: string;
}

export interface PlanPeer {
  readonly label: string;
  readonly identityPubkey: string;
  readonly currentSlot: number;
}

const STEPS: ReadonlyArray<string> = [
  "Acquire swap locks on both agents",
  "Source: set-identity to unstaked (pause voting)",
  "Encrypt identity+tower, send to target via agent A → CLI → agent B",
  "Target: decrypt in /dev/shm, set-identity with --require-tower",
  "Target: add authorized voter",
  "Wait for target to resume voting (timeout: 30s)",
  "Scrub all transient buffers",
  "Release locks",
];

/**
 * Build the plain-text plan exactly as it appears on stdout.
 *
 * The output is deterministic — no timestamps, no random IDs other
 * than `correlationId` (which is provided by the caller).
 */
export function renderPlan(plan: PlanInputs): string {
  const lines: string[] = [];
  lines.push("Planned swap:");
  lines.push(
    `  Source: ${plan.source.label} (pubkey ${shortPubkey(plan.source.identityPubkey)}, slot ${plan.source.currentSlot})`,
  );
  const lag = plan.source.currentSlot - plan.target.currentSlot;
  const lagText =
    lag === 0 ? "in sync" : lag > 0 ? `lag ${lag} slot${lag === 1 ? "" : "s"}` : `lead ${-lag} slot${-lag === 1 ? "" : "s"}`;
  lines.push(
    `  Target: ${plan.target.label} (pubkey ${shortPubkey(plan.target.identityPubkey)}, slot ${plan.target.currentSlot}, ${lagText})`,
  );
  if (plan.tower !== null) {
    const sizeKb = (plan.tower.sizeBytes / 1024).toFixed(1);
    lines.push(
      `  Tower: ${plan.tower.fileName} (slot ${plan.tower.slot}, ${sizeKb} KB)`,
    );
  } else {
    lines.push("  Tower: unknown (target preflight will refuse)");
  }
  lines.push(`  Correlation ID: ${plan.correlationId}`);
  lines.push("");
  lines.push("  Steps:");
  STEPS.forEach((step, idx) => {
    lines.push(`    ${(idx + 1).toString()}. ${step}`);
  });
  lines.push("");
  const [lo, hi] = plan.expectedSwapWindowMs;
  lines.push(
    `  Expected swap window: ~${(lo / 1000).toFixed(0)}–${(hi / 1000).toFixed(0)} seconds`,
  );
  return lines.join("\n");
}
