import sodium from "libsodium-wrappers";
import { sodiumReady } from "./ready.js";
import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SECRET_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
} from "../constants.js";

/** Opaque wrapper around a long-term Ed25519 secret key. */
export class SigningSecretKey {
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    if (bytes.byteLength !== ED25519_SECRET_KEY_BYTES) {
      throw new RangeError(
        `signing secret key must be ${ED25519_SECRET_KEY_BYTES} bytes, got ${bytes.byteLength}`,
      );
    }
    this.#bytes = new Uint8Array(bytes);
  }

  /** Return the underlying bytes. Handle with care. */
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

export interface SigningKeypair {
  readonly publicKey: Uint8Array;
  readonly secretKey: SigningSecretKey;
}

/** Generate a fresh Ed25519 long-term keypair. */
export async function generateSigningKeypair(): Promise<SigningKeypair> {
  await sodiumReady();
  const kp = sodium.crypto_sign_keypair();
  return {
    publicKey: new Uint8Array(kp.publicKey),
    secretKey: new SigningSecretKey(new Uint8Array(kp.privateKey)),
  };
}

/**
 * Produce a detached Ed25519 signature over `message` using `secretKey`.
 * The output is exactly {@link ED25519_SIGNATURE_BYTES} bytes long.
 */
export async function signDetached(
  message: Uint8Array,
  secretKey: SigningSecretKey,
): Promise<Uint8Array> {
  await sodiumReady();
  const sig = sodium.crypto_sign_detached(message, secretKey.reveal());
  return new Uint8Array(sig);
}

/**
 * Verify a detached Ed25519 signature. Returns `true` iff the signature
 * is valid for `message` under `publicKey`. Wrong-size inputs return
 * `false` without consulting libsodium.
 */
export async function verifyDetached(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  await sodiumReady();
  if (
    signature.byteLength !== ED25519_SIGNATURE_BYTES ||
    publicKey.byteLength !== ED25519_PUBLIC_KEY_BYTES
  ) {
    return false;
  }
  return sodium.crypto_sign_verify_detached(signature, message, publicKey);
}
