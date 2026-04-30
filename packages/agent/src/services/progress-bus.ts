import { EventEmitter } from "node:events";
import type { SwapProgressEvent } from "@vswap/protocol";

/**
 * In-memory pub/sub keyed by correlationId. One emitter per correlation
 * so a stray subscriber cannot observe events for a different swap.
 */
export class ProgressBus {
  private readonly emitters = new Map<string, EventEmitter>();

  emit(correlationId: string, event: SwapProgressEvent): void {
    const e = this.emitters.get(correlationId);
    if (e === undefined) {
      return;
    }
    e.emit("progress", event);
  }

  end(correlationId: string): void {
    const e = this.emitters.get(correlationId);
    if (e === undefined) {
      return;
    }
    e.emit("end");
    e.removeAllListeners();
    this.emitters.delete(correlationId);
  }

  subscribe(
    correlationId: string,
    listener: (event: SwapProgressEvent) => void,
    onEnd?: () => void,
  ): () => void {
    let emitter = this.emitters.get(correlationId);
    if (emitter === undefined) {
      emitter = new EventEmitter();
      emitter.setMaxListeners(16);
      this.emitters.set(correlationId, emitter);
    }
    emitter.on("progress", listener);
    if (onEnd !== undefined) {
      emitter.once("end", onEnd);
    }
    return () => {
      emitter?.off("progress", listener);
      if (onEnd !== undefined) {
        emitter?.off("end", onEnd);
      }
    };
  }
}
