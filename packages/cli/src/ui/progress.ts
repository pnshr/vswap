/**
 * Progress UI for `vswap swap`. In a TTY we draw a single-line
 * progress bar with a phase label; in non-TTY (CI, pipe) we emit a
 * newline-delimited record per phase.
 */

import type { SwapPhase, SwapProgressEvent } from "@vswap/protocol";
import type { TerminalCapabilities } from "../util/tty.js";
import { colourise } from "./errors.js";

const PHASE_ORDER: ReadonlyArray<SwapPhase> = [
  "precheck",
  "stop-voting",
  "ship-tower",
  "activate",
  "cleanup",
  "health",
];

export interface ProgressView {
  /** Update with a new event. */
  update(event: SwapProgressEvent): void;
  /** Mark the run as complete and tear down any TTY drawing. */
  done(): void;
  /** Mark the run as failed and tear down. */
  fail(): void;
}

export function createProgressView(
  term: TerminalCapabilities,
  stream: NodeJS.WriteStream = process.stdout,
): ProgressView {
  if (term.isTty) {
    return new TtyProgressView(term, stream);
  }
  return new LineProgressView(stream);
}

class LineProgressView implements ProgressView {
  constructor(private readonly stream: NodeJS.WriteStream) {}

  update(event: SwapProgressEvent): void {
    const detail =
      event.slot !== undefined ? `${event.detail} (slot ${event.slot})` : event.detail;
    this.stream.write(`${event.phase}\t${detail}\n`);
  }

  done(): void {
    /* nothing to redraw */
  }

  fail(): void {
    /* nothing to redraw */
  }
}

class TtyProgressView implements ProgressView {
  private lastPhaseIdx = -1;
  private lastDetail = "";
  private finished = false;

  constructor(
    private readonly term: TerminalCapabilities,
    private readonly stream: NodeJS.WriteStream,
  ) {}

  update(event: SwapProgressEvent): void {
    if (this.finished) {
      return;
    }
    const idx = PHASE_ORDER.indexOf(event.phase);
    if (idx >= 0) {
      this.lastPhaseIdx = idx;
    }
    this.lastDetail = event.detail;
    this.draw();
  }

  done(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearLine();
  }

  fail(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearLine();
  }

  private draw(): void {
    if (this.lastPhaseIdx < 0) return;
    const totalPhases = PHASE_ORDER.length;
    const filled = "#".repeat(Math.max(0, this.lastPhaseIdx + 1));
    const empty = ".".repeat(totalPhases - this.lastPhaseIdx - 1);
    const phase = PHASE_ORDER[this.lastPhaseIdx] ?? "?";
    const bar = `[${filled}${empty}]`;
    const colouredBar = this.term.colour ? colourise(bar, "green") : bar;
    const detail = this.lastDetail.slice(0, Math.max(0, this.term.width - 30));
    const line = `${colouredBar} ${phase.padEnd(12)} ${detail}`;
    this.clearLine();
    this.stream.write(line);
  }

  private clearLine(): void {
    if (typeof this.stream.cursorTo === "function") {
      this.stream.cursorTo(0);
    }
    if (typeof this.stream.clearLine === "function") {
      this.stream.clearLine(0);
    } else {
      this.stream.write(`\r${" ".repeat(this.term.width)}\r`);
    }
  }
}
