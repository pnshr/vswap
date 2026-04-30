import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NonceCache } from "../../src/auth/nonce-cache.js";
import { ReplayDetectedError } from "@vswap/protocol";

const now = () => 1_700_000_000_000;

function bytes(fill: number): Uint8Array {
  return new Uint8Array(24).fill(fill);
}

describe("NonceCache", () => {
  it("accepts a fresh nonce and rejects a replay", async () => {
    const cache = new NonceCache({ now });
    await cache.check(bytes(1), now());
    await expect(cache.check(bytes(1), now())).rejects.toBeInstanceOf(
      ReplayDetectedError,
    );
  });

  it("rejects timestamps outside the window", async () => {
    const cache = new NonceCache({ now, windowMs: 1_000 });
    await expect(
      cache.check(bytes(2), now() - 2_000),
    ).rejects.toBeInstanceOf(ReplayDetectedError);
    await expect(
      cache.check(bytes(2), now() + 2_000),
    ).rejects.toBeInstanceOf(ReplayDetectedError);
  });

  it("evicts the oldest entry when exceeding maxEntries", async () => {
    const cache = new NonceCache({ now, maxEntries: 2 });
    await cache.check(bytes(1), now());
    await cache.check(bytes(2), now());
    await cache.check(bytes(3), now());
    expect(cache.size()).toBe(2);
    // The oldest nonce was evicted, so it can be re-inserted without
    // triggering a replay error.
    await cache.check(bytes(1), now());
  });

  it("persists across restart via the on-disk log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nonce-cache-test-"));
    try {
      const first = new NonceCache({ now, dataDir: dir });
      await first.restore();
      await first.check(bytes(7), now());

      const raw = await readFile(join(dir, "nonces.log"), "utf8");
      expect(raw.length).toBeGreaterThan(0);

      const second = new NonceCache({ now, dataDir: dir });
      await second.restore();
      await expect(second.check(bytes(7), now())).rejects.toBeInstanceOf(
        ReplayDetectedError,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops expired log entries on restore", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nonce-cache-test-"));
    try {
      let clock = now();
      const cache = new NonceCache({
        now: () => clock,
        dataDir: dir,
        windowMs: 1_000,
      });
      await cache.restore();
      await cache.check(bytes(9), clock);
      clock += 60_000;
      const restored = new NonceCache({
        now: () => clock,
        dataDir: dir,
        windowMs: 1_000,
      });
      await restored.restore();
      // Stale entries are dropped, so the nonce can be re-used when the
      // fresh timestamp is also inside the window.
      await restored.check(bytes(9), clock);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
