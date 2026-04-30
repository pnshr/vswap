import {
  PROTOCOL_VERSION,
  TIMESTAMP_WINDOW_MS,
  openEnvelope,
} from "@vswap/protocol";
import type { AnyMessage } from "@vswap/protocol";
import {
  PeerUnknownError,
  TimestampOutOfWindowError,
} from "../errors.js";
import type { NonceCache } from "./nonce-cache.js";
import type { PeerStore } from "../storage/config-store.js";
import { encodeBase58 } from "../solana/base58.js";

export interface VerifiedRequest {
  readonly message: AnyMessage;
  readonly senderPubkey: Uint8Array;
  readonly senderPubkeyBase58: string;
}

export interface VerifyOptions {
  readonly allowUnpaired?: boolean;
  readonly peers: PeerStore;
  readonly nonces: NonceCache;
  readonly now?: () => number;
}

/**
 * Open a signed envelope, enforce timestamp window + nonce anti-replay,
 * and optionally assert that the sender is a paired peer. Throws on
 * any violation; on success returns the validated inner message plus
 * the sender's long-term pubkey.
 */
export async function verifyEnvelope(
  bytes: Uint8Array,
  opts: VerifyOptions,
): Promise<VerifiedRequest> {
  const opened = await openEnvelope(bytes);
  const message = opened.message;
  if (message.version !== PROTOCOL_VERSION) {
    // openEnvelope already raises VersionMismatchError for this path,
    // but we double-check to keep the invariant legible.
    throw new TimestampOutOfWindowError({
      reason: "protocol version mismatch",
      expected: PROTOCOL_VERSION,
      actual: message.version,
    });
  }
  const now = (opts.now ?? Date.now)();
  const skew = now - message.timestamp;
  if (Math.abs(skew) > TIMESTAMP_WINDOW_MS) {
    throw new TimestampOutOfWindowError({
      skewMs: Math.abs(skew),
      windowMs: TIMESTAMP_WINDOW_MS,
    });
  }
  await opts.nonces.check(message.nonce, message.timestamp);
  const senderPubkeyBase58 = encodeBase58(opened.senderPubkey);
  if (opts.allowUnpaired !== true && !opts.peers.has(senderPubkeyBase58)) {
    throw new PeerUnknownError({ senderPubkeyBase58 });
  }
  return {
    message,
    senderPubkey: opened.senderPubkey,
    senderPubkeyBase58,
  };
}
