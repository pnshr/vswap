import {
  deriveEd25519PublicKey,
  encode,
  scrub,
  sealForRecipient,
  signDetached,
  withScrubAsync,
} from "@vswap/protocol";
import type {
  IdentityBlob,
  SigningSecretKey,
  SwapProgressEvent,
} from "@vswap/protocol";
import { basename } from "node:path";
import type { AgentConfig } from "../config.js";
import type { AdminRpcClient } from "../solana/admin-rpc.js";
import type { ValidatorCli } from "../solana/cli.js";
import { findTowerFile, readTowerBytes } from "../solana/tower.js";
import { readKeypairFile, verifyKeypairMatchesPubkey } from "../solana/identity.js";
import { acquireSwapLock } from "../storage/lock.js";
import type { ProgressBus } from "./progress-bus.js";
import { AdminRpcFailedError } from "../errors.js";
import { encodeBase58 } from "../solana/base58.js";

export interface SwapSourceRequest {
  readonly correlationId: string;
  readonly sessionId: string;
  readonly recipientSessionPubkey: Uint8Array;
  readonly expectedIdentityPubkey: string;
}

export interface SwapSourceRuntime {
  readonly config: AgentConfig;
  readonly rpc: AdminRpcClient;
  readonly cli: ValidatorCli;
  readonly progress: ProgressBus;
  readonly longTermSecret: SigningSecretKey;
}

export interface SwapSourceResult {
  readonly ciphertext: Uint8Array;
  readonly pausedAt: number;
  readonly sourcePubkey: string;
}

/**
 * Source-side orchestration: swap the staked identity out, seal the
 * identity + tower blob for the target's session pubkey, and return
 * the ciphertext. The caller is expected to ship the ciphertext to
 * Agent-B via a relay.
 *
 * Any failure **after** the admin RPC `setIdentity(unstaked)` step
 * triggers an automatic rollback to the staked identity so the
 * operator is never stranded with a silently un-voting host.
 */
export async function runSwapSource(
  req: SwapSourceRequest,
  runtime: SwapSourceRuntime,
): Promise<SwapSourceResult> {
  const lock = await acquireSwapLock(runtime.config.dataDir);
  const emit = (phase: SwapProgressEvent["phase"], detail: string): void => {
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

  let pausedAt = 0;
  let voteIsOff = false;
  try {
    emit("precheck", "source swap starting");
    const staked = await readKeypairFile(
      runtime.config.validator.stakedIdentityPath,
    );
    try {
      verifyKeypairMatchesPubkey(staked, req.expectedIdentityPubkey);
      const towerPath = await findTowerFile(
        runtime.config.validator.ledgerPath,
        staked.publicKey,
      );
      if (towerPath === null) {
        throw new AdminRpcFailedError(
          `no tower file for identity ${staked.publicKey}`,
        );
      }
      const towerBytes = await readTowerBytes(towerPath);

      emit("stop-voting", "calling setIdentity(unstaked)");
      await runtime.rpc.setIdentity(
        runtime.config.validator.unstakedIdentityPath,
        false,
      );
      voteIsOff = true;
      pausedAt = Date.now();
      emit("stop-voting", `paused at ${new Date(pausedAt).toISOString()}`);

      const ciphertext = await withScrubAsync(
        new Uint8Array(staked.secretKey),
        async (secretCopy) => {
          emit("ship-tower", "sealing identity blob");
          const pubkeyBytes = await deriveEd25519PublicKey(secretCopy);
          const blobUnsigned = {
            sourcePubkey: pubkeyBytes,
            identitySecretKey: secretCopy,
            towerFileName: basename(towerPath),
            towerBytes,
          } as const;
          const encodedForSig = encode(blobUnsigned);
          const signature = await signDetached(
            encodedForSig,
            runtime.longTermSecret,
          );
          const blob: IdentityBlob = {
            sourcePubkey: pubkeyBytes,
            identitySecretKey: secretCopy,
            towerFileName: basename(towerPath),
            towerBytes,
            signature,
          };
          const plaintext = encode(blob);
          try {
            return await sealForRecipient(
              plaintext,
              req.recipientSessionPubkey,
            );
          } finally {
            scrub(plaintext);
          }
        },
      );
      emit("ship-tower", "ciphertext prepared");
      return {
        ciphertext,
        pausedAt,
        sourcePubkey: encodeBase58(
          await deriveEd25519PublicKey(staked.secretKey),
        ),
      };
    } finally {
      scrub(staked.secretKey);
    }
  } catch (err) {
    if (voteIsOff) {
      // Best-effort rollback so the operator is not stranded.
      try {
        await runtime.rpc.setIdentity(
          runtime.config.validator.stakedIdentityPath,
          true,
        );
        emit("cleanup", "rolled back to staked identity");
      } catch (rollbackErr) {
        emit(
          "cleanup",
          `rollback failed: ${
            rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
          }`,
        );
      }
    }
    throw err;
  } finally {
    await lock.release();
  }
}

function randomNonce(): Uint8Array {
  const out = new Uint8Array(24);
  // Node >=20 global crypto; fallback to require should not be needed.
  crypto.getRandomValues(out);
  return out;
}
