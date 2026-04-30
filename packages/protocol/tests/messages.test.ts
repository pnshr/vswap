import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  anyMessageSchema,
  parseMessage,
  preflightRequestSchema,
  pairResponseSchema,
  swapCompletedSchema,
  swapFailedSchema,
  swapPayloadSchema,
  swapProgressEventSchema,
  swapSessionInitSchema,
  type AnyMessage,
} from "../src/messages.js";
import {
  ED25519_PUBLIC_KEY_BYTES,
  NONCE_BYTES,
  PROTOCOL_VERSION,
  X25519_PUBLIC_KEY_BYTES,
} from "../src/constants.js";
import {
  ErrorCode,
  MessageSchemaError,
  VersionMismatchError,
} from "../src/errors.js";

function baseFields(): {
  version: string;
  nonce: Uint8Array;
  timestamp: number;
  correlationId: string;
} {
  return {
    version: PROTOCOL_VERSION,
    nonce: new Uint8Array(NONCE_BYTES),
    timestamp: Date.now(),
    correlationId: randomUUID(),
  };
}

function samples(): AnyMessage[] {
  const sessionId = randomUUID();
  return [
    {
      type: "PreflightRequest",
      ...baseFields(),
      agentVersion: "0.1.0",
      capabilities: ["setIdentityFromBytes", "contactInfo"],
    },
    {
      type: "PreflightResponse",
      ...baseFields(),
      agentVersion: "0.1.0",
      capabilities: ["setIdentityFromBytes"],
      startProgress: "Running",
    },
    {
      type: "PairRequest",
      ...baseFields(),
      senderLongTermPubkey: new Uint8Array(ED25519_PUBLIC_KEY_BYTES),
    },
    {
      type: "PairResponse",
      ...baseFields(),
      senderLongTermPubkey: new Uint8Array(ED25519_PUBLIC_KEY_BYTES),
      acknowledgedPubkey: new Uint8Array(ED25519_PUBLIC_KEY_BYTES),
    },
    {
      type: "SwapSessionInit",
      ...baseFields(),
      sessionId,
      sessionPubkey: new Uint8Array(X25519_PUBLIC_KEY_BYTES),
      sessionExpiresAt: Date.now() + 300_000,
    },
    {
      type: "SwapPayload",
      ...baseFields(),
      sessionId,
      recipientSessionPubkey: new Uint8Array(X25519_PUBLIC_KEY_BYTES),
      ciphertext: new Uint8Array([1, 2, 3, 4, 5]),
    },
    {
      type: "SwapCommitRequest",
      ...baseFields(),
      sessionId,
      requireTower: true,
    },
    {
      type: "SwapProgressEvent",
      ...baseFields(),
      sessionId,
      phase: "activate",
      detail: "setIdentityFromBytes accepted",
      slot: 12345,
    },
    {
      type: "SwapCompleted",
      ...baseFields(),
      sessionId,
      finalIdentityPubkey: new Uint8Array(ED25519_PUBLIC_KEY_BYTES),
      durationMs: 2100,
    },
    {
      type: "SwapFailed",
      ...baseFields(),
      sessionId,
      phase: "ship-tower",
      error: {
        code: ErrorCode.TowerInvalid,
        message: "signature on the saved tower is invalid",
        context: { pubkeySize: 32 },
      },
    },
    {
      type: "RollbackRequest",
      ...baseFields(),
      sessionId,
      reason: "health-check failed on target",
    },
    {
      type: "ErrorEnvelope",
      ...baseFields(),
      error: {
        code: ErrorCode.ReplayDetected,
        message: "nonce already seen",
        context: {},
      },
    },
  ];
}

describe("messages — positive round-trip", () => {
  for (const sample of samples()) {
    it(`accepts a valid ${sample.type}`, () => {
      const parsed = parseMessage(sample);
      expect(parsed.type).toBe(sample.type);
      expect(parsed).toEqual(sample);
    });
  }

  it("samples() covers every discriminator from the union schema", () => {
    const unionTypes = new Set(
      anyMessageSchema.options.map((o) => o.shape.type.value),
    );
    const sampleTypes = new Set(samples().map((s) => s.type));
    expect(sampleTypes).toEqual(unionTypes);
  });
});

describe("messages — negative cases", () => {
  it("rejects a missing required field via MessageSchemaError", () => {
    const bad: Record<string, unknown> = {
      type: "PreflightRequest",
      ...baseFields(),
      // missing agentVersion
      capabilities: [],
    };
    expect(() => parseMessage(bad)).toThrow(MessageSchemaError);
  });

  it("rejects an unknown field in strict mode", () => {
    const bad: Record<string, unknown> = {
      type: "PreflightRequest",
      ...baseFields(),
      agentVersion: "0.1.0",
      capabilities: [],
      extraField: "nope",
    };
    expect(() => parseMessage(bad)).toThrow(MessageSchemaError);
  });

  it("rejects an unknown `type` discriminator", () => {
    const bad: Record<string, unknown> = {
      type: "TotallyMadeUp",
      ...baseFields(),
    };
    expect(() => parseMessage(bad)).toThrow(MessageSchemaError);
  });

  it("rejects a nonce of wrong length", () => {
    const base = baseFields();
    const bad: Record<string, unknown> = {
      type: "PreflightRequest",
      version: base.version,
      nonce: new Uint8Array(NONCE_BYTES - 1),
      timestamp: base.timestamp,
      correlationId: base.correlationId,
      agentVersion: "0.1.0",
      capabilities: [],
    };
    expect(() => parseMessage(bad)).toThrow(MessageSchemaError);
  });

  it("rejects a non-UUID correlationId", () => {
    const base = baseFields();
    const bad: Record<string, unknown> = {
      type: "PreflightRequest",
      version: base.version,
      nonce: base.nonce,
      timestamp: base.timestamp,
      correlationId: "not-a-uuid",
      agentVersion: "0.1.0",
      capabilities: [],
    };
    expect(() => parseMessage(bad)).toThrow(MessageSchemaError);
  });

  it("raises VersionMismatchError on a mismatched version string", () => {
    const bad: AnyMessage = {
      type: "PreflightRequest",
      ...baseFields(),
      version: "9.9.9",
      agentVersion: "x",
      capabilities: [],
    };
    expect(() => parseMessage(bad)).toThrow(VersionMismatchError);
  });

  it("raises MessageSchemaError when input is not an object", () => {
    expect(() => parseMessage(null)).toThrow(MessageSchemaError);
    expect(() => parseMessage(42)).toThrow(MessageSchemaError);
  });
});

describe("messages — direct schema spot checks", () => {
  it("preflightRequestSchema is strict (unknown field rejected)", () => {
    const res = preflightRequestSchema.safeParse({
      type: "PreflightRequest",
      ...baseFields(),
      agentVersion: "0.1.0",
      capabilities: [],
      extra: 1,
    });
    expect(res.success).toBe(false);
  });

  it("swapPayloadSchema rejects an overly large ciphertext", () => {
    const res = swapPayloadSchema.safeParse({
      type: "SwapPayload",
      ...baseFields(),
      sessionId: randomUUID(),
      recipientSessionPubkey: new Uint8Array(X25519_PUBLIC_KEY_BYTES),
      ciphertext: new Uint8Array(200_001),
    });
    expect(res.success).toBe(false);
  });

  it("swapProgressEventSchema enforces a known phase enum", () => {
    const res = swapProgressEventSchema.safeParse({
      type: "SwapProgressEvent",
      ...baseFields(),
      sessionId: randomUUID(),
      phase: "unknown-phase",
      detail: "x",
    });
    expect(res.success).toBe(false);
  });

  it("swapSessionInitSchema enforces pubkey length", () => {
    const res = swapSessionInitSchema.safeParse({
      type: "SwapSessionInit",
      ...baseFields(),
      sessionId: randomUUID(),
      sessionPubkey: new Uint8Array(X25519_PUBLIC_KEY_BYTES - 1),
      sessionExpiresAt: 0,
    });
    expect(res.success).toBe(false);
  });

  it("swapCompletedSchema enforces pubkey length", () => {
    const res = swapCompletedSchema.safeParse({
      type: "SwapCompleted",
      ...baseFields(),
      sessionId: randomUUID(),
      finalIdentityPubkey: new Uint8Array(ED25519_PUBLIC_KEY_BYTES - 1),
      durationMs: 0,
    });
    expect(res.success).toBe(false);
  });

  it("pairResponseSchema accepts and round-trips an optional validatorVersion", () => {
    const sample = {
      type: "PairResponse" as const,
      ...baseFields(),
      senderLongTermPubkey: new Uint8Array(ED25519_PUBLIC_KEY_BYTES),
      acknowledgedPubkey: new Uint8Array(ED25519_PUBLIC_KEY_BYTES),
      validatorVersion: "agave-validator 3.1.14 (src:00000000; feat:0)",
    };
    const parsed = pairResponseSchema.parse(sample);
    expect(parsed.validatorVersion).toBe(sample.validatorVersion);
  });

  it("pairResponseSchema accepts a PairResponse without validatorVersion (older agents)", () => {
    const sample = {
      type: "PairResponse" as const,
      ...baseFields(),
      senderLongTermPubkey: new Uint8Array(ED25519_PUBLIC_KEY_BYTES),
      acknowledgedPubkey: new Uint8Array(ED25519_PUBLIC_KEY_BYTES),
    };
    const parsed = pairResponseSchema.parse(sample);
    expect(parsed.validatorVersion).toBeUndefined();
  });

  it("pairResponseSchema rejects an oversize validatorVersion (>256 chars)", () => {
    const res = pairResponseSchema.safeParse({
      type: "PairResponse" as const,
      ...baseFields(),
      senderLongTermPubkey: new Uint8Array(ED25519_PUBLIC_KEY_BYTES),
      acknowledgedPubkey: new Uint8Array(ED25519_PUBLIC_KEY_BYTES),
      validatorVersion: "x".repeat(257),
    });
    expect(res.success).toBe(false);
  });

  it("swapFailedSchema requires a SerialisedError shape", () => {
    const res = swapFailedSchema.safeParse({
      type: "SwapFailed",
      ...baseFields(),
      sessionId: randomUUID(),
      phase: "cleanup",
      error: { code: "NOT_A_REAL_CODE", message: "x", context: {} },
    });
    expect(res.success).toBe(false);
  });
});
