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
import { encodeBase58 } from "../solana/base58.js";

/**
 * Pair a remote agent: accept its long-term pubkey into the local
 * peer store after validating the request signature came from the
 * same pubkey. Pairing is asymmetric — each side must pair the other
 * independently.
 */
export function registerPairRoute(
  app: FastifyInstance,
  runtime: AgentRuntime,
): void {
  app.post("/pair", async (req, reply) => {
    const verified = await parseSignedRequest(req, reply, runtime, {
      allowUnpaired: true,
    });
    if (verified === null) return;
    if (!isPairRequest(verified.message)) {
      await sendErrorEnvelope(reply, runtime, 400, {
        code: "MESSAGE_SCHEMA",
        message: `expected PairRequest, got ${verified.message.type}`,
      });
      return;
    }
    const pairReq = verified.message;
    const claimedPubkey = pairReq.senderLongTermPubkey;
    // Envelope sender must equal the body's claimed long-term pubkey.
    if (!bytesEqual(claimedPubkey, verified.senderPubkey)) {
      await sendErrorEnvelope(reply, runtime, 401, {
        code: "SIGNATURE_INVALID",
        message:
          "PairRequest senderLongTermPubkey does not match the envelope signer",
      });
      return;
    }
    const base58 = encodeBase58(claimedPubkey);
    await runtime.peers.add({
      longTermPubkey: base58,
      addedAt: Date.now(),
    });
    const response: AnyMessage = {
      type: "PairResponse",
      version: PROTOCOL_VERSION,
      nonce: randomNonce(),
      timestamp: Date.now(),
      correlationId: pairReq.correlationId,
      senderLongTermPubkey: runtime.identity.publicKey,
      acknowledgedPubkey: claimedPubkey,
      // Best-effort version probe captured at boot. Pass-through only;
      // the operator CLI is responsible for gating / warning. See
      // docs/supported-versions.md.
      ...(runtime.validatorVersion !== null
        ? { validatorVersion: runtime.validatorVersion }
        : {}),
    };
    await sendSignedEnvelope(reply, runtime, response);
  });
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function randomNonce(): Uint8Array {
  const out = new Uint8Array(24);
  crypto.getRandomValues(out);
  return out;
}
