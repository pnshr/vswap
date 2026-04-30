"use client";

/**
 * Browser-side helper that calls the `/api/agent/*` proxy. The proxy is
 * the only layer that speaks mTLS + the binary `@vswap/protocol`
 * envelope format; the browser only ever sees JSON.
 */
import type { NodeStatus, PreflightCheck, SwapProgress } from "./types";

export interface OperatorSecretBundle {
  format?: string;
  operatorPubkey?: string;
  signingSecretKeyBase64?: string;
  clientCertPem?: string;
  clientKeyPem?: string;
  caCertPem?: string;
}

export interface AgentCallContext {
  id?: string;
  label?: string;
  /** Hostname or IP of the agent. */
  host: string;
  port: number;
  /** Agent's expected long-term Ed25519 pubkey (base58). */
  agentPubkey: string;
  /** Route the request to the hosted disposable validator sandbox. */
  sandbox?: boolean;
  /** Decrypted per-tab operator bundle from `vswap export --for-web`. */
  secret?: OperatorSecretBundle;
}

async function postProxy<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/agent/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`proxy ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export interface StatusResponse {
  status: NodeStatus;
}

export async function fetchStatus(
  ctx: AgentCallContext,
): Promise<StatusResponse> {
  return postProxy<StatusResponse>("status", ctx);
}

export interface PreflightResponse {
  checks: PreflightCheck[];
  agentVersion: string;
}

export async function runPreflight(
  ctx: AgentCallContext,
  role: "source" | "target",
): Promise<PreflightResponse> {
  return postProxy<PreflightResponse>("preflight", { ...ctx, role });
}

export interface SwapResult {
  sessionId: string;
  durationMs: number;
  events: SwapProgress[];
  finalIdentity: string;
  ciphertextBytes?: number;
  plaintextExposedToProxy?: false;
}

export interface SwapInput {
  source: AgentCallContext;
  target: AgentCallContext;
  expectedPubkey: string;
  requireTower: boolean;
  dryRun?: boolean;
}

export async function executeSwap(input: SwapInput): Promise<SwapResult> {
  return postProxy<SwapResult>("swap/execute", input);
}

export async function rollback(
  ctx: AgentCallContext,
  reason: string,
): Promise<{ ok: true }> {
  return postProxy<{ ok: true }>("rollback", { ...ctx, reason });
}

export function parseOperatorSecret(
  unlockedSecret: string | null,
): OperatorSecretBundle | null {
  if (!unlockedSecret) return null;
  try {
    const parsed = JSON.parse(unlockedSecret) as OperatorSecretBundle;
    if (
      typeof parsed.signingSecretKeyBase64 !== "string" ||
      typeof parsed.clientCertPem !== "string" ||
      typeof parsed.clientKeyPem !== "string" ||
      typeof parsed.caCertPem !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
