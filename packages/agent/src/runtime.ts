import { readFile } from "node:fs/promises";
import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SECRET_KEY_BYTES,
  SigningSecretKey,
  deriveEd25519PublicKey,
} from "@vswap/protocol";
import type { Logger } from "pino";
import type { AgentConfig } from "./config.js";
import { AdminRpcClient } from "./solana/admin-rpc.js";
import { ValidatorCli } from "./solana/cli.js";
import { NonceCache } from "./auth/nonce-cache.js";
import { PeerStore } from "./storage/config-store.js";
import { ProgressBus } from "./services/progress-bus.js";
import { TargetSessionStore } from "./services/swap-target.js";
import { ConfigInvalidError, IdentityPubkeyMismatchError } from "./errors.js";
import { encodeBase58 } from "./solana/base58.js";
import { join } from "node:path";

export interface LongTermIdentity {
  readonly secretKey: SigningSecretKey;
  readonly publicKey: Uint8Array;
  readonly publicKeyBase58: string;
}

/**
 * Bundle of singletons that every route depends on. Constructed once
 * at boot and passed into `createServer`.
 */
export interface AgentRuntime {
  readonly config: AgentConfig;
  readonly logger: Logger;
  readonly rpc: AdminRpcClient;
  readonly cli: ValidatorCli;
  readonly nonces: NonceCache;
  readonly peers: PeerStore;
  readonly progress: ProgressBus;
  readonly sessions: TargetSessionStore;
  readonly identity: LongTermIdentity;
  /**
   * Best-effort `agave-validator --version` snapshot, captured once at
   * boot. Reported back to the operator in `PairResponse` so the CLI
   * can flag versions outside the tested matrix
   * (docs/supported-versions.md). `null` if the probe failed (binary
   * missing, timeout, etc.); the agent does NOT gate on this string.
   */
  readonly validatorVersion: string | null;
}

export interface BuildRuntimeOptions {
  readonly config: AgentConfig;
  readonly logger: Logger;
}

/**
 * Build a fully-wired {@link AgentRuntime}. Reads the agent's
 * long-term signing key + public key, opens the peer store, and
 * restores the nonce cache.
 */
export async function buildRuntime(
  opts: BuildRuntimeOptions,
): Promise<AgentRuntime> {
  const identity = await loadLongTermIdentity(opts.config);
  const nonces = new NonceCache({ dataDir: opts.config.dataDir });
  await nonces.restore();
  const peers = await PeerStore.open(opts.config.dataDir);
  const rpc = new AdminRpcClient({
    socketPath: join(opts.config.validator.ledgerPath, "admin.rpc"),
  });
  const cli = new ValidatorCli({
    binary: opts.config.validator.binary,
    ledgerPath: opts.config.validator.ledgerPath,
  });
  const validatorVersion = await probeValidatorVersion(cli, opts.logger);
  return {
    config: opts.config,
    logger: opts.logger,
    rpc,
    cli,
    nonces,
    peers,
    progress: new ProgressBus(),
    sessions: new TargetSessionStore(),
    identity,
    validatorVersion,
  };
}

async function probeValidatorVersion(
  cli: ValidatorCli,
  logger: Logger,
): Promise<string | null> {
  try {
    const raw = await cli.version();
    // Cap the cached value so a misbehaving binary cannot waste memory
    // or push the field over the protocol's 256-char limit. The wire
    // schema enforces the same bound on serialisation; we mirror it
    // here so the runtime carries a value that always fits.
    const trimmed = raw.trim();
    return trimmed.length > 256 ? trimmed.slice(0, 256) : trimmed;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "agave-validator --version probe failed; PairResponse will omit validatorVersion",
    );
    return null;
  }
}

async function loadLongTermIdentity(
  config: AgentConfig,
): Promise<LongTermIdentity> {
  const secretRaw = await readFile(config.identity.longTermSigningKeyPath);
  if (secretRaw.byteLength !== ED25519_SECRET_KEY_BYTES) {
    throw new ConfigInvalidError(
      `long-term signing key must be ${ED25519_SECRET_KEY_BYTES.toString()} bytes`,
      {
        path: config.identity.longTermSigningKeyPath,
        actualSize: secretRaw.byteLength,
      },
    );
  }
  const secretBytes = new Uint8Array(
    secretRaw.buffer,
    secretRaw.byteOffset,
    secretRaw.byteLength,
  );
  const derived = await deriveEd25519PublicKey(secretBytes);
  const pubRaw = await readFile(config.identity.longTermPublicKeyPath);
  if (pubRaw.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
    throw new ConfigInvalidError(
      `long-term public key must be ${ED25519_PUBLIC_KEY_BYTES.toString()} bytes`,
      {
        path: config.identity.longTermPublicKeyPath,
        actualSize: pubRaw.byteLength,
      },
    );
  }
  const pubBytes = new Uint8Array(
    pubRaw.buffer,
    pubRaw.byteOffset,
    pubRaw.byteLength,
  );
  let diff = 0;
  for (let i = 0; i < pubBytes.byteLength; i++) {
    diff |= (pubBytes[i] ?? 0) ^ (derived[i] ?? 0);
  }
  if (diff !== 0) {
    throw new IdentityPubkeyMismatchError({
      reason: "long-term signing key does not derive to the configured pubkey",
    });
  }
  return {
    secretKey: new SigningSecretKey(secretBytes),
    publicKey: pubBytes,
    publicKeyBase58: encodeBase58(pubBytes),
  };
}
