import { WebSocket } from "ws";
import type { ClientOptions } from "ws";
import type { SwapProgressEvent } from "@vswap/protocol";
import type { LoadedClientConfig } from "../config/load.js";
import { decodeBase58 } from "../util/base58.js";
import { readEnvelope } from "./envelope.js";

export interface ProgressClientOptions {
  readonly config: LoadedClientConfig;
  /**
   * Override the WebSocket constructor — tests substitute an
   * in-memory implementation here.
   */
  readonly socketFactory?: (url: string, opts: ClientOptions) => SocketLike;
}

/**
 * Minimal interface implemented by the real `ws.WebSocket`. Tests
 * implement the same surface against an event-emitter mock.
 */
export interface SocketLike {
  on(event: "message", listener: (data: Buffer | ArrayBuffer | Buffer[]) => void): this;
  on(event: "open", listener: () => void): this;
  on(event: "close", listener: (code: number, reason: Buffer | string) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  close(code?: number, reason?: string): void;
}

export interface ProgressSubscription {
  /** Detach all listeners and close the socket. */
  close(): void;
}

export interface ProgressHandlers {
  onEvent(event: SwapProgressEvent): void;
  onClose?(code: number, reason: string): void;
  onError?(err: Error): void;
}

/**
 * WSS client for `/swap/progress/:correlationId`. Each frame is a
 * signed envelope wrapping a {@link SwapProgressEvent}; the helper
 * verifies the envelope against the agent's expected long-term pubkey
 * and forwards the inner event to the handler.
 */
export class ProgressClient {
  constructor(private readonly opts: ProgressClientOptions) {}

  subscribe(
    peer: { readonly address: string; readonly longTermPubkey: string },
    correlationId: string,
    handlers: ProgressHandlers,
  ): ProgressSubscription {
    const url = `wss://${peer.address}/swap/progress/${encodeURIComponent(correlationId)}`;
    const factory =
      this.opts.socketFactory ??
      ((u, o): SocketLike => new WebSocket(u, o) as unknown as SocketLike);
    const tlsOptions: ClientOptions = {
      cert: this.opts.config.tls.clientCert,
      key: this.opts.config.tls.clientKey,
      ca: this.opts.config.tls.caCert,
      rejectUnauthorized: true,
    };
    const socket = factory(url, tlsOptions);
    const expectedPubkey = decodeBase58(peer.longTermPubkey);

    socket.on("message", (data) => {
      const bytes = toUint8(data);
      readEnvelope(bytes, expectedPubkey)
        .then((opened) => {
          if (opened.message.type !== "SwapProgressEvent") {
            return;
          }
          handlers.onEvent(opened.message as SwapProgressEvent);
        })
        .catch((err: unknown) => {
          handlers.onError?.(
            err instanceof Error ? err : new Error(String(err)),
          );
        });
    });
    socket.on("close", (code, reason) => {
      const reasonText =
        typeof reason === "string" ? reason : Buffer.from(reason).toString("utf8");
      handlers.onClose?.(code, reasonText);
    });
    socket.on("error", (err) => {
      handlers.onError?.(err);
    });

    return {
      close: () => {
        try {
          socket.close(1000, "client done");
        } catch {
          /* swallow — the socket may already be closed */
        }
      },
    };
  }
}

function toUint8(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (Array.isArray(data)) {
    const total = data.reduce((sum, c) => sum + c.byteLength, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of data) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
