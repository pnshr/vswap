import { describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSwapLock } from "../../src/storage/lock.js";
import { SwapAlreadyInProgressError } from "../../src/errors.js";

describe("lock", () => {
  it("acquire succeeds when the lock is free", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-test-"));
    try {
      const lock = await acquireSwapLock(dir);
      await stat(join(dir, "swap.lock"));
      await lock.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("second acquire fails while first is held", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-test-"));
    try {
      const first = await acquireSwapLock(dir);
      await expect(acquireSwapLock(dir)).rejects.toBeInstanceOf(
        SwapAlreadyInProgressError,
      );
      await first.release();
      const second = await acquireSwapLock(dir);
      await second.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("release is idempotent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-test-"));
    try {
      const lock = await acquireSwapLock(dir);
      await lock.release();
      await lock.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("release removes the lock file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-test-"));
    try {
      const lock = await acquireSwapLock(dir);
      const path = join(dir, "swap.lock");
      await stat(path);
      await lock.release();
      await expect(stat(path)).rejects.toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
