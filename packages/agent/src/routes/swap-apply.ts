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
import { runSwapApply } from "../services/swap-target.js";

/**
 * Target-side: apply an encrypted identity blob. The request is a
 * {@link SwapCommitRequest} — the ciphertext itself arrives in the
 * payload of the prior {@link SwapPayload} message, which the caller
 * submits alongside via the same sessionId.
 *
 * The route treats the SwapCommitRequest + one in-flight SwapPayload
 * (kept in memory from an earlier POST on `/swap/apply/payload`,
 * threaded through as a query string) as a single call.
 */
export function registerSwapApplyRoute(
  app: FastifyInstance,
  runtime: AgentRuntime,
): void {
  app.post("/swap/apply", async (req, reply) => {
    const verified = await parseSignedRequest(req, reply, runtime);
    if (verified === null) return;
    if (!isSwapPayload(verified.message)) {
      await sendErrorEnvelope(reply, runtime, 400, {
        code: "MESSAGE_SCHEMA",
        message:
          "swap/apply expects a SwapPayload body (ciphertext + sessionId)",
      });
      return;
    }
    const payload = verified.message;
    const expected =
      typeof (req.query as { expectedPubkey?: unknown }).expectedPubkey ===
      "string"
        ? (req.query as { expectedPubkey: string }).expectedPubkey
        : null;
    if (expected === null) {
      await sendErrorEnvelope(reply, runtime, 400, {
        code: "MESSAGE_SCHEMA",
        message: "query param expectedPubkey (base58) is required",
      });
      return;
    }
    const requireTower =
      typeof (req.query as { requireTower?: unknown }).requireTower ===
      "string"
        ? (req.query as { requireTower: string }).requireTower !== "false"
        : true;
    const result = await runSwapApply(
      {
        correlationId: payload.correlationId,
        sessionId: payload.sessionId,
        ciphertext: payload.ciphertext,
        expectedIdentityPubkey: expected,
        requireTower,
      },
      {
        config: runtime.config,
        rpc: runtime.rpc,
        progress: runtime.progress,
        sessions: runtime.sessions,
      },
    ).catch(async (err: unknown) => {
      await sendExceptionEnvelope(reply, runtime, err, payload.correlationId);
      return null;
    });
    if (result === null) return;
    const response: AnyMessage = {
      type: "SwapCompleted",
      version: PROTOCOL_VERSION,
      nonce: randomNonce(),
      timestamp: Date.now(),
      correlationId: payload.correlationId,
      sessionId: payload.sessionId,
      finalIdentityPubkey: fromBase58Padded(result.finalIdentityPubkey),
      durationMs: result.durationMs,
    };
    await sendSignedEnvelope(reply, runtime, response);
  });
}

/**
 * Decode a base58 pubkey back to its 32-byte representation. This
 * mirrors the encode path from `./solana/base58.ts`. Only used here to
 * satisfy the protocol schema which transports pubkeys as raw bytes.
 */
function fromBase58Padded(_: string): Uint8Array {
  // We never round-trip secret material through this helper; for the
  // pubkey we maintain the 32-byte form upstream. The agent currently
  // stores the blob's `sourcePubkey` bytes at decrypt time, so pack the
  // base58 back into 32 bytes via a deterministic decode.
  // Implementing decode here keeps the module surface minimal without
  // adding a new dependency.
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const base = 58n;
  let value = 0n;
  for (const ch of _) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) {
      throw new Error(`invalid base58 character: ${ch}`);
    }
    value = value * base + BigInt(idx);
  }
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}

function randomNonce(): Uint8Array {
  const out = new Uint8Array(24);
  crypto.getRandomValues(out);
  return out;
}
