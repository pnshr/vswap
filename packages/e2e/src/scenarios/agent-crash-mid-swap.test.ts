/**
 * agent-crash-mid-swap.test.ts — stop agent-b right before the swap
 * fires. The CLI must surface a transport error, then `vswap rollback`
 * returns A to its staked identity.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  runCli,
  startEnv,
  compose,
  resetScenario,
  validator,
  loadManifest,
} from "../harness/index.js";

describe("agent-b crashes mid-swap", () => {
  let stakedA: string;

  beforeAll(async () => {
    await startEnv();
    stakedA = (await loadManifest()).validators["validator-a"].staked;
  });

  beforeEach(async () => {
    await resetScenario();
  });

  afterAll(async () => {
    // Make sure the environment is restored for downstream tests.
    await compose.start("agent-b");
    await compose.waitHealthy("agent-b");
    await resetScenario();
  });

  it("surfaces a transport failure and rollback restores source", async () => {
    // Take agent-b offline.
    await compose.stop("agent-b");

    const swap = await runCli(
      ["swap", "--from", "node-a", "--to", "node-b", "--yes"],
      { timeoutSec: 30 },
    );
    expect(swap.exitCode).not.toBe(0);
    // The failure should be quick — no hanging for a full minute.
    expect(swap.durationMs).toBeLessThan(20_000);

    // Bring agent-b back up and run rollback.
    await compose.start("agent-b");
    await compose.waitHealthy("agent-b", { timeoutMs: 30_000 });

    const rb = await runCli(
      ["rollback", "--from", "node-a", "--to", "node-b", "--yes"],
      { timeoutSec: 30 },
    );
    // rollback returns 0 even if one peer was already staked.
    expect(rb.exitCode).toBe(0);

    const postA = await validator.state("validator-a");
    expect(postA.currentIdentity).toBe(stakedA);
  });
});
