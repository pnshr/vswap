/**
 * Typed error hierarchy for the vswap protocol. Every error carries a
 * stable machine-readable `code` and a `context` bag that MUST NOT
 * include any secret material (private keys, plaintext payloads, etc).
 * Only metadata such as pubkeys, sizes, or type names belong there.
 */

export type ErrorContext = Readonly<Record<string, unknown>>;

/** Stable machine-readable error codes. */
export const ErrorCode = {
  Protocol: "PROTOCOL_ERROR",
  SignatureInvalid: "SIGNATURE_INVALID",
  MessageSchema: "MESSAGE_SCHEMA",
  ReplayDetected: "REPLAY_DETECTED",
  DecryptionFailed: "DECRYPTION_FAILED",
  PubkeyMismatch: "PUBKEY_MISMATCH",
  TowerInvalid: "TOWER_INVALID",
  VersionMismatch: "VERSION_MISMATCH",
  PayloadTooLarge: "PAYLOAD_TOO_LARGE",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Base class for every protocol-level error. */
export class ProtocolError extends Error {
  readonly code: ErrorCodeValue;
  readonly context: ErrorContext;

  constructor(
    code: ErrorCodeValue,
    message: string,
    context: ErrorContext = {},
  ) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.context = context;
  }
}

export class SignatureInvalidError extends ProtocolError {
  constructor(message = "Signature verification failed", context: ErrorContext = {}) {
    super(ErrorCode.SignatureInvalid, message, context);
    this.name = "SignatureInvalidError";
  }
}

export class MessageSchemaError extends ProtocolError {
  constructor(message = "Message failed schema validation", context: ErrorContext = {}) {
    super(ErrorCode.MessageSchema, message, context);
    this.name = "MessageSchemaError";
  }
}

export class ReplayDetectedError extends ProtocolError {
  constructor(
    message = "Replay detected (nonce seen or timestamp out of window)",
    context: ErrorContext = {},
  ) {
    super(ErrorCode.ReplayDetected, message, context);
    this.name = "ReplayDetectedError";
  }
}

export class DecryptionFailedError extends ProtocolError {
  constructor(message = "Decryption failed", context: ErrorContext = {}) {
    super(ErrorCode.DecryptionFailed, message, context);
    this.name = "DecryptionFailedError";
  }
}

export class PubkeyMismatchError extends ProtocolError {
  constructor(message = "Pubkey did not match the expected value", context: ErrorContext = {}) {
    super(ErrorCode.PubkeyMismatch, message, context);
    this.name = "PubkeyMismatchError";
  }
}

export class TowerInvalidError extends ProtocolError {
  constructor(message = "Tower file is invalid", context: ErrorContext = {}) {
    super(ErrorCode.TowerInvalid, message, context);
    this.name = "TowerInvalidError";
  }
}

export class VersionMismatchError extends ProtocolError {
  constructor(message = "Protocol version mismatch", context: ErrorContext = {}) {
    super(ErrorCode.VersionMismatch, message, context);
    this.name = "VersionMismatchError";
  }
}

export class PayloadTooLargeError extends ProtocolError {
  constructor(message = "Payload exceeds allowed size", context: ErrorContext = {}) {
    super(ErrorCode.PayloadTooLarge, message, context);
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Serialisable shape of a protocol error for transport via an
 * `ErrorEnvelope` wire message. Never include secret material here.
 */
export interface SerialisedError {
  readonly code: ErrorCodeValue;
  readonly message: string;
  readonly context: ErrorContext;
}

export function serialiseError(err: ProtocolError): SerialisedError {
  return { code: err.code, message: err.message, context: err.context };
}
