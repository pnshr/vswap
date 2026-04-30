import type { FastifyInstance } from "fastify";
import { PROTOCOL_VERSION } from "@vswap/protocol";
import type { AnyMessage } from "@vswap/protocol";
import type { AgentRuntime } from "../runtime.js";
import {
  isRollbackRequest,
  parseSignedRequest,
  sendErrorEnvelope,
  sendSignedEnvelope,
} from "./envelope-helpers.js";

/**
 * Rollback endpoint — force the validator back to its staked identity
 * via admin RPC. Used by operators when a swap goes sideways and the
 * automatic rollback path on the source did not fire.
 */
export function registerSwapRollbackRoute(
  app: FastifyInstance,
  runtime: AgentRuntime,
): void {
  app.post("/swap/rollback", async (req, reply) => {
    const verified = await parseSignedRequest(req, reply, runtime);
    if (verified === null) return;
    if (!isRollbackRequest(verified.message)) {
      await sendErrorEnvelope(reply, runtime, 400, {
        code: "MESSAGE_SCHEMA",
        message: `expected RollbackRequest, got ${verified.message.type}`,
      });
      return;
    }
    const rollbackReq = verified.message;
    try {
      await runtime.rpc.setIdentity(
        runtime.config.validator.stakedIdentityPath,
        true,
      );
    } catch (err) {
      await sendErrorEnvelope(reply, runtime, 500, {
        code: "PROTOCOL_ERROR",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const response: AnyMessage = {
      type: "SwapCompleted",
      version: PROTOCOL_VERSION,
      nonce: randomNonce(),
      timestamp: Date.now(),
      correlationId: rollbackReq.correlationId,
      sessionId: rollbackReq.sessionId,
      finalIdentityPubkey: new Uint8Array(32),
      durationMs: 0,
    };
    await sendSignedEnvelope(reply, runtime, response);
  });
}

function randomNonce(): Uint8Array {
  const out = new Uint8Array(24);
  crypto.getRandomValues(out);
  return out;
}
