import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ConfigInvalidError, KeyfilePermissionsUnsafeError } from "./errors.js";

const listenSchema = z
  .object({
    host: z.string().default("0.0.0.0"),
    port: z.number().int().min(1).max(65535).default(7872),
  })
  .strict()
  .default({ host: "0.0.0.0", port: 7872 });

const tlsSchema = z
  .object({
    certPath: z.string().min(1),
    keyPath: z.string().min(1),
    caPath: z.string().min(1),
  })
  .strict();

const validatorSchema = z
  .object({
    ledgerPath: z.string().min(1),
    stakedIdentityPath: z.string().min(1),
    unstakedIdentityPath: z.string().min(1),
    identitySymlinkPath: z.string().min(1),
    binary: z.string().default("agave-validator"),
  })
  .strict();

const identitySchema = z
  .object({
    longTermSigningKeyPath: z.string().min(1),
    longTermPublicKeyPath: z.string().min(1),
  })
  .strict();

const tmpfsSchema = z
  .object({
    basePath: z.string().default("/dev/shm/vswap"),
  })
  .strict()
  .default({ basePath: "/dev/shm/vswap" });

const loggingSchema = z
  .object({
    level: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  })
  .strict()
  .default({ level: "info" });

export const agentConfigSchema = z
  .object({
    listen: listenSchema,
    tls: tlsSchema,
    validator: validatorSchema,
    identity: identitySchema,
    tmpfs: tmpfsSchema,
    dataDir: z.string().default("/var/lib/vswap"),
    logging: loggingSchema,
  })
  .strict();

export type AgentConfig = z.infer<typeof agentConfigSchema>;

/**
 * Paths of sensitive files that must be mode 0600 or stricter. The
 * agent refuses to start if any of them is world-readable.
 */
const SECRET_FILE_FIELDS: ReadonlyArray<
  (c: AgentConfig) => string
> = [
  (c) => c.identity.longTermSigningKeyPath,
  (c) => c.tls.keyPath,
  (c) => c.validator.stakedIdentityPath,
  (c) => c.validator.unstakedIdentityPath,
];

/**
 * Paths that must exist and be readable at startup (besides the secret
 * files above which are checked separately for permissions).
 */
const READABLE_FILE_FIELDS: ReadonlyArray<
  (c: AgentConfig) => string
> = [
  (c) => c.tls.certPath,
  (c) => c.tls.caPath,
  (c) => c.identity.longTermPublicKeyPath,
];

/**
 * Directories that must exist at startup.
 */
const DIRECTORY_FIELDS: ReadonlyArray<(c: AgentConfig) => string> = [
  (c) => c.validator.ledgerPath,
  (c) => c.dataDir,
];

export interface LoadConfigOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly skipFsChecks?: boolean;
}

/**
 * Resolve the path of the config file. Priority:
 * 1. `VSWAP_AGENT_CONFIG` environment variable.
 * 2. `/etc/vswap/agent.yaml`.
 * 3. `<cwd>/agent.yaml`.
 *
 * The first path that *exists* wins; missing files are skipped except
 * for `VSWAP_AGENT_CONFIG` which is considered authoritative when set.
 */
export function resolveConfigPath(opts: LoadConfigOptions = {}): string {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const envPath = env.VSWAP_AGENT_CONFIG;
  if (envPath !== undefined && envPath.length > 0) {
    return envPath;
  }
  const candidates = ["/etc/vswap/agent.yaml", resolve(cwd, "agent.yaml")];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // not a real error — candidate just does not exist.
    }
  }
  throw new ConfigInvalidError(
    "no agent config found in VSWAP_AGENT_CONFIG, /etc/vswap/agent.yaml, or ./agent.yaml",
    { attempted: candidates },
  );
}

/**
 * Parse and validate a config blob (already read from disk).
 */
export function parseConfig(raw: string, sourcePath: string): AgentConfig {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new ConfigInvalidError("config file is not valid YAML/JSON", {
      sourcePath,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  const result = agentConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigInvalidError("agent config failed schema validation", {
      sourcePath,
      issues: result.error.issues.map((i) => ({
        path: i.path,
        code: i.code,
        message: i.message,
      })),
    });
  }
  return result.data;
}

/**
 * Refuse to start if any secret-bearing file is accessible to anyone
 * but its owner. Checks only the permission bits (lower 9) for
 * non-owner read/write/exec.
 */
export function assertSecretFilePermissions(config: AgentConfig): void {
  for (const getPath of SECRET_FILE_FIELDS) {
    const path = getPath(config);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(path);
    } catch (err) {
      throw new ConfigInvalidError(
        `secret-bearing file missing or unreadable: ${path}`,
        {
          path,
          cause: err instanceof Error ? err.message : String(err),
        },
      );
    }
    const otherBits = stat.mode & 0o077;
    if (otherBits !== 0) {
      throw new KeyfilePermissionsUnsafeError({
        path,
        mode: (stat.mode & 0o777).toString(8),
      });
    }
  }
}

/**
 * Verify that all path references in `config` resolve to existing
 * filesystem entries. Does not touch file contents.
 */
export function assertConfigPathsExist(config: AgentConfig): void {
  for (const getPath of READABLE_FILE_FIELDS) {
    const path = getPath(config);
    try {
      if (!statSync(path).isFile()) {
        throw new ConfigInvalidError(
          `config path is not a regular file: ${path}`,
          { path },
        );
      }
    } catch (err) {
      if (err instanceof ConfigInvalidError) {
        throw err;
      }
      throw new ConfigInvalidError(`config path missing: ${path}`, {
        path,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }
  for (const getPath of DIRECTORY_FIELDS) {
    const path = getPath(config);
    try {
      if (!statSync(path).isDirectory()) {
        throw new ConfigInvalidError(
          `config path is not a directory: ${path}`,
          { path },
        );
      }
    } catch (err) {
      if (err instanceof ConfigInvalidError) {
        throw err;
      }
      throw new ConfigInvalidError(`config path missing: ${path}`, {
        path,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Load, parse, and validate the config from disk. Performs all
 * filesystem checks unless `skipFsChecks` is set (useful in tests).
 */
export function loadConfig(opts: LoadConfigOptions = {}): AgentConfig {
  const sourcePath = resolveConfigPath(opts);
  let raw: string;
  try {
    raw = readFileSync(sourcePath, "utf8");
  } catch (err) {
    throw new ConfigInvalidError("could not read agent config file", {
      sourcePath,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  const config = parseConfig(raw, sourcePath);
  if (opts.skipFsChecks !== true) {
    assertConfigPathsExist(config);
    assertSecretFilePermissions(config);
  }
  return config;
}
