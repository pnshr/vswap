import { readFile, stat } from "node:fs/promises";
import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SECRET_KEY_BYTES,
  SigningSecretKey,
  deriveEd25519PublicKey,
} from "@vswap/protocol";
import type { ConfigPaths } from "./paths.js";
import { encodeBase58 } from "../util/base58.js";

export interface LoadedClientIdentity {
  readonly secretKey: SigningSecretKey;
  readonly publicKey: Uint8Array;
  readonly publicKeyBase58: string;
}

export interface LoadedClientTls {
  readonly clientCert: Buffer;
  readonly clientKey: Buffer;
  readonly caCert: Buffer;
}

export interface LoadedClientConfig {
  readonly paths: ConfigPaths;
  readonly identity: LoadedClientIdentity;
  readonly tls: LoadedClientTls;
}

/**
 * Read and validate every artifact under {@link ConfigPaths}. Throws
 * with a path-aware error message when anything is missing or
 * malformed — these are the cases where `vswap init` is the right next
 * step.
 */
export async function loadClientConfig(
  paths: ConfigPaths,
): Promise<LoadedClientConfig> {
  await ensureExists(paths.root, "config root", "vswap init");
  const identity = await loadIdentity(paths);
  const tls = await loadTls(paths);
  return { paths, identity, tls };
}

async function loadIdentity(paths: ConfigPaths): Promise<LoadedClientIdentity> {
  const secretRaw = await readFile(paths.clientSecretKey);
  if (secretRaw.byteLength !== ED25519_SECRET_KEY_BYTES) {
    throw new Error(
      `client secret key at ${paths.clientSecretKey} must be ${ED25519_SECRET_KEY_BYTES} ` +
        `bytes, got ${secretRaw.byteLength}`,
    );
  }
  const secretBytes = new Uint8Array(
    secretRaw.buffer,
    secretRaw.byteOffset,
    secretRaw.byteLength,
  );
  const derived = await deriveEd25519PublicKey(secretBytes);
  const pubRaw = await readFile(paths.clientPublicKey);
  if (pubRaw.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
    throw new Error(
      `client public key at ${paths.clientPublicKey} must be ${ED25519_PUBLIC_KEY_BYTES} ` +
        `bytes, got ${pubRaw.byteLength}`,
    );
  }
  const pubBytes = new Uint8Array(pubRaw.buffer, pubRaw.byteOffset, pubRaw.byteLength);
  let diff = 0;
  for (let i = 0; i < pubBytes.byteLength; i++) {
    diff |= (pubBytes[i] ?? 0) ^ (derived[i] ?? 0);
  }
  if (diff !== 0) {
    throw new Error(
      `long-term signing key at ${paths.clientSecretKey} does not derive to the public key ` +
        `at ${paths.clientPublicKey}; re-run \`vswap init --force\` to regenerate both`,
    );
  }
  return {
    secretKey: new SigningSecretKey(secretBytes),
    publicKey: pubBytes,
    publicKeyBase58: encodeBase58(pubBytes),
  };
}

async function loadTls(paths: ConfigPaths): Promise<LoadedClientTls> {
  const [clientCert, clientKey, caCert] = await Promise.all([
    readFile(paths.clientCert),
    readFile(paths.clientKey),
    readFile(paths.caCert),
  ]);
  return { clientCert, clientKey, caCert };
}

async function ensureExists(
  path: string,
  what: string,
  hint: string,
): Promise<void> {
  try {
    await stat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${what} at ${path} does not exist; run \`${hint}\` first`);
    }
    throw err;
  }
}
