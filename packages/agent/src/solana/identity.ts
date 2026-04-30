import { readFile, stat } from "node:fs/promises";
import {
  ED25519_SECRET_KEY_BYTES,
  deriveEd25519PublicKey,
} from "@vswap/protocol";
import {
  IdentityPubkeyMismatchError,
  KeyfilePermissionsUnsafeError,
} from "../errors.js";
import { encodeBase58 } from "./base58.js";

/**
 * Shape of a parsed Solana identity keypair. `secretKey` is the full
 * 64-byte libsodium layout (seed || pubkey). Callers must scrub the
 * buffer as soon as it is no longer needed.
 */
export interface IdentityKeypair {
  readonly secretKey: Uint8Array;
  readonly publicKey: string;
}

/**
 * Read a Solana CLI-format keypair file (JSON array of 64 uint8
 * values). Throws on permission issues, non-array content, wrong
 * length, or out-of-range bytes.
 */
export async function readKeypairFile(path: string): Promise<IdentityKeypair> {
  const info = await stat(path);
  const otherBits = info.mode & 0o077;
  if (otherBits !== 0) {
    throw new KeyfilePermissionsUnsafeError({
      path,
      mode: (info.mode & 0o777).toString(8),
    });
  }
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new IdentityPubkeyMismatchError({
      path,
      cause: "file is not valid JSON",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  if (!Array.isArray(parsed)) {
    throw new IdentityPubkeyMismatchError({
      path,
      cause: "keypair file is not a JSON array",
    });
  }
  const arr: unknown[] = parsed;
  if (arr.length !== ED25519_SECRET_KEY_BYTES) {
    throw new IdentityPubkeyMismatchError({
      path,
      cause: `expected ${ED25519_SECRET_KEY_BYTES.toString()} bytes, got ${arr.length.toString()}`,
    });
  }
  const bytes = new Uint8Array(ED25519_SECRET_KEY_BYTES);
  for (let i = 0; i < ED25519_SECRET_KEY_BYTES; i++) {
    const v = arr[i];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 255) {
      throw new IdentityPubkeyMismatchError({
        path,
        cause: `keypair byte at index ${i.toString()} is out of range`,
      });
    }
    bytes[i] = v;
  }
  const pub = await deriveEd25519PublicKey(bytes);
  return { secretKey: bytes, publicKey: encodeBase58(pub) };
}

/**
 * Throw {@link IdentityPubkeyMismatchError} when the derived pubkey of
 * `keypair` does not match `expectedPubkey`. Does not touch the secret
 * bytes.
 */
export function verifyKeypairMatchesPubkey(
  keypair: IdentityKeypair,
  expectedPubkey: string,
): void {
  if (keypair.publicKey !== expectedPubkey) {
    throw new IdentityPubkeyMismatchError({
      expectedPubkey,
      actualPubkey: keypair.publicKey,
    });
  }
}

/** Convenience: derive the base58 pubkey from the 64-byte secret. */
export async function derivePubkeyBase58(
  secretKey: Uint8Array,
): Promise<string> {
  const pub = await deriveEd25519PublicKey(secretKey);
  return encodeBase58(pub);
}
