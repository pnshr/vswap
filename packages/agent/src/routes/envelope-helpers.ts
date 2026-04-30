import type { FastifyReply, FastifyRequest } from "fastify";
import {
  MAX_MESSAGE_SIZE_BYTES,
  PROTOCOL_VERSION,
  ProtocolError,
  sealEnvelope,
  serialiseError,
} from "@vswap/protocol";
import type {
  AnyMessage,
  PairRequest,
  PreflightRequest,
  RollbackRequest,
  SwapCommitRequest,
  SwapPayload,
} from "@vswap/protocol";
import { verifyEnvelope } from "../auth/signature.js";
import type { VerifiedRequest } from "../auth/signature.js";
import type { AgentRuntime } from "../runtime.js";
import { AgentError } from "../errors.js";

export const VSWAP_CONTENT_TYPE = "application/vswap+msgpack";

/**
 * Read a Fastify request body as a `Uint8Array`, verify the enclosing
 * signed envelope, and return the validated inner message. Aborts the
 * response with an appropriate status when any check fails.
 */
export async function parseSignedRequest(
  req: FastifyRequest,
  reply: FastifyReply,
  runtime: AgentRuntime,
  options: { allowUnpaired?: boolean } = {},
): Promise<VerifiedRequest | null> {
  // Fastify skips the content-type parser on GET requests, so
  // `req.body` is undefined there even though the client sent a
  // non-empty body. Fall back to draining the raw stream when needed.
  let body: unknown = req.body;
  if (
    (body === undefined || body === null) &&
    typeof req.raw.readable === "boolean"
  ) {
    try {
      body = await drainRawRequest(req);
    } catch (err) {
      await sendErrorEnvelope(reply, runtime, 400, {
        code: "MESSAGE_SCHEMA",
        message: `failed to read request body: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      return null;
    }
  }
  if (!(body instanceof Buffer) && !(body instanceof Uint8Array)) {
    await sendErrorEnvelope(reply, runtime, 400, {
      code: "MESSAGE_SCHEMA",
      message: "expected binary msgpack envelope body",
    });
    return null;
  }
  const bytes =
    body instanceof Buffer
      ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
      : body;
  try {
    const verified = await verifyEnvelope(bytes, {
      peers: runtime.peers,
      nonces: runtime.nonces,
      ...(options.allowUnpaired !== undefined
        ? { allowUnpaired: options.allowUnpaired }
        : {}),
    });
    return verified;
  } catch (err) {
    const status = mapErrorToStatus(err);
    await sendErrorEnvelope(reply, runtime, status, toSerialisable(err));
    return null;
  }
}

/**
 * Encode `message` into a signed envelope using the agent's long-term
 * signing key and send it as the response body with the vswap content
 * type.
 */
export async function sendSignedEnvelope(
  reply: FastifyReply,
  runtime: AgentRuntime,
  message: AnyMessage,
): Promise<void> {
  const envelope = await sealEnvelope(
    message,
    runtime.identity.secretKey,
    runtime.identity.publicKey,
  );
  await reply
    .code(200)
    .type(VSWAP_CONTENT_TYPE)
    .send(Buffer.from(envelope));
}

/**
 * Emit an error envelope (code + message) as the response. Used when
 * a request is malformed before business logic has a chance to run.
 */
export async function sendErrorEnvelope(
  reply: FastifyReply,
  runtime: AgentRuntime,
  status: number,
  error: {
    code: string;
    message: string;
    context?: Readonly<Record<string, unknown>>;
  },
  correlationId?: string,
): Promise<void> {
  const msg: AnyMessage = {
    type: "ErrorEnvelope",
    version: PROTOCOL_VERSION,
    nonce: randomNonce(),
    timestamp: Date.now(),
    correlationId: correlationId ?? crypto.randomUUID(),
    error: {
      code: normaliseCode(error.code),
      message: error.message,
      context: error.context ?? {},
    },
  };
  const envelope = await sealEnvelope(
    msg,
    runtime.identity.secretKey,
    runtime.identity.publicKey,
  );
  await reply
    .code(status)
    .type(VSWAP_CONTENT_TYPE)
    .send(Buffer.from(envelope));
}

/**
 * Convert an exception from route business logic into a signed error
 * envelope. This keeps the wire contract intact even when the failure
 * happens after request parsing, e.g. missing tower files during
 * `/swap/send`.
 */
export async function sendExceptionEnvelope(
  reply: FastifyReply,
  runtime: AgentRuntime,
  err: unknown,
  correlationId?: string,
): Promise<void> {
  await sendErrorEnvelope(
    reply,
    runtime,
    mapErrorToStatus(err),
    toSerialisable(err),
    correlationId,
  );
}

function normaliseCode(code: string): AnyMessageErrorCode {
  // ErrorEnvelope.error.code must be one of the enum values defined in
  // `@vswap/protocol`. Agent-specific codes are surfaced as a generic
  // protocol error with the original code placed into `context`.
  const protocolCodes: ReadonlySet<string> = new Set([
    "PROTOCOL_ERROR",
    "SIGNATURE_INVALID",
    "MESSAGE_SCHEMA",
    "REPLAY_DETECTED",
    "DECRYPTION_FAILED",
    "PUBKEY_MISMATCH",
    "TOWER_INVALID",
    "VERSION_MISMATCH",
    "PAYLOAD_TOO_LARGE",
  ]);
  return protocolCodes.has(code) ? (code as AnyMessageErrorCode) : "PROTOCOL_ERROR";
}

type AnyMessageErrorCode =
  | "PROTOCOL_ERROR"
  | "SIGNATURE_INVALID"
  | "MESSAGE_SCHEMA"
  | "REPLAY_DETECTED"
  | "DECRYPTION_FAILED"
  | "PUBKEY_MISMATCH"
  | "TOWER_INVALID"
  | "VERSION_MISMATCH"
  | "PAYLOAD_TOO_LARGE";

function mapErrorToStatus(err: unknown): number {
  if (err instanceof AgentError) return 400;
  if (err instanceof ProtocolError) {
    if (err.code === "SIGNATURE_INVALID" || err.code === "REPLAY_DETECTED") {
      return 401;
    }
    if (err.code === "PAYLOAD_TOO_LARGE") {
      return 413;
    }
    return 400;
  }
  return 500;
}

function toSerialisable(err: unknown): {
  code: string;
  message: string;
  context: Readonly<Record<string, unknown>>;
} {
  if (err instanceof ProtocolError) {
    return serialiseError(err);
  }
  return {
    code: "PROTOCOL_ERROR",
    message: err instanceof Error ? err.message : String(err),
    context: {},
  };
}

function randomNonce(): Uint8Array {
  const out = new Uint8Array(24);
  crypto.getRandomValues(out);
  return out;
}

/**
 * Drain the raw IncomingMessage into a single Buffer. Used as a
 * fallback on GET routes where fastify does not invoke the
 * content-type parser. Enforces the same ceiling as the Fastify
 * bodyLimit so a client cannot exhaust agent memory by streaming
 * an arbitrarily large body on `GET /status`.
 */
async function drainRawRequest(req: FastifyRequest): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.raw.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > MAX_MESSAGE_SIZE_BYTES) {
        req.raw.destroy();
        reject(new Error("request body exceeds MAX_MESSAGE_SIZE_BYTES"));
        return;
      }
      chunks.push(chunk);
    });
    req.raw.on("end", () => resolve(Buffer.concat(chunks)));
    req.raw.on("error", (err) => reject(err));
  });
}

/**
 * Narrowing helpers. `AnyMessage` from the protocol package does not
 * discriminate by `type` at the TypeScript level (its members are
 * inferred with `type: string` rather than `type: "X"`), so a simple
 * equality check never narrows. These guards bridge that gap — they
 * are sound because `parseMessage` has already validated each branch's
 * schema before this point.
 */
export function isPreflightRequest(m: AnyMessage): m is PreflightRequest {
  return m.type === "PreflightRequest";
}
export function isPairRequest(m: AnyMessage): m is PairRequest {
  return m.type === "PairRequest";
}
export function isSwapPayload(m: AnyMessage): m is SwapPayload {
  return m.type === "SwapPayload";
}
export function isSwapCommitRequest(m: AnyMessage): m is SwapCommitRequest {
  return m.type === "SwapCommitRequest";
}
export function isRollbackRequest(m: AnyMessage): m is RollbackRequest {
  return m.type === "RollbackRequest";
}
