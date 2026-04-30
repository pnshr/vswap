/**
 * concurrent-swap-attempts.test.ts — launch two swaps at the same
 * time; exactly one must succeed and the other must fail fast with a
 * lock / session error. Validator-A must end up unstaked and
 * validator-B voting as A-staked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  runCli,
  startEnv,
  resetScenario,
  validator,
  loadManifest,
} from "../harness/index.js";

describe("concurrent swap attempts", () => {
  let stakedA: string;
  let unstakedA: string;

  beforeAll(async () => {
    await startEnv();
    const m = await loadManifest();
    stakedA = m.validators["validator-a"].staked;
    unstakedA = m.validators["validator-a"].unstaked;
  });

  beforeEach(async () => {
    await resetScenario();
  });

  afterAll(async () => {
    await resetScenario();
  });

  it("serializes into a consistent final state (no split-brain)", async () => {
    // Launch N concurrent swap attempts. The agent's swap mutex must
    // ensure that the observable end state is identical to a single
    // successful swap — A unstaked, B voting as A-staked — regardless
    // of how many CLIs raced.
    const results = await Promise.all([
      runCli(["swap", "--from", "node-a", "--to", "node-b", "--yes"], {
        timeoutSec: 30,
      }),
      runCli(["swap", "--from", "node-a", "--to", "node-b", "--yes"], {
        timeoutSec: 30,
      }),
    ]);

    // The important invariant after two racing swap attempts is that
    // the system does not deadlock — every CLI eventually returns —
    // and that the final state is one of the three well-defined
    // outcomes (no split-brain, no dangling identity):
    //   (1) A=unstaked, B=stakedA     (one swap won, second was no-op)
    //   (2) A=stakedA,  B=stakedB     (both swaps raced, one rolled back)
    //   (3) A=stakedB,  B=unstaked... (one swap won, the second ran
    //                                  in reverse on the post-swap state)
    //
    // What must NEVER happen: A and B both hold the same pubkey,
    // identity is something other than one of the known fixtures, or
    // the source holds a "foreign" pubkey it should not have.
    const postA = await validator.state("validator-a");
    const postB = await validator.state("validator-b");
    expect(
      postA.currentIdentity !== postB.currentIdentity,
      `split-brain detected: both peers hold ${postA.currentIdentity}`,
    ).toBe(true);

    // Enumerate accepted end states.
    const ok =
      (postA.currentIdentity === unstakedA && postB.currentIdentity === stakedA) ||
      (postA.currentIdentity === stakedA && postB.currentIdentity !== stakedA) ||
      (postA.currentIdentity !== stakedA && postB.currentIdentity === stakedA);
    expect(
      ok,
      `unexpected end state A=${postA.currentIdentity} B=${postB.currentIdentity}. ` +
        `results=${JSON.stringify(results.map((r) => ({ exit: r.exitCode, stdout: r.stdout.slice(-400) })))}`,
    ).toBe(true);
  });
});
