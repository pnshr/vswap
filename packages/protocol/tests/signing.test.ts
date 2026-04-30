import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  SigningSecretKey,
  generateSigningKeypair,
  signDetached,
  verifyDetached,
} from "../src/crypto/signing.js";
import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SECRET_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
} from "../src/constants.js";
import { deriveEd25519PublicKey } from "../src/crypto/keygen.js";

describe("signing keypair", () => {
  it("generates a 32-byte public key and 64-byte secret key", async () => {
    const kp = await generateSigningKeypair();
    expect(kp.publicKey.byteLength).toBe(ED25519_PUBLIC_KEY_BYTES);
    expect(kp.secretKey.reveal().byteLength).toBe(ED25519_SECRET_KEY_BYTES);
  });

  it("derived public key matches the one embedded in the secret key", async () => {
    const kp = await generateSigningKeypair();
    const derived = await deriveEd25519PublicKey(kp.secretKey.reveal());
    expect(derived).toEqual(kp.publicKey);
  });

  it("rejects wrong-length bytes when wrapping", () => {
    expect(() => new SigningSecretKey(new Uint8Array(32))).toThrow(RangeError);
  });

  it("redacts secret key in any string/JSON/inspect form", () => {
    const sk = new SigningSecretKey(new Uint8Array(ED25519_SECRET_KEY_BYTES));
    expect(sk.toJSON()).toBe("[redacted]");
    expect(String(sk)).toBe("[redacted]");
    expect(JSON.stringify({ sk })).toBe('{"sk":"[redacted]"}');
    expect(inspect(sk)).toBe("[redacted]");
  });
});

describe("signDetached / verifyDetached", () => {
  it("produces a 64-byte signature that verifies for the right message+pubkey", async () => {
    const kp = await generateSigningKeypair();
    const msg = new TextEncoder().encode("hello vswap");
    const sig = await signDetached(msg, kp.secretKey);
    expect(sig.byteLength).toBe(ED25519_SIGNATURE_BYTES);
    expect(await verifyDetached(sig, msg, kp.publicKey)).toBe(true);
  });

  it("fails to verify if the payload is tampered", async () => {
    const kp = await generateSigningKeypair();
    const msg = new TextEncoder().encode("the quick brown fox");
    const sig = await signDetached(msg, kp.secretKey);

    const tampered = new Uint8Array(msg);
    if (tampered[0] === undefined) throw new Error("unreachable");
    tampered[0] ^= 0x01;
    expect(await verifyDetached(sig, tampered, kp.publicKey)).toBe(false);
  });

  it("fails to verify under the wrong pubkey", async () => {
    const kpA = await generateSigningKeypair();
    const kpB = await generateSigningKeypair();
    const msg = new TextEncoder().encode("message");
    const sig = await signDetached(msg, kpA.secretKey);
    expect(await verifyDetached(sig, msg, kpB.publicKey)).toBe(false);
  });

  it("handles a zero-length message round-trip", async () => {
    const kp = await generateSigningKeypair();
    const msg = new Uint8Array(0);
    const sig = await signDetached(msg, kp.secretKey);
    expect(await verifyDetached(sig, msg, kp.publicKey)).toBe(true);
  });

  it("returns false for wrong-sized signature or pubkey (does not throw)", async () => {
    const kp = await generateSigningKeypair();
    const msg = new TextEncoder().encode("x");
    const sig = await signDetached(msg, kp.secretKey);

    expect(await verifyDetached(new Uint8Array(10), msg, kp.publicKey)).toBe(false);
    expect(await verifyDetached(sig, msg, new Uint8Array(10))).toBe(false);
  });
});

describe("deriveEd25519PublicKey", () => {
  it("rejects wrong-length input", async () => {
    await expect(deriveEd25519PublicKey(new Uint8Array(32))).rejects.toThrow(
      RangeError,
    );
  });
});
