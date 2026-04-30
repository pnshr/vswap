/**
 * TTY / terminal awareness helpers. Centralised so individual command
 * modules don't sprinkle `process.stdout.isTTY` checks.
 */

export interface TerminalCapabilities {
  /** True when stdout is a terminal (not redirected to a file or pipe). */
  readonly isTty: boolean;
  /** Effective terminal width, falling back to 80 columns. */
  readonly width: number;
  /** True when colour output should be emitted. */
  readonly colour: boolean;
}

export function detectTerminal(
  env: NodeJS.ProcessEnv = process.env,
  stream: NodeJS.WriteStream = process.stdout,
): TerminalCapabilities {
  const isTty = Boolean(stream.isTTY);
  const width = stream.columns && stream.columns > 0 ? stream.columns : 80;
  const colour =
    isTty &&
    env["NO_COLOR"] === undefined &&
    env["VSWAP_NO_COLOR"] === undefined;
  return { isTty, width, colour };
}

/**
 * Truncate a long string with an ellipsis suffix while keeping it under
 * `max` characters. The ellipsis is `…` (single character) so widths
 * are predictable.
 */
export function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  if (max <= 1) {
    return value.slice(0, max);
  }
  return `${value.slice(0, max - 1)}…`;
}

/**
 * Shorten a base58 pubkey for human display: first 6 chars + ellipsis +
 * last 4 chars when the input is longer than 12 characters; otherwise
 * the full string.
 */
export function shortPubkey(pubkey: string): string {
  if (pubkey.length <= 12) {
    return pubkey;
  }
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`;
}
