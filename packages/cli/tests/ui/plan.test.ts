import { describe, expect, it } from "vitest";
import { renderPlan } from "../../src/ui/plan.js";

describe("renderPlan", () => {
  it("renders a plan with full peer + tower context (snapshot)", () => {
    const out = renderPlan({
      correlationId: "1c1f7c8e-2222-4333-8444-555566667777",
      source: {
        label: "node-a",
        identityPubkey: "7kAbCdEfGhJkLmNpQrStUvWxYz1234567890aBcDeF",
        currentSlot: 250125012,
      },
      target: {
        label: "node-b",
        identityPubkey: "7kAbCdEfGhJkLmNpQrStUvWxYz1234567890aBcDeF",
        currentSlot: 250125011,
      },
      tower: {
        fileName: "tower-1_9-7kAbCdEf.bin",
        slot: 250124987,
        sizeBytes: 3072,
      },
      expectedSwapWindowMs: [1000, 3000],
    });
    expect(out).toMatchSnapshot();
  });

  it("renders a plan with no tower (target preflight failure)", () => {
    const out = renderPlan({
      correlationId: "1c1f7c8e-2222-4333-8444-555566667777",
      source: {
        label: "node-a",
        identityPubkey: "7kAbCdEfGhJkLmNpQrStUvWxYz1234567890aBcDeF",
        currentSlot: 100,
      },
      target: {
        label: "node-b",
        identityPubkey: "7kAbCdEfGhJkLmNpQrStUvWxYz1234567890aBcDeF",
        currentSlot: 100,
      },
      tower: null,
      expectedSwapWindowMs: [1000, 3000],
    });
    expect(out).toMatchSnapshot();
  });

  it("uses singular 'slot' when lag is exactly 1", () => {
    const out = renderPlan({
      correlationId: "1c1f7c8e-2222-4333-8444-555566667777",
      source: { label: "a", identityPubkey: "7kAbCdEfGh", currentSlot: 5 },
      target: { label: "b", identityPubkey: "7kAbCdEfGh", currentSlot: 4 },
      tower: null,
      expectedSwapWindowMs: [1000, 3000],
    });
    expect(out).toMatch(/lag 1 slot\)/);
  });
});
