import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { runInit } from "../../src/commands/init.js";
import { ED25519_PUBLIC_KEY_BYTES, ED25519_SECRET_KEY_BYTES } from "@vswap/protocol";

class MemStream extends Writable {
  chunks: Buffer[] = [];
  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    cb();
  }
  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

describe("vswap init", () => {
  let configPath: string;
  let stdout: MemStream;

  beforeEach(async () => {
    configPath = await mkdtemp(join(tmpdir(), "vswap-init-test-"));
    stdout = new MemStream();
  });

  afterEach(async () => {
    await rm(configPath, { recursive: true, force: true });
  });

  it("creates the config root with all expected artifacts", async () => {
    const code = await runInit({ configPath }, stdout as unknown as NodeJS.WriteStream);
    expect(code).toBe(0);
    const skBuf = await readFile(join(configPath, "client.sk"));
    const pkBuf = await readFile(join(configPath, "client.pk"));
    expect(skBuf.byteLength).toBe(ED25519_SECRET_KEY_BYTES);
    expect(pkBuf.byteLength).toBe(ED25519_PUBLIC_KEY_BYTES);
    const ca = await readFile(join(configPath, "ca.crt"), "utf8");
    expect(ca).toContain("BEGIN CERTIFICATE");
    const clientCert = await readFile(join(configPath, "client.crt"), "utf8");
    expect(clientCert).toContain("BEGIN CERTIFICATE");
    const clientKey = await readFile(join(configPath, "client.key"), "utf8");
    expect(clientKey).toMatch(/BEGIN (?:RSA )?PRIVATE KEY/);
    const peers = JSON.parse(
      await readFile(join(configPath, "peers.json"), "utf8"),
    ) as { version: number; peers: unknown[] };
    expect(peers).toEqual({ version: 1, peers: [] });
    expect(stdout.text()).toContain("vswap config initialised at");
    expect(stdout.text()).toContain("Pubkey (base58):");
  }, 30000);

  it("writes mode 0600 on secret material", async () => {
    await runInit({ configPath }, stdout as unknown as NodeJS.WriteStream);
    if (process.platform === "win32") return;
    const sk = await stat(join(configPath, "client.sk"));
    const caKey = await stat(join(configPath, "ca.key"));
    const clientKey = await stat(join(configPath, "client.key"));
    expect(sk.mode & 0o777).toBe(0o600);
    expect(caKey.mode & 0o777).toBe(0o600);
    expect(clientKey.mode & 0o777).toBe(0o600);
  }, 30000);

  it("refuses to overwrite an existing config without --force", async () => {
    await runInit({ configPath }, stdout as unknown as NodeJS.WriteStream);
    const second = new MemStream();
    const code = await runInit({ configPath }, second as unknown as NodeJS.WriteStream);
    expect(code).not.toBe(0);
    expect(second.text()).toContain("Refusing to overwrite");
  }, 30000);

  it("emits a single JSON line in --json mode", async () => {
    const code = await runInit(
      { configPath, json: true },
      stdout as unknown as NodeJS.WriteStream,
    );
    expect(code).toBe(0);
    const lines = stdout.text().trim().split("\n");
    expect(lines.length).toBe(1);
    const first = lines[0];
    if (first === undefined) {
      throw new Error("expected at least one JSON line");
    }
    const parsed = JSON.parse(first) as {
      type: string;
      payload: { clientPubkeyBase58: string };
    };
    expect(parsed.type).toBe("init.completed");
    expect(parsed.payload.clientPubkeyBase58).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,}$/);
  }, 30000);
});
