import { pino } from "pino";
import type { Logger, LoggerOptions } from "pino";

/**
 * Paths that must never appear in log output regardless of how a caller
 * structured a log record. The list is deliberately over-inclusive:
 * every secret-adjacent field name anywhere in the protocol or agent
 * code is enumerated here.
 */
export const REDACT_PATHS = [
  "*.secretKey",
  "*.privateKey",
  "*.keypair",
  "*.identity",
  "*.identitySecretKey",
  "*.identityBytes",
  "*.towerBytes",
  "*.ciphertext",
  "*.plaintext",
  "*.sessionSecretKey",
  "*.reveal",
  "req.headers.authorization",
  'req.headers["x-vswap-signature"]',
  "secretKey",
  "privateKey",
  "identitySecretKey",
  "identityBytes",
  "towerBytes",
  "ciphertext",
  "plaintext",
  "sessionSecretKey",
] as const;

export interface LoggerConfig {
  readonly level: string;
}

/**
 * Create a pino logger with redact paths covering every secret-bearing
 * field name in the agent + protocol surface.
 */
export function createLogger(config: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level: config.level,
    redact: {
      paths: [...REDACT_PATHS],
      censor: "[redacted]",
    },
    base: { service: "vswap-agent" },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };
  return pino(options);
}

export type { Logger };
