import { Buffer } from "node:buffer";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  PROTOCOL_VERSION,
  SigningSecretKey,
  deriveEd25519PublicKey,
  decode,
  encode,
  generateSessionKeypair,
  generateSigningKeypair,
  openEnvelope,
  openSealedBox,
  scrub,
  sealForRecipient,
  sealEnvelope,
} from "@vswap/protocol";
import type {
  AnyMessage,
  ErrorEnvelopeMessage,
  PreflightResponse,
  SwapCompleted,
  SwapPayload,
  SwapSessionInit,
} from "@vswap/protocol";
import {
  ALL_PHASES,
  type NodeStatus,
  type PreflightCheck,
  type SwapProgress,
} from "@/lib/types";
import { DEMO_NODE_STATUS, DEMO_PREFLIGHT } from "@/lib/demo";

/**
 * Agent proxy.
 *
 * The browser POSTs JSON describing what it wants to do (status,
 * preflight, swap/execute, rollback) plus the per-peer connection
 * material (host, port, expected agent pubkey). The proxy is the only
 * layer that touches the binary protocol and mTLS — it builds a signed
 * `EnvelopeV1`, opens a per-request mTLS connection to the agent, and
 * returns the parsed response body as JSON.
 *
 * Security:
 *
 * - Operator client cert / key are taken from the request and live in
 *   per-request scope only. They are never written to disk or persisted
 *   on the server. Operators should self-host this dashboard for real
 *   validators so those per-request secrets stay inside their own
 *   infrastructure.
 * - Request and response bodies are NEVER logged. Even though the
 *   ciphertext on the wire is opaque, log lines could leak nonces,
 *   correlation IDs or peer pubkeys, which we do not need to retain.
 * - The public Vercel deployment is intended for the disposable
 *   sandbox. Real validator traffic is supported by the same route only
 *   when `VSWAP_ENABLE_LIVE_PROXY=1` is set on a self-hosted deployment
 *   that can reach the private agents.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProxyRequest {
  /** Hostname or IP of the agent. */
  host?: string;
  port?: number;
  id?: string;
  label?: string;
  /** Expected long-term Ed25519 pubkey (base58). */
  agentPubkey?: string;
  /** True for the public hosted sandbox backed by disposable demo identities. */
  sandbox?: boolean;
  /** Operator's cert+key bundle, decrypted in the browser. */
  mtls?: { cert?: string; key?: string; ca?: string };
  /** Operator's long-term signing key (base64 or PEM). */
  signingKey?: string;
  secret?: OperatorSecretBundle;
  role?: "source" | "target";
  source?: ProxyPeer;
  target?: ProxyPeer;
  expectedPubkey?: string;
  requireTower?: boolean;
  dryRun?: boolean;
  sessionId?: string;
  reason?: string;
}

interface PathParams {
  params: { path?: string[] } | Promise<{ path?: string[] }>;
}

interface ProxyPeer {
  host?: string;
  port?: number;
  id?: string;
  label?: string;
  agentPubkey?: string;
  sandbox?: boolean;
  secret?: OperatorSecretBundle;
}

interface OperatorSecretBundle {
  format?: string;
  operatorPubkey?: string;
  signingSecretKeyBase64?: string;
  clientCertPem?: string;
  clientKeyPem?: string;
  caCertPem?: string;
}

export async function POST(req: Request, { params }: PathParams): Promise<Response> {
  const resolvedParams = await params;
  const path = (resolvedParams.path ?? []).join("/");
  let body: ProxyRequest;
  try {
    body = (await req.json()) as ProxyRequest;
  } catch {
    return jsonError(400, "invalid_json", "request body must be JSON");
  }

  if (body.sandbox === true || body.source?.sandbox === true || body.target?.sandbox === true) {
    return handleSandbox(path, body);
  }

  if (process.env.VSWAP_ENABLE_LIVE_PROXY !== "1") {
    return jsonError(
      503,
      "live_proxy_disabled",
      "real agent proxying is disabled on this deployment. Use sandbox mode, the CLI, or self-host with VSWAP_ENABLE_LIVE_PROXY=1.",
    );
  }

  return handleLive(path, body);
}

export async function GET(): Promise<Response> {
  return jsonError(405, "method_not_allowed", "POST only");
}

const VSWAP_CONTENT_TYPE = "application/vswap+msgpack";
const REQUEST_TIMEOUT_MS = 30_000;

function jsonError(status: number, code: string, message: string): Response {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status },
  );
}

async function handleLive(path: string, body: ProxyRequest): Promise<Response> {
  try {
    switch (path) {
      case "status": {
        const peer = peerFromBody(body);
        const creds = await credentialsFromSecret(body.secret ?? peer.secret);
        try {
          const response = await callAgent<PreflightResponse>(
            peer,
            creds,
            "/status",
            "GET",
            {
              ...messageDefaults(),
              type: "PreflightRequest",
              agentVersion: "0.1.0",
              capabilities: ["status"],
            },
            "PreflightResponse",
          );
          return NextResponse.json({
            status: statusFromPreflight(peer, response.message),
          });
        } finally {
          creds.agent.destroy();
        }
      }
      case "preflight": {
        const peer = peerFromBody(body);
        const creds = await credentialsFromSecret(body.secret ?? peer.secret);
        try {
          const response = await callAgent<PreflightResponse>(
            peer,
            creds,
            "/preflight",
            "POST",
            {
              ...messageDefaults(),
              type: "PreflightRequest",
              agentVersion: "0.1.0",
              capabilities: ["preflight", body.role ?? "source"],
            },
            "PreflightResponse",
          );
          return NextResponse.json({
            agentVersion: response.message.agentVersion,
            checks: checksFromPreflight(response.message.startProgress),
          });
        } finally {
          creds.agent.destroy();
        }
      }
      case "swap/execute":
        return NextResponse.json(await liveSwap(body));
      case "rollback": {
        const peer = peerFromBody(body);
        const creds = await credentialsFromSecret(body.secret ?? peer.secret);
        try {
          await callAgent<SwapCompleted>(
            peer,
            creds,
            "/swap/rollback",
            "POST",
            {
              ...messageDefaults(),
              type: "RollbackRequest",
              sessionId: body.sessionId ?? "00000000-0000-0000-0000-000000000000",
              reason: body.reason ?? "operator requested rollback",
            },
            "SwapCompleted",
          );
          return NextResponse.json({ ok: true });
        } finally {
          creds.agent.destroy();
        }
      }
      default:
        return jsonError(404, "unknown_agent_path", `unknown agent path "${path}"`);
    }
  } catch (err) {
    if (err instanceof ResponseError) {
      return jsonError(err.status, err.code, err.message);
    }
    return jsonError(
      502,
      "agent_proxy_error",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function liveSwap(body: ProxyRequest): Promise<{
  sessionId: string;
  durationMs: number;
  events: SwapProgress[];
  finalIdentity: string;
  ciphertextBytes: number;
  plaintextExposedToProxy: false;
}> {
  if (body.source === undefined || body.target === undefined) {
    throw new ResponseError(400, "missing_swap_peers", "source and target are required");
  }
  const expected = body.expectedPubkey;
  if (!expected) {
    throw new ResponseError(
      400,
      "missing_expected_pubkey",
      "expectedPubkey is required",
    );
  }
  if (body.requireTower === false) {
    throw new ResponseError(
      400,
      "tower_required",
      "production swaps must use requireTower=true",
    );
  }

  if (body.dryRun === true) {
    const sessionId = randomUUID();
    const events = buildProgressEvents(sessionId, [
      "Dry-run checked source and target metadata only",
      "Dry-run: source voting would pause here",
      "Dry-run: identity and tower would move as sealed ciphertext",
      "Dry-run: target would activate with requireTower=true",
      "Dry-run: tmpfs cleanup would run",
      "Dry-run: target health would be checked",
    ]);
    return {
      sessionId,
      durationMs: events[events.length - 1]!.ts - events[0]!.ts,
      events,
      finalIdentity: expected,
      ciphertextBytes: 0,
      plaintextExposedToProxy: false,
    };
  }

  let sourceCreds: LiveCredentials | null = null;
  let targetCreds: LiveCredentials | null = null;
  try {
    sourceCreds = await credentialsFromSecret(body.source.secret);
    targetCreds = await credentialsFromSecret(body.target.secret);
    const correlationId = randomUUID();
    const sourceAgentPubkey = requiredBase58(
      body.source.agentPubkey,
      "source.agentPubkey",
    );

    const init = await callAgent<SwapSessionInit>(
      body.target,
      targetCreds,
      "/swap/init",
      "POST",
      {
        ...messageDefaults(correlationId),
        type: "PairRequest",
        senderLongTermPubkey: sourceAgentPubkey,
      },
      "SwapSessionInit",
    );

    const send = await callAgent<SwapPayload>(
      body.source,
      sourceCreds,
      `/swap/send?expectedPubkey=${encodeURIComponent(expected)}`,
      "POST",
      {
        ...messageDefaults(correlationId),
        type: "SwapPayload",
        sessionId: init.message.sessionId,
        recipientSessionPubkey: init.message.sessionPubkey,
        ciphertext: new Uint8Array(0),
      },
      "SwapPayload",
    );

    const completed = await callAgent<SwapCompleted>(
      body.target,
      targetCreds,
      `/swap/apply?${new URLSearchParams({
        expectedPubkey: expected,
        requireTower: "true",
      }).toString()}`,
      "POST",
      {
        ...messageDefaults(correlationId),
        type: "SwapPayload",
        sessionId: send.message.sessionId,
        recipientSessionPubkey: send.message.recipientSessionPubkey,
        ciphertext: send.message.ciphertext,
      },
      "SwapCompleted",
    );

    const events = buildProgressEvents(init.message.sessionId, [
      "Source and target accepted signed mTLS envelopes",
      "Source paused voting with the unstaked identity",
      `Encrypted identity + tower moved as ${send.message.ciphertext.byteLength.toString()} bytes of ciphertext`,
      "Target decrypted in tmpfs and activated with requireTower=true",
      "Target cleanup acknowledged",
      "Target returned the final voting identity",
    ]);
    return {
      sessionId: init.message.sessionId,
      durationMs: completed.message.durationMs,
      events,
      finalIdentity: encodeBase58(completed.message.finalIdentityPubkey),
      ciphertextBytes: send.message.ciphertext.byteLength,
      plaintextExposedToProxy: false,
    };
  } finally {
    sourceCreds?.agent.destroy();
    targetCreds?.agent.destroy();
  }
}

interface LiveCredentials {
  readonly agent: HttpsAgent;
  readonly signer: {
    readonly secretKey: SigningSecretKey;
    readonly publicKey: Uint8Array;
  };
}

async function credentialsFromSecret(secret?: OperatorSecretBundle): Promise<LiveCredentials> {
  if (secret === undefined) {
    throw new ResponseError(
      400,
      "missing_secret_bundle",
      "unlock a vswap export bundle before calling real agents",
    );
  }
  if (
    typeof secret.signingSecretKeyBase64 !== "string" ||
    typeof secret.clientCertPem !== "string" ||
    typeof secret.clientKeyPem !== "string" ||
    typeof secret.caCertPem !== "string"
  ) {
    throw new ResponseError(
      400,
      "invalid_secret_bundle",
      "secret bundle must include signingSecretKeyBase64, clientCertPem, clientKeyPem, and caCertPem",
    );
  }

  const raw = new Uint8Array(Buffer.from(secret.signingSecretKeyBase64, "base64"));
  try {
    const publicKey = await deriveEd25519PublicKey(raw);
    if (
      typeof secret.operatorPubkey === "string" &&
      encodeBase58(publicKey) !== secret.operatorPubkey
    ) {
      throw new ResponseError(
        400,
        "operator_pubkey_mismatch",
        "secret signing key does not derive to operatorPubkey",
      );
    }
    return {
      agent: new HttpsAgent({
        cert: secret.clientCertPem,
        key: secret.clientKeyPem,
        ca: secret.caCertPem,
        rejectUnauthorized: true,
        keepAlive: false,
      }),
      signer: {
        secretKey: new SigningSecretKey(raw),
        publicKey,
      },
    };
  } finally {
    scrub(raw);
  }
}

interface AgentCallResult<M extends AnyMessage> {
  readonly message: M;
  readonly senderPubkey: Uint8Array;
}

async function callAgent<M extends AnyMessage>(
  peer: ProxyPeer,
  creds: LiveCredentials,
  path: string,
  method: "GET" | "POST",
  message: AnyMessage,
  expectedType: M["type"],
): Promise<AgentCallResult<M>> {
  const host = peer.host;
  const port = peer.port;
  if (!host || !port) {
    throw new ResponseError(400, "missing_target", "host and port are required");
  }
  const envelope = await sealEnvelope(
    message,
    creds.signer.secretKey,
    creds.signer.publicKey,
  );
  const responseBytes = await httpsEnvelopeRequest({
    agent: creds.agent,
    address: `${host}:${port.toString()}`,
    path,
    method,
    body: envelope,
  });
  const expectedAgentPubkey =
    peer.agentPubkey !== undefined
      ? decodeBase58(peer.agentPubkey)
      : undefined;
  const opened = await openEnvelope(responseBytes, expectedAgentPubkey);
  if (opened.message.type === "ErrorEnvelope") {
    const err = opened.message as ErrorEnvelopeMessage;
    throw new ResponseError(502, err.error.code, err.error.message);
  }
  if (opened.message.type !== expectedType) {
    throw new ResponseError(
      502,
      "unexpected_agent_response",
      `expected ${String(expectedType)}, got ${opened.message.type}`,
    );
  }
  return {
    message: opened.message as M,
    senderPubkey: opened.senderPubkey,
  };
}

function httpsEnvelopeRequest(req: {
  agent: HttpsAgent;
  address: string;
  path: string;
  method: "GET" | "POST";
  body: Uint8Array;
}): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const request = httpsRequest(
      `https://${req.address}${req.path}`,
      {
        method: req.method,
        headers: {
          "content-type": VSWAP_CONTENT_TYPE,
          "content-length": String(req.body.byteLength),
          accept: VSWAP_CONTENT_TYPE,
        },
        agent: req.agent,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          if (chunks.length === 0) {
            reject(
              new ResponseError(
                502,
                "empty_agent_response",
                `empty response from ${req.address}${req.path}`,
              ),
            );
            return;
          }
          resolve(new Uint8Array(Buffer.concat(chunks)));
        });
      },
    );
    request.on("error", (err) => reject(err));
    request.on("timeout", () => {
      request.destroy(new Error("agent request timed out"));
    });
    request.write(Buffer.from(req.body));
    request.end();
  });
}

function peerFromBody(body: ProxyRequest): ProxyPeer {
  return {
    host: body.host,
    port: body.port,
    id: body.id,
    label: body.label,
    agentPubkey: body.agentPubkey,
    secret: body.secret,
  };
}

function messageDefaults(correlationId: string = randomUUID()) {
  return {
    version: PROTOCOL_VERSION,
    nonce: randomNonce(),
    timestamp: Date.now(),
    correlationId,
  };
}

function randomNonce(): Uint8Array {
  const out = new Uint8Array(24);
  crypto.getRandomValues(out);
  return out;
}

function statusFromPreflight(peer: ProxyPeer, message: PreflightResponse): NodeStatus {
  let parsed: { contactInfo?: { identity?: unknown; id?: unknown; slot?: unknown } } = {};
  try {
    parsed = JSON.parse(message.startProgress) as typeof parsed;
  } catch {
    parsed = {};
  }
  const contact = parsed.contactInfo ?? {};
  const identity =
    typeof contact.identity === "string"
      ? contact.identity
      : typeof contact.id === "string"
        ? contact.id
        : peer.agentPubkey ?? "(unknown)";
  const slot = typeof contact.slot === "number" ? contact.slot : 0;
  return {
    id: peer.id ?? peer.label ?? peer.host ?? "agent",
    label: peer.label ?? peer.id ?? peer.host ?? "agent",
    host: peer.host ?? "",
    port: peer.port ?? 7872,
    version: `vswap-agent ${message.agentVersion}`,
    identityPubkey: identity,
    caughtUpSlot: slot,
    slotLag: 0,
    delinquent: false,
    reachable: true,
  };
}

function checksFromPreflight(report: string): PreflightCheck[] {
  return report
    .split("\n")
    .slice(1)
    .map((line): PreflightCheck | null => {
      const [status, name, ...rest] = line.split("\t");
      if (!status || !name) return null;
      const normalised =
        status === "ok" || status === "warn" || status === "fail"
          ? status
          : "warn";
      return {
        status: normalised,
        name,
        message: rest.join("\t") || "no detail",
      };
    })
    .filter((check): check is PreflightCheck => check !== null);
}

function buildProgressEvents(sessionId: string, details: string[]): SwapProgress[] {
  const baseTs = Date.now();
  return ALL_PHASES.map<SwapProgress>((phase, idx) => ({
    sessionId,
    phase,
    detail: details[idx] ?? phase,
    ts: baseTs + idx * 280,
  }));
}

async function handleSandbox(path: string, body: ProxyRequest): Promise<Response> {
  try {
    switch (path) {
      case "status":
        return NextResponse.json({ status: sandboxStatus(body) });
      case "preflight":
        return NextResponse.json({
          agentVersion: "vswap-agent sandbox/1.0",
          checks: sandboxPreflight(body),
        });
      case "swap/execute":
        return NextResponse.json(await sandboxSwap(body));
      case "rollback":
        return NextResponse.json({
          ok: true,
          rolledBackAt: Date.now(),
          reason: body.reason ?? "operator requested rollback",
        });
      default:
        return jsonError(404, "unknown_sandbox_path", `unknown sandbox path "${path}"`);
    }
  } catch (err) {
    if (err instanceof ResponseError) {
      return jsonError(err.status, err.code, err.message);
    }
    return jsonError(
      500,
      "sandbox_error",
      err instanceof Error ? err.message : String(err),
    );
  }
}

function sandboxStatus(peer: ProxyPeer): NodeStatus {
  const known = DEMO_NODE_STATUS.find((n) => peerMatches(n, peer));
  if (known !== undefined) {
    return { ...known, reachable: true };
  }
  return {
    id: peer.id ?? peer.label ?? peer.host ?? "sandbox-node",
    label: peer.label ?? peer.id ?? "sandbox node",
    host: peer.host ?? "127.0.0.1",
    port: peer.port ?? 7872,
    version: "agave-validator sandbox/2.1.7",
    identityPubkey: peer.agentPubkey ?? "SandboxIdentity1111111111111111111111111111",
    caughtUpSlot: 312_409_117,
    slotLag: 1,
    delinquent: false,
    reachable: true,
  };
}

function sandboxPreflight(body: ProxyRequest): PreflightCheck[] {
  const peerId = body.id ?? body.label ?? body.host ?? "primary";
  const known = DEMO_PREFLIGHT[peerId] ?? DEMO_PREFLIGHT[body.role === "target" ? "standby" : "primary"];
  if (known !== undefined) {
    return known.map((check) => ({ ...check }));
  }
  return [
    {
      status: "ok",
      name: "sandbox-validator",
      message: "Disposable sandbox validator reachable over the in-process demo transport",
    },
    {
      status: "ok",
      name: "sandbox-tower",
      message: "Synthetic tower file present and bound to the expected identity",
    },
  ];
}

async function sandboxSwap(body: ProxyRequest): Promise<{
  sessionId: string;
  durationMs: number;
  events: SwapProgress[];
  finalIdentity: string;
  ciphertextBytes: number;
  plaintextExposedToProxy: false;
}> {
  if (body.source === undefined || body.target === undefined) {
    throw new ResponseError(400, "missing_swap_peers", "source and target are required");
  }
  if (body.requireTower === false) {
    throw new ResponseError(
      400,
      "tower_required",
      "sandbox swaps require tower validation, matching production defaults",
    );
  }
  const expected = body.expectedPubkey ?? sandboxStatus(body.source).identityPubkey;
  const cryptoResult = await runSandboxCryptoTransfer(expected);
  const sessionId = randomUUID();
  const baseSlot = 312_409_117;
  const baseTs = Date.now();
  const details: Record<(typeof ALL_PHASES)[number], string> = {
    precheck: "Sandbox source and target checked: identity, tower, catchup, tmpfs",
    "stop-voting": "Source switched to the unstaked identity in the sandbox ledger",
    "ship-tower": `Sealed identity + tower shipped as ${cryptoResult.ciphertextBytes.toString()} bytes of ciphertext`,
    activate: "Target decrypted in tmpfs and activated with requireTower=true",
    cleanup: "Sandbox tmpfs bytes scrubbed and session key discarded",
    health: "Target reports the expected voting identity",
  };
  const events = ALL_PHASES.map<SwapProgress>((phase, idx) => ({
    sessionId,
    phase,
    detail: details[phase],
    slot: baseSlot + idx,
    ts: baseTs + idx * 280,
  }));
  return {
    sessionId,
    durationMs: events[events.length - 1]!.ts - events[0]!.ts,
    events,
    finalIdentity: expected,
    ciphertextBytes: cryptoResult.ciphertextBytes,
    plaintextExposedToProxy: false,
  };
}

async function runSandboxCryptoTransfer(expectedIdentity: string): Promise<{ ciphertextBytes: number }> {
  const targetSession = await generateSessionKeypair();
  const identity = await generateSigningKeypair();
  const secret = identity.secretKey.reveal();
  const towerBytes = new Uint8Array(4096);
  crypto.getRandomValues(towerBytes);
  const plaintext = encode({
    identityPubkey: expectedIdentity,
    identitySecretKey: secret,
    towerBytes,
    towerFileName: `tower-1_9-${expectedIdentity}.bin`,
  });
  let ciphertext: Uint8Array;
  try {
    ciphertext = await sealForRecipient(plaintext, targetSession.publicKey);
  } finally {
    scrub(plaintext);
  }
  const opened = await openSealedBox(
    ciphertext,
    targetSession.publicKey,
    targetSession.secretKey,
  );
  try {
    const decoded = decode(opened) as { identityPubkey?: unknown };
    if (decoded.identityPubkey !== expectedIdentity) {
      throw new Error("sandbox sealed-box round trip returned the wrong identity");
    }
  } finally {
    scrub(opened);
    scrub(secret);
    scrub(towerBytes);
  }
  return { ciphertextBytes: ciphertext.byteLength };
}

function peerMatches(node: NodeStatus, peer: ProxyPeer): boolean {
  return (
    node.id === peer.id ||
    node.label === peer.label ||
    node.host === peer.host ||
    `${node.host}:${node.port.toString()}` === `${peer.host ?? ""}:${(peer.port ?? 0).toString()}`
  );
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function requiredBase58(value: string | undefined, field: string): Uint8Array {
  if (value === undefined || value === "") {
    throw new ResponseError(400, "missing_pubkey", `${field} is required`);
  }
  return decodeBase58(value);
}

function decodeBase58(input: string): Uint8Array {
  let value = 0n;
  for (const ch of input) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) {
      throw new ResponseError(
        400,
        "invalid_base58",
        `invalid base58 character in pubkey`,
      );
    }
    value = value * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.push(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const ch of input) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  const out = new Uint8Array(bytes.reverse());
  if (out.byteLength !== 32) {
    throw new ResponseError(
      400,
      "invalid_pubkey_size",
      `expected 32-byte public key, got ${out.byteLength.toString()} bytes`,
    );
  }
  return out;
}

function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }
  let out = "";
  while (value > 0n) {
    const mod = Number(value % 58n);
    out = BASE58_ALPHABET[mod] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out || "1";
}

class ResponseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
