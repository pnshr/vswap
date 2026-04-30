import { describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers";
import {
  resolveMemzero,
  scrub,
  withScrub,
  withScrubAsync,
} from "../src/crypto/scrub.js";
import { sodiumReady } from "../src/crypto/ready.js";

interface SodiumWithMemzero {
  memzero?: ((buffer: Uint8Array) => void) | undefined;
}
const sodiumPatch = sodium as unknown as SodiumWithMemzero;

describe("scrub", () => {
  it("zeroes out every byte of a non-empty buffer", async () => {
    await sodiumReady();
    const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    scrub(buf);
    expect(buf).toEqual(new Uint8Array(8));
  });

  it("is a no-op on an empty buffer (does not throw)", () => {
    const buf = new Uint8Array(0);
    expect(() => scrub(buf)).not.toThrow();
    expect(buf.byteLength).toBe(0);
  });

  it("uses the libsodium memzero primitive when it is exposed", async () => {
    await sodiumReady();
    expect(resolveMemzero()).toBeTypeOf("function");
    const buf = Uint8Array.from({ length: 8 }, (_, i) => i + 1);
    scrub(buf);
    expect(buf).toEqual(new Uint8Array(8));
  });

  it("falls back to Uint8Array.fill when memzero is not exposed", async () => {
    await sodiumReady();
    const original = sodiumPatch.memzero;
    sodiumPatch.memzero = undefined;
    try {
      expect(resolveMemzero()).toBeUndefined();
      const buf = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
      scrub(buf);
      expect(buf).toEqual(new Uint8Array(16));
    } finally {
      sodiumPatch.memzero = original;
    }
  });

  it("resolveMemzero returns undefined if the export is not a function", () => {
    const original = sodiumPatch.memzero;
    (sodiumPatch as { memzero: unknown }).memzero = "not-a-function";
    try {
      expect(resolveMemzero()).toBeUndefined();
    } finally {
      sodiumPatch.memzero = original;
    }
  });
});

describe("withScrub", () => {
  it("returns the callback result and scrubs after it", async () => {
    await sodiumReady();
    const buf = new Uint8Array([9, 9, 9, 9]);
    const observedInside: number[] = [];
    const result = withScrub(buf, (b) => {
      observedInside.push(...b);
      return b.byteLength;
    });
    expect(result).toBe(4);
    expect(observedInside).toEqual([9, 9, 9, 9]);
    expect(buf).toEqual(new Uint8Array(4));
  });

  it("still scrubs when the callback throws", async () => {
    await sodiumReady();
    const buf = new Uint8Array([5, 5, 5]);
    expect(() =>
      withScrub(buf, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(buf).toEqual(new Uint8Array(3));
  });
});

describe("withScrubAsync", () => {
  it("awaits the callback and scrubs on success", async () => {
    await sodiumReady();
    const buf = new Uint8Array([2, 4, 6, 8]);
    const result = await withScrubAsync(buf, (b) =>
      Promise.resolve(b.reduce((acc, v) => acc + v, 0)),
    );
    expect(result).toBe(20);
    expect(buf).toEqual(new Uint8Array(4));
  });

  it("scrubs on rejection", async () => {
    await sodiumReady();
    const buf = new Uint8Array([7, 7, 7]);
    await expect(
      withScrubAsync(buf, () => Promise.reject(new Error("async boom"))),
    ).rejects.toThrow("async boom");
    expect(buf).toEqual(new Uint8Array(3));
  });
});
