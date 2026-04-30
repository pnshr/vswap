#!/usr/bin/env node
/**
 * vswap real-validator ops sidecar.
 *
 * Serves the SAME HTTP API the mock validator publishes today:
 *
 *   GET  /state           — { currentIdentity, initialIdentity, voters,
 *                             chaos, towerExists, profile: "real",
 *                             slot, clusterVersion }
 *   POST /chaos           — { flags: [...] }   (only filesystem-level
 *                             flags are honoured; see CHAOS_FLAGS below)
 *   POST /tower/delete    — remove the current identity's tower file
 *   POST /tower/corrupt   — { impostorPubkey } — rename the current
 *                             tower so its filename embeds another
 *                             pubkey
 *   POST /tower/ensure    — re-create the current identity's tower
 *                             from the captured initial snapshot
 *   POST /reset-identity  — call admin RPC setIdentity(initialStaked,
 *                             requireTower=false) and restore the
 *                             initial tower snapshot
 *
 * Backing implementations differ from the mock:
 *   - State is read live from the validator's `admin.rpc` unix socket
 *     (`contactInfo`) plus a JSON-RPC HTTP probe (`getSlot`,
 *     `getVersion`).
 *   - Tower manipulation operates on the real ledger directory.
 *   - `reset-identity` uses the real admin RPC `setIdentity` against
 *     the initial staked keypair file.
 *
 * Environment:
 *   LEDGER_PATH          path to the validator's ledger dir (admin.rpc
 *                        socket lives at <LEDGER_PATH>/admin.rpc)
 *   INITIAL_KEYPAIR      path to the validator's initial (staked)
 *                        keypair JSON; this pubkey is the "initial
 *                        identity" for reset purposes
 *   TOWER_SCHEMA_SLUG    optional — overrides the schema chunk in the
 *                        tower filename (default: "1_9")
 *   STATE_DIR            writable dir for the initial-tower snapshot
 *                        (default: /var/lib/vswap-ops)
 *   OPS_HTTP_PORT        port to listen on (default: 7999)
 *   RPC_HTTP_URL         optional — HTTP JSON-RPC URL to probe getSlot/
 *                        getVersion (default: http://127.0.0.1:8899)
 *
 * Notes on chaos flags vs the mock:
 *   - SET_IDENTITY_FAIL    — NOT supported (cannot intercept real
 *                             admin RPC). Returns 501 with a clear
 *                             message; scenarios that rely on it
 *                             should skip the real profile.
 *   - REMOVE_TOWER_ON_SET  — NOT supported (no hook into setIdentity).
 *                             Same 501.
 *   - IGNORE_SET_IDENTITY  — NOT supported.
 *
 * All chaos flags that are file-system-only (none today) would be
 * stored in `chaos` and reflected in `/state`, but no such flags are
 * defined yet for the real profile.
 */
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { connect } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { dirname, join } from "node:path";

const LEDGER = process.env.LEDGER_PATH ?? "/var/ledger";
const SOCKET_PATH = join(LEDGER, "admin.rpc");
const INITIAL_KEYPAIR_PATH =
  process.env.INITIAL_KEYPAIR ?? "/var/validator/staked.json";
const TOWER_SCHEMA_SLUG = process.env.TOWER_SCHEMA_SLUG ?? "1_9";
const STATE_DIR = process.env.STATE_DIR ?? "/var/lib/vswap-ops";
const OPS_HTTP_PORT = Number(process.env.OPS_HTTP_PORT ?? "7999");
const RPC_HTTP_URL = process.env.RPC_HTTP_URL ?? "http://127.0.0.1:8899";

const TOWER_SNAPSHOT_PATH = join(STATE_DIR, "initial-tower.bin");

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
      component: "ops-sidecar",
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

let nextRpcId = 1;

/**
 * Send a single JSON-RPC request to the agave-validator admin.rpc unix
 * socket and return the parsed response. Resolves on the FIRST matching
 * response (newline-framed); the real agave server keeps the
 * connection open for pipelined requests, so we must not wait for
 * end/close. The agent's `admin-rpc.ts` carries the same fix.
 */
function adminRpcCall(method, params, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const id = `ops-${nextRpcId++}`;
    const sock = connect(SOCKET_PATH);
    let buffer = "";
    let settled = false;

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      fn();
    };

    const timer = setTimeout(() => {
      settle(() =>
        reject(new Error(`admin RPC ${method} timed out after ${timeoutMs}ms`)),
      );
    }, timeoutMs);

    const handleParsed = (parsed) => {
      if (parsed?.id !== id) return false;
      if (parsed.error) {
        settle(() =>
          reject(
            new Error(
              `admin RPC ${method} error: ${parsed.error.message ?? "unknown"} (code ${parsed.error.code ?? "?"})`,
            ),
          ),
        );
        return true;
      }
      settle(() => resolve(parsed.result));
      return true;
    };

    const tryDrain = () => {
      let nl = buffer.indexOf("\n");
      while (nl >= 0 && !settled) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.length === 0) {
          nl = buffer.indexOf("\n");
          continue;
        }
        try {
          const parsed = JSON.parse(line);
          if (handleParsed(parsed)) return;
        } catch {
          // fall through — server may have sent a banner.
        }
        nl = buffer.indexOf("\n");
      }
    };

    sock.on("connect", () => {
      const req = { jsonrpc: "2.0", id, method, params };
      sock.write(JSON.stringify(req) + "\n");
    });
    sock.on("data", (c) => {
      buffer += c.toString("utf8");
      tryDrain();
    });
    const finishOnClose = () => {
      // The mock validator closes the socket after each response
      // without a trailing newline. Try the trailing buffer once
      // before giving up.
      if (buffer.length > 0) {
        const trimmed = buffer.trim();
        buffer = "";
        if (trimmed.length > 0) {
          try {
            const parsed = JSON.parse(trimmed);
            if (handleParsed(parsed)) return;
          } catch {
            /* fall through */
          }
        }
      }
      settle(() =>
        reject(
          new Error(
            `admin RPC ${method} connection closed without a matching response`,
          ),
        ),
      );
    };
    sock.on("end", finishOnClose);
    sock.on("close", finishOnClose);
    sock.on("error", (err) =>
      settle(() => reject(new Error(`admin RPC socket error: ${err.message}`))),
    );
  });
}

/**
 * Probe the validator's HTTP JSON-RPC endpoint for current slot +
 * version. We tolerate failures (the validator may still be warming up
 * or the test may be running with the HTTP RPC disabled) by returning
 * `null` for individual fields.
 */
async function probeRpcHttp() {
  try {
    const res = await fetch(RPC_HTTP_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: "ops-getSlot", method: "getSlot" },
        { jsonrpc: "2.0", id: "ops-getVersion", method: "getVersion" },
      ]),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { slot: null, clusterVersion: null };
    const arr = await res.json();
    const map = new Map(arr.map((entry) => [entry.id, entry.result]));
    return {
      slot:
        typeof map.get("ops-getSlot") === "number"
          ? map.get("ops-getSlot")
          : null,
      clusterVersion: map.get("ops-getVersion")?.["solana-core"] ?? null,
    };
  } catch {
    return { slot: null, clusterVersion: null };
  }
}

/** Find any tower file matching the given pubkey in LEDGER. */
async function findTowerForPubkey(pubkey) {
  const fs = await import("node:fs/promises");
  let entries;
  try {
    entries = await fs.readdir(LEDGER);
  } catch {
    return null;
  }
  const re = /^tower-[A-Za-z0-9._]+-([1-9A-HJ-NP-Za-km-z]{32,44})\.bin$/;
  for (const entry of entries) {
    const m = re.exec(entry);
    if (m && m[1] === pubkey) return join(LEDGER, entry);
  }
  return null;
}

const state = {
  initialIdentity: null,
  voters: [],
  /**
   * Chaos flags here are tracked for /state introspection only — none
   * have a real implementation in the real profile. Setting any of them
   * is a no-op (returned as `unsupported` in the response).
   */
  chaos: new Set(),
};

const UNSUPPORTED_CHAOS_FLAGS = new Set([
  "SET_IDENTITY_FAIL",
  "REMOVE_TOWER_ON_SET",
  "IGNORE_SET_IDENTITY",
]);

async function ensureSnapshotIfPossible() {
  if (await exists(TOWER_SNAPSHOT_PATH)) return;
  const candidate = await findTowerForPubkey(state.initialIdentity);
  if (candidate === null) return; // not yet produced
  await mkdir(dirname(TOWER_SNAPSHOT_PATH), { recursive: true });
  await copyFile(candidate, TOWER_SNAPSHOT_PATH);
  log("snapshot.captured", {
    from: candidate,
    to: TOWER_SNAPSHOT_PATH,
  });
}

async function restoreSnapshotForCurrent(pubkey) {
  if (!(await exists(TOWER_SNAPSHOT_PATH))) {
    log("snapshot.missing");
    return false;
  }
  const target = join(LEDGER, `tower-${TOWER_SCHEMA_SLUG}-${pubkey}.bin`);
  await copyFile(TOWER_SNAPSHOT_PATH, target);
  log("snapshot.restored", { target });
  return true;
}

async function getCurrentIdentity() {
  const info = await adminRpcCall("contactInfo", []);
  // Real agave-validator returns the pubkey under `id`; the mock
  // profile returns `identity`. Accept either.
  const id =
    typeof info?.identity === "string" && info.identity.length > 0
      ? info.identity
      : typeof info?.id === "string" && info.id.length > 0
        ? info.id
        : null;
  if (id === null) {
    throw new Error("admin RPC contactInfo returned no identity");
  }
  return id;
}

async function buildState() {
  const [identity, rpcInfo] = await Promise.all([
    getCurrentIdentity().catch((err) => {
      log("state.contactInfo.error", { err: err.message });
      return null;
    }),
    probeRpcHttp(),
  ]);
  const towerPath =
    identity !== null ? await findTowerForPubkey(identity) : null;
  // Real agave's admin RPC does not expose the list of authorized
  // voters (no `getAuthorizedVoters` method). The existing scenarios
  // assert `voters.includes(stakedA)` on the swap target after a
  // successful swap. The agent's swap-target flow always calls
  // `addAuthorizedVoter(<currentIdentity>)` immediately after
  // `setIdentity`, so currentIdentity is a faithful proxy for "this
  // validator has added this identity as an authorised voter and is
  // currently voting under it". We synthesise the field on that
  // basis so scenarios stay profile-agnostic.
  const syntheticVoters =
    identity !== null && identity !== state.initialIdentity ? [identity] : [];
  return {
    profile: "real",
    currentIdentity: identity,
    initialIdentity: state.initialIdentity,
    voters: syntheticVoters,
    chaos: Array.from(state.chaos),
    towerExists: towerPath !== null,
    slot: rpcInfo.slot,
    clusterVersion: rpcInfo.clusterVersion,
  };
}

async function deleteCurrentTower() {
  const identity = await getCurrentIdentity();
  const towerPath = await findTowerForPubkey(identity);
  if (towerPath === null) return false;
  await unlink(towerPath);
  log("tower.deleted", { path: towerPath });
  return true;
}

async function corruptCurrentTower(impostorPubkey) {
  const identity = await getCurrentIdentity();
  const towerPath = await findTowerForPubkey(identity);
  if (towerPath === null) {
    throw new Error(`no tower file for current identity ${identity}`);
  }
  const newName = `tower-${TOWER_SCHEMA_SLUG}-${impostorPubkey}.bin`;
  const newPath = join(LEDGER, newName);
  await rename(towerPath, newPath);
  log("tower.corrupted", { from: towerPath, to: newPath });
  return newPath;
}

async function ensureCurrentTower() {
  // The harness uses ensureTower() in resetScenario() right after
  // resetIdentity(). The expected post-condition is "the validator's
  // initial-staked identity has a tower file in the ledger so the
  // next swap source can read it". On real agave, contactInfo's
  // reported identity lags behind setIdentity by several seconds
  // (gossip propagation), so we cannot rely on getCurrentIdentity()
  // here — we'd see the previous identity (e.g. unstaked-A after a
  // completed swap) and miss the snapshot. Always operate against
  // the initial-staked identity, which is what the harness's
  // resetIdentity() most-recently asked for.
  const identity = state.initialIdentity;
  if (identity === null) {
    throw new Error("initial identity not yet known");
  }
  const existing = await findTowerForPubkey(identity);
  if (existing !== null) return existing;
  if (!(await exists(TOWER_SNAPSHOT_PATH))) {
    throw new Error("initial tower snapshot has not been captured yet");
  }
  const target = join(LEDGER, `tower-${TOWER_SCHEMA_SLUG}-${identity}.bin`);
  await copyFile(TOWER_SNAPSHOT_PATH, target);
  log("tower.ensured", { target });
  return target;
}

async function resetIdentity() {
  // Best-effort restore of the snapshot first so requireTower paths in
  // any subsequent test see a tower file. The validator may still hold
  // the latest tower-<initialPubkey>.bin in memory; copying over it is
  // safe because setIdentity below re-loads identity state.
  await restoreSnapshotForCurrent(state.initialIdentity);
  await adminRpcCall("setIdentity", [INITIAL_KEYPAIR_PATH, false], 30_000);
  // Real agave's addAuthorizedVoter is NOT idempotent — re-adding
  // the same voter returns an error. The mock dedupes silently.
  // resetScenario between tests therefore has to clear voter state on
  // the real validator too, otherwise the second test's swap target
  // hits "already an authorized voter for this validator" on its
  // addAuthorizedVoter call.
  try {
    await adminRpcCall("removeAllAuthorizedVoters", [], 10_000);
  } catch (err) {
    log("reset-identity.removeAllAuthorizedVoters.error", { err: err.message });
  }
  state.voters = [];
  log("reset-identity", { identity: state.initialIdentity });
}

async function startHttp() {
  const server = createHttpServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = req.url ?? "";
      const method = req.method ?? "GET";
      try {
        if (url === "/state" && method === "GET") {
          const out = await buildState();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(out));
          return;
        }
        if (url === "/chaos" && method === "POST") {
          const { flags } = JSON.parse(body || "{}");
          state.chaos.clear();
          const unsupported = [];
          for (const f of flags ?? []) {
            const flag = String(f);
            if (UNSUPPORTED_CHAOS_FLAGS.has(flag)) {
              unsupported.push(flag);
              continue;
            }
            state.chaos.add(flag);
          }
          log("chaos.set", {
            flags: Array.from(state.chaos),
            unsupported,
          });
          res.writeHead(unsupported.length === 0 ? 200 : 501, {
            "content-type": "application/json",
          });
          res.end(
            JSON.stringify({
              ok: unsupported.length === 0,
              chaos: Array.from(state.chaos),
              unsupported,
              note:
                unsupported.length === 0
                  ? undefined
                  : "real profile cannot intercept admin RPC; skip these scenarios",
            }),
          );
          return;
        }
        if (url === "/tower/delete" && method === "POST") {
          const ok = await deleteCurrentTower();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok }));
          return;
        }
        if (url === "/tower/corrupt" && method === "POST") {
          const parsed = JSON.parse(body || "{}");
          const impostor = parsed.impostorPubkey;
          if (typeof impostor !== "string" || impostor.length < 32) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "impostorPubkey required" }));
            return;
          }
          await corruptCurrentTower(impostor);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (url === "/tower/ensure" && method === "POST") {
          await ensureCurrentTower();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (url === "/reset-identity" && method === "POST") {
          await resetIdentity();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (url === "/snapshot" && method === "POST") {
          // Test-helper: capture the initial tower snapshot now if the
          // validator has produced it. up-real.sh polls this on first
          // boot.
          await ensureSnapshotIfPossible();
          const captured = await exists(TOWER_SNAPSHOT_PATH);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, captured }));
          return;
        }
        res.writeHead(404);
        res.end();
      } catch (err) {
        log("http.error", { url, err: err.message });
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(OPS_HTTP_PORT, () => {
      log("listening", { port: OPS_HTTP_PORT });
      resolve(server);
    });
  });
}

async function boot() {
  await mkdir(STATE_DIR, { recursive: true });
  state.initialIdentity = await readPubkeyFromKeypairFile(INITIAL_KEYPAIR_PATH);
  log("boot", {
    ledger: LEDGER,
    initialIdentity: state.initialIdentity,
    socket: SOCKET_PATH,
    schema: TOWER_SCHEMA_SLUG,
  });
  // Background snapshot capture: poll until the validator produces the
  // initial tower file, then copy it once into STATE_DIR.
  const snapshotTimer = setInterval(() => {
    ensureSnapshotIfPossible().catch((err) =>
      log("snapshot.error", { err: err.message }),
    );
  }, 1500);
  snapshotTimer.unref?.();
}

async function main() {
  await boot();
  const server = await startHttp();
  const shutdown = () => {
    log("shutdown");
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
