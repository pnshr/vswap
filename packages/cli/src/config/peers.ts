import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const pairedPeerSchema = z
  .object({
    /** Operator-assigned label (`--label` on `vswap pair`). */
    label: z.string().min(1),
    /** Host:port that the agent listens on (no scheme). */
    address: z.string().min(1),
    /** Base58-encoded long-term Ed25519 public key of the agent. */
    longTermPubkey: z.string().min(32).max(88),
    /** Unix milliseconds when the peer was added. */
    addedAt: z.number().int().nonnegative(),
    /** Free-form note set by the operator (`--note`). */
    note: z.string().optional(),
  })
  .strict();

export type PairedPeer = z.infer<typeof pairedPeerSchema>;

const peersFileSchema = z
  .object({
    version: z.literal(1),
    peers: z.array(pairedPeerSchema),
  })
  .strict();

export type PeersFile = z.infer<typeof peersFileSchema>;

const EMPTY: PeersFile = { version: 1, peers: [] };

/**
 * On-disk store of paired peers. The file is rewritten atomically
 * (write to a sibling tempfile, fsync, rename) on every mutation.
 *
 * The class deliberately does not cache an in-memory copy across
 * processes — each CLI command opens, mutates, and writes the file in
 * a single short-lived run.
 */
export class PeersStore {
  private constructor(
    private readonly path: string,
    private state: PeersFile,
  ) {}

  /** Open or initialise the peer store at `path`. */
  static async open(path: string): Promise<PeersStore> {
    const state = await readPeersFile(path);
    return new PeersStore(path, state);
  }

  /**
   * Initialise an empty peers file at `path`. Refuses to overwrite an
   * existing file unless `overwrite` is set.
   */
  static async init(path: string, overwrite = false): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    if (!overwrite) {
      try {
        await readFile(path, "utf8");
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err;
        }
      }
    }
    await writeAtomic(path, JSON.stringify(EMPTY, null, 2));
  }

  list(): ReadonlyArray<PairedPeer> {
    return this.state.peers;
  }

  byLabel(label: string): PairedPeer | undefined {
    return this.state.peers.find((p) => p.label === label);
  }

  byPubkey(longTermPubkey: string): PairedPeer | undefined {
    return this.state.peers.find((p) => p.longTermPubkey === longTermPubkey);
  }

  /**
   * Insert or replace a peer keyed by `label`. Throws when the label
   * is taken by a different pubkey unless `force` is set.
   */
  async upsert(peer: PairedPeer, opts: { force?: boolean } = {}): Promise<void> {
    const existing = this.byLabel(peer.label);
    if (existing && existing.longTermPubkey !== peer.longTermPubkey && !opts.force) {
      throw new Error(
        `peer label '${peer.label}' is already paired with a different long-term pubkey ` +
          `(${existing.longTermPubkey}); pass --force to replace`,
      );
    }
    const next: PairedPeer[] = [
      ...this.state.peers.filter((p) => p.label !== peer.label),
      peer,
    ];
    next.sort((a, b) => a.label.localeCompare(b.label));
    this.state = { version: 1, peers: next };
    await writeAtomic(this.path, JSON.stringify(this.state, null, 2));
  }

  async remove(label: string): Promise<boolean> {
    const before = this.state.peers.length;
    const next = this.state.peers.filter((p) => p.label !== label);
    if (next.length === before) {
      return false;
    }
    this.state = { version: 1, peers: next };
    await writeAtomic(this.path, JSON.stringify(this.state, null, 2));
    return true;
  }
}

async function readPeersFile(path: string): Promise<PeersFile> {
  let raw: string | null = null;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
  if (raw === null) {
    return { ...EMPTY };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `peers file ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = peersFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `peers file ${path} failed schema validation: ${result.error.issues
        .map((i) => i.path.join("."))
        .join(", ")}`,
    );
  }
  return result.data;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, content, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}
