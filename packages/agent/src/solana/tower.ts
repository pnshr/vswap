import { chmod, copyFile, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TowerInvalidError } from "@vswap/protocol";
import { TowerPubkeyMismatchError } from "../errors.js";

/**
 * Regular expression matching `agave-validator`'s tower file format.
 * Accepts both the historical `tower-1_9-<pubkey>.bin` naming and any
 * forward-compatible `tower-<anything>-<pubkey>.bin`.
 */
const TOWER_FILENAME_REGEX = /^tower-[A-Za-z0-9._]+-([1-9A-HJ-NP-Za-km-z]{32,44})\.bin$/;
const MAX_TOWER_FILE_BYTES = 90_000;

/** Derive the base58 pubkey embedded in a tower file name, or null. */
export function extractPubkeyFromFilename(filename: string): string | null {
  const match = TOWER_FILENAME_REGEX.exec(filename);
  return match !== null && match[1] !== undefined ? match[1] : null;
}

/** Throw if a tower filename does not embed the expected base58 pubkey. */
export function verifyTowerFilenamePubkey(
  filename: string,
  expectedPubkey: string,
): void {
  const actual = extractPubkeyFromFilename(filename);
  if (actual !== expectedPubkey) {
    throw new TowerPubkeyMismatchError({
      filename,
      expectedPubkey,
      actualPubkey: actual ?? null,
    });
  }
}

/**
 * Locate the tower file for `identityPubkey` inside `ledgerPath`.
 * Returns the absolute path, or `null` when no matching file exists.
 */
export async function findTowerFile(
  ledgerPath: string,
  identityPubkey: string,
): Promise<string | null> {
  const entries = await readdir(ledgerPath);
  for (const entry of entries) {
    const pubkey = extractPubkeyFromFilename(entry);
    if (pubkey === identityPubkey) {
      return join(ledgerPath, entry);
    }
  }
  return null;
}

/** Read the raw bytes of a tower file. */
export async function readTowerBytes(path: string): Promise<Uint8Array> {
  const info = await stat(path);
  if (info.size > MAX_TOWER_FILE_BYTES) {
    throw new TowerInvalidError("tower file exceeds maximum supported size", {
      path,
      size: info.size,
      max: MAX_TOWER_FILE_BYTES,
    });
  }
  const buf = await readFile(path);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Copy `path` to `<path>.bak-<epoch-ms>` and return the destination.
 * The timestamp in the filename is unique enough for human-driven ops.
 */
export async function backupTower(path: string): Promise<string> {
  const dest = `${path}.bak-${Date.now().toString()}`;
  await copyFile(path, dest);
  await chmod(dest, 0o600);
  return dest;
}

/**
 * Write raw tower bytes under the canonical filename inside
 * `ledgerPath`. The file is written with mode 0600 and the on-disk name
 * always embeds `identityPubkey`.
 */
export async function writeTowerBytes(
  ledgerPath: string,
  identityPubkey: string,
  bytes: Uint8Array,
  schemaSlug = "1_9",
): Promise<string> {
  if (bytes.byteLength > MAX_TOWER_FILE_BYTES) {
    throw new TowerInvalidError("tower file exceeds maximum supported size", {
      size: bytes.byteLength,
      max: MAX_TOWER_FILE_BYTES,
    });
  }
  const filename = `tower-${schemaSlug}-${identityPubkey}.bin`;
  const dest = join(ledgerPath, filename);
  await writeFile(dest, bytes, { mode: 0o600 });
  await chmod(dest, 0o600);
  return dest;
}
