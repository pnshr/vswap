import { sodiumReady } from "./ready.js";
import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SECRET_KEY_BYTES,
} from "../constants.js";

/**
 * Recover the 32-byte Ed25519 public key from a 64-byte libsodium
 * "full" secret key.
 *
 * libsodium encodes the secret key as `seed || public_key` (NaCl
 * convention), so the trailing 32 bytes are the canonical public key.
 * Slicing is stable across libsodium-wrappers versions; some of them do
 * not export `crypto_sign_ed25519_sk_to_pk` at all.
 */
export async function deriveEd25519PublicKey(
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  await sodiumReady();
  if (secretKey.byteLength !== ED25519_SECRET_KEY_BYTES) {
    throw new RangeError(
      `ed25519 secret key must be ${ED25519_SECRET_KEY_BYTES} bytes, got ${secretKey.byteLength}`,
    );
  }
  return new Uint8Array(
    secretKey.slice(
      ED25519_SECRET_KEY_BYTES - ED25519_PUBLIC_KEY_BYTES,
      ED25519_SECRET_KEY_BYTES,
    ),
  );
}
