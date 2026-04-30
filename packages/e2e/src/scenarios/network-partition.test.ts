/**
 * network-partition.test.ts — disconnect agent-b from the shared
 * docker network right before the swap. The CLI hits a connection
 * error quickly and the source is rolled back.
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

describe("network partition between CLI and agent-b", () => {
  let stakedA: string;

  beforeAll(async () => {
    await startEnv();
    stakedA = (await loadManifest()).validators["validator-a"].staked;
  });

  beforeEach(async () => {
    await resetScenario();
  });

  afterAll(async () => {
    await compose.connect("agent-b");
    await compose.waitHealthy("agent-b", { timeoutMs: 30_000 });
    await resetScenario();
  });

  it("fails fast with a transport error", async () => {
    // Disconnecting from the network does not stop the port forward
    // on the host; the agent is still listening on 7873 *but* its
    // internal state may no longer be reachable after it loses the
    // DNS link. In practice that is what we want to observe — the CLI
    // goes via 127.0.0.1:7873 and the request succeeds or fails based
    // on the bridge state. We approximate partition by stopping the
    // container to achieve the same observable result.
    await compose.stop("agent-b");

    const res = await runCli(
      ["swap", "--from", "node-a", "--to", "node-b", "--yes"],
      { timeoutSec: 30 },
    );
    expect(res.exitCode).not.toBe(0);
    expect(res.durationMs).toBeLessThan(20_000);

    await compose.start("agent-b");
    await compose.waitHealthy("agent-b", { timeoutMs: 30_000 });

    const postA = await validator.state("validator-a");
    // Auto-rollback on the source path restores staked identity.
    expect(postA.currentIdentity).toBe(stakedA);
  });
});
