import { connect } from "node:net";
import type { Socket } from "node:net";
import { AdminRpcFailedError } from "../errors.js";

/**
 * JSON-RPC 2.0 client over a Solana `admin.rpc` unix socket. The socket
 * path is typically `<ledger>/admin.rpc` for a running `agave-validator`
 * instance.
 *
 * We do not assume a specific framing variant of the server; instead
 * every call opens a fresh socket, writes one request (JSON + LF),
 * reads until the server closes the connection, then parses the
 * accumulated bytes as either a newline-delimited JSON-RPC response or
 * the full response body. This single-shot model is robust against
 * both common framings in use by `jsonrpc-ipc-server` crates.
 */
export interface ContactInfo {
  readonly identity: string;
  readonly rpcAddress?: string | undefined;
  readonly tpuAddress?: string | undefined;
  readonly version?: string | undefined;
  readonly shredVersion?: number | undefined;
}

export interface AdminRpcOptions {
  readonly socketPath: string;
  readonly defaultTimeoutMs?: number;
  readonly setIdentityTimeoutMs?: number;
}

interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: string;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string;
  readonly result?: unknown;
  readonly error?: { code: number; message: string; data?: unknown };
}

/**
 * Minimal unix-socket JSON-RPC 2.0 client. Does not retry; admin RPC
 * mutations (setIdentity, addAuthorizedVoter) are not idempotent so the
 * caller must take care of retry semantics explicitly.
 */
export class AdminRpcClient {
  private readonly socketPath: string;
  private readonly defaultTimeoutMs: number;
  private readonly setIdentityTimeoutMs: number;
  private nextId = 0;

  constructor(opts: AdminRpcOptions) {
    this.socketPath = opts.socketPath;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 5_000;
    this.setIdentityTimeoutMs = opts.setIdentityTimeoutMs ?? 30_000;
  }

  /** Change the validator's identity to the keypair at `keypairPath`. */
  async setIdentity(
    keypairPath: string,
    requireTower: boolean,
  ): Promise<void> {
    await this.call<null>(
      "setIdentity",
      [keypairPath, requireTower],
      this.setIdentityTimeoutMs,
    );
  }

  /** Add an authorized voter from the keypair at `keypairPath`. */
  async addAuthorizedVoter(keypairPath: string): Promise<void> {
    await this.call<null>("addAuthorizedVoter", [keypairPath]);
  }

  /** Remove every authorized voter currently attached. */
  async removeAllAuthorizedVoters(): Promise<void> {
    await this.call<null>("removeAllAuthorizedVoters", []);
  }

  /** Current contact info (identity, rpc addr, version, shred ver). */
  async contactInfo(): Promise<ContactInfo> {
    const raw = await this.call<unknown>("contactInfo", []);
    return normaliseContactInfo(raw);
  }

  /** `host:port` of the RPC interface, if the validator exposes one. */
  async rpcAddress(): Promise<string | null> {
    const raw = await this.call<unknown>("rpcAddress", []);
    if (raw === null || raw === undefined) {
      return null;
    }
    if (typeof raw !== "string") {
      throw new AdminRpcFailedError(
        "rpcAddress returned a non-string value",
        { actualType: typeof raw },
      );
    }
    return raw;
  }

  private nextRequestId(): string {
    this.nextId = (this.nextId + 1) >>> 0;
    return `agent-${this.nextId.toString(36)}`;
  }

  private async call<T>(
    method: string,
    params: unknown,
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<T> {
    const id = this.nextRequestId();
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };
    const parsed = await this.exchange(`${JSON.stringify(req)}\n`, id, timeoutMs);
    if (parsed.error !== undefined) {
      throw new AdminRpcFailedError(
        `admin RPC method ${method} returned an error`,
        {
          method,
          code: parsed.error.code,
          message: parsed.error.message,
        },
      );
    }
    return parsed.result as T;
  }

  /**
   * Send one JSON-RPC request to the admin.rpc unix socket and return
   * the response object whose `id` matches `expectedId`. Resolves as
   * soon as we have parsed a complete matching response — we do NOT
   * wait for the server to close the connection. This matters because
   * the real `agave-validator` admin RPC server (jsonrpc-ipc-server)
   * keeps the connection open for pipelined requests; resolving on
   * close-only would block until the socket-level timeout, masking
   * fast responses behind a 5–30 s wait. The mock validator used by
   * the hermetic test harness always closes after each response, so
   * `finishOnClose` below still parses the remaining buffer for that
   * profile.
   */
  private exchange(
    payload: string,
    expectedId: string,
    timeoutMs: number,
  ): Promise<JsonRpcResponse> {
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const sock: Socket = connect(this.socketPath);
      let buffer = "";
      let settled = false;

      const settle = (action: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        try {
          sock.destroy();
        } catch {
          // ignore — socket may already be torn down.
        }
        action();
      };

      const timer = setTimeout(() => {
        settle(() =>
          reject(
            new AdminRpcFailedError("admin RPC call timed out", {
              socketPath: this.socketPath,
              timeoutMs,
            }),
          ),
        );
      }, timeoutMs);

      const tryDrain = (): void => {
        // The agave admin RPC server frames responses with a trailing
        // newline. We may receive partial frames or multiple frames in
        // one chunk; scan the buffer line-by-line and resolve as soon
        // as we find a JSON-RPC response with the expected id.
        let nl = buffer.indexOf("\n");
        while (nl >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.length > 0) {
            try {
              const candidate: unknown = JSON.parse(line);
              if (
                isJsonRpcResponse(candidate) &&
                candidate.id === expectedId
              ) {
                settle(() => resolve(candidate));
                return;
              }
            } catch {
              // fall through to the next line — server may have sent
              // an unexpected non-JSON banner.
            }
          }
          nl = buffer.indexOf("\n");
        }
      };

      sock.on("connect", () => {
        sock.write(payload);
      });
      sock.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        tryDrain();
      });
      const finishOnClose = (): void => {
        // The mock validator closes the socket after each response,
        // so the response may have arrived as a single frame *without*
        // a trailing newline. Try to parse the remaining buffer once
        // before giving up.
        if (buffer.length > 0) {
          const trimmed = buffer.trim();
          buffer = "";
          if (trimmed.length > 0) {
            try {
              const candidate: unknown = JSON.parse(trimmed);
              if (
                isJsonRpcResponse(candidate) &&
                candidate.id === expectedId
              ) {
                settle(() => resolve(candidate));
                return;
              }
            } catch {
              // fall through — server hung up before sending a
              // matching response.
            }
          }
        }
        settle(() =>
          reject(
            new AdminRpcFailedError(
              "admin RPC connection closed without a matching response",
              { socketPath: this.socketPath, expectedId },
            ),
          ),
        );
      };
      sock.on("end", finishOnClose);
      sock.on("close", finishOnClose);
      sock.on("error", (err) => {
        settle(() =>
          reject(
            new AdminRpcFailedError("admin RPC socket error", {
              socketPath: this.socketPath,
              cause: err.message,
            }),
          ),
        );
      });
    });
  }
}

/**
 * Accept either a raw single JSON-RPC response object or a stream of
 * newline-separated JSON-RPC responses and return the first entry
 * matching `id`. Throws if none matches.
 */
export function parseJsonRpcResponse(
  raw: string,
  expectedId: string,
): JsonRpcResponse {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new AdminRpcFailedError("admin RPC returned empty payload");
  }
  const candidates = trimmed.includes("\n")
    ? trimmed.split(/\r?\n/).filter((l) => l.length > 0)
    : [trimmed];
  for (const line of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isJsonRpcResponse(parsed)) {
      continue;
    }
    if (parsed.id === expectedId) {
      return parsed;
    }
  }
  throw new AdminRpcFailedError(
    "admin RPC response did not match the request id",
    { expectedId, candidatesCount: candidates.length },
  );
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (obj.jsonrpc !== "2.0") {
    return false;
  }
  if (typeof obj.id !== "string") {
    return false;
  }
  return true;
}

function normaliseContactInfo(raw: unknown): ContactInfo {
  if (raw === null || typeof raw !== "object") {
    throw new AdminRpcFailedError("contactInfo returned non-object", {
      actualType: raw === null ? "null" : typeof raw,
    });
  }
  const obj = raw as Record<string, unknown>;
  // Real agave-validator's admin RPC returns the pubkey under the
  // shorthand `id`; our mock validator (and some downstream forks)
  // use `identity`. Accept either — the wire shape is otherwise
  // compatible. Same goes for `rpcAddress` (mock) vs `rpc` (agave);
  // `tpuAddress` vs `tpu`; `shredVersion` vs `shred_version`.
  const identity =
    typeof obj.identity === "string" && obj.identity.length > 0
      ? obj.identity
      : typeof obj.id === "string" && obj.id.length > 0
        ? obj.id
        : null;
  if (identity === null) {
    throw new AdminRpcFailedError("contactInfo.identity missing or not a string");
  }
  const rpcAddress =
    typeof obj.rpcAddress === "string"
      ? obj.rpcAddress
      : typeof obj.rpc === "string"
        ? obj.rpc
        : undefined;
  const tpuAddress =
    typeof obj.tpuAddress === "string"
      ? obj.tpuAddress
      : typeof obj.tpu === "string"
        ? obj.tpu
        : undefined;
  const shredVersion =
    typeof obj.shredVersion === "number"
      ? obj.shredVersion
      : typeof obj.shred_version === "number"
        ? obj.shred_version
        : undefined;
  return {
    identity,
    rpcAddress,
    tpuAddress,
    version: typeof obj.version === "string" ? obj.version : undefined,
    shredVersion,
  };
}
