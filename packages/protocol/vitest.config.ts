import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: "default",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/crypto/index.ts"],
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
        "src/crypto/!(index).ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
});
