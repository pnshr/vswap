import sodium from "libsodium-wrappers";
import { sodiumReady } from "./ready.js";
import {
  MAX_IDENTITY_PAYLOAD_BYTES,
  X25519_PUBLIC_KEY_BYTES,
  X25519_SECRET_KEY_BYTES,
} from "../constants.js";
import {
  DecryptionFailedError,
  PayloadTooLargeError,
} from "../errors.js";

/** Opaque wrapper around an X25519 session secret key. */
export class SessionSecretKey {
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    if (bytes.byteLength !== X25519_SECRET_KEY_BYTES) {
      throw new RangeError(
        `session secret key must be ${X25519_SECRET_KEY_BYTES} bytes, got ${bytes.byteLength}`,
      );
    }
    this.#bytes = new Uint8Array(bytes);
  }

  reveal(): Uint8Array {
    return this.#bytes;
  }

  toJSON(): string {
    return "[redacted]";
  }

  toString(): string {
    return "[redacted]";
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[redacted]";
  }
}

export interface SessionKeypair {
  readonly publicKey: Uint8Array;
  readonly secretKey: SessionSecretKey;
}

/**
 * Generate a fresh X25519 ephemeral session keypair. The receiver
 * publishes `publicKey` to the sender and keeps `secretKey` private.
 */
export async function generateSessionKeypair(): Promise<SessionKeypair> {
  await sodiumReady();
  const kp = sodium.crypto_box_keypair();
  return {
    publicKey: new Uint8Array(kp.publicKey),
    secretKey: new SessionSecretKey(new Uint8Array(kp.privateKey)),
  };
}

/**
 * Seal `plaintext` against a recipient's X25519 public key. Uses
 * libsodium's `crypto_box_seal`, which derives an ephemeral sender
 * keypair internally so the ciphertext is anonymous.
 *
 * Throws {@link PayloadTooLargeError} when the plaintext exceeds
 * {@link MAX_IDENTITY_PAYLOAD_BYTES}.
 */
export async function sealForRecipient(
  plaintext: Uint8Array,
  recipientPubkey: Uint8Array,
): Promise<Uint8Array> {
  await sodiumReady();
  if (plaintext.byteLength > MAX_IDENTITY_PAYLOAD_BYTES) {
    throw new PayloadTooLargeError("sealed-box plaintext exceeds maximum", {
      size: plaintext.byteLength,
      max: MAX_IDENTITY_PAYLOAD_BYTES,
    });
  }
  if (recipientPubkey.byteLength !== X25519_PUBLIC_KEY_BYTES) {
    throw new DecryptionFailedError("recipient pubkey has wrong length", {
      size: recipientPubkey.byteLength,
      expected: X25519_PUBLIC_KEY_BYTES,
    });
  }
  const ct = sodium.crypto_box_seal(plaintext, recipientPubkey);
  return new Uint8Array(ct);
}

/**
 * Open a sealed box. The recipient's X25519 keypair (public + secret)
 * is required because `crypto_box_seal_open` takes both.
 *
 * Throws {@link DecryptionFailedError} on any failure (wrong key,
 * tampered ciphertext, wrong sizes) — the underlying libsodium error
 * message is discarded to avoid leaking key material via error text.
 *
 * Throws {@link PayloadTooLargeError} if the recovered plaintext is
 * larger than {@link MAX_IDENTITY_PAYLOAD_BYTES}.
 */
export async function openSealedBox(
  ciphertext: Uint8Array,
  recipientPubkey: Uint8Array,
  recipientSecretKey: SessionSecretKey,
): Promise<Uint8Array> {
  await sodiumReady();
  if (recipientPubkey.byteLength !== X25519_PUBLIC_KEY_BYTES) {
    throw new DecryptionFailedError("recipient pubkey has wrong length", {
      size: recipientPubkey.byteLength,
      expected: X25519_PUBLIC_KEY_BYTES,
    });
  }
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      sodium.crypto_box_seal_open(
        ciphertext,
        recipientPubkey,
        recipientSecretKey.reveal(),
      ),
    );
  } catch {
    throw new DecryptionFailedError("sealed box could not be opened", {
      ciphertextSize: ciphertext.byteLength,
    });
  }
  if (plaintext.byteLength > MAX_IDENTITY_PAYLOAD_BYTES) {
    throw new PayloadTooLargeError("sealed-box plaintext exceeds maximum", {
      size: plaintext.byteLength,
      max: MAX_IDENTITY_PAYLOAD_BYTES,
    });
  }
  return plaintext;
}
