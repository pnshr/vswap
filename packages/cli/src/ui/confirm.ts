/**
 * Confirmation prompt for `vswap swap`. Operator must type the literal
 * string `swap` to proceed — defends against reflexive `Enter`.
 */

import { shortPubkey } from "../util/tty.js";

export interface ConfirmContext {
  readonly sourceLabel: string;
  readonly targetLabel: string;
  readonly identityPubkey: string;
  readonly expectedSwapWindowSeconds: readonly [number, number];
}

const CONFIRM_WORD = "swap";

/**
 * Build the prompt text exactly as it appears on stdout. Returned as a
 * pair so tests can inspect the text without re-running the prompt.
 */
export function buildPrompt(ctx: ConfirmContext): {
  readonly text: string;
  readonly word: string;
} {
  const [lo, hi] = ctx.expectedSwapWindowSeconds;
  const text = [
    `You are about to transfer identity ${shortPubkey(ctx.identityPubkey)} from ${ctx.sourceLabel} to ${ctx.targetLabel}.`,
    "This will briefly pause voting and the tower file will be transferred.",
    `Expected swap window: ${lo}–${hi} seconds.`,
    "",
    `Type '${CONFIRM_WORD}' to confirm, anything else to abort:`,
  ].join("\n");
  return { text, word: CONFIRM_WORD };
}

/**
 * Drive an interactive confirmation. Returns `true` iff the operator
 * typed exactly `swap`. On EOF (non-TTY stdin) returns `false`.
 *
 * The implementation depends on `@inquirer/prompts.input` lazily via
 * dynamic import to keep `vswap --version` startup fast.
 */
export async function confirmSwap(ctx: ConfirmContext): Promise<boolean> {
  const { text, word } = buildPrompt(ctx);
  process.stdout.write(`${text}\n`);
  const { input } = await import("@inquirer/prompts");
  let answer: string;
  try {
    answer = await input({ message: ">" });
  } catch {
    // Inquirer raises on Ctrl+C / EOF.
    return false;
  }
  return answer.trim() === word;
}
