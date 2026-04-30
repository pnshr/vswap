import {
  SESSION_KEYPAIR_TTL_MS,
  decode,
  deriveEd25519PublicKey,
  generateSessionKeypair,
  identityBlobSchema,
  openSealedBox,
  scrub,
  verifyDetached,
  withScrubAsync,
} from "@vswap/protocol";
import type {
  IdentityBlob,
  SessionKeypair,
  SwapProgressEvent,
} from "@vswap/protocol";
import type { AgentConfig } from "../config.js";
import type { AdminRpcClient } from "../solana/admin-rpc.js";
import { writeTowerBytes, verifyTowerFilenamePubkey } from "../solana/tower.js";
import { createSession, writeSessionFile } from "../storage/tmpfs.js";
import type { TmpfsSession } from "../storage/tmpfs.js";
import { acquireSwapLock } from "../storage/lock.js";
import type { SwapLock } from "../storage/lock.js";
import { encodeBase58 } from "../solana/base58.js";
import type { ProgressBus } from "./progress-bus.js";
import {
  IdentityPubkeyMismatchError,
  SwapSessionExpiredError,
  SwapSessionUnknownError,
} from "../errors.js";
import { PubkeyMismatchError, SignatureInvalidError, TowerInvalidError } from "@vswap/protocol";

export interface TargetSession {
  readonly sessionId: string;
  readonly keypair: SessionKeypair;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly sourceLongTermPubkey: Uint8Array;
}

/**
 * In-memory registry of active target-side session keypairs. Entries
 * expire on access; a session is single-use.
 */
export class TargetSessionStore {
  private readonly sessions = new Map<string, TargetSession>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? SESSION_KEYPAIR_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  async init(sourceLongTermPubkey: Uint8Array): Promise<TargetSession> {
    const keypair = await generateSessionKeypair();
    const sessionId = crypto.randomUUID();
    const createdAt = this.now();
    const session: TargetSession = {
      sessionId,
      keypair,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      sourceLongTermPubkey,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  take(sessionId: string): TargetSession {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new SwapSessionUnknownError({ sessionId });
    }
    this.sessions.delete(sessionId);
    if (this.now() > session.expiresAt) {
      throw new SwapSessionExpiredError({ sessionId });
    }
    return session;
  }
}

export interface SwapApplyRequest {
  readonly correlationId: string;
  readonly sessionId: string;
  readonly ciphertext: Uint8Array;
  readonly expectedIdentityPubkey: string;
  readonly requireTower: boolean;
}

export interface SwapTargetRuntime {
  readonly config: AgentConfig;
  readonly rpc: AdminRpcClient;
  readonly progress: ProgressBus;
  readonly sessions: TargetSessionStore;
}

export interface SwapApplyResult {
  readonly finalIdentityPubkey: string;
  readonly durationMs: number;
}

/**
 * Target-side orchestration: decrypt the identity blob, validate it,
 * write identity + tower to tmpfs, and hand them to admin RPC.
 *
 * Cleanup of the tmpfs directory is guaranteed via `finally`; the swap
 * mutex is released in the same block.
 */
export async function runSwapApply(
  req: SwapApplyRequest,
  runtime: SwapTargetRuntime,
): Promise<SwapApplyResult> {
  if (req.requireTower !== true && process.env.VSWAP_DANGEROUS_DEV_BUILD !== "1") {
    throw new TowerInvalidError(
      "requireTower=false is disabled in production builds",
      { sessionId: req.sessionId },
    );
  }
  let lock: SwapLock | null = null;
  let tmpfs: TmpfsSession | null = null;
  const emit = (
    phase: SwapProgressEvent["phase"],
    detail: string,
  ): void => {
    runtime.progress.emit(req.correlationId, {
      type: "SwapProgressEvent",
      version: "1.0.0",
      nonce: randomNonce(),
      timestamp: Date.now(),
      correlationId: req.correlationId,
      sessionId: req.sessionId,
      phase,
      detail,
    });
  };
  const startedAt = Date.now();
  try {
    lock = await acquireSwapLock(runtime.config.dataDir);
    const session = runtime.sessions.take(req.sessionId);
    tmpfs = await createSession(runtime.config.tmpfs.basePath);
    const sessionTmpfs = tmpfs;
    emit("precheck", "decrypting identity blob");
    const plaintext = await openSealedBox(
      req.ciphertext,
      session.keypair.publicKey,
      session.keypair.secretKey,
    );
    return await withScrubAsync(plaintext, async (plain) => {
      const raw = decode(plain);
      const parsed = identityBlobSchema.safeParse(raw);
      if (!parsed.success) {
        throw new IdentityPubkeyMismatchError({
          reason: "identity blob failed schema validation",
          issues: parsed.error.issues.map((i) => ({
            path: i.path,
            code: i.code,
          })),
        });
      }
      const blob: IdentityBlob = parsed.data;
      await verifyBlob(blob, session.sourceLongTermPubkey, req.expectedIdentityPubkey);
      verifyTowerFilenamePubkey(
        blob.towerFileName,
        encodeBase58(blob.sourcePubkey),
      );

      const identityBytes = keypairJsonBytes(blob.identitySecretKey);
      let identityPath: string;
      try {
        identityPath = await writeSessionFile(
          sessionTmpfs.dir,
          `identity-${encodeBase58(blob.sourcePubkey)}.json`,
          identityBytes,
        );
      } finally {
        scrub(identityBytes);
      }
      await writeTowerBytes(
        runtime.config.validator.ledgerPath,
        encodeBase58(blob.sourcePubkey),
        blob.towerBytes,
      );
      emit("activate", "calling setIdentity on target");
      await runtime.rpc.setIdentity(identityPath, req.requireTower);
      await runtime.rpc.addAuthorizedVoter(identityPath);
      emit("health", "authorized voter attached");

      const finalIdentityPubkey = encodeBase58(blob.sourcePubkey);
      return {
        finalIdentityPubkey,
        durationMs: Date.now() - startedAt,
      };
    });
  } catch (err) {
    emit(
      "cleanup",
      `target swap failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    try {
      await runtime.rpc.setIdentity(
        runtime.config.validator.unstakedIdentityPath,
        false,
      );
    } catch {
      // Already in a failure path; swallow to let the original error surface.
    }
    throw err;
  } finally {
    if (tmpfs !== null) {
      await tmpfs.cleanup();
    }
    if (lock !== null) {
      await lock.release();
    }
  }
}

async function verifyBlob(
  blob: IdentityBlob,
  senderLongTermPubkey: Uint8Array,
  expectedIdentityPubkey: string,
): Promise<void> {
  // Re-derive the Ed25519 pubkey from the secret and compare to the
  // blob's claimed source pubkey.
  const derivedSource = await deriveEd25519PublicKey(blob.identitySecretKey);
  if (!constantTimeEqual(derivedSource, blob.sourcePubkey)) {
    throw new PubkeyMismatchError(
      "derived source pubkey does not match the blob's source pubkey",
      {
        derivedSize: derivedSource.byteLength,
        claimedSize: blob.sourcePubkey.byteLength,
      },
    );
  }
  if (encodeBase58(derivedSource) !== expectedIdentityPubkey) {
    throw new PubkeyMismatchError(
      "identity pubkey does not match the expected value",
      {
        expected: expectedIdentityPubkey,
        actual: encodeBase58(derivedSource),
      },
    );
  }
  // Re-encode the unsigned portion of the blob for signature verification.
  // We zero our working copy after use.
  const { encode } = await import("@vswap/protocol");
  const unsigned = encode({
    sourcePubkey: blob.sourcePubkey,
    identitySecretKey: blob.identitySecretKey,
    towerFileName: blob.towerFileName,
    towerBytes: blob.towerBytes,
  });
  try {
    const ok = await verifyDetached(
      blob.signature,
      unsigned,
      senderLongTermPubkey,
    );
    if (!ok) {
      throw new SignatureInvalidError(
        "identity blob signature did not verify",
      );
    }
  } finally {
    scrub(unsigned);
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function keypairJsonBytes(secret: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + secret.length * 4);
  let offset = 0;
  out[offset++] = 0x5b; // [
  for (let i = 0; i < secret.length; i++) {
    if (i > 0) {
      out[offset++] = 0x2c; // ,
    }
    offset = writeDecimalByte(out, offset, secret[i] ?? 0);
  }
  out[offset++] = 0x5d; // ]
  return out.slice(0, offset);
}

function writeDecimalByte(out: Uint8Array, offset: number, value: number): number {
  if (value >= 100) {
    out[offset++] = 0x30 + Math.floor(value / 100);
    out[offset++] = 0x30 + Math.floor((value % 100) / 10);
    out[offset++] = 0x30 + (value % 10);
    return offset;
  }
  if (value >= 10) {
    out[offset++] = 0x30 + Math.floor(value / 10);
    out[offset++] = 0x30 + (value % 10);
    return offset;
  }
  out[offset++] = 0x30 + value;
  return offset;
}

function randomNonce(): Uint8Array {
  const out = new Uint8Array(24);
  crypto.getRandomValues(out);
  return out;
}
