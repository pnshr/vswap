import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import {
  generateSigningKeypair,
  PROTOCOL_VERSION,
  type SwapCompleted,
} from "@vswap/protocol";
import { runRollback } from "../../src/commands/rollback.js";
import { runInit } from "../../src/commands/init.js";
import { PeersStore } from "../../src/config/peers.js";
import {
  AgentClient,
  AgentResponseError,
  type AgentResponse,
  type AgentTransport,
} from "../../src/client/agent-client.js";

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

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const size = Math.ceil((bytes.length * 138) / 100) + 1;
  const b58 = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i] ?? 0;
    let j = 0;
    for (let it = size - 1; (carry !== 0 || j < length) && it >= 0; it--, j++) {
      carry += 256 * (b58[it] ?? 0);
      b58[it] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }
  let offset = size - length;
  while (offset < size && b58[offset] === 0) offset++;
  let out = "";
  for (let i = 0; i < zeros; i++) out += ALPHABET[0];
  for (let i = offset; i < size; i++) out += ALPHABET[b58[i] ?? 0];
  return out;
}

interface FakeClientOptions {
  failOnSource?: boolean;
  failOnTarget?: boolean;
}

function makeFakeRollbackClient(opts: FakeClientOptions): {
  client: AgentClient;
  callOrder: string[];
} {
  const callOrder: string[] = [];
  const stub: AgentTransport = {
    send: () => Promise.resolve(new Uint8Array()),
    health: () => Promise.resolve(true),
  };
  const client = new AgentClient(
    {
      config: {
        paths: {} as never,
        identity: {
          secretKey: { reveal: () => new Uint8Array(64) } as never,
          publicKey: new Uint8Array(32),
          publicKeyBase58: "11111111111111111111111111111111",
        },
        tls: {
          clientCert: Buffer.alloc(0),
          clientKey: Buffer.alloc(0),
          caCert: Buffer.alloc(0),
        },
      },
    },
    stub,
  );
  client.swapRollback = (peer): Promise<AgentResponse<SwapCompleted>> => {
    callOrder.push(peer.label);
    if (peer.label === "node-a" && opts.failOnSource === true) {
      return Promise.reject(
        new AgentResponseError("source rollback failed", "GENERIC", {}),
      );
    }
    if (peer.label === "node-b" && opts.failOnTarget === true) {
      return Promise.reject(
        new AgentResponseError("target rollback failed", "GENERIC", {}),
      );
    }
    const message: SwapCompleted = {
      type: "SwapCompleted",
      correlationId: "00000000-0000-0000-0000-000000000000",
      nonce: new Uint8Array(24),
      timestamp: Date.now(),
      version: PROTOCOL_VERSION,
      sessionId: "00000000-0000-0000-0000-000000000000",
      finalIdentityPubkey: new Uint8Array(32),
      durationMs: 5,
    };
    return Promise.resolve({ message, senderPubkey: new Uint8Array(32) });
  };
  return { client, callOrder };
}

describe("vswap rollback", () => {
  let configPath: string;
  let stdout: MemStream;

  beforeEach(async () => {
    configPath = await mkdtemp(join(tmpdir(), "vswap-rollback-test-"));
    await runInit({ configPath }, new MemStream() as unknown as NodeJS.WriteStream);
    const peers = await PeersStore.open(join(configPath, "peers.json"));
    const a = await generateSigningKeypair();
    const b = await generateSigningKeypair();
    await peers.upsert({
      label: "node-a",
      address: "127.0.0.1:7872",
      longTermPubkey: encodeBase58(a.publicKey),
      addedAt: Date.now(),
    });
    await peers.upsert({
      label: "node-b",
      address: "127.0.0.1:7873",
      longTermPubkey: encodeBase58(b.publicKey),
      addedAt: Date.now(),
    });
    stdout = new MemStream();
  });

  afterEach(async () => {
    await rm(configPath, { recursive: true, force: true });
  });

  it("calls rollback on source then target in that order", async () => {
    const { client, callOrder } = makeFakeRollbackClient({});
    const code = await runRollback(
      { from: "node-a", to: "node-b", configPath, yes: true },
      { agentClient: client, stdout: stdout as unknown as NodeJS.WriteStream },
    );
    expect(code).toBe(0);
    expect(callOrder).toEqual(["node-a", "node-b"]);
  }, 30000);

  it("returns exit code 6 if any rollback failed", async () => {
    const { client, callOrder } = makeFakeRollbackClient({ failOnTarget: true });
    const code = await runRollback(
      { from: "node-a", to: "node-b", configPath, yes: true, json: true },
      { agentClient: client, stdout: stdout as unknown as NodeJS.WriteStream },
    );
    expect(code).toBe(6);
    expect(callOrder).toEqual(["node-a", "node-b"]);
    expect(stdout.text()).toContain("rollback.report");
  }, 30000);

  it("aborts when confirmation is declined", async () => {
    const { client, callOrder } = makeFakeRollbackClient({});
    const code = await runRollback(
      { from: "node-a", to: "node-b", configPath },
      {
        agentClient: client,
        stdout: stdout as unknown as NodeJS.WriteStream,
        confirm: () => Promise.resolve(false),
      },
    );
    expect(code).toBe(5);
    expect(callOrder).toEqual([]);
  }, 30000);
});
