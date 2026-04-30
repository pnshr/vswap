import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ConfigInvalidError } from "../errors.js";

const base58Schema = z.string().min(32).max(88);

const pairedPeerSchema = z
  .object({
    longTermPubkey: base58Schema,
    addedAt: z.number().int().nonnegative(),
    note: z.string().optional(),
  })
  .strict();

export type PairedPeer = z.infer<typeof pairedPeerSchema>;

const peerStoreSchema = z
  .object({
    version: z.literal(1),
    peers: z.array(pairedPeerSchema),
  })
  .strict();

export type PeerStoreState = z.infer<typeof peerStoreSchema>;

const STORE_FILENAME = "peers.json";

/**
 * JSON-on-disk store for paired peers. Writes atomically: every mutation
 * replaces the whole file under a temp name and renames into place.
 */
export class PeerStore {
  private readonly path: string;
  private state: PeerStoreState;

  private constructor(path: string, state: PeerStoreState) {
    this.path = path;
    this.state = state;
  }

  /**
   * Load (or initialise) the peer store for `dataDir`. Creates an empty
   * store on disk if none exists yet.
   */
  static async open(dataDir: string): Promise<PeerStore> {
    await mkdir(dataDir, { recursive: true });
    const path = join(dataDir, STORE_FILENAME);
    let raw: string | null = null;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
    if (raw === null) {
      const fresh: PeerStoreState = { version: 1, peers: [] };
      await writeAtomic(path, JSON.stringify(fresh));
      return new PeerStore(path, fresh);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ConfigInvalidError("peer store is not valid JSON", {
        path,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    const result = peerStoreSchema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigInvalidError("peer store failed schema validation", {
        path,
        issues: result.error.issues.map((i) => ({ path: i.path, code: i.code })),
      });
    }
    return new PeerStore(path, result.data);
  }

  list(): ReadonlyArray<PairedPeer> {
    return this.state.peers;
  }

  has(longTermPubkey: string): boolean {
    return this.state.peers.some((p) => p.longTermPubkey === longTermPubkey);
  }

  async add(peer: PairedPeer): Promise<void> {
    if (this.has(peer.longTermPubkey)) {
      return;
    }
    const next: PeerStoreState = {
      version: 1,
      peers: [...this.state.peers, peer],
    };
    await writeAtomic(this.path, JSON.stringify(next));
    this.state = next;
  }

  async remove(longTermPubkey: string): Promise<void> {
    const next: PeerStoreState = {
      version: 1,
      peers: this.state.peers.filter(
        (p) => p.longTermPubkey !== longTermPubkey,
      ),
    };
    await writeAtomic(this.path, JSON.stringify(next));
    this.state = next;
  }
}

async function writeAtomic(path: string, data: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp-${process.pid.toString()}-${Date.now().toString()}`;
  await writeFile(tmp, data, { mode: 0o600 });
  await chmod(tmp, 0o600);
  const { rename } = await import("node:fs/promises");
  await rename(tmp, path);
}
