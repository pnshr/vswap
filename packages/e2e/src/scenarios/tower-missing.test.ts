/**
 * tower-missing.test.ts — variant of preflight-fails: we skip preflight
 * (`--no-preflight`) so the tower gap is only noticed at swap-time by
 * the source agent, which must bail before touching admin RPC.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  runCli,
  startEnv,
  resetScenario,
  validator,
  loadManifest,
} from "../harness/index.js";

describe("source tower missing (no-preflight)", () => {
  let stakedA: string;

  beforeAll(async () => {
    await startEnv();
    stakedA = (await loadManifest()).validators["validator-a"].staked;
  });

  beforeEach(async () => {
    await resetScenario();
  });

  afterAll(async () => {
    await resetScenario();
  });

  it("returns a TowerMissingError-ish failure; A untouched", async () => {
    await validator.deleteTower("validator-a");
    const res = await runCli(
      [
        "swap",
        "--from",
        "node-a",
        "--to",
        "node-b",
        "--yes",
        "--no-preflight",
      ],
      { timeoutSec: 30 },
    );

    expect(res.exitCode).not.toBe(0);
    // The CLI should surface a diagnostic that mentions the tower
    // rather than an opaque "internal error".
    expect(`${res.stdout}\n${res.stderr}`.toLowerCase()).toMatch(/tower/);

    // Identity untouched.
    const post = await validator.state("validator-a");
    expect(post.currentIdentity).toBe(stakedA);
  });
});
