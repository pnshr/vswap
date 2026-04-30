import type { FastifyInstance } from "fastify";
import { PROTOCOL_VERSION } from "@vswap/protocol";
import type { AnyMessage } from "@vswap/protocol";
import type { AgentRuntime } from "../runtime.js";
import {
  isPreflightRequest,
  parseSignedRequest,
  sendErrorEnvelope,
  sendSignedEnvelope,
} from "./envelope-helpers.js";
import { gatherValidatorInfo } from "../solana/validator-info.js";

/**
 * Read-only status endpoint: wraps `contactInfo` + `rpcAddress` into a
 * preflight-style response so operators can probe without running a
 * full preflight.
 */
export function registerStatusRoute(
  app: FastifyInstance,
  runtime: AgentRuntime,
): void {
  app.get("/status", async (req, reply) => {
    const verified = await parseSignedRequest(req, reply, runtime);
    if (verified === null) return;
    if (!isPreflightRequest(verified.message)) {
      await sendErrorEnvelope(reply, runtime, 400, {
        code: "MESSAGE_SCHEMA",
        message:
          "status expects a PreflightRequest envelope (reusing the schema for simplicity)",
      });
      return;
    }
    const preflightReq = verified.message;
    const info = await gatherValidatorInfo(runtime.rpc);
    const response: AnyMessage = {
      type: "PreflightResponse",
      version: PROTOCOL_VERSION,
      nonce: randomNonce(),
      timestamp: Date.now(),
      correlationId: preflightReq.correlationId,
      agentVersion: "0.1.0",
      capabilities: ["status"],
      startProgress: JSON.stringify(info),
    };
    await sendSignedEnvelope(reply, runtime, response);
  });
}

function randomNonce(): Uint8Array {
  const out = new Uint8Array(24);
  crypto.getRandomValues(out);
  return out;
}
