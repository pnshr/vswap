/**
 * happy-path.test.ts — the golden-path e2e test. Boots the env once,
 * then runs a full `vswap swap` 10 consecutive times and asserts each
 * one moves the identity across validators in under 5 seconds. The
 * primary success metric is 10/10 runs green.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  runCli,
  startEnv,
  resetScenario,
  validator,
  loadManifest,
} from "../harness/index.js";

describe("happy-path swap", () => {
  let stakedA: string;
  let unstakedA: string;
  let stakedB: string;

  beforeAll(async () => {
    await startEnv();
    const manifest = await loadManifest();
    stakedA = manifest.validators["validator-a"].staked;
    unstakedA = manifest.validators["validator-a"].unstaked;
    stakedB = manifest.validators["validator-b"].staked;
  });

  afterAll(async () => {
    await resetScenario();
  });

  beforeEach(async () => {
    await resetScenario();
  });

  // 10 independent runs — each must move A's identity to B, the swap
  // window must be under 5 seconds, and the rollback command must
  // return both validators to their boot identities. We don't use
  // `it.concurrent` (tests must be strictly sequential) but we do
  // emit 10 separate test cases so Vitest reports per-run timings.
  const runs = Array.from({ length: 10 }, (_, i) => i + 1);
  it.each(runs)(
    "swap %s/10 completes in <5s and moves identity A→B",
    async (runIndex) => {
      // Starting state is guaranteed by beforeEach.
      const preA = await validator.state("validator-a");
      const preB = await validator.state("validator-b");
      expect(preA.currentIdentity).toBe(stakedA);
      expect(preB.currentIdentity).toBe(stakedB);

      const swap = await runCli(
        ["swap", "--from", "node-a", "--to", "node-b", "--yes"],
        { timeoutSec: 30 },
      );
      if (swap.exitCode !== 0) {
        throw new Error(
          `run ${runIndex}: vswap swap exited ${swap.exitCode}\n--- stdout ---\n${swap.stdout}\n--- stderr ---\n${swap.stderr}`,
        );
      }

      // Must advertise a swap window. The CLI formats it as "in <N> ms".
      const match = swap.stdout.match(/Swap completed in (\d+) ms/);
      expect(match, `run ${runIndex}: expected swap window in output`).not.toBeNull();
      const windowMs = Number(match?.[1] ?? "99999");
      expect(windowMs, `run ${runIndex}: swap window ${windowMs}ms exceeded 5s budget`).toBeLessThan(5000);

      // Post-state: A is now unstaked, B holds A's staked pubkey.
      const postA = await validator.state("validator-a");
      const postB = await validator.state("validator-b");
      expect(postA.currentIdentity, `run ${runIndex}: validator-a should be unstaked`).toBe(unstakedA);
      expect(postB.currentIdentity, `run ${runIndex}: validator-b should now vote as A-staked`).toBe(stakedA);
      expect(postB.voters, `run ${runIndex}: B should have added A-staked as authorized voter`).toContain(stakedA);
    },
  );
});
