import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
// src/harness/paths.ts → src/harness → src → packages/e2e → repo root
// During tests the file runs from source, not compiled dist.
export const REPO_ROOT = resolve(dirname(__filename), "..", "..", "..", "..");
export const TEST_ENV_DIR = join(REPO_ROOT, "scripts", "test-env");
export const FIXTURES_DIR = join(TEST_ENV_DIR, "fixtures");
export const OPERATOR_HOME = join(FIXTURES_DIR, "operator", ".vswap");
export const CLI_BIN = join(REPO_ROOT, "packages", "cli", "bin", "vswap.js");

/**
 * Test-environment profile. Two are supported:
 *
 *  - `mock` (default): Node mock validator that speaks just enough
 *    admin RPC to drive the agent, plus a chaos HTTP plane on the same
 *    container. Fast, hermetic, no Solana code in the loop.
 *
 *  - `real`: real `agave-validator` running `solana-test-validator` per
 *    side, with a sibling Node "ops" sidecar that re-exposes the same
 *    chaos HTTP API the scenarios depend on. Slow boot (validator must
 *    reach `getHealth: ok` and produce a tower file), high fidelity:
 *    setIdentity / requireTower / addAuthorizedVoter all hit real code.
 *
 * Selected via the `VSWAP_E2E_PROFILE` env var. Anything other than
 * `real` (including unset) yields `mock`.
 */
export type TestProfile = "mock" | "real";

export function activeProfile(): TestProfile {
  return process.env.VSWAP_E2E_PROFILE === "real" ? "real" : "mock";
}

export const COMPOSE_FILE_MOCK = join(TEST_ENV_DIR, "docker-compose.yml");
export const COMPOSE_FILE_REAL = join(TEST_ENV_DIR, "docker-compose.real.yml");

/** Compose file matching the active profile. */
export function activeComposeFile(): string {
  return activeProfile() === "real" ? COMPOSE_FILE_REAL : COMPOSE_FILE_MOCK;
}

/**
 * Backwards-compatible alias. Older harness modules import COMPOSE_FILE
 * directly; that import now reflects whichever profile is active when the
 * module is loaded.
 */
export const COMPOSE_FILE = activeComposeFile();
