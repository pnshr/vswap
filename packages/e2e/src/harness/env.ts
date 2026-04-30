import { readFile, writeFile } from "node:fs/promises";
import { compose } from "./compose.js";
import { loadManifest, type FixtureManifest } from "./fixtures.js";
import { validator } from "./validator.js";
import { FIXTURES_DIR } from "./paths.js";
import { join } from "node:path";

export interface E2eEnv {
  readonly manifest: FixtureManifest;
}

/** Global singleton populated by `startEnv`. */
let cached: E2eEnv | null = null;

/**
 * Start (or reuse) the e2e environment. Re-invocations are cheap: if
 * the agents are already healthy we just return the cached manifest.
 */
export async function startEnv(): Promise<E2eEnv> {
  if (cached !== null) return cached;
  await compose.up();
  const manifest = await loadManifest();
  cached = { manifest };
  return cached;
}

/** Tear down the environment — called from the global afterAll hook. */
export async function stopEnv(): Promise<void> {
  await compose.down();
  cached = null;
}

/**
 * Reset all per-scenario state between tests. Call from `beforeEach`
 * to guarantee isolation: each scenario sees validator-a staked +
 * voting, validator-b staked + voting (role-swapped or damaged states
 * are reset). Leaves the docker containers running.
 */
export async function resetScenario(): Promise<void> {
  // 1. Clear any chaos flags left over from prior runs.
  await Promise.all([
    validator.setChaos("validator-a", []),
    validator.setChaos("validator-b", []),
  ]);

  // 2. Point each validator's identity back to its boot-time staked
  //    keypair. `reset-identity` also re-creates the tower file for
  //    that pubkey if it was removed or renamed.
  await Promise.all([
    validator.resetIdentity("validator-a"),
    validator.resetIdentity("validator-b"),
  ]);
  await Promise.all([
    validator.ensureTower("validator-a"),
    validator.ensureTower("validator-b"),
  ]);
}

/**
 * Read the operator's paired peers file. Useful for assertions about
 * pairing side-effects.
 */
export async function readPeersJson(): Promise<unknown> {
  const raw = await readFile(
    join(FIXTURES_DIR, "operator", ".vswap", "peers.json"),
    "utf8",
  );
  return JSON.parse(raw);
}

/** Patch the operator peers.json — used by scenarios that tweak addresses. */
export async function writePeersJson(data: unknown): Promise<void> {
  await writeFile(
    join(FIXTURES_DIR, "operator", ".vswap", "peers.json"),
    JSON.stringify(data, null, 2),
  );
}
