import { randomUUID, randomBytes } from "node:crypto";
import {
  PROTOCOL_VERSION,
  openEnvelope,
  sealEnvelope,
} from "@vswap/protocol";
import type { AnyMessage, OpenedEnvelope, SigningSecretKey } from "@vswap/protocol";

/** Fields shared by every wire message. */
export interface MessageDefaults {
  readonly correlationId: string;
  readonly nonce: Uint8Array;
  readonly timestamp: number;
  readonly version: string;
}

/** Generate a fresh UUIDv4 for `correlationId`. */
export function freshCorrelationId(): string {
  return randomUUID();
}

/** Generate a 24-byte random nonce as required by the wire protocol. */
export function freshNonce(): Uint8Array {
  return new Uint8Array(randomBytes(24));
}

/**
 * Stamp a message with default metadata (`correlationId`, `nonce`,
 * `timestamp`, `version`). Callers pass the type and type-specific
 * fields; this helper fills in the rest.
 */
export function newMessageDefaults(
  correlationId: string = freshCorrelationId(),
): MessageDefaults {
  return {
    correlationId,
    nonce: freshNonce(),
    timestamp: Date.now(),
    version: PROTOCOL_VERSION,
  };
}

export interface SignerIdentity {
  readonly secretKey: SigningSecretKey;
  readonly publicKey: Uint8Array;
}

/**
 * Encode a message into a signed wire envelope.
 *
 * The result is the raw msgpack envelope bytes ready to be sent over
 * the wire (HTTP body or WS frame).
 */
export async function buildEnvelope(
  message: AnyMessage,
  signer: SignerIdentity,
): Promise<Uint8Array> {
  return sealEnvelope(message, signer.secretKey, signer.publicKey);
}

/**
 * Verify an inbound envelope and return the inner message together
 * with the proven sender pubkey.
 *
 * If `expectedSenderPubkey` is supplied, the helper rejects envelopes
 * whose sender does not match (constant-time inside `@vswap/protocol`).
 */
export async function readEnvelope(
  bytes: Uint8Array,
  expectedSenderPubkey?: Uint8Array,
): Promise<OpenedEnvelope> {
  return openEnvelope(bytes, expectedSenderPubkey);
}
