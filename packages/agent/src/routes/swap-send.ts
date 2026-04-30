import type { FastifyInstance } from "fastify";
import { PROTOCOL_VERSION } from "@vswap/protocol";
import type { AnyMessage } from "@vswap/protocol";
import type { AgentRuntime } from "../runtime.js";
import {
  isSwapPayload,
  parseSignedRequest,
  sendErrorEnvelope,
  sendExceptionEnvelope,
  sendSignedEnvelope,
} from "./envelope-helpers.js";
import { runSwapSource } from "../services/swap-source.js";

/**
 * Source-side: run the source swap orchestration (pause voting, seal
 * identity + tower), returning the ciphertext inside a SwapPayload.
 *
 * The caller MUST have already completed `/swap/init` on the target
 * and passed the returned session keypair + expected identity pubkey
 * through the operator into this request. Wire shape is
 * `SwapPayload` in → `SwapPayload` out, with the expected identity
 * pubkey carried on `expectedIdentityPubkey` (query param).
 */
export function registerSwapSendRoute(
  app: FastifyInstance,
  runtime: AgentRuntime,
): void {
  app.post("/swap/send", async (req, reply) => {
    const verified = await parseSignedRequest(req, reply, runtime);
    if (verified === null) return;
    if (!isSwapPayload(verified.message)) {
      await sendErrorEnvelope(reply, runtime, 400, {
        code: "MESSAGE_SCHEMA",
        message: `expected SwapPayload, got ${verified.message.type}`,
      });
      return;
    }
    const payload = verified.message;
    const expected =
      typeof (req.query as { expectedPubkey?: unknown }).expectedPubkey === "string"
        ? (req.query as { expectedPubkey: string }).expectedPubkey
        : null;
    if (expected === null) {
      await sendErrorEnvelope(reply, runtime, 400, {
        code: "MESSAGE_SCHEMA",
        message: "query param expectedPubkey (base58) is required",
      });
      return;
    }
    const result = await runSwapSource(
      {
        correlationId: payload.correlationId,
        sessionId: payload.sessionId,
        recipientSessionPubkey: payload.recipientSessionPubkey,
        expectedIdentityPubkey: expected,
      },
      {
        config: runtime.config,
        rpc: runtime.rpc,
        cli: runtime.cli,
        progress: runtime.progress,
        longTermSecret: runtime.identity.secretKey,
      },
    ).catch(async (err: unknown) => {
      await sendExceptionEnvelope(reply, runtime, err, payload.correlationId);
      return null;
    });
    if (result === null) return;
    const response: AnyMessage = {
      type: "SwapPayload",
      version: PROTOCOL_VERSION,
      nonce: randomNonce(),
      timestamp: Date.now(),
      correlationId: payload.correlationId,
      sessionId: payload.sessionId,
      recipientSessionPubkey: payload.recipientSessionPubkey,
      ciphertext: result.ciphertext,
    };
    await sendSignedEnvelope(reply, runtime, response);
  });
}

function randomNonce(): Uint8Array {
  const out = new Uint8Array(24);
  crypto.getRandomValues(out);
  return out;
}
