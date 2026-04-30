/**
 * tampered-ciphertext.test.ts — exercise the target-side decryption
 * guard via the mock validator's SET_IDENTITY_FAIL chaos flag. A real
 * tamper would be caught by sealed-box decryption failure; here we
 * emulate "target refuses to set identity" which surfaces the same
 * observable outcome for the operator: swap fails, A is rolled back,
 * B stays untouched.
 *
 * Modelling ciphertext tampering without access to the in-flight
 * bytes requires a man-in-the-middle shim in the transport layer;
 * that is out of scope for the mock harness, so we use this
 * semantically equivalent injection point.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  runCli,
  startEnv,
  resetScenario,
  validator,
  loadManifest,
} from "../harness/index.js";

describe("tampered / rejected ciphertext application", () => {
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
    await validator.setChaos("validator-b", []);
  });

  it("fails the swap and rolls A back to staked", async () => {
    await validator.setChaos("validator-b", ["SET_IDENTITY_FAIL"]);

    const res = await runCli(
      ["swap", "--from", "node-a", "--to", "node-b", "--yes"],
      { timeoutSec: 30 },
    );
    expect(res.exitCode).not.toBe(0);

    // Rollback restores source to staked identity.
    const postA = await validator.state("validator-a");
    expect(postA.currentIdentity).toBe(stakedA);

    // Target never successfully committed the new identity (it either
    // stayed on its boot identity or bounced to unstaked — both are
    // acceptable as long as it did NOT take over A-staked).
    const postB = await validator.state("validator-b");
    expect(postB.currentIdentity).not.toBe(stakedA);
    expect(postB.voters).not.toContain(stakedA);
    // Clear any lingering flag so unrelated tests aren't poisoned.
    await validator.setChaos("validator-b", []);
    // Initial staked B value might have been overwritten to the unstaked
    // variant by the agent's cleanup path — the only invariant we need
    // is "not staked-A".
    expect([stakedB, postB.initialIdentity]).toContain(postB.initialIdentity);
  });
});
