/**
 * preflight-fails.test.ts — the source tower file is missing when the
 * CLI tries to swap. Preflight must catch the condition *before* any
 * admin RPC mutation, and identity A must stay put.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  runCli,
  startEnv,
  resetScenario,
  validator,
  loadManifest,
} from "../harness/index.js";

describe("preflight fails when tower is missing on source", () => {
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

  it("exits non-zero and leaves identity A untouched", async () => {
    // Arrange: remove tower file on source *before* the swap.
    await validator.deleteTower("validator-a");
    const pre = await validator.state("validator-a");
    expect(pre.currentIdentity).toBe(stakedA);
    expect(pre.towerExists).toBe(false);

    // Act.
    const res = await runCli(
      ["swap", "--from", "node-a", "--to", "node-b", "--yes"],
      { timeoutSec: 30 },
    );

    // Assert.
    expect(
      res.exitCode,
      `expected non-zero exit; stdout=${res.stdout}\nstderr=${res.stderr}`,
    ).not.toBe(0);
    const post = await validator.state("validator-a");
    // Critically: the identity must not have mutated.
    expect(post.currentIdentity).toBe(stakedA);
  });
});
