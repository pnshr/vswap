import type { FastifyInstance } from "fastify";
import { PROTOCOL_VERSION } from "@vswap/protocol";
import type { AnyMessage } from "@vswap/protocol";
import type { AgentRuntime } from "../runtime.js";
import {
  isPreflightRequest,
  parseSignedRequest,
  sendErrorEnvelope,
  sendSignedEnvelope,
} from "./envelope-helpers.js";
import { runPreflight } from "../services/preflight.js";

export function registerPreflightRoute(
  app: FastifyInstance,
  runtime: AgentRuntime,
): void {
  app.post("/preflight", async (req, reply) => {
    const verified = await parseSignedRequest(req, reply, runtime);
    if (verified === null) return;
    if (!isPreflightRequest(verified.message)) {
      await sendErrorEnvelope(reply, runtime, 400, {
        code: "MESSAGE_SCHEMA",
        message: `expected PreflightRequest, got ${verified.message.type}`,
      });
      return;
    }
    const preflightReq = verified.message;
    const role = roleFromCapabilities(preflightReq.capabilities);
    const report = await runPreflight({
      role,
      config: runtime.config,
      rpc: runtime.rpc,
      cli: runtime.cli,
    });
    const response: AnyMessage = {
      type: "PreflightResponse",
      version: PROTOCOL_VERSION,
      nonce: randomNonce(),
      timestamp: Date.now(),
      correlationId: preflightReq.correlationId,
      agentVersion: "0.1.0",
      capabilities: capabilityList(role),
      startProgress: renderReport(report),
    };
    await sendSignedEnvelope(reply, runtime, response);
  });
}

function roleFromCapabilities(
  capabilities: ReadonlyArray<string>,
): "source" | "target" {
  if (capabilities.includes("target")) return "target";
  return "source";
}

function capabilityList(role: "source" | "target"): string[] {
  return role === "target" ? ["preflight", "target", "swap"] : ["preflight", "source", "swap"];
}

function renderReport(report: {
  readonly role: string;
  readonly checks: ReadonlyArray<{
    readonly name: string;
    readonly status: string;
    readonly message: string;
  }>;
}): string {
  const header = `role=${report.role}`;
  const rows = report.checks
    .map((c) => `${c.status}\t${c.name}\t${c.message}`)
    .join("\n");
  return `${header}\n${rows}`;
}

function randomNonce(): Uint8Array {
  const out = new Uint8Array(24);
  crypto.getRandomValues(out);
  return out;
}
