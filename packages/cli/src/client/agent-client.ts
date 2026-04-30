import { Agent, request as httpsRequest } from "node:https";
import { Buffer } from "node:buffer";
import {
  ErrorCode,
  ProtocolError,
  type AnyMessage,
  type ErrorEnvelopeMessage,
  type PairRequest,
  type PairResponse,
  type PreflightRequest,
  type PreflightResponse,
  type RollbackRequest,
  type SwapCompleted,
  type SwapPayload,
  type SwapSessionInit,
} from "@vswap/protocol";
import { decodeBase58 } from "../util/base58.js";
import {
  buildEnvelope,
  freshCorrelationId,
  newMessageDefaults,
  readEnvelope,
} from "./envelope.js";
import type { LoadedClientConfig } from "../config/load.js";
import type { PairedPeer } from "../config/peers.js";
import type { SigningSecretKey } from "@vswap/protocol";

/** Content type used for every signed request and response body. */
export const VSWAP_CONTENT_TYPE = "application/vswap+msgpack";

/** Default per-request timeout (ms). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Strongly-typed alias of the message types the CLI receives back. */
export interface AgentResponse<M extends AnyMessage = AnyMessage> {
  readonly message: M;
  readonly senderPubkey: Uint8Array;
}

/** Lightweight subset of the loaded identity the client cares about. */
export interface SignerLike {
  readonly secretKey: SigningSecretKey;
  readonly publicKey: Uint8Array;
}

export interface AgentClientOptions {
  readonly config: LoadedClientConfig;
  /** Override the default `https.Agent`. Tests pass a mock here. */
  readonly httpsAgent?: Agent;
  /** Per-request timeout. Defaults to {@link DEFAULT_REQUEST_TIMEOUT_MS}. */
  readonly requestTimeoutMs?: number;
}

/**
 * Pluggable transport used by {@link AgentClient}. The production
 * implementation goes over mTLS HTTPS; tests substitute an in-memory
 * mock.
 */
export interface AgentTransport {
  send(req: TransportRequest): Promise<Uint8Array>;
  health(address: string): Promise<boolean>;
}

export interface TransportRequest {
  readonly address: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body: Uint8Array;
}

export class AgentTransportError extends Error {
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentTransportError";
    if (statusCode !== undefined) {
      this.statusCode = statusCode;
    }
  }
}

export class AgentResponseError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "AgentResponseError";
  }
}

/**
 * High-level client that the commands use to talk to a paired agent.
 * Wraps mTLS HTTPS, signed-envelope encode/decode, and server-pubkey
 * verification.
 */
export class AgentClient {
  private readonly transport: AgentTransport;

  constructor(opts: AgentClientOptions, transport?: AgentTransport) {
    this.transport =
      transport ??
      createDefaultTransport({
        agent:
          opts.httpsAgent ??
          new Agent({
            cert: opts.config.tls.clientCert,
            key: opts.config.tls.clientKey,
            ca: opts.config.tls.caCert,
            rejectUnauthorized: true,
            keepAlive: false,
          }),
        timeoutMs: opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      });
  }

  /** GET /health (unauthenticated). */
  async health(peer: { readonly address: string }): Promise<boolean> {
    return this.transport.health(peer.address);
  }

  async pair(
    peer: { readonly address: string },
    signer: SignerLike,
    correlationId: string = freshCorrelationId(),
  ): Promise<AgentResponse<PairResponse>> {
    const message: PairRequest = {
      ...newMessageDefaults(correlationId),
      type: "PairRequest",
      senderLongTermPubkey: signer.publicKey,
    };
    return this.send<PairResponse>(
      peer,
      signer,
      "/pair",
      "POST",
      message,
      "PairResponse",
    );
  }

  async preflight(
    peer: PairedPeer,
    signer: SignerLike,
    role: "source" | "target",
    correlationId: string = freshCorrelationId(),
  ): Promise<AgentResponse<PreflightResponse>> {
    const message: PreflightRequest = {
      ...newMessageDefaults(correlationId),
      type: "PreflightRequest",
      agentVersion: "0.1.0",
      capabilities: ["preflight", role],
    };
    return this.send<PreflightResponse>(
      peer,
      signer,
      "/preflight",
      "POST",
      message,
      "PreflightResponse",
    );
  }

  async status(
    peer: PairedPeer,
    signer: SignerLike,
    correlationId: string = freshCorrelationId(),
  ): Promise<AgentResponse<PreflightResponse>> {
    const message: PreflightRequest = {
      ...newMessageDefaults(correlationId),
      type: "PreflightRequest",
      agentVersion: "0.1.0",
      capabilities: ["status"],
    };
    return this.send<PreflightResponse>(
      peer,
      signer,
      "/status",
      "GET",
      message,
      "PreflightResponse",
    );
  }

  async swapInit(
    peer: PairedPeer,
    signer: SignerLike,
    correlationId: string,
    sourceLongTermPubkeyBase58?: string,
  ): Promise<AgentResponse<SwapSessionInit>> {
    // The target uses this field to bind the session to the source
    // agent's long-term key — that is what the identity blob will be
    // signed with. When the caller does not supply it (unit tests,
    // legacy callers), fall back to the operator's own pubkey so the
    // request shape remains valid.
    const sourceKeyBytes =
      sourceLongTermPubkeyBase58 !== undefined
        ? decodeBase58(sourceLongTermPubkeyBase58)
        : signer.publicKey;
    const message: PairRequest = {
      ...newMessageDefaults(correlationId),
      type: "PairRequest",
      senderLongTermPubkey: sourceKeyBytes,
    };
    return this.send<SwapSessionInit>(
      peer,
      signer,
      "/swap/init",
      "POST",
      message,
      "SwapSessionInit",
    );
  }

  async swapSend(
    peer: PairedPeer,
    signer: SignerLike,
    init: SwapSessionInit,
    expectedSourcePubkey: string,
    correlationId: string,
  ): Promise<AgentResponse<SwapPayload>> {
    const message: SwapPayload = {
      ...newMessageDefaults(correlationId),
      type: "SwapPayload",
      sessionId: init.sessionId,
      recipientSessionPubkey: init.sessionPubkey,
      ciphertext: new Uint8Array(0),
    };
    const path = `/swap/send?expectedPubkey=${encodeURIComponent(expectedSourcePubkey)}`;
    return this.send<SwapPayload>(
      peer,
      signer,
      path,
      "POST",
      message,
      "SwapPayload",
    );
  }

  async swapApply(
    peer: PairedPeer,
    signer: SignerLike,
    payload: SwapPayload,
    expectedSourcePubkey: string,
    requireTower: boolean,
    correlationId: string,
  ): Promise<AgentResponse<SwapCompleted>> {
    const message: SwapPayload = {
      ...newMessageDefaults(correlationId),
      type: "SwapPayload",
      sessionId: payload.sessionId,
      recipientSessionPubkey: payload.recipientSessionPubkey,
      ciphertext: payload.ciphertext,
    };
    const params = new URLSearchParams({
      expectedPubkey: expectedSourcePubkey,
      requireTower: requireTower ? "true" : "false",
    });
    return this.send<SwapCompleted>(
      peer,
      signer,
      `/swap/apply?${params.toString()}`,
      "POST",
      message,
      "SwapCompleted",
    );
  }

  async swapRollback(
    peer: PairedPeer,
    signer: SignerLike,
    sessionId: string,
    reason: string,
    correlationId: string = freshCorrelationId(),
  ): Promise<AgentResponse<SwapCompleted>> {
    const message: RollbackRequest = {
      ...newMessageDefaults(correlationId),
      type: "RollbackRequest",
      sessionId,
      reason,
    };
    return this.send<SwapCompleted>(
      peer,
      signer,
      "/swap/rollback",
      "POST",
      message,
      "SwapCompleted",
    );
  }

  /**
   * Generic helper. Used by every method above; only this method
   * touches the transport.
   *
   * Throws {@link AgentTransportError} on connectivity failure,
   * {@link AgentResponseError} when the agent replies with an
   * `ErrorEnvelope`, and {@link ProtocolError} on signature / schema
   * problems (re-raised from `@vswap/protocol`).
   */
  private async send<M extends AnyMessage>(
    peer: { readonly address: string; readonly longTermPubkey?: string },
    signer: SignerLike,
    path: string,
    method: "GET" | "POST",
    message: AnyMessage,
    expected: M["type"],
  ): Promise<AgentResponse<M>> {
    const envelope = await buildEnvelope(message, signer);
    const expectedAgentPubkey =
      peer.longTermPubkey !== undefined
        ? decodeBase58(peer.longTermPubkey)
        : undefined;
    const responseBytes = await this.transport.send({
      address: peer.address,
      method,
      path,
      body: envelope,
    });
    const opened = await readEnvelope(responseBytes, expectedAgentPubkey);
    if (opened.message.type === "ErrorEnvelope") {
      const errMsg = opened.message as ErrorEnvelopeMessage;
      throw new AgentResponseError(
        errMsg.error.message,
        errMsg.error.code,
        errMsg.error.context,
      );
    }
    if (opened.message.type !== expected) {
      throw new ProtocolError(
        ErrorCode.MessageSchema,
        `expected ${expected} response, got ${opened.message.type}`,
        { actualType: opened.message.type, expectedType: expected },
      );
    }
    return {
      message: opened.message as M,
      senderPubkey: opened.senderPubkey,
    };
  }
}

export interface DefaultTransportOptions {
  readonly agent: Agent;
  readonly timeoutMs: number;
}

/** Real-world `node:https` transport used in production. */
export function createDefaultTransport(
  opts: DefaultTransportOptions,
): AgentTransport {
  return {
    async send(req: TransportRequest): Promise<Uint8Array> {
      const url = `https://${req.address}${req.path}`;
      return new Promise<Uint8Array>((resolve, reject) => {
        const r = httpsRequest(
          url,
          {
            method: req.method,
            headers: {
              "content-type": VSWAP_CONTENT_TYPE,
              "content-length": String(req.body.byteLength),
              accept: VSWAP_CONTENT_TYPE,
            },
            agent: opts.agent,
            timeout: opts.timeoutMs,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              if (chunks.length === 0) {
                reject(
                  new AgentTransportError(
                    `empty response from ${req.address}${req.path}`,
                    res.statusCode,
                  ),
                );
                return;
              }
              const total = chunks.reduce(
                (sum, c) => sum + c.byteLength,
                0,
              );
              const out = new Uint8Array(total);
              let off = 0;
              for (const c of chunks) {
                out.set(c, off);
                off += c.byteLength;
              }
              resolve(out);
            });
          },
        );
        r.on("error", (err) => {
          reject(new AgentTransportError(err.message, undefined, { cause: err }));
        });
        r.on("timeout", () => {
          r.destroy(new Error("request timed out"));
        });
        r.write(req.body);
        r.end();
      });
    },
    async health(address: string): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        const r = httpsRequest(
          `https://${address}/health`,
          { method: "GET", agent: opts.agent, timeout: opts.timeoutMs },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => {
              if (res.statusCode !== 200) {
                resolve(false);
                return;
              }
              const text = Buffer.concat(chunks).toString("utf8").trim();
              resolve(text === "ok");
            });
          },
        );
        r.on("error", () => resolve(false));
        r.on("timeout", () => {
          r.destroy();
          resolve(false);
        });
        r.end();
      });
    },
  };
}
