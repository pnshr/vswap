import { execa } from "execa";
import {
  REPO_ROOT,
  TEST_ENV_DIR,
  activeComposeFile,
  activeProfile,
} from "./paths.js";

/** Compose CLI args for the active profile (mock or real). */
function composeArgs(): string[] {
  return ["compose", "-f", activeComposeFile()];
}

/** Bring-up entry script for the active profile. */
function upScript(): string {
  return activeProfile() === "real"
    ? "scripts/test-env/up-real.sh"
    : "scripts/test-env/up.sh";
}

export interface ComposeOptions {
  /** Silence docker-compose stdout. Defaults to `true` in CI. */
  readonly quiet?: boolean;
}

/**
 * Thin wrapper around `docker compose` operations specific to the
 * @vswap/e2e environment. All calls block until the docker daemon
 * ACKs the command — `up` additionally waits for healthy agents via
 * the matching `up*.sh` so tests can immediately exercise the CLI.
 *
 * The active profile is resolved from `VSWAP_E2E_PROFILE` (`mock` by
 * default) at the time each method is invoked; tests that flip the env
 * mid-suite should call `down()` first.
 */
export const compose = {
  /** Bring the full stack up via the project's `up*.sh` (idempotent). */
  async up(opts: ComposeOptions = {}): Promise<void> {
    const stdio = opts.quiet === false ? "inherit" : "pipe";
    await execa("bash", [upScript()], {
      cwd: REPO_ROOT,
      stdio,
      env: { ...process.env },
    });
  },

  /** Stop containers (volumes retained). */
  async down(): Promise<void> {
    await execa("docker", [...composeArgs(), "down", "--remove-orphans"], {
      cwd: TEST_ENV_DIR,
      stdio: "pipe",
    });
  },

  /** Stop a single service (e.g. to simulate an agent crash mid-swap). */
  async stop(service: string): Promise<void> {
    await execa(
      "docker",
      [...composeArgs(), "stop", "--timeout", "5", service],
      {
        cwd: TEST_ENV_DIR,
        stdio: "pipe",
      },
    );
  },

  /** Start a previously stopped service. */
  async start(service: string): Promise<void> {
    await execa("docker", [...composeArgs(), "start", service], {
      cwd: TEST_ENV_DIR,
      stdio: "pipe",
    });
  },

  /** Disconnect a service from the shared docker network. */
  async disconnect(service: string, networkName = "vswap-e2e-net"): Promise<void> {
    const container = `vswap-${service}`;
    await execa("docker", ["network", "disconnect", networkName, container], {
      stdio: "pipe",
    }).catch(() => {
      /* already disconnected — idempotent */
    });
  },

  /** Reconnect a service to the shared docker network. */
  async connect(service: string, networkName = "vswap-e2e-net"): Promise<void> {
    const container = `vswap-${service}`;
    await execa("docker", ["network", "connect", networkName, container], {
      stdio: "pipe",
    }).catch(() => {
      /* already connected */
    });
  },

  /**
   * Read the last `lines` lines from a service's container stdout.
   * Used in test-failure diagnostics.
   */
  async tail(service: string, lines = 60): Promise<string> {
    const { stdout } = await execa(
      "docker",
      ["logs", "--tail", String(lines), `vswap-${service}`],
      { stdio: "pipe" },
    );
    return stdout;
  },

  /**
   * Wait until the docker daemon reports a service as healthy. Used
   * after `start()` / `connect()` — the bring-up script already does
   * this on initial boot.
   */
  async waitHealthy(
    service: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<void> {
    const container = `vswap-${service}`;
    const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
    while (Date.now() < deadline) {
      const { stdout } = await execa(
        "docker",
        ["inspect", "--format", "{{.State.Health.Status}}", container],
        { reject: false, stdio: "pipe" },
      );
      if (stdout.trim() === "healthy") return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`${container} did not become healthy in time`);
  },
};
