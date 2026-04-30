import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_SIZE_BYTES,
  NONCE_BYTES,
  PROTOCOL_VERSION,
} from "../src/constants.js";
import {
  MessageSchemaError,
  PayloadTooLargeError,
  SignatureInvalidError,
  VersionMismatchError,
} from "../src/errors.js";
import {
  openEnvelope,
  sealEnvelope,
} from "../src/envelope.js";
import {
  generateSigningKeypair,
} from "../src/crypto/signing.js";
import { decode, encode } from "../src/wire.js";
import { type PreflightRequest } from "../src/messages.js";

function preflight(agentVersion = "0.1.0"): PreflightRequest {
  return {
    type: "PreflightRequest",
    version: PROTOCOL_VERSION,
    nonce: new Uint8Array(NONCE_BYTES),
    timestamp: Date.now(),
    correlationId: randomUUID(),
    agentVersion,
    capabilities: ["setIdentityFromBytes"],
  };
}

describe("envelope round-trip", () => {
  it("seal → open yields the original message and the sender pubkey", async () => {
    const kp = await generateSigningKeypair();
    const message = preflight();
    const sealed = await sealEnvelope(message, kp.secretKey, kp.publicKey);
    const opened = await openEnvelope(sealed);
    expect(opened.message).toEqual(message);
    expect(opened.senderPubkey).toEqual(kp.publicKey);
  });

  it("accepts a matching expectedSenderPubkey", async () => {
    const kp = await generateSigningKeypair();
    const message = preflight();
    const sealed = await sealEnvelope(message, kp.secretKey, kp.publicKey);
    const opened = await openEnvelope(sealed, kp.publicKey);
    expect(opened.message.type).toBe("PreflightRequest");
  });
});

describe("envelope failure modes", () => {
  it("rejects a mismatched expectedSenderPubkey", async () => {
    const kpA = await generateSigningKeypair();
    const kpB = await generateSigningKeypair();
    const sealed = await sealEnvelope(preflight(), kpA.secretKey, kpA.publicKey);
    await expect(openEnvelope(sealed, kpB.publicKey)).rejects.toBeInstanceOf(
      SignatureInvalidError,
    );
  });

  it("rejects envelope with tampered payload (signature fails)", async () => {
    const kp = await generateSigningKeypair();
    const sealed = await sealEnvelope(preflight(), kp.secretKey, kp.publicKey);

    // Decode, tamper payload by one byte, re-encode.
    const env = decode(sealed) as {
      payload: Uint8Array;
      senderPubkey: Uint8Array;
      signature: Uint8Array;
    };
    const tamperedPayload = new Uint8Array(env.payload);
    if (tamperedPayload[0] === undefined) throw new Error("unreachable");
    tamperedPayload[0] ^= 0x01;
    const tamperedEnvelope = encode({
      payload: tamperedPayload,
      senderPubkey: env.senderPubkey,
      signature: env.signature,
    });
    await expect(openEnvelope(tamperedEnvelope)).rejects.toBeInstanceOf(
      SignatureInvalidError,
    );
  });

  it("rejects an envelope whose inner payload encodes an unknown message type", async () => {
    const kp = await generateSigningKeypair();
    const bogusInner = encode({
      type: "NotARealType",
      version: PROTOCOL_VERSION,
      nonce: new Uint8Array(NONCE_BYTES),
      timestamp: Date.now(),
      correlationId: randomUUID(),
    });
    const signature = await (await import("../src/crypto/signing.js")).signDetached(
      bogusInner,
      kp.secretKey,
    );
    const sealed = encode({
      payload: bogusInner,
      senderPubkey: kp.publicKey,
      signature,
    });
    await expect(openEnvelope(sealed)).rejects.toBeInstanceOf(MessageSchemaError);
  });

  it("rejects an envelope whose inner payload has a mismatched protocol version", async () => {
    const kp = await generateSigningKeypair();
    const mismatched = {
      type: "PreflightRequest" as const,
      version: "9.9.9",
      nonce: new Uint8Array(NONCE_BYTES),
      timestamp: Date.now(),
      correlationId: randomUUID(),
      agentVersion: "0.1.0",
      capabilities: [],
    };
    const innerPayload = encode(mismatched);
    const signature = await (await import("../src/crypto/signing.js")).signDetached(
      innerPayload,
      kp.secretKey,
    );
    const sealed = encode({
      payload: innerPayload,
      senderPubkey: kp.publicKey,
      signature,
    });
    await expect(openEnvelope(sealed)).rejects.toBeInstanceOf(VersionMismatchError);
  });

  it("rejects an envelope whose outer structure is invalid (wrong signature length)", async () => {
    const bogus = encode({
      payload: new Uint8Array([1, 2, 3]),
      senderPubkey: new Uint8Array(32),
      signature: new Uint8Array(10),
    });
    await expect(openEnvelope(bogus)).rejects.toBeInstanceOf(MessageSchemaError);
  });

  it("rejects envelope bytes larger than MAX_MESSAGE_SIZE_BYTES", async () => {
    const tooBig = new Uint8Array(MAX_MESSAGE_SIZE_BYTES + 1);
    await expect(openEnvelope(tooBig)).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
  });

  it("sealEnvelope rejects a wrong-size senderPubkey", async () => {
    const kp = await generateSigningKeypair();
    await expect(
      sealEnvelope(preflight(), kp.secretKey, new Uint8Array(10)),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
