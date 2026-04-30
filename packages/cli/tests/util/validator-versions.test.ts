import { describe, expect, it } from "vitest";
import {
  classifyValidatorVersion,
  extractVersionToken,
} from "../../src/util/validator-versions.js";

describe("extractVersionToken", () => {
  it("extracts a semver from the canonical agave-validator output", () => {
    expect(
      extractVersionToken(
        "agave-validator 2.0.21 (src:00000000; feat:0; client:Agave)",
      ),
    ).toBe("2.0.21");
  });

  it("extracts a semver from the v3.1.x output", () => {
    expect(
      extractVersionToken(
        "agave-validator 3.1.14 (src:abcdef12; feat:0; client:Agave)",
      ),
    ).toBe("3.1.14");
  });

  it("extracts a release-candidate semver", () => {
    expect(extractVersionToken("agave-validator 4.0.0-rc.0")).toBe(
      "4.0.0-rc.0",
    );
  });

  it("returns null when there is no recognisable version token", () => {
    expect(extractVersionToken("some unrelated banner without a version"))
      .toBe(null);
  });
});

describe("classifyValidatorVersion", () => {
  it("classifies the v2.0.21 baseline as works", () => {
    const result = classifyValidatorVersion("agave-validator 2.0.21");
    expect(result.kind).toBe("works");
  });

  it("classifies the v2.1.13 regression as broken with a reason", () => {
    const result = classifyValidatorVersion(
      "agave-validator 2.1.13 (src:foo; feat:0)",
    );
    expect(result.kind).toBe("broken");
    if (result.kind === "broken") {
      expect(result.version).toBe("2.1.13");
      expect(result.reason).toMatch(/require-tower/i);
    }
  });

  it("classifies the current v3.1 stable as untested (until promoted)", () => {
    const result = classifyValidatorVersion(
      "agave-validator 3.1.14 (src:abcdef12)",
    );
    expect(result.kind).toBe("untested");
    if (result.kind === "untested") {
      expect(result.version).toBe("3.1.14");
    }
  });

  it("classifies a missing version (older agent) as unknown", () => {
    const result = classifyValidatorVersion(null);
    expect(result.kind).toBe("unknown");
  });

  it("falls back to untested with the raw string when no semver is parseable", () => {
    const result = classifyValidatorVersion("garbage-version-banner");
    expect(result.kind).toBe("untested");
    if (result.kind === "untested") {
      expect(result.version).toBe("garbage-version-banner");
    }
  });
});
