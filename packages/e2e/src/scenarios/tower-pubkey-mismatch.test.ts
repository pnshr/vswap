/**
 * tower-pubkey-mismatch.test.ts — the source tower file exists but its
 * embedded pubkey points at another validator. The agent's
 * verifyTowerFilenamePubkey() guard must reject.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  runCli,
  startEnv,
  resetScenario,
  validator,
  loadManifest,
} from "../harness/index.js";

describe("source tower carries a mismatched pubkey", () => {
  let stakedA: string;
  let otherPubkey: string;

  beforeAll(async () => {
    await startEnv();
    const manifest = await loadManifest();
    stakedA = manifest.validators["validator-a"].staked;
    // Any other valid base58 pubkey we can claim in the filename. B's
    // staked key is a convenient off-validator value.
    otherPubkey = manifest.validators["validator-b"].staked;
  });

  beforeEach(async () => {
    await resetScenario();
  });

  afterAll(async () => {
    await resetScenario();
  });

  it("rejects the swap and leaves A untouched", async () => {
    // Rename the tower file so the pubkey in the filename no longer
    // matches the actual validator identity.
    await validator.corruptTower("validator-a", otherPubkey);

    const res = await runCli(
      ["swap", "--from", "node-a", "--to", "node-b", "--yes"],
      { timeoutSec: 30 },
    );

    expect(res.exitCode).not.toBe(0);
    const post = await validator.state("validator-a");
    expect(post.currentIdentity).toBe(stakedA);
  });
});
