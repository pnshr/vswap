#!/usr/bin/env node
/**
 * vswap mock validator — a drop-in replacement for `agave-validator`'s
 * admin RPC socket that speaks just enough of the JSON-RPC surface for
 * `@vswap/agent` to complete a swap. No voting, no consensus, no slot
 * production — this service exists purely so e2e tests can exercise
 * the agent code path without pulling in a 2 GB Solana image.
 *
 * State it tracks per instance:
 *   - `currentIdentity`: base58 pubkey the validator currently votes as
 *   - `tower`: raw bytes of the tower file, kept on disk at
 *              `<ledger>/tower-<cluster>-<currentIdentity>.bin`.
 *
 * JSON-RPC methods implemented:
 *   - `contactInfo()`           → { identity, rpcAddress, tpuAddress, version, shredVersion }
 *   - `rpcAddress()`            → "127.0.0.1:<rpcPort>" (fake)
 *   - `setIdentity([keypairPath, requireTower])` → null
 *   - `addAuthorizedVoter([keypairPath])`        → null
 *   - `removeAllAuthorizedVoters()`              → null
 *
 * Environment variables:
 *   LEDGER_PATH        absolute path to the ledger dir (admin.rpc socket goes here)
 *   INITIAL_KEYPAIR    path to the keypair file the validator boots as (staked.json)
 *   TOWER_PUBKEY       optional — override the pubkey embedded in the generated tower filename
 *   TOWER_BYTES        optional — initial tower contents (default: random 512 bytes)
 *   CHAOS              optional comma-separated flags; see CHAOS_FLAGS below
 *
 * Chaos flags (controlled via /chaos HTTP admin endpoint on port 7999):
 *   SET_IDENTITY_FAIL     → next setIdentity returns -32000
 *   REMOVE_TOWER_ON_SET   → delete the tower file when setIdentity is called
 *   IGNORE_SET_IDENTITY   → pretend setIdentity succeeded but don't change identity
 *
 * The admin HTTP control plane on :7999 also exposes:
 *   GET  /state           — current identity + tower presence
 *   POST /chaos           — set chaos flags via JSON body { flags: [...] }
 *   POST /tower/delete    — remove the current tower file
 *   POST /tower/corrupt   — rename the current tower to another pubkey
 *
 * Everything logs to stdout. A minimal pino-style JSON line per event
 * keeps the e2e log aggregator parseable.
 */
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

const LEDGER = process.env.LEDGER_PATH ?? "/var/ledger";
const SOCKET_PATH = join(LEDGER, "admin.rpc");
const RPC_FAKE_ADDR = process.env.RPC_ADDR ?? "127.0.0.1:8899";
const TPU_FAKE_ADDR = process.env.TPU_ADDR ?? "127.0.0.1:1024";
const VERSION_STRING = process.env.VERSION_STRING ?? "2.0.0-mock";
const SHRED_VERSION = Number(process.env.SHRED_VERSION ?? "0");
const CHAOS_HTTP_PORT = Number(process.env.CHAOS_HTTP_PORT ?? "7999");

/** Solana base58 alphabet. */
const BASE58 =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes) {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const source = Array.from(bytes);
  const size = Math.ceil((bytes.length * 138) / 100) + 1;
  const b58 = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < source.length; i++) {
    let carry = source[i];
    let j = 0;
    for (let it = size - 1; (carry !== 0 || j < length) && it >= 0; it--, j++) {
      carry += 256 * b58[it];
      b58[it] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }
  let iter = size - length;
  while (iter < size && b58[iter] === 0) iter++;
  let out = "1".repeat(zeros);
  while (iter < size) out += BASE58[b58[iter++]];
  return out;
}

function log(event, fields = {}) {
  process.stdout.write(
    JSON.stringify({
      level: 30,
      time: Date.now(),
      component: "mock-validator",
      event,
      ...fields,
    }) + "\n",
  );
}

async function readPubkeyFromKeypairFile(path) {
  const raw = await readFile(path, "utf8");
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr) || arr.length !== 64) {
    throw new Error(`invalid keypair file at ${path}`);
  }
  const bytes = new Uint8Array(arr);
  // Last 32 bytes of the libsodium sk layout are the public key.
  return encodeBase58(bytes.slice(32));
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureTower(identityPubkey, bytesOverride) {
  const name = `tower-1_9-${identityPubkey}.bin`;
  const path = join(LEDGER, name);
  if (await exists(path)) return path;
  const body = bytesOverride ?? randomBytes(512);
  await writeFile(path, body, { mode: 0o600 });
  log("tower.created", { path, size: body.length });
  return path;
}

async function removeTowerIfAny(identityPubkey) {
  const path = join(LEDGER, `tower-1_9-${identityPubkey}.bin`);
  if (await exists(path)) {
    await unlink(path);
    log("tower.removed", { path });
  }
}

const chaos = new Set(
  (process.env.CHAOS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);

const state = {
  currentIdentity: null,
  initialIdentity: null,
  voters: [],
};

async function boot() {
  await mkdir(LEDGER, { recursive: true });
  const initialKeypair = process.env.INITIAL_KEYPAIR;
  if (!initialKeypair) {
    throw new Error("INITIAL_KEYPAIR env var is required");
  }
  const initialPubkey = await readPubkeyFromKeypairFile(initialKeypair);
  state.currentIdentity = initialPubkey;
  state.initialIdentity = initialPubkey;
  log("boot", { ledger: LEDGER, identity: initialPubkey });

  // Seed a tower file for the initial identity so preflight checks
  // pass on boot.
  await ensureTower(initialPubkey);
}

/** JSON-RPC handler — returns { result } or { error }. */
async function handleRpc(method, params) {
  switch (method) {
    case "contactInfo": {
      return {
        result: {
          identity: state.currentIdentity,
          rpcAddress: RPC_FAKE_ADDR,
          tpuAddress: TPU_FAKE_ADDR,
          version: VERSION_STRING,
          shredVersion: SHRED_VERSION,
        },
      };
    }
    case "rpcAddress": {
      return { result: RPC_FAKE_ADDR };
    }
    case "setIdentity": {
      if (!Array.isArray(params) || params.length < 1) {
        return { error: { code: -32602, message: "expected [keypairPath, requireTower]" } };
      }
      const [keypairPath, requireTower] = params;
      if (chaos.has("SET_IDENTITY_FAIL")) {
        log("chaos.setIdentity.fail");
        return { error: { code: -32000, message: "chaos: setIdentity refused" } };
      }
      const nextPubkey = await readPubkeyFromKeypairFile(keypairPath);
      if (requireTower === true) {
        const towerPath = join(LEDGER, `tower-1_9-${nextPubkey}.bin`);
        if (!(await exists(towerPath))) {
          return {
            error: {
              code: -32000,
              message: `tower file missing for ${nextPubkey}; requireTower=true`,
            },
          };
        }
      }
      if (chaos.has("IGNORE_SET_IDENTITY")) {
        log("chaos.setIdentity.ignored", { requested: nextPubkey });
        return { result: null };
      }
      state.currentIdentity = nextPubkey;
      log("setIdentity", { identity: nextPubkey, requireTower });
      if (chaos.has("REMOVE_TOWER_ON_SET")) {
        await removeTowerIfAny(nextPubkey);
      }
      return { result: null };
    }
    case "addAuthorizedVoter": {
      if (!Array.isArray(params) || params.length < 1) {
        return { error: { code: -32602, message: "expected [keypairPath]" } };
      }
      const pubkey = await readPubkeyFromKeypairFile(params[0]);
      if (!state.voters.includes(pubkey)) state.voters.push(pubkey);
      log("addAuthorizedVoter", { pubkey });
      return { result: null };
    }
    case "removeAllAuthorizedVoters": {
      state.voters = [];
      log("removeAllAuthorizedVoters");
      return { result: null };
    }
    default: {
      return {
        error: {
          code: -32601,
          message: `method not implemented: ${method}`,
        },
      };
    }
  }
}

function startJsonRpcSocket() {
  const server = createNetServer((sock) => {
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        void handleLine(line, sock);
      }
    });
    sock.on("error", (err) => log("socket.error", { err: err.message }));
  });

  async function handleLine(line, sock) {
    let req;
    try {
      req = JSON.parse(line);
    } catch (err) {
      const resp = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "parse error" },
      };
      sock.write(JSON.stringify(resp) + "\n");
      sock.end();
      return;
    }
    const { id, method, params } = req;
    log("rpc.in", { id, method });
    let resp;
    try {
      const out = await handleRpc(method, params);
      resp = { jsonrpc: "2.0", id, ...out };
    } catch (err) {
      resp = {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: err.message ?? String(err) },
      };
    }
    sock.write(JSON.stringify(resp) + "\n");
    sock.end();
  }

  return new Promise((resolve, reject) => {
    // Clean up any stale socket from a previous run.
    unlink(SOCKET_PATH).catch(() => {});
    server.listen(SOCKET_PATH, () => {
      log("rpc.listening", { socket: SOCKET_PATH });
      resolve(server);
    });
    server.on("error", reject);
  });
}

function startChaosHttp() {
  const server = createHttpServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const body = Buffer.concat(chunks).toString("utf8");
      try {
        if (req.url === "/state" && req.method === "GET") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              currentIdentity: state.currentIdentity,
              initialIdentity: state.initialIdentity,
              voters: state.voters,
              chaos: Array.from(chaos),
              towerExists: await exists(
                join(LEDGER, `tower-1_9-${state.currentIdentity}.bin`),
              ),
            }),
          );
          return;
        }
        if (req.url === "/chaos" && req.method === "POST") {
          const { flags } = JSON.parse(body || "{}");
          chaos.clear();
          for (const f of flags ?? []) chaos.add(String(f));
          log("chaos.set", { flags: Array.from(chaos) });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, chaos: Array.from(chaos) }));
          return;
        }
        if (req.url === "/tower/delete" && req.method === "POST") {
          await removeTowerIfAny(state.currentIdentity);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url === "/tower/corrupt" && req.method === "POST") {
          // Parameters: { impostorPubkey: string }
          const parsed = JSON.parse(body || "{}");
          const impostor = parsed.impostorPubkey;
          if (typeof impostor !== "string" || impostor.length < 32) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "impostorPubkey required" }));
            return;
          }
          const oldName = `tower-1_9-${state.currentIdentity}.bin`;
          const newName = `tower-1_9-${impostor}.bin`;
          await rename(join(LEDGER, oldName), join(LEDGER, newName));
          log("chaos.tower.corrupted", {
            from: state.currentIdentity,
            to: impostor,
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, newName }));
          return;
        }
        if (req.url === "/tower/ensure" && req.method === "POST") {
          await ensureTower(state.currentIdentity);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url === "/reset-identity" && req.method === "POST") {
          state.currentIdentity = state.initialIdentity;
          // Clear authorized voters so scenarios don't leak A-staked
          // pubkeys into subsequent runs.
          state.voters = [];
          await ensureTower(state.currentIdentity);
          log("reset-identity", {
            identity: state.currentIdentity,
            voters: state.voters,
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.writeHead(404);
        res.end();
      } catch (err) {
        log("chaos.http.error", { err: err.message });
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(CHAOS_HTTP_PORT, () => {
      log("chaos.http.listening", { port: CHAOS_HTTP_PORT });
      resolve(server);
    });
  });
}

async function main() {
  await boot();
  const rpc = await startJsonRpcSocket();
  const chaosHttp = await startChaosHttp();

  const shutdown = async (signal) => {
    log("shutdown", { signal });
    rpc.close();
    chaosHttp.close();
    await unlink(SOCKET_PATH).catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
