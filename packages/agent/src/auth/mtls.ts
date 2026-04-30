import { readFile } from "node:fs/promises";
import type { SecureContextOptions } from "node:tls";
import { ConfigInvalidError } from "../errors.js";
import type { AgentConfig } from "../config.js";

export interface TlsMaterial {
  readonly cert: Buffer;
  readonly key: Buffer;
  readonly ca: Buffer;
}

/**
 * Load cert/key/ca from disk. Missing or empty files raise
 * {@link ConfigInvalidError} so the agent refuses to start rather than
 * serving mTLS-less traffic by accident.
 */
export async function loadTlsMaterial(
  config: AgentConfig,
): Promise<TlsMaterial> {
  const [cert, key, ca] = await Promise.all([
    readSafe(config.tls.certPath, "tls.certPath"),
    readSafe(config.tls.keyPath, "tls.keyPath"),
    readSafe(config.tls.caPath, "tls.caPath"),
  ]);
  return { cert, key, ca };
}

/**
 * Convert loaded TLS material into the options object expected by
 * `fastify` when creating an HTTPS server with mTLS.
 */
export function mtlsHttpsOptions(material: TlsMaterial): SecureContextOptions & {
  requestCert: true;
  rejectUnauthorized: true;
} {
  return {
    cert: material.cert,
    key: material.key,
    ca: material.ca,
    requestCert: true,
    rejectUnauthorized: true,
  };
}

async function readSafe(path: string, field: string): Promise<Buffer> {
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch (err) {
    throw new ConfigInvalidError(`could not read ${field}: ${path}`, {
      field,
      path,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  if (buf.byteLength === 0) {
    throw new ConfigInvalidError(`${field} file is empty: ${path}`, {
      field,
      path,
    });
  }
  return buf;
}
