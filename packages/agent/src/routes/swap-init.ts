import type { FastifyInstance } from "fastify";
import { PROTOCOL_VERSION } from "@vswap/protocol";
import type { AnyMessage } from "@vswap/protocol";
import type { AgentRuntime } from "../runtime.js";
import {
  isPairRequest,
  parseSignedRequest,
  sendErrorEnvelope,
  sendSignedEnvelope,
} from "./envelope-helpers.js";

/**
 * Target-side: generate an ephemeral X25519 session keypair and return
 * the public half so the source can seal an identity blob against it.
 */
export function registerSwapInitRoute(
  app: FastifyInstance,
  runtime: AgentRuntime,
): void {
  app.post("/swap/init", async (req, reply) => {
    const verified = await parseSignedRequest(req, reply, runtime);
    if (verified === null) return;
    if (!isPairRequest(verified.message)) {
      await sendErrorEnvelope(reply, runtime, 400, {
        code: "MESSAGE_SCHEMA",
        message:
          "swap/init expects a PairRequest payload carrying the source long-term pubkey",
      });
      return;
    }
    const pairReq = verified.message;
    // Bind the session to the source *agent*'s long-term pubkey (the key
    // that will sign the identity blob), not the envelope sender (the
    // operator / CLI). The CLI carries the source agent's pubkey in
    // `PairRequest.senderLongTermPubkey`. We accept the envelope
    // sender as a fallback for backwards compatibility with unit tests.
    const sourcePubkey =
      pairReq.senderLongTermPubkey.byteLength === 32
        ? pairReq.senderLongTermPubkey
        : verified.senderPubkey;
    const session = await runtime.sessions.init(sourcePubkey);
    const response: AnyMessage = {
      type: "SwapSessionInit",
      version: PROTOCOL_VERSION,
      nonce: randomNonce(),
      timestamp: Date.now(),
      correlationId: pairReq.correlationId,
      sessionId: session.sessionId,
      sessionPubkey: session.keypair.publicKey,
      sessionExpiresAt: session.expiresAt,
    };
    await sendSignedEnvelope(reply, runtime, response);
  });
}

function randomNonce(): Uint8Array {
  const out = new Uint8Array(24);
  crypto.getRandomValues(out);
  return out;
}
