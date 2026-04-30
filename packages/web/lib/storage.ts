"use client";

/**
 * IndexedDB wrapper.
 *
 * Three stores:
 *
 * - `meta`: operator config metadata (peers, label, operatorPubkey).
 *   Stored in plaintext — no secret material here.
 *
 * - `secret`: a single record holding the WebCrypto-encrypted operator
 *   client cert + signing key. Decryption requires a passphrase the
 *   operator types at the start of every session. The decrypted blob
 *   never leaves React state.
 *
 * - `history`: local swap history (timestamps, durations, no secret
 *   material). Used by the /dashboard/history page.
 *
 * Anything in the `secret` store is opaque ciphertext. The plaintext
 * shape is defined by `EncryptedConfigPlaintext` and decrypted via
 * `lib/crypto.ts`.
 */
import type { OperatorConfigMetadata, SwapHistoryEntry } from "./types";

const DB_NAME = "vswap-web";
const DB_VERSION = 1;

const STORE_META = "meta";
const STORE_SECRET = "secret";
const STORE_HISTORY = "history";

const META_KEY = "operator-config";
const SECRET_KEY = "operator-secret";

export interface SecretRecord {
  /** AES-GCM 256 ciphertext over the JSON-serialised plaintext. */
  ciphertext: ArrayBuffer;
  /** 12-byte AES-GCM IV. */
  iv: ArrayBuffer;
  /** PBKDF2 salt (32 bytes). */
  salt: ArrayBuffer;
  /** PBKDF2 iteration count (>= 600_000 for newly imported configs). */
  iterations: number;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

async function openDb(): Promise<IDBDatabase> {
  if (!isBrowser()) {
    throw new Error("IndexedDB is only available in the browser");
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
      if (!db.objectStoreNames.contains(STORE_SECRET)) {
        db.createObjectStore(STORE_SECRET);
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        db.createObjectStore(STORE_HISTORY, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  try {
    const transaction = db.transaction(store, mode);
    const objectStore = transaction.objectStore(store);
    const result = await fn(objectStore);
    return await new Promise<T>((resolve, reject) => {
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("indexedDB tx error"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("indexedDB tx aborted"));
    });
  } finally {
    db.close();
  }
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB req error"));
  });
}

export async function saveMeta(meta: OperatorConfigMetadata): Promise<void> {
  await tx(STORE_META, "readwrite", async (s) => {
    await reqAsPromise(s.put(meta, META_KEY));
  });
}

export async function loadMeta(): Promise<OperatorConfigMetadata | null> {
  if (!isBrowser()) return null;
  return tx(STORE_META, "readonly", async (s) => {
    const value = await reqAsPromise(s.get(META_KEY));
    return (value as OperatorConfigMetadata | undefined) ?? null;
  });
}

export async function clearMeta(): Promise<void> {
  await tx(STORE_META, "readwrite", async (s) => {
    await reqAsPromise(s.delete(META_KEY));
  });
}

export async function saveSecret(rec: SecretRecord): Promise<void> {
  await tx(STORE_SECRET, "readwrite", async (s) => {
    await reqAsPromise(s.put(rec, SECRET_KEY));
  });
}

export async function loadSecret(): Promise<SecretRecord | null> {
  if (!isBrowser()) return null;
  return tx(STORE_SECRET, "readonly", async (s) => {
    const value = await reqAsPromise(s.get(SECRET_KEY));
    return (value as SecretRecord | undefined) ?? null;
  });
}

export async function clearSecret(): Promise<void> {
  await tx(STORE_SECRET, "readwrite", async (s) => {
    await reqAsPromise(s.delete(SECRET_KEY));
  });
}

export async function appendHistory(entry: SwapHistoryEntry): Promise<void> {
  await tx(STORE_HISTORY, "readwrite", async (s) => {
    await reqAsPromise(s.put(entry));
  });
}

export async function loadHistory(): Promise<SwapHistoryEntry[]> {
  if (!isBrowser()) return [];
  return tx(STORE_HISTORY, "readonly", async (s) => {
    const value = await reqAsPromise(s.getAll());
    const list = (value as SwapHistoryEntry[]) ?? [];
    return list.sort((a, b) => b.startedAt - a.startedAt);
  });
}

export async function clearHistory(): Promise<void> {
  await tx(STORE_HISTORY, "readwrite", async (s) => {
    await reqAsPromise(s.clear());
  });
}
