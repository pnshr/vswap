import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import {
  generateSigningKeypair,
  PROTOCOL_VERSION,
  type AnyMessage,
  type PreflightResponse,
  type SwapCompleted,
  type SwapPayload,
  type SwapSessionInit,
} from "@vswap/protocol";
import { runSwap } from "../../src/commands/swap.js";
import { runInit } from "../../src/commands/init.js";
import { PeersStore } from "../../src/config/peers.js";
import {
  AgentClient,
  AgentResponseError,
  type AgentTransport,
  type AgentResponse,
} from "../../src/client/agent-client.js";
import type { ProgressClient } from "../../src/client/ws-client.js";

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

interface FakeRecorder {
  readonly calls: Array<{ peer: string; method: string; path: string }>;
}

function makeFakeClient(opts: {
  health?: boolean;
  preflightOk?: boolean;
  applyError?: AgentResponseError;
  rollbackThrows?: boolean;
  statusBlob?: string;
}): { client: AgentClient; recorder: FakeRecorder } {
  const recorder: FakeRecorder = { calls: [] };
  const stub: AgentTransport = {
    health: () => Promise.resolve(opts.health ?? true),
    send: () => Promise.resolve(new Uint8Array(0)),
  };

  const sessionId = "11111111-2222-3333-4444-555566667777";
  const finalPub = new Uint8Array(32);

  // We override the high-level methods directly so the real `send`
  // path does not run.
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

  client.health = (peer: { address: string }): Promise<boolean> => {
    recorder.calls.push({ peer: peer.address, method: "GET", path: "/health" });
    return Promise.resolve(opts.health ?? true);
  };
  client.preflight = (peer): Promise<AgentResponse<PreflightResponse>> => {
    recorder.calls.push({ peer: peer.address, method: "POST", path: "/preflight" });
    const message: PreflightResponse = {
      type: "PreflightResponse",
      correlationId: "00000000-0000-0000-0000-000000000000",
      nonce: new Uint8Array(24),
      timestamp: Date.now(),
      version: PROTOCOL_VERSION,
      agentVersion: "0.1.0",
      capabilities: ["preflight"],
      startProgress: opts.preflightOk === false ? "fail\tcheck\tboom" : '{"contactInfo":{"id":"7kAbCd","slot":100}}',
    };
    return Promise.resolve({ message, senderPubkey: new Uint8Array(32) });
  };
  client.status = (peer): Promise<AgentResponse<PreflightResponse>> => {
    recorder.calls.push({ peer: peer.address, method: "GET", path: "/status" });
    const message: PreflightResponse = {
      type: "PreflightResponse",
      correlationId: "00000000-0000-0000-0000-000000000000",
      nonce: new Uint8Array(24),
      timestamp: Date.now(),
      version: PROTOCOL_VERSION,
      agentVersion: "0.1.0",
      capabilities: ["status"],
      startProgress: opts.statusBlob ?? '{"contactInfo":{"id":"7kAbCd","slot":100}}',
    };
    return Promise.resolve({ message, senderPubkey: new Uint8Array(32) });
  };
  client.swapInit = (peer): Promise<AgentResponse<SwapSessionInit>> => {
    recorder.calls.push({ peer: peer.address, method: "POST", path: "/swap/init" });
    const message: SwapSessionInit = {
      type: "SwapSessionInit",
      correlationId: "00000000-0000-0000-0000-000000000000",
      nonce: new Uint8Array(24),
      timestamp: Date.now(),
      version: PROTOCOL_VERSION,
      sessionId,
      sessionPubkey: new Uint8Array(32),
      sessionExpiresAt: Date.now() + 60_000,
    };
    return Promise.resolve({ message, senderPubkey: new Uint8Array(32) });
  };
  client.swapSend = (peer): Promise<AgentResponse<SwapPayload>> => {
    recorder.calls.push({ peer: peer.address, method: "POST", path: "/swap/send" });
    const message: SwapPayload = {
      type: "SwapPayload",
      correlationId: "00000000-0000-0000-0000-000000000000",
      nonce: new Uint8Array(24),
      timestamp: Date.now(),
      version: PROTOCOL_VERSION,
      sessionId,
      recipientSessionPubkey: new Uint8Array(32),
      ciphertext: new Uint8Array(64),
    };
    return Promise.resolve({ message, senderPubkey: new Uint8Array(32) });
  };
  client.swapApply = (peer): Promise<AgentResponse<SwapCompleted>> => {
    recorder.calls.push({ peer: peer.address, method: "POST", path: "/swap/apply" });
    if (opts.applyError !== undefined) {
      return Promise.reject(opts.applyError);
    }
    const message: SwapCompleted = {
      type: "SwapCompleted",
      correlationId: "00000000-0000-0000-0000-000000000000",
      nonce: new Uint8Array(24),
      timestamp: Date.now(),
      version: PROTOCOL_VERSION,
      sessionId,
      finalIdentityPubkey: finalPub,
      durationMs: 1234,
    };
    return Promise.resolve({ message, senderPubkey: new Uint8Array(32) });
  };
  client.swapRollback = (peer): Promise<AgentResponse<SwapCompleted>> => {
    recorder.calls.push({ peer: peer.address, method: "POST", path: "/swap/rollback" });
    if (opts.rollbackThrows === true) {
      return Promise.reject(new Error("rollback exploded"));
    }
    const message: SwapCompleted = {
      type: "SwapCompleted",
      correlationId: "00000000-0000-0000-0000-000000000000",
      nonce: new Uint8Array(24),
      timestamp: Date.now(),
      version: PROTOCOL_VERSION,
      sessionId,
      finalIdentityPubkey: new Uint8Array(32),
      durationMs: 100,
    };
    return Promise.resolve({ message, senderPubkey: new Uint8Array(32) });
  };

  return { client, recorder };
}

const noopProgress: ProgressClient = {
  subscribe: vi.fn(() => ({ close: vi.fn() })),
} as unknown as ProgressClient;

interface SetupResult {
  configPath: string;
}

async function bootstrapConfig(): Promise<SetupResult> {
  const configPath = await mkdtemp(join(tmpdir(), "vswap-swap-test-"));
  await runInit({ configPath }, new MemStream() as unknown as NodeJS.WriteStream);
  const peers = await PeersStore.open(join(configPath, "peers.json"));
  // Generate a real Ed25519 keypair so the base58 encoder accepts it.
  const a = await generateSigningKeypair();
  const b = await generateSigningKeypair();
  await peers.upsert({
    label: "node-a",
    address: "127.0.0.1:7872",
    longTermPubkey: encodeBase58Local(a.publicKey),
    addedAt: Date.now(),
  });
  await peers.upsert({
    label: "node-b",
    address: "127.0.0.1:7873",
    longTermPubkey: encodeBase58Local(b.publicKey),
    addedAt: Date.now(),
  });
  return { configPath };
}

function encodeBase58Local(bytes: Uint8Array): string {
  // Inline tiny base58 to avoid coupling tests to the prod helper.
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
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

describe("vswap swap", () => {
  let configPath: string;
  let stdout: MemStream;

  beforeEach(async () => {
    const setup = await bootstrapConfig();
    configPath = setup.configPath;
    stdout = new MemStream();
  });

  afterEach(async () => {
    await rm(configPath, { recursive: true, force: true });
  });

  it("happy path: drives init → send → apply in order", async () => {
    const { client, recorder } = makeFakeClient({});
    const code = await runSwap(
      { from: "node-a", to: "node-b", configPath, yes: true, json: true },
      {
        agentClient: client,
        progressClient: noopProgress,
        stdout: stdout as unknown as NodeJS.WriteStream,
      },
    );
    expect(code).toBe(0);
    const swapPaths = recorder.calls
      .filter((c) => c.path.startsWith("/swap/"))
      .map((c) => c.path);
    expect(swapPaths).toEqual(["/swap/init", "/swap/send", "/swap/apply"]);
  }, 30000);

  it("dry-run: shows plan and exits before any swap call", async () => {
    const { client, recorder } = makeFakeClient({});
    const code = await runSwap(
      { from: "node-a", to: "node-b", configPath, dryRun: true, json: true },
      {
        agentClient: client,
        progressClient: noopProgress,
        stdout: stdout as unknown as NodeJS.WriteStream,
      },
    );
    expect(code).toBe(0);
    const swapPaths = recorder.calls
      .filter((c) => c.path.startsWith("/swap/"))
      .map((c) => c.path);
    expect(swapPaths).toEqual([]);
    expect(stdout.text()).toContain("\"swap.plan\"");
  }, 30000);

  it("apply fails → automatic rollback on source", async () => {
    const { client, recorder } = makeFakeClient({
      applyError: new AgentResponseError("decryption failed", "DECRYPTION_FAILED", {}),
    });
    const code = await runSwap(
      { from: "node-a", to: "node-b", configPath, yes: true },
      {
        agentClient: client,
        progressClient: noopProgress,
        stdout: stdout as unknown as NodeJS.WriteStream,
      },
    );
    expect(code).toBe(4); // crypto exit code
    const swapPaths = recorder.calls
      .filter((c) => c.path.startsWith("/swap/"))
      .map((c) => c.path);
    expect(swapPaths).toEqual(["/swap/init", "/swap/send", "/swap/apply", "/swap/rollback"]);
    expect(stdout.text()).toContain("Attempting automatic rollback on source");
  }, 30000);

  it("apply + rollback both fail → exit code 6 (rollback needed)", async () => {
    const { client } = makeFakeClient({
      applyError: new AgentResponseError("apply boom", "GENERIC", {}),
      rollbackThrows: true,
    });
    const code = await runSwap(
      { from: "node-a", to: "node-b", configPath, yes: true },
      {
        agentClient: client,
        progressClient: noopProgress,
        stdout: stdout as unknown as NodeJS.WriteStream,
      },
    );
    expect(code).toBe(6);
    expect(stdout.text()).toContain("Rollback FAILED");
  }, 30000);

  it("refuses to swap when source identity cannot be parsed from /status", async () => {
    const { client, recorder } = makeFakeClient({ statusBlob: "not even json" });
    const code = await runSwap(
      { from: "node-a", to: "node-b", configPath, yes: true, json: true },
      {
        agentClient: client,
        progressClient: noopProgress,
        stdout: stdout as unknown as NodeJS.WriteStream,
      },
    );
    expect(code).toBe(1); // Generic — better than letting agent reject "(unknown)"
    const swapPaths = recorder.calls
      .filter((c) => c.path.startsWith("/swap/"))
      .map((c) => c.path);
    expect(swapPaths).toEqual([]);
    expect(stdout.text()).toContain("source identity unknown");
  }, 30000);

  it("connectivity check fails → exit code 3 without touching swap endpoints", async () => {
    const { client, recorder } = makeFakeClient({ health: false });
    const code = await runSwap(
      { from: "node-a", to: "node-b", configPath, yes: true },
      {
        agentClient: client,
        progressClient: noopProgress,
        stdout: stdout as unknown as NodeJS.WriteStream,
      },
    );
    expect(code).toBe(3);
    const swapPaths = recorder.calls
      .filter((c) => c.path.startsWith("/swap/"))
      .map((c) => c.path);
    expect(swapPaths).toEqual([]);
  }, 30000);
});

// keep the AnyMessage import alive even though we never reference it directly
const _typeAlive: AnyMessage | null = null;
void _typeAlive;
