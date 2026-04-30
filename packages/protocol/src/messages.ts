import { z } from "zod";
import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SECRET_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
  NONCE_BYTES,
  PROTOCOL_VERSION,
  X25519_PUBLIC_KEY_BYTES,
} from "./constants.js";
import {
  ErrorCode,
  MessageSchemaError,
  VersionMismatchError,
  type ErrorCodeValue,
} from "./errors.js";

/** UUID v4 string (RFC 4122) used for `correlationId` and `sessionId`. */
const uuidSchema = z.string().uuid();

/** Schema for a fixed-length `Uint8Array` field. */
function bytesOfLength(length: number): z.ZodType<Uint8Array> {
  return z
    .instanceof(Uint8Array, { message: `expected Uint8Array of ${length} bytes` })
    .refine((b) => b.byteLength === length, {
      message: `expected ${length}-byte Uint8Array`,
    });
}

/** Schema for a variable-length `Uint8Array` with an upper bound. */
function bytesMax(max: number): z.ZodType<Uint8Array> {
  return z
    .instanceof(Uint8Array, { message: "expected Uint8Array" })
    .refine((b) => b.byteLength <= max, {
      message: `expected Uint8Array of at most ${max} bytes`,
    });
}

const errorCodeSchema = z.enum([
  ErrorCode.Protocol,
  ErrorCode.SignatureInvalid,
  ErrorCode.MessageSchema,
  ErrorCode.ReplayDetected,
  ErrorCode.DecryptionFailed,
  ErrorCode.PubkeyMismatch,
  ErrorCode.TowerInvalid,
  ErrorCode.VersionMismatch,
  ErrorCode.PayloadTooLarge,
]) satisfies z.ZodType<ErrorCodeValue>;

export const serialisedErrorSchema = z
  .object({
    code: errorCodeSchema,
    message: z.string(),
    context: z.record(z.unknown()),
  })
  .strict();

/**
 * Fields common to every wire message. Every message type below extends
 * this base.
 */
const baseMessageShape = {
  type: z.string(),
  version: z.string(),
  nonce: bytesOfLength(NONCE_BYTES),
  timestamp: z.number().int().nonnegative(),
  correlationId: uuidSchema,
} as const;

function messageObject<T extends z.ZodRawShape>(
  typeLiteral: string,
  shape: T,
) {
  return z
    .object({
      ...baseMessageShape,
      type: z.literal(typeLiteral),
      ...shape,
    })
    .strict();
}

export const preflightRequestSchema = messageObject("PreflightRequest", {
  agentVersion: z.string(),
  capabilities: z.array(z.string()),
});

export const preflightResponseSchema = messageObject("PreflightResponse", {
  agentVersion: z.string(),
  capabilities: z.array(z.string()),
  startProgress: z.string(),
});

export const pairRequestSchema = messageObject("PairRequest", {
  senderLongTermPubkey: bytesOfLength(ED25519_PUBLIC_KEY_BYTES),
});

export const pairResponseSchema = messageObject("PairResponse", {
  senderLongTermPubkey: bytesOfLength(ED25519_PUBLIC_KEY_BYTES),
  acknowledgedPubkey: bytesOfLength(ED25519_PUBLIC_KEY_BYTES),
  // Best-effort pass-through of `agave-validator --version` from the
  // agent's host so the operator CLI can flag versions that fall
  // outside the tested matrix in docs/supported-versions.md. Optional:
  // older agents do not set it, and a current agent leaves it
  // undefined if the version probe fails (binary missing, timeout,
  // etc.). Bounded length so a maliciously-large value cannot bloat
  // the response envelope.
  validatorVersion: z.string().max(256).optional(),
});

export const swapSessionInitSchema = messageObject("SwapSessionInit", {
  sessionId: uuidSchema,
  sessionPubkey: bytesOfLength(X25519_PUBLIC_KEY_BYTES),
  sessionExpiresAt: z.number().int().nonnegative(),
});

export const swapPayloadSchema = messageObject("SwapPayload", {
  sessionId: uuidSchema,
  recipientSessionPubkey: bytesOfLength(X25519_PUBLIC_KEY_BYTES),
  ciphertext: bytesMax(200_000),
});

export const swapCommitRequestSchema = messageObject("SwapCommitRequest", {
  sessionId: uuidSchema,
  requireTower: z.boolean(),
});

export const swapPhaseSchema = z.enum([
  "precheck",
  "stop-voting",
  "ship-tower",
  "activate",
  "cleanup",
  "health",
]);
export type SwapPhase = z.infer<typeof swapPhaseSchema>;

export const swapProgressEventSchema = messageObject("SwapProgressEvent", {
  sessionId: uuidSchema,
  phase: swapPhaseSchema,
  detail: z.string(),
  slot: z.number().int().nonnegative().optional(),
});

export const swapCompletedSchema = messageObject("SwapCompleted", {
  sessionId: uuidSchema,
  finalIdentityPubkey: bytesOfLength(ED25519_PUBLIC_KEY_BYTES),
  durationMs: z.number().int().nonnegative(),
});

export const swapFailedSchema = messageObject("SwapFailed", {
  sessionId: uuidSchema,
  phase: swapPhaseSchema,
  error: serialisedErrorSchema,
});

export const rollbackRequestSchema = messageObject("RollbackRequest", {
  sessionId: uuidSchema,
  reason: z.string(),
});

export const errorEnvelopeSchema = messageObject("ErrorEnvelope", {
  error: serialisedErrorSchema,
});

/**
 * Plaintext payload sealed against Agent-B's session pubkey. Carried
 * inside {@link swapPayloadSchema}`.ciphertext` after msgpack-encoding.
 * Kept here so Agent-A and Agent-B agree on the layout without depending
 * on the outer wire module.
 */
export const identityBlobSchema = z
  .object({
    sourcePubkey: bytesOfLength(ED25519_PUBLIC_KEY_BYTES),
    identitySecretKey: bytesOfLength(ED25519_SECRET_KEY_BYTES),
    towerFileName: z.string().min(1),
    towerBytes: bytesMax(90_000),
    signature: bytesOfLength(ED25519_SIGNATURE_BYTES),
  })
  .strict();
export type IdentityBlob = z.infer<typeof identityBlobSchema>;

/** Discriminated union of every valid wire message. */
export const anyMessageSchema = z.discriminatedUnion("type", [
  preflightRequestSchema,
  preflightResponseSchema,
  pairRequestSchema,
  pairResponseSchema,
  swapSessionInitSchema,
  swapPayloadSchema,
  swapCommitRequestSchema,
  swapProgressEventSchema,
  swapCompletedSchema,
  swapFailedSchema,
  rollbackRequestSchema,
  errorEnvelopeSchema,
]);

export type AnyMessage = z.infer<typeof anyMessageSchema>;
export type PreflightRequest = z.infer<typeof preflightRequestSchema>;
export type PreflightResponse = z.infer<typeof preflightResponseSchema>;
export type PairRequest = z.infer<typeof pairRequestSchema>;
export type PairResponse = z.infer<typeof pairResponseSchema>;
export type SwapSessionInit = z.infer<typeof swapSessionInitSchema>;
export type SwapPayload = z.infer<typeof swapPayloadSchema>;
export type SwapCommitRequest = z.infer<typeof swapCommitRequestSchema>;
export type SwapProgressEvent = z.infer<typeof swapProgressEventSchema>;
export type SwapCompleted = z.infer<typeof swapCompletedSchema>;
export type SwapFailed = z.infer<typeof swapFailedSchema>;
export type RollbackRequest = z.infer<typeof rollbackRequestSchema>;
export type ErrorEnvelopeMessage = z.infer<typeof errorEnvelopeSchema>;

/**
 * Validate a decoded object against the union schema. On failure throws
 * {@link MessageSchemaError}; on protocol-version mismatch throws
 * {@link VersionMismatchError}. Only metadata (expected vs actual
 * version, zod issue paths) is included in the error context — never
 * the raw payload.
 */
export function parseMessage(candidate: unknown): AnyMessage {
  if (
    candidate !== null &&
    typeof candidate === "object" &&
    "version" in candidate &&
    typeof (candidate as { version: unknown }).version === "string" &&
    (candidate as { version: string }).version !== PROTOCOL_VERSION
  ) {
    throw new VersionMismatchError(
      `expected protocol version ${PROTOCOL_VERSION}, got ${(candidate as { version: string }).version}`,
      {
        expected: PROTOCOL_VERSION,
        actual: (candidate as { version: string }).version,
      },
    );
  }
  const result = anyMessageSchema.safeParse(candidate);
  if (!result.success) {
    throw new MessageSchemaError("message failed schema validation", {
      issues: result.error.issues.map((i) => ({ path: i.path, code: i.code })),
    });
  }
  return result.data;
}
