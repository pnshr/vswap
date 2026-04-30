import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateSigningKeypair,
  sodiumReady,
} from "@vswap/protocol";
import {
  derivePubkeyBase58,
  readKeypairFile,
  verifyKeypairMatchesPubkey,
} from "../../src/solana/identity.js";
import {
  IdentityPubkeyMismatchError,
  KeyfilePermissionsUnsafeError,
} from "../../src/errors.js";

let tmp = "";

beforeAll(async () => {
  await sodiumReady();
  tmp = await mkdtemp(join(tmpdir(), "identity-test-"));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writeKeypair(
  secret: Uint8Array,
  mode: number,
): Promise<string> {
  const path = join(tmp, `kp-${Date.now().toString()}-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(path, JSON.stringify(Array.from(secret)), { mode });
  await chmod(path, mode);
  return path;
}

describe("identity", () => {
  it("reads a valid keypair and derives the pubkey", async () => {
    const kp = await generateSigningKeypair();
    const secret = kp.secretKey.reveal();
    const expected = await derivePubkeyBase58(secret);
    const path = await writeKeypair(secret, 0o600);
    const loaded = await readKeypairFile(path);
    expect(loaded.publicKey).toBe(expected);
    expect(loaded.secretKey.length).toBe(64);
  });

  it("refuses world-readable keypair files", async () => {
    const kp = await generateSigningKeypair();
    const path = await writeKeypair(kp.secretKey.reveal(), 0o644);
    await expect(readKeypairFile(path)).rejects.toBeInstanceOf(
      KeyfilePermissionsUnsafeError,
    );
  });

  it("rejects wrong-length JSON arrays", async () => {
    const path = join(tmp, "wrong-length.json");
    await writeFile(path, JSON.stringify([1, 2, 3]), { mode: 0o600 });
    await chmod(path, 0o600);
    await expect(readKeypairFile(path)).rejects.toBeInstanceOf(
      IdentityPubkeyMismatchError,
    );
  });

  it("rejects malformed JSON", async () => {
    const path = join(tmp, "bad-json.json");
    await writeFile(path, "not json", { mode: 0o600 });
    await chmod(path, 0o600);
    await expect(readKeypairFile(path)).rejects.toBeInstanceOf(
      IdentityPubkeyMismatchError,
    );
  });

  it("verifyKeypairMatchesPubkey throws on mismatch", async () => {
    const kp = await generateSigningKeypair();
    const path = await writeKeypair(kp.secretKey.reveal(), 0o600);
    const loaded = await readKeypairFile(path);
    expect(() =>
      verifyKeypairMatchesPubkey(loaded, "different-pubkey"),
    ).toThrow(IdentityPubkeyMismatchError);
  });

  it("verifyKeypairMatchesPubkey accepts the derived pubkey", async () => {
    const kp = await generateSigningKeypair();
    const path = await writeKeypair(kp.secretKey.reveal(), 0o600);
    const loaded = await readKeypairFile(path);
    expect(() =>
      verifyKeypairMatchesPubkey(loaded, loaded.publicKey),
    ).not.toThrow();
  });
});
