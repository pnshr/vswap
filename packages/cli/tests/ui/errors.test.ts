import { describe, expect, it } from "vitest";
import { formatError } from "../../src/ui/errors.js";

const PLAIN_TERM = { isTty: false, width: 80, colour: false } as const;

describe("formatError", () => {
  it("renders the three-section layout", () => {
    const out = formatError(
      {
        headline: "tower file not found on source",
        context: [
          ["Expected", "/var/solana/ledger/tower-1_9-7kAbC...bin"],
          ["Identity pubkey", "7kAbCd..."],
        ],
        nextSteps: [
          "Verify validator is running and has voted at least once",
          "Check ledger path in agent config matches the validator's --ledger",
          "Run `vswap status --peer node-a` for more diagnostics",
        ],
      },
      PLAIN_TERM,
    );
    expect(out).toContain("Error: tower file not found on source");
    expect(out).toContain("  Context:");
    expect(out).toContain("    - Expected:");
    expect(out).toContain("  Next steps:");
    expect(out).toContain("    - Verify validator is running and has voted at least once");
  });

  it("emits sections in the documented order", () => {
    const out = formatError(
      {
        headline: "boom",
        context: [["k", "v"]],
        nextSteps: ["do this"],
      },
      PLAIN_TERM,
    );
    const headlineIdx = out.indexOf("Error:");
    const contextIdx = out.indexOf("Context:");
    const nextStepsIdx = out.indexOf("Next steps:");
    expect(headlineIdx).toBeLessThan(contextIdx);
    expect(contextIdx).toBeLessThan(nextStepsIdx);
  });

  it("omits empty sections cleanly", () => {
    const out = formatError(
      { headline: "broken", context: [], nextSteps: [] },
      PLAIN_TERM,
    );
    expect(out).toContain("Error: broken");
    expect(out).not.toContain("Context:");
    expect(out).not.toContain("Next steps:");
  });
});
