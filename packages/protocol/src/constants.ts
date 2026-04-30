/**
 * Protocol-level constants. All sizes are in bytes, all durations in
 * milliseconds, unless noted.
 */

/** Current wire protocol version. Must be present on every message. */
export const PROTOCOL_VERSION = "1.0.0";

/** Hard upper bound on any single encoded envelope on the wire. */
export const MAX_MESSAGE_SIZE_BYTES = 1_048_576;

/**
 * Size of the nonce attached to every message for anti-replay. 24 bytes
 * matches libsodium's `crypto_box_NONCEBYTES` and gives ample collision
 * resistance for random nonces.
 */
export const NONCE_BYTES = 24;

/**
 * Acceptable skew (in either direction) between a message's `timestamp`
 * and the receiver's wall clock. Messages outside this window MUST be
 * rejected as replays.
 */
export const TIMESTAMP_WINDOW_MS = 30_000;

/**
 * Upper bound on the plaintext payload (64-byte identity keypair + tower
 * blob + framing overhead) carried inside a sealed box. Tower files are
 * a few KB in practice; 100 KB leaves room for growth and the
 * cbor/msgpack header.
 */
export const MAX_IDENTITY_PAYLOAD_BYTES = 100_000;

/**
 * Time after which a session X25519 keypair generated on Agent-B should
 * be considered stale and discarded, regardless of swap progress.
 */
export const SESSION_KEYPAIR_TTL_MS = 300_000;

/** Size of an Ed25519 public key, bytes. */
export const ED25519_PUBLIC_KEY_BYTES = 32;

/** Size of an Ed25519 secret key (libsodium "full" format), bytes. */
export const ED25519_SECRET_KEY_BYTES = 64;

/** Size of an Ed25519 detached signature, bytes. */
export const ED25519_SIGNATURE_BYTES = 64;

/** Size of an X25519 public key, bytes. */
export const X25519_PUBLIC_KEY_BYTES = 32;

/** Size of an X25519 secret key, bytes. */
export const X25519_SECRET_KEY_BYTES = 32;
