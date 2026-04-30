import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/scenarios/**/*.test.ts"],
    // Each scenario spins up containers and drives the CLI end-to-end.
    // 120s is enough for the heaviest chaos scenarios while still
    // surfacing hangs reasonably quickly. The real-validator profile's
    // first-boot up-real.sh is significantly slower (genesis + agave
    // boot + tower snapshot capture), so the hook timeout is bumped
    // when VSWAP_E2E_PROFILE=real is selected.
    testTimeout: 120_000,
    hookTimeout: process.env.VSWAP_E2E_PROFILE === "real" ? 600_000 : 180_000,
    // Tests must run sequentially: they share the same docker-compose
    // environment via volumes + TCP ports. Parallelism within a file
    // is already serialised by beforeAll/afterAll.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
    reporters: ["default"],
  },
});
