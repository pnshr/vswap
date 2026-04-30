import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Layout of the on-disk config directory under `$VSWAP_HOME` (or
 * `~/.vswap` when the env var is unset).
 *
 * Every path is computed once via {@link resolveConfigPaths}; commands
 * pass the returned struct around rather than recomputing.
 */
export interface ConfigPaths {
  /** Root of the config directory. */
  readonly root: string;
  /** Long-term Ed25519 secret key for the operator (64 raw bytes, 0600). */
  readonly clientSecretKey: string;
  /** Long-term Ed25519 public key for the operator (32 raw bytes, 0644). */
  readonly clientPublicKey: string;
  /** PEM-encoded mTLS root certificate (the CA). */
  readonly caCert: string;
  /** PEM-encoded mTLS root certificate private key (0600). */
  readonly caKey: string;
  /** PEM-encoded mTLS client certificate signed by the CA. */
  readonly clientCert: string;
  /** PEM-encoded mTLS client certificate private key (0600). */
  readonly clientKey: string;
  /** JSON document tracking all paired peers. */
  readonly peers: string;
  /** Optional log directory used when --debug is passed. */
  readonly logsDir: string;
}

/**
 * Resolve the operator's config root.
 *
 * - If the caller passes an explicit override, that value wins.
 * - Otherwise `$VSWAP_HOME` (when set and non-empty).
 * - Otherwise `~/.vswap`.
 *
 * The function is pure — it does not touch the filesystem.
 */
export function resolveConfigPaths(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): ConfigPaths {
  const root =
    override !== undefined && override !== ""
      ? override
      : typeof env["VSWAP_HOME"] === "string" && env["VSWAP_HOME"] !== ""
        ? env["VSWAP_HOME"]
        : join(home, ".vswap");
  return {
    root,
    clientSecretKey: join(root, "client.sk"),
    clientPublicKey: join(root, "client.pk"),
    caCert: join(root, "ca.crt"),
    caKey: join(root, "ca.key"),
    clientCert: join(root, "client.crt"),
    clientKey: join(root, "client.key"),
    peers: join(root, "peers.json"),
    logsDir: join(root, "logs"),
  };
}
