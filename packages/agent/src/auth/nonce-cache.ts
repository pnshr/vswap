import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ReplayDetectedError, TIMESTAMP_WINDOW_MS } from "@vswap/protocol";

export interface NonceCacheOptions {
  readonly dataDir?: string;
  readonly maxEntries?: number;
  readonly windowMs?: number;
  readonly now?: () => number;
}

interface NonceEntry {
  readonly nonce: string;
  readonly timestamp: number;
}

const DEFAULT_MAX = 10_000;
const PERSIST_FILENAME = "nonces.log";

/**
 * LRU cache of recently-seen `(nonce, timestamp)` pairs used to detect
 * wire-level replays. Entries older than `windowMs` are evicted
 * opportunistically on every `check()` call; the LRU bound is an extra
 * safety net so a flood of unique nonces cannot blow up memory.
 *
 * When `dataDir` is supplied the cache mirrors its state to an
 * append-only log so replays across process restarts are caught too.
 */
export class NonceCache {
  private readonly entries = new Map<string, NonceEntry>();
  private readonly maxEntries: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly dataDir: string | undefined;
  private persistPath: string | undefined;

  constructor(opts: NonceCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX;
    this.windowMs = opts.windowMs ?? TIMESTAMP_WINDOW_MS;
    this.now = opts.now ?? Date.now;
    this.dataDir = opts.dataDir;
  }

  /**
   * Seed the in-memory cache from disk (if `dataDir` is configured).
   * Safe to call zero or many times; subsequent calls replace the
   * current in-memory state.
   */
  async restore(): Promise<void> {
    if (this.dataDir === undefined) {
      return;
    }
    await mkdir(this.dataDir, { recursive: true });
    this.persistPath = join(this.dataDir, PERSIST_FILENAME);
    let raw = "";
    try {
      raw = await readFile(this.persistPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      await writeFile(this.persistPath, "", { mode: 0o600 });
      return;
    }
    const cutoff = this.now() - this.windowMs;
    const kept: NonceEntry[] = [];
    for (const line of raw.split(/\n/)) {
      if (line.length === 0) continue;
      const parsed = parseLogLine(line);
      if (parsed === null) continue;
      if (parsed.timestamp < cutoff) continue;
      kept.push(parsed);
    }
    this.entries.clear();
    for (const entry of kept) {
      this.entries.set(entry.nonce, entry);
    }
    // Rewrite the log with only the surviving entries.
    await writeFile(
      this.persistPath,
      kept.map(serialiseLogLine).join(""),
      { mode: 0o600 },
    );
  }

  size(): number {
    return this.entries.size;
  }

  /**
   * Validate `(nonce, timestamp)`. Throws
   * {@link ReplayDetectedError} when the timestamp is outside the
   * acceptable window or the nonce has already been observed.
   *
   * On success the entry is inserted (or its LRU position refreshed),
   * and — when persistence is on — appended to the log.
   */
  async check(nonce: Uint8Array, timestamp: number): Promise<void> {
    const nowMs = this.now();
    if (
      timestamp < nowMs - this.windowMs ||
      timestamp > nowMs + this.windowMs
    ) {
      throw new ReplayDetectedError(
        "timestamp outside acceptable window",
        {
          skewMs: Math.abs(nowMs - timestamp),
          windowMs: this.windowMs,
        },
      );
    }
    const key = nonceKey(nonce);
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      throw new ReplayDetectedError("nonce replay detected", {
        nonceSize: nonce.byteLength,
      });
    }
    this.pruneExpired(nowMs);
    if (this.persistPath !== undefined) {
      const line = serialiseLogLine({ nonce: key, timestamp });
      const handle = await open(this.persistPath, "a");
      try {
        await handle.appendFile(line);
      } finally {
        await handle.close();
      }
    }
    this.entries.set(key, { nonce: key, timestamp });
    while (this.entries.size > this.maxEntries) {
      const first = this.entries.keys().next();
      if (first.done === true) break;
      this.entries.delete(first.value);
    }
  }

  private pruneExpired(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    for (const [key, entry] of this.entries) {
      if (entry.timestamp < cutoff) {
        this.entries.delete(key);
      }
    }
  }
}

function nonceKey(nonce: Uint8Array): string {
  return Buffer.from(nonce).toString("hex");
}

function serialiseLogLine(entry: NonceEntry): string {
  return `${entry.nonce} ${entry.timestamp.toString()}\n`;
}

function parseLogLine(line: string): NonceEntry | null {
  const parts = line.split(" ");
  if (parts.length !== 2) return null;
  const [nonce, ts] = parts;
  if (nonce === undefined || ts === undefined) return null;
  if (!/^[0-9a-f]+$/i.test(nonce)) return null;
  const timestamp = Number.parseInt(ts, 10);
  if (!Number.isFinite(timestamp)) return null;
  return { nonce, timestamp };
}
