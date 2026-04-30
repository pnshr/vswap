import { z } from "zod";
import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
  MAX_MESSAGE_SIZE_BYTES,
} from "./constants.js";
import {
  MessageSchemaError,
  PayloadTooLargeError,
  SignatureInvalidError,
} from "./errors.js";
import {
  type AnyMessage,
  parseMessage,
} from "./messages.js";
import { signDetached, verifyDetached } from "./crypto/signing.js";
import type { SigningSecretKey } from "./crypto/signing.js";
import { decode, encode } from "./wire.js";

/**
 * Wire shape of a signed envelope. Every byte leaving a vswap agent
 * travels wrapped in this struct.
 */
export interface Envelope {
  /** msgpack-encoded {@link AnyMessage}. */
  readonly payload: Uint8Array;
  /** Ed25519 long-term public key of the sender. */
  readonly senderPubkey: Uint8Array;
  /** Detached Ed25519 signature over `payload`. */
  readonly signature: Uint8Array;
}

const envelopeSchema = z
  .object({
    payload: z.instanceof(Uint8Array),
    senderPubkey: z
      .instanceof(Uint8Array)
      .refine((b) => b.byteLength === ED25519_PUBLIC_KEY_BYTES, {
        message: `senderPubkey must be ${ED25519_PUBLIC_KEY_BYTES} bytes`,
      }),
    signature: z
      .instanceof(Uint8Array)
      .refine((b) => b.byteLength === ED25519_SIGNATURE_BYTES, {
        message: `signature must be ${ED25519_SIGNATURE_BYTES} bytes`,
      }),
  })
  .strict();

/** Opened envelope: the validated inner message together with proven sender. */
export interface OpenedEnvelope {
  readonly message: AnyMessage;
  readonly senderPubkey: Uint8Array;
}

/**
 * Seal a message into a signed envelope:
 * 1. msgpack-encode the message,
 * 2. sign the encoded bytes with `senderSecretKey`,
 * 3. msgpack-encode the `{payload, senderPubkey, signature}` triple.
 *
 * Throws {@link PayloadTooLargeError} if the outer encoded envelope
 * exceeds {@link MAX_MESSAGE_SIZE_BYTES}.
 */
export async function sealEnvelope(
  message: AnyMessage,
  senderSecretKey: SigningSecretKey,
  senderPubkey: Uint8Array,
): Promise<Uint8Array> {
  if (senderPubkey.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
    throw new RangeError(
      `senderPubkey must be ${ED25519_PUBLIC_KEY_BYTES} bytes, got ${senderPubkey.byteLength}`,
    );
  }
  const payload = encode(message);
  const signature = await signDetached(payload, senderSecretKey);
  const envelope: Envelope = {
    payload,
    senderPubkey: new Uint8Array(senderPubkey),
    signature,
  };
  return encode(envelope);
}

/**
 * Verify and open a signed envelope.
 *
 * - Rejects envelopes larger than {@link MAX_MESSAGE_SIZE_BYTES}
 *   (via {@link decode}).
 * - Throws {@link MessageSchemaError} on structural problems.
 * - Throws {@link SignatureInvalidError} on signature failure or on
 *   sender pubkey mismatch when `expectedSenderPubkey` is supplied.
 * - Throws errors raised by {@link parseMessage} (schema / version).
 */
export async function openEnvelope(
  bytes: Uint8Array,
  expectedSenderPubkey?: Uint8Array,
): Promise<OpenedEnvelope> {
  if (bytes.byteLength > MAX_MESSAGE_SIZE_BYTES) {
    throw new PayloadTooLargeError("envelope exceeds maximum wire size", {
      size: bytes.byteLength,
      max: MAX_MESSAGE_SIZE_BYTES,
    });
  }
  const raw = decode(bytes);
  const envelopeResult = envelopeSchema.safeParse(raw);
  if (!envelopeResult.success) {
    throw new MessageSchemaError("envelope structure invalid", {
      issues: envelopeResult.error.issues.map((i) => ({
        path: i.path,
        code: i.code,
      })),
    });
  }
  const envelope = envelopeResult.data;

  if (
    expectedSenderPubkey !== undefined &&
    !constantTimeEqualBytes(envelope.senderPubkey, expectedSenderPubkey)
  ) {
    throw new SignatureInvalidError("sender pubkey mismatch", {
      senderPubkeySize: envelope.senderPubkey.byteLength,
      expectedSize: expectedSenderPubkey.byteLength,
    });
  }

  const ok = await verifyDetached(
    envelope.signature,
    envelope.payload,
    envelope.senderPubkey,
  );
  if (!ok) {
    throw new SignatureInvalidError("signature did not verify", {
      payloadSize: envelope.payload.byteLength,
    });
  }

  const innerRaw = decode(envelope.payload);
  const message = parseMessage(innerRaw);
  return { message, senderPubkey: envelope.senderPubkey };
}

/**
 * Constant-time byte-wise comparison. Uses `sodium.memcmp` when available
 * through libsodium, falls back to a plain loop otherwise. Public keys
 * are not secret, but keeping comparisons constant-time here is cheap
 * insurance against timing oracles if the helper is reused elsewhere.
 */
function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
