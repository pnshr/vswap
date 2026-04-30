import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { PROTOCOL_VERSION, sealEnvelope } from "@vswap/protocol";
import type { AnyMessage, SwapProgressEvent } from "@vswap/protocol";
import type { AgentRuntime } from "../runtime.js";

/**
 * WebSocket endpoint streaming `SwapProgressEvent` envelopes keyed by
 * `correlationId`. Each frame is a signed msgpack envelope just like
 * the HTTP body format.
 *
 * Note: no envelope verification on *incoming* frames because the WS
 * path is output-only; the caller just opens a socket and reads.
 */
export function registerSwapProgressRoute(
  app: FastifyInstance,
  runtime: AgentRuntime,
): void {
  app.get<{ Params: { correlationId: string } }>(
    "/swap/progress/:correlationId",
    { websocket: true },
    (socket, req) => {
      const correlationId = req.params.correlationId;
      const onProgress = (event: SwapProgressEvent): void => {
        void emitFrame(socket, runtime, event);
      };
      const unsubscribe = runtime.progress.subscribe(
        correlationId,
        onProgress,
        () => {
          socket.close(1000, "done");
        },
      );
      socket.on("close", () => {
        unsubscribe();
      });
    },
  );
}

async function emitFrame(
  socket: WebSocket,
  runtime: AgentRuntime,
  event: SwapProgressEvent,
): Promise<void> {
  const frame: AnyMessage = {
    type: "SwapProgressEvent",
    version: PROTOCOL_VERSION,
    nonce: event.nonce,
    timestamp: event.timestamp,
    correlationId: event.correlationId,
    sessionId: event.sessionId,
    phase: event.phase,
    detail: event.detail,
    ...(event.slot !== undefined ? { slot: event.slot } : {}),
  };
  const envelope = await sealEnvelope(
    frame,
    runtime.identity.secretKey,
    runtime.identity.publicKey,
  );
  socket.send(Buffer.from(envelope));
}
