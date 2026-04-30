import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface TmpfsSession {
  readonly dir: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Create a fresh tmpfs session directory under `basePath` (typically
 * `/dev/shm/vswap`). The returned `cleanup` callback overwrites every
 * file inside the dir with zeros before unlinking it and the directory
 * itself. Callers MUST invoke cleanup in a finally block.
 */
export async function createSession(basePath: string): Promise<TmpfsSession> {
  await mkdir(basePath, { recursive: true, mode: 0o700 });
  const dir = join(basePath, randomUUID());
  await mkdir(dir, { mode: 0o700 });
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    await zeroAndRemove(dir);
  };
  return { dir, cleanup };
}

/**
 * Write `bytes` into `<dir>/<name>` with mode 0600. Returns the
 * absolute path of the new file.
 */
export async function writeSessionFile(
  dir: string,
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, bytes, { mode: 0o600 });
  return path;
}

/**
 * Overwrite every regular file beneath `dir` with zeros, then unlink
 * the whole tree. Best-effort: if the directory has already been
 * removed, this is a no-op.
 */
export async function zeroAndRemove(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const info = await stat(full);
      if (info.isFile()) {
        const zeros = Buffer.alloc(info.size);
        await writeFile(full, zeros);
      }
    } catch {
      // best-effort overwrite; proceed to unlink regardless.
    }
  }
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // same as above — nothing to do if the tree is already gone.
  }
}
