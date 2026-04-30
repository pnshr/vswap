/**
 * Browser-friendly mirror of selected `@vswap/protocol` shapes.
 *
 * The wire types in `@vswap/protocol` rely on `Uint8Array` and msgpack,
 * which do not survive a JSON boundary. The web client speaks plain
 * JSON to the Next.js proxy; the proxy is the only layer that touches
 * the binary protocol.
 */

export type SwapPhase =
  | "precheck"
  | "stop-voting"
  | "ship-tower"
  | "activate"
  | "cleanup"
  | "health";

export type CheckStatus = "ok" | "warn" | "fail";

export interface PreflightCheck {
  status: CheckStatus;
  name: string;
  message: string;
}

export interface NodeStatus {
  /** Stable identifier inside the operator config (e.g. "primary"). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Hostname or IP plus port. */
  host: string;
  port: number;
  /** Validator software version, e.g. "agave-validator 1.18.20". */
  version: string;
  /** Base58 voting identity pubkey currently set on the host. */
  identityPubkey: string;
  /** Latest slot the validator has caught up to. */
  caughtUpSlot: number;
  /** Slot lag versus cluster tip. */
  slotLag: number;
  /** Whether the validator currently misses leader slots. */
  delinquent: boolean;
  /** Last successful swap timestamp (ms epoch), if any. */
  lastSwapAt?: number;
  /** Whether `/health` succeeded on the last poll. */
  reachable: boolean;
}

export interface SwapHistoryEntry {
  id: string;
  startedAt: number;
  durationMs: number;
  fromNodeId: string;
  toNodeId: string;
  fromIdentity: string;
  toIdentity: string;
  status: "completed" | "failed" | "rolled-back";
  failureReason?: string;
  sourceLastVotedSlot?: number;
  targetFirstVotedSlot?: number;
  towerAdvancement?: number;
}

export interface SwapProgress {
  sessionId: string;
  phase: SwapPhase;
  detail: string;
  slot?: number;
  ts: number;
}

export interface OperatorPeer {
  id: string;
  label: string;
  host: string;
  port: number;
  /** Long-term Ed25519 pubkey of the agent (base58). */
  agentPubkey: string;
}

export interface OperatorConfigMetadata {
  /** Free-form name the operator chose for this config. */
  name: string;
  /** When the config was first imported. */
  importedAt: number;
  peers: OperatorPeer[];
  /** Operator's own long-term Ed25519 pubkey (base58). */
  operatorPubkey: string;
}

export const ALL_PHASES: ReadonlyArray<SwapPhase> = [
  "precheck",
  "stop-voting",
  "ship-tower",
  "activate",
  "cleanup",
  "health",
] as const;

export const PHASE_LABEL: Record<SwapPhase, string> = {
  precheck: "Precheck",
  "stop-voting": "Pause source voting",
  "ship-tower": "Transfer identity + tower",
  activate: "Activate target",
  cleanup: "Cleanup tmpfs",
  health: "Verify health",
};
