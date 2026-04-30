import { Packr, unpack } from "msgpackr";
import { MAX_MESSAGE_SIZE_BYTES } from "./constants.js";
import { PayloadTooLargeError, ProtocolError } from "./errors.js";

/**
 * Shared msgpack packer tuned for our wire format:
 *
 * - `useRecords: false` — we never want the self-describing record
 *   extension; every field must travel explicitly so that the receiver
 *   can validate against a zod schema.
 * - `copyBuffers: true` — decoders return independent copies of binary
 *   fields so callers can hold onto them without aliasing the source
 *   buffer.
 * - `moreTypes: false` — disable built-in date/bigint extensions; we use
 *   plain numbers for timestamps to stay portable.
 */
const packer = new Packr({
  useRecords: false,
  copyBuffers: true,
  moreTypes: false,
});

/** Encode an arbitrary JS value into a msgpack byte buffer. */
export function encode(value: unknown): Uint8Array {
  const packed = packer.pack(value);
  const out = packed instanceof Uint8Array ? new Uint8Array(packed) : new Uint8Array(packed);
  if (out.byteLength > MAX_MESSAGE_SIZE_BYTES) {
    throw new PayloadTooLargeError("encoded message exceeds maximum wire size", {
      size: out.byteLength,
      max: MAX_MESSAGE_SIZE_BYTES,
    });
  }
  return out;
}

/**
 * Decode a msgpack byte buffer. Rejects inputs larger than
 * {@link MAX_MESSAGE_SIZE_BYTES} before parsing, and wraps any parser
 * exception in {@link ProtocolError} so callers never see a raw
 * msgpackr error.
 */
export function decode(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_MESSAGE_SIZE_BYTES) {
    throw new PayloadTooLargeError("encoded message exceeds maximum wire size", {
      size: bytes.byteLength,
      max: MAX_MESSAGE_SIZE_BYTES,
    });
  }
  try {
    return unpack(bytes);
  } catch (err) {
    throw new ProtocolError(
      "PROTOCOL_ERROR",
      "malformed msgpack payload",
      { cause: err instanceof Error ? err.message : String(err) },
    );
  }
}
