import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/logger.js";

function collectLogs(fn: (log: ReturnType<typeof createLogger>) => void): string[] {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    const text =
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    lines.push(text);
    return true;
  }) as typeof process.stdout.write;
  try {
    const log = createLogger({ level: "info" });
    fn(log);
  } finally {
    process.stdout.write = orig;
  }
  return lines;
}

describe("logger", () => {
  it("redacts secret-bearing fields", () => {
    const out = collectLogs((log) => {
      log.info(
        {
          secretKey: new Uint8Array([1, 2, 3]),
          identitySecretKey: "super-secret",
          towerBytes: new Uint8Array([4, 5]),
          ciphertext: "xxx",
          wrapper: { privateKey: "deep" },
          harmless: "ok",
        },
        "test",
      );
    });
    const dump = out.join("");
    expect(dump).not.toContain("super-secret");
    expect(dump).not.toContain("deep");
    expect(dump).toContain("[redacted]");
    expect(dump).toContain("ok");
  });
});
