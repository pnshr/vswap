import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers";
import {
  SessionSecretKey,
  generateSessionKeypair,
  openSealedBox,
  sealForRecipient,
} from "../src/crypto/sealed-box.js";
import { sodiumReady } from "../src/crypto/ready.js";
import {
  MAX_IDENTITY_PAYLOAD_BYTES,
  X25519_PUBLIC_KEY_BYTES,
  X25519_SECRET_KEY_BYTES,
} from "../src/constants.js";
import {
  DecryptionFailedError,
  PayloadTooLargeError,
} from "../src/errors.js";

describe("session keypair", () => {
  it("generates 32-byte X25519 public and secret keys", async () => {
    const kp = await generateSessionKeypair();
    expect(kp.publicKey.byteLength).toBe(X25519_PUBLIC_KEY_BYTES);
    expect(kp.secretKey.reveal().byteLength).toBe(X25519_SECRET_KEY_BYTES);
  });

  it("rejects wrong-length bytes when wrapping", () => {
    expect(() => new SessionSecretKey(new Uint8Array(16))).toThrow(RangeError);
  });

  it("redacts secret key in any string/JSON/inspect form", () => {
    const sk = new SessionSecretKey(new Uint8Array(X25519_SECRET_KEY_BYTES));
    expect(sk.toJSON()).toBe("[redacted]");
    expect(String(sk)).toBe("[redacted]");
    expect(JSON.stringify({ sk })).toBe('{"sk":"[redacted]"}');
    expect(inspect(sk)).toBe("[redacted]");
  });
});

describe("sealed-box round-trip", () => {
  it("encrypt → decrypt recovers the plaintext byte-for-byte", async () => {
    const kp = await generateSessionKeypair();
    const plaintext = new Uint8Array([1, 2, 3, 4, 5, 42, 99, 0, 255]);
    const ct = await sealForRecipient(plaintext, kp.publicKey);
    const decrypted = await openSealedBox(ct, kp.publicKey, kp.secretKey);
    expect(decrypted).toEqual(plaintext);
  });

  it("round-trips an empty plaintext", async () => {
    const kp = await generateSessionKeypair();
    const ct = await sealForRecipient(new Uint8Array(0), kp.publicKey);
    const pt = await openSealedBox(ct, kp.publicKey, kp.secretKey);
    expect(pt.byteLength).toBe(0);
  });
});

describe("sealed-box failure modes", () => {
  it("decrypting with the wrong secret key throws DecryptionFailedError", async () => {
    const alice = await generateSessionKeypair();
    const bob = await generateSessionKeypair();
    const ct = await sealForRecipient(new Uint8Array([1, 2, 3]), alice.publicKey);
    await expect(
      openSealedBox(ct, alice.publicKey, bob.secretKey),
    ).rejects.toBeInstanceOf(DecryptionFailedError);
  });

  it("tampering with the ciphertext causes decryption to fail", async () => {
    const kp = await generateSessionKeypair();
    const plaintext = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const ct = await sealForRecipient(plaintext, kp.publicKey);
    const tampered = new Uint8Array(ct);
    const mid = Math.floor(tampered.byteLength / 2);
    if (tampered[mid] === undefined) throw new Error("unreachable");
    tampered[mid] ^= 0x7f;
    await expect(
      openSealedBox(tampered, kp.publicKey, kp.secretKey),
    ).rejects.toBeInstanceOf(DecryptionFailedError);
  });

  it("plaintext larger than MAX_IDENTITY_PAYLOAD_BYTES is rejected before encryption", async () => {
    const kp = await generateSessionKeypair();
    const oversized = new Uint8Array(MAX_IDENTITY_PAYLOAD_BYTES + 1);
    await expect(sealForRecipient(oversized, kp.publicKey)).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
  });

  it("wrong-size recipient pubkey is rejected at seal time", async () => {
    await expect(
      sealForRecipient(new Uint8Array([1, 2, 3]), new Uint8Array(10)),
    ).rejects.toBeInstanceOf(DecryptionFailedError);
  });

  it("wrong-size recipient pubkey is rejected at open time", async () => {
    const kp = await generateSessionKeypair();
    const ct = await sealForRecipient(new Uint8Array([1, 2, 3]), kp.publicKey);
    await expect(
      openSealedBox(ct, new Uint8Array(10), kp.secretKey),
    ).rejects.toBeInstanceOf(DecryptionFailedError);
  });

  it("accepts a boundary-sized plaintext equal to MAX_IDENTITY_PAYLOAD_BYTES", async () => {
    const kp = await generateSessionKeypair();
    const boundary = new Uint8Array(MAX_IDENTITY_PAYLOAD_BYTES);
    const ct = await sealForRecipient(boundary, kp.publicKey);
    const pt = await openSealedBox(ct, kp.publicKey, kp.secretKey);
    expect(pt.byteLength).toBe(boundary.byteLength);
  });

  it("rejects an oversized plaintext on open (when seal is bypassed)", async () => {
    await sodiumReady();
    const kp = await generateSessionKeypair();
    const oversized = new Uint8Array(MAX_IDENTITY_PAYLOAD_BYTES + 1);
    // Bypass our in-module size check by calling libsodium directly, so we
    // can exercise openSealedBox's own post-decrypt size guard.
    const rawCiphertext = new Uint8Array(
      sodium.crypto_box_seal(oversized, kp.publicKey),
    );
    await expect(
      openSealedBox(rawCiphertext, kp.publicKey, kp.secretKey),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });
});
