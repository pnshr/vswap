import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AdminRpcClient,
  parseJsonRpcResponse,
} from "../../src/solana/admin-rpc.js";
import { AdminRpcFailedError } from "../../src/errors.js";

interface ReceivedRequest {
  readonly jsonrpc: "2.0";
  readonly id: string;
  readonly method: string;
  readonly params?: unknown;
}

interface FakeValidator {
  readonly socketPath: string;
  readonly server: Server;
  readonly shutdown: () => Promise<void>;
  readonly received: ReceivedRequest[];
}

async function startFakeValidator(
  handler: (req: ReceivedRequest) => unknown,
): Promise<FakeValidator> {
  const dir = await mkdtemp(join(tmpdir(), "admin-rpc-test-"));
  const socketPath = join(dir, "admin.rpc");
  const received: ReceivedRequest[] = [];
  const connections: Socket[] = [];
  const server = createServer((socket) => {
    connections.push(socket);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const idx = buffer.indexOf("\n");
      if (idx < 0) return;
      const raw = buffer.slice(0, idx);
      let parsed: ReceivedRequest;
      try {
        parsed = JSON.parse(raw) as ReceivedRequest;
      } catch {
        socket.end();
        return;
      }
      received.push(parsed);
      const result = handler(parsed);
      socket.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result })}\n`,
      );
      socket.end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(socketPath, () => resolve());
  });
  const shutdown = async (): Promise<void> => {
    for (const c of connections) {
      try {
        c.destroy();
      } catch {
        // ignore
      }
    }
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await rm(dir, { recursive: true, force: true });
  };
  return { socketPath, server, shutdown, received };
}

let cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const c of cleanups) await c();
  cleanups = [];
});

afterAll(async () => {
  for (const c of cleanups) await c();
  cleanups = [];
});

describe("admin-rpc", () => {
  it("round-trips setIdentity through the unix socket", async () => {
    const fake = await startFakeValidator(() => null);
    cleanups.push(fake.shutdown);
    const client = new AdminRpcClient({ socketPath: fake.socketPath });
    await client.setIdentity("/tmp/new.json", true);
    expect(fake.received).toHaveLength(1);
    expect(fake.received[0]?.method).toBe("setIdentity");
    expect(fake.received[0]?.params).toEqual(["/tmp/new.json", true]);
  });

  it("maps contactInfo JSON to a typed struct", async () => {
    const fake = await startFakeValidator(() => ({
      identity: "ident123",
      rpcAddress: "127.0.0.1:8899",
      version: "1.18.0",
      shredVersion: 42,
    }));
    cleanups.push(fake.shutdown);
    const client = new AdminRpcClient({ socketPath: fake.socketPath });
    const info = await client.contactInfo();
    expect(info.identity).toBe("ident123");
    expect(info.rpcAddress).toBe("127.0.0.1:8899");
    expect(info.shredVersion).toBe(42);
  });

  it("raises AdminRpcFailedError when contactInfo returns junk", async () => {
    const fake = await startFakeValidator(() => "not an object");
    cleanups.push(fake.shutdown);
    const client = new AdminRpcClient({ socketPath: fake.socketPath });
    await expect(client.contactInfo()).rejects.toBeInstanceOf(
      AdminRpcFailedError,
    );
  });

  it("times out when the server never replies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "admin-rpc-test-"));
    const socketPath = join(dir, "admin.rpc");
    const sockets: Socket[] = [];
    const server = createServer((socket) => {
      sockets.push(socket);
      // accept but never reply
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    cleanups.push(async () => {
      for (const s of sockets) {
        try {
          s.destroy();
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.unref();
      });
      await rm(dir, { recursive: true, force: true });
    });
    const client = new AdminRpcClient({
      socketPath,
      defaultTimeoutMs: 100,
    });
    await expect(client.rpcAddress()).rejects.toBeInstanceOf(
      AdminRpcFailedError,
    );
  });

  it("parseJsonRpcResponse tolerates newline-delimited streams", () => {
    const raw = `${JSON.stringify({ jsonrpc: "2.0", id: "other", result: 1 })}\n${JSON.stringify({ jsonrpc: "2.0", id: "mine", result: "ok" })}\n`;
    const parsed = parseJsonRpcResponse(raw, "mine");
    expect(parsed.result).toBe("ok");
  });

  it("parseJsonRpcResponse fails when id never matches", () => {
    const raw = `${JSON.stringify({ jsonrpc: "2.0", id: "other", result: 1 })}\n`;
    expect(() => parseJsonRpcResponse(raw, "mine")).toThrow(
      AdminRpcFailedError,
    );
  });
});
