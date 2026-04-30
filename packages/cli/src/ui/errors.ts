/**
 * Operator-friendly error rendering. Every error funnels through
 * {@link formatError}, which produces the documented three-section
 * layout: headline, context, next steps.
 */

import type { TerminalCapabilities } from "../util/tty.js";

export interface ErrorView {
  /** Single-line headline (no trailing newline). */
  readonly headline: string;
  /** Pairs displayed under "Context:". */
  readonly context: ReadonlyArray<readonly [string, string]>;
  /** Bulleted lines displayed under "Next steps:". */
  readonly nextSteps: ReadonlyArray<string>;
}

/**
 * Render an {@link ErrorView} into a string suitable for writing to
 * stderr. Colours are applied lazily via `chalk`; the renderer is
 * synchronous and `chalk` is loaded only when colours are enabled.
 */
export function formatError(view: ErrorView, term: TerminalCapabilities): string {
  const lines: string[] = [];
  const red = (s: string): string => (term.colour ? colourise(s, "red") : s);
  const dim = (s: string): string => (term.colour ? colourise(s, "dim") : s);
  const yellow = (s: string): string => (term.colour ? colourise(s, "yellow") : s);

  lines.push(`${red("Error")}: ${view.headline}`);
  if (view.context.length > 0) {
    lines.push("");
    lines.push(dim("  Context:"));
    for (const [k, v] of view.context) {
      lines.push(`    - ${k}: ${v}`);
    }
  }
  if (view.nextSteps.length > 0) {
    lines.push("");
    lines.push(yellow("  Next steps:"));
    for (const step of view.nextSteps) {
      lines.push(`    - ${step}`);
    }
  }
  return lines.join("\n");
}

const ANSI = {
  red: ["\u001b[31m", "\u001b[39m"],
  dim: ["\u001b[2m", "\u001b[22m"],
  yellow: ["\u001b[33m", "\u001b[39m"],
  green: ["\u001b[32m", "\u001b[39m"],
} as const;

/**
 * Apply a small set of ANSI colours without depending on `chalk` at
 * the top of the import graph (chalk's first load is ~30 ms which we
 * cannot afford on the `--version` hot path).
 */
export function colourise(value: string, name: keyof typeof ANSI): string {
  const codes = ANSI[name];
  return `${codes[0]}${value}${codes[1]}`;
}
