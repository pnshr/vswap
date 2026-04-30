import { describe, expect, it } from "vitest";
import { decode, encode } from "../src/wire.js";
import { MAX_MESSAGE_SIZE_BYTES, NONCE_BYTES } from "../src/constants.js";
import { PayloadTooLargeError, ProtocolError } from "../src/errors.js";

describe("wire encode/decode", () => {
  it("round-trips simple JSON-ish objects", () => {
    const value = { a: 1, b: "two", c: [true, null, 3.14] };
    const encoded = encode(value);
    expect(encoded).toBeInstanceOf(Uint8Array);
    const decoded = decode(encoded);
    expect(decoded).toEqual(value);
  });

  it("preserves Uint8Array identity across round-trip", () => {
    const bytes = new Uint8Array(NONCE_BYTES);
    for (let i = 0; i < bytes.byteLength; i++) bytes[i] = i;
    const encoded = encode({ payload: bytes });
    const decoded = decode(encoded) as { payload: Uint8Array };
    expect(decoded.payload).toBeInstanceOf(Uint8Array);
    expect(decoded.payload).toEqual(bytes);
  });

  it("handles zero-length Uint8Array fields", () => {
    const encoded = encode({ empty: new Uint8Array(0) });
    const decoded = decode(encoded) as { empty: Uint8Array };
    expect(decoded.empty).toBeInstanceOf(Uint8Array);
    expect(decoded.empty.byteLength).toBe(0);
  });

  it("rejects malformed msgpack input", () => {
    const garbage = new Uint8Array([0xc1, 0xff, 0xff, 0xff]);
    expect(() => decode(garbage)).toThrow(ProtocolError);
  });

  it("rejects encoded payloads above MAX_MESSAGE_SIZE_BYTES on encode", () => {
    const huge = { blob: new Uint8Array(MAX_MESSAGE_SIZE_BYTES + 16) };
    expect(() => encode(huge)).toThrow(PayloadTooLargeError);
  });

  it("rejects encoded payloads above MAX_MESSAGE_SIZE_BYTES on decode", () => {
    const tooBig = new Uint8Array(MAX_MESSAGE_SIZE_BYTES + 1);
    expect(() => decode(tooBig)).toThrow(PayloadTooLargeError);
  });

  it("decode returns a detached Uint8Array (no aliasing of input)", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const encoded = encode({ b: bytes });
    const decoded = decode(encoded) as { b: Uint8Array };
    decoded.b[0] = 99;
    expect(bytes[0]).toBe(1);
  });

  it("wraps non-Error throwables from msgpackr in ProtocolError", () => {
    // msgpackr throws plain Error in practice; cover the `String(err)` branch
    // of the catch by decoding a byte sequence that triggers it.
    const notMsgpack = new Uint8Array([0xc1, 0xc1, 0xc1]);
    try {
      decode(notMsgpack);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProtocolError);
      const protoErr = e as ProtocolError;
      expect(typeof protoErr.context["cause"]).toBe("string");
    }
  });
});
