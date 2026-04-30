import { constants as fsConstants } from "node:fs";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { SwapAlreadyInProgressError } from "../errors.js";

export interface SwapLock {
  readonly release: () => Promise<void>;
}

const LOCK_FILE = "swap.lock";
const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;

/**
 * Acquire a process-exclusive swap lock under `dataDir`. Implemented as
 * a `O_CREAT | O_EXCL` sentinel file rather than `flock` because
 * vitest's worker model and the systemd restart loop both interact
 * poorly with advisory BSD locks on some kernels.
 *
 * Non-blocking: if another agent instance holds the sentinel the call
 * throws {@link SwapAlreadyInProgressError} immediately. The returned
 * `release` callback unlinks the sentinel and is safe to call twice.
 */
export async function acquireSwapLock(dataDir: string): Promise<SwapLock> {
  await mkdir(dataDir, { recursive: true });
  const path = join(dataDir, LOCK_FILE);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      path,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR,
      0o600,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      if (await removeStaleLockIfSafe(path)) {
        return acquireSwapLock(dataDir);
      }
      throw new SwapAlreadyInProgressError({ path });
    }
    throw err;
  }
  await handle.writeFile(
    `${process.pid.toString()}\n${new Date().toISOString()}\n`,
  );

  let released = false;
  const release = async (): Promise<void> => {
    if (released) {
      return;
    }
    released = true;
    try {
      await handle.close();
    } catch {
      // handle may already be closed on process exit.
    }
    try {
      await unlink(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  };

  return { release };
}

async function removeStaleLockIfSafe(path: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return false;
  }
  const [pidLine, createdLine] = raw.split(/\r?\n/);
  const pid = Number.parseInt(pidLine ?? "", 10);
  const createdAt = Date.parse(createdLine ?? "");
  const pidDead = Number.isFinite(pid) && pid > 0 ? !processIsAlive(pid) : false;
  const stale =
    Number.isFinite(createdAt) &&
    Date.now() - createdAt > DEFAULT_STALE_LOCK_MS;
  if (!pidDead && !stale) {
    return false;
  }
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
