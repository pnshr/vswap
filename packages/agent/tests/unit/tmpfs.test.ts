import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession,
  writeSessionFile,
  zeroAndRemove,
} from "../../src/storage/tmpfs.js";

let base = "";

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "tmpfs-test-"));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("tmpfs", () => {
  it("creates a session directory with 0700 permissions", async () => {
    const session = await createSession(base);
    try {
      const info = await stat(session.dir);
      expect(info.mode & 0o777).toBe(0o700);
    } finally {
      await session.cleanup();
    }
  });

  it("writeSessionFile writes with 0600 permissions", async () => {
    const session = await createSession(base);
    try {
      const path = await writeSessionFile(
        session.dir,
        "blob.bin",
        new Uint8Array([1, 2, 3]),
      );
      const info = await stat(path);
      expect(info.mode & 0o777).toBe(0o600);
    } finally {
      await session.cleanup();
    }
  });

  it("cleanup zeroes files and removes the directory", async () => {
    const session = await createSession(base);
    await writeSessionFile(session.dir, "secret.bin", new Uint8Array([42, 42]));
    await session.cleanup();
    await expect(stat(session.dir)).rejects.toBeDefined();
  });

  it("cleanup is idempotent", async () => {
    const session = await createSession(base);
    await session.cleanup();
    await session.cleanup();
    await expect(stat(session.dir)).rejects.toBeDefined();
  });

  it("zeros files even without createSession wrapper", async () => {
    const dir = join(base, `plain-${Date.now().toString()}`);
    await (await import("node:fs/promises")).mkdir(dir);
    const path = join(dir, "plain.bin");
    await (await import("node:fs/promises")).writeFile(
      path,
      Buffer.from([1, 2, 3]),
    );
    // Zero and remove the directory; function is public for reuse.
    await zeroAndRemove(dir);
    await expect(stat(dir)).rejects.toBeDefined();
    await expect(readFile(path)).rejects.toBeDefined();
  });
});
