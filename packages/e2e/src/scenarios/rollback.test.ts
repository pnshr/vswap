/**
 * rollback.test.ts — place the env in an inconsistent state (both
 * validators unstaked, mid-partial swap), then run `vswap rollback`
 * and confirm identities recover.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  runCli,
  startEnv,
  resetScenario,
  validator,
  loadManifest,
} from "../harness/index.js";

describe("rollback command", () => {
  let stakedA: string;
  let stakedB: string;

  beforeAll(async () => {
    await startEnv();
    const m = await loadManifest();
    stakedA = m.validators["validator-a"].staked;
    stakedB = m.validators["validator-b"].staked;
  });

  beforeEach(async () => {
    await resetScenario();
  });

  afterAll(async () => {
    await resetScenario();
  });

  it("returns both peers to their staked identity", async () => {
    // Induce a partial-swap state: set target chaos so the next swap
    // fails after side-effects — this leaves A at unstaked, B at
    // unstaked (target auto-cleanup path).
    await validator.setChaos("validator-b", ["SET_IDENTITY_FAIL"]);
    await runCli(
      ["swap", "--from", "node-a", "--to", "node-b", "--yes"],
      { timeoutSec: 30 },
    );
    // Lift the chaos flag so the /swap/rollback admin RPC can succeed.
    await validator.setChaos("validator-b", []);

    const rb = await runCli(
      ["rollback", "--from", "node-a", "--to", "node-b", "--yes"],
      { timeoutSec: 30 },
    );
    expect(
      rb.exitCode,
      `rollback stdout=${rb.stdout}\nstderr=${rb.stderr}`,
    ).toBe(0);

    const postA = await validator.state("validator-a");
    const postB = await validator.state("validator-b");
    expect(postA.currentIdentity).toBe(stakedA);
    expect(postB.currentIdentity).toBe(stakedB);
  });
});
