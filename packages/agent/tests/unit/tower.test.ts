import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupTower,
  extractPubkeyFromFilename,
  findTowerFile,
  readTowerBytes,
  verifyTowerFilenamePubkey,
  writeTowerBytes,
} from "../../src/solana/tower.js";
import { TowerPubkeyMismatchError } from "../../src/errors.js";

const VALID_PUBKEY = "4Nd1mVmQQw2EhBhswKF3dAcdSQpR4nKvrEpqrMMkvkXn";

describe("tower", () => {
  it("extracts pubkey from canonical filename", () => {
    expect(
      extractPubkeyFromFilename(`tower-1_9-${VALID_PUBKEY}.bin`),
    ).toBe(VALID_PUBKEY);
  });

  it("returns null for unrelated filenames", () => {
    expect(extractPubkeyFromFilename("ledger.log")).toBeNull();
    expect(extractPubkeyFromFilename("tower.bin")).toBeNull();
  });

  it("verifyTowerFilenamePubkey throws on mismatch", () => {
    expect(() =>
      verifyTowerFilenamePubkey(
        `tower-1_9-${VALID_PUBKEY}.bin`,
        "7Nd1mVmQQw2EhBhswKF3dAcdSQpR4nKvrEpqrMMkvkXn",
      ),
    ).toThrow(TowerPubkeyMismatchError);
  });

  it("verifyTowerFilenamePubkey accepts matching pubkey", () => {
    expect(() =>
      verifyTowerFilenamePubkey(
        `tower-1_9-${VALID_PUBKEY}.bin`,
        VALID_PUBKEY,
      ),
    ).not.toThrow();
  });

  it("findTowerFile locates file and ignores others", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tower-test-"));
    try {
      await writeFile(join(dir, `tower-1_9-${VALID_PUBKEY}.bin`), "x");
      await writeFile(join(dir, "ledger.log"), "noise");
      const found = await findTowerFile(dir, VALID_PUBKEY);
      expect(found).toBe(join(dir, `tower-1_9-${VALID_PUBKEY}.bin`));
      const none = await findTowerFile(
        dir,
        "9Nd1mVmQQw2EhBhswKF3dAcdSQpR4nKvrEpqrMMkvkXn",
      );
      expect(none).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("backupTower copies to dated filename with 0600 perms", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tower-test-"));
    try {
      const src = join(dir, `tower-1_9-${VALID_PUBKEY}.bin`);
      await writeFile(src, Buffer.from([1, 2, 3]));
      const dest = await backupTower(src);
      expect(dest.startsWith(`${src}.bak-`)).toBe(true);
      const info = await stat(dest);
      expect(info.mode & 0o777).toBe(0o600);
      const bytes = await readTowerBytes(dest);
      expect(Array.from(bytes)).toEqual([1, 2, 3]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writeTowerBytes writes canonical filename with 0600 perms", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tower-test-"));
    try {
      const path = await writeTowerBytes(
        dir,
        VALID_PUBKEY,
        new Uint8Array([42, 43]),
      );
      expect(path).toBe(join(dir, `tower-1_9-${VALID_PUBKEY}.bin`));
      const info = await stat(path);
      expect(info.mode & 0o777).toBe(0o600);
      const bytes = await readTowerBytes(path);
      expect(Array.from(bytes)).toEqual([42, 43]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
