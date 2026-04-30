/**
 * Fixture data used when no operator config is imported. Lets reviewers
 * walk the dashboard end-to-end on the public deploy without standing up
 * real agents. Sandbox mode is always labelled in the UI.
 */
import type {
  NodeStatus,
  OperatorConfigMetadata,
  PreflightCheck,
  SwapHistoryEntry,
  SwapProgress,
} from "./types";
import { ALL_PHASES } from "./types";

export const DEMO_CONFIG: OperatorConfigMetadata = {
  name: "demo-mainnet-pair",
  importedAt: Date.parse("2026-04-20T12:00:00Z"),
  operatorPubkey: "OperatorDemoPub11111111111111111111111111111",
  peers: [
    {
      id: "primary",
      label: "primary (frankfurt-a1)",
      host: "10.20.30.40",
      port: 7872,
      agentPubkey: "AgentPriDemo111111111111111111111111111111111",
    },
    {
      id: "standby",
      label: "standby (frankfurt-b2)",
      host: "10.20.30.41",
      port: 7872,
      agentPubkey: "AgentStbDemo111111111111111111111111111111111",
    },
  ],
};

export const DEMO_NODE_STATUS: NodeStatus[] = [
  {
    id: "primary",
    label: "primary (frankfurt-a1)",
    host: "10.20.30.40",
    port: 7872,
    version: "agave-validator 2.1.7",
    identityPubkey: "VaLiDStaKedA1bC2dE3fG4hJ5kM6nP7qR8sT9uV0wX1yZ",
    caughtUpSlot: 312_409_117,
    slotLag: 1,
    delinquent: false,
    lastSwapAt: Date.parse("2026-04-22T03:14:09Z"),
    reachable: true,
  },
  {
    id: "standby",
    label: "standby (frankfurt-b2)",
    host: "10.20.30.41",
    port: 7872,
    version: "agave-validator 2.1.7",
    identityPubkey: "UnStAkEdStBy1aB2cD3eF4gH5jK6lM7nP8qR9sT0uV1w",
    caughtUpSlot: 312_409_115,
    slotLag: 3,
    delinquent: false,
    reachable: true,
  },
];

export const DEMO_PREFLIGHT: Record<string, PreflightCheck[]> = {
  primary: [
    { status: "ok", name: "validator-running", message: "agave-validator 2.1.7 reachable on admin RPC" },
    { status: "ok", name: "caught-up", message: "slot lag 1 (≤ 5)" },
    { status: "ok", name: "tower-present", message: "tower-1_9-VaLi…1yZ.bin (32 KiB), 0s old" },
    { status: "ok", name: "identity-symlink", message: "/etc/solana/identity.json -> staked.json" },
    { status: "warn", name: "disk-pressure", message: "/mnt/ledger 78% full (advisory only)" },
  ],
  standby: [
    { status: "ok", name: "validator-running", message: "agave-validator 2.1.7 reachable on admin RPC" },
    { status: "ok", name: "unstaked-identity", message: "/etc/solana/unstaked.json mode 0600" },
    { status: "ok", name: "authorized-voter", message: "configured and current" },
    { status: "ok", name: "tmpfs-base", message: "/dev/shm/vswap mounted, 0 stale dirs" },
  ],
};

export const DEMO_HISTORY: SwapHistoryEntry[] = [
  {
    id: "swap-2026-04-22-031409",
    startedAt: Date.parse("2026-04-22T03:14:09Z"),
    durationMs: 1840,
    fromNodeId: "primary",
    toNodeId: "standby",
    fromIdentity: "VaLiDStaKedA1bC2dE3fG4hJ5kM6nP7qR8sT9uV0wX1yZ",
    toIdentity: "VaLiDStaKedA1bC2dE3fG4hJ5kM6nP7qR8sT9uV0wX1yZ",
    status: "completed",
    sourceLastVotedSlot: 309_887_004,
    targetFirstVotedSlot: 309_887_007,
    towerAdvancement: 3,
  },
  {
    id: "swap-2026-04-15-194401",
    startedAt: Date.parse("2026-04-15T19:44:01Z"),
    durationMs: 2110,
    fromNodeId: "standby",
    toNodeId: "primary",
    fromIdentity: "VaLiDStaKedA1bC2dE3fG4hJ5kM6nP7qR8sT9uV0wX1yZ",
    toIdentity: "VaLiDStaKedA1bC2dE3fG4hJ5kM6nP7qR8sT9uV0wX1yZ",
    status: "completed",
    sourceLastVotedSlot: 308_220_551,
    targetFirstVotedSlot: 308_220_553,
    towerAdvancement: 2,
  },
  {
    id: "swap-2026-04-09-082215",
    startedAt: Date.parse("2026-04-09T08:22:15Z"),
    durationMs: 0,
    fromNodeId: "primary",
    toNodeId: "standby",
    fromIdentity: "VaLiDStaKedA1bC2dE3fG4hJ5kM6nP7qR8sT9uV0wX1yZ",
    toIdentity: "VaLiDStaKedA1bC2dE3fG4hJ5kM6nP7qR8sT9uV0wX1yZ",
    status: "rolled-back",
    failureReason: "tower file mtime drift exceeded 30s threshold; rollback issued",
  },
];

const DEMO_DETAILS: Record<string, string> = {
  precheck: "Refusing to start if catchup lag > 5 slots",
  "stop-voting": "setIdentity(unstaked) on source, last voted slot recorded",
  "ship-tower": "Sealed identity + tower (32 KiB) shipped through the sandbox transfer",
  activate: "setIdentity(staked, requireTower=true), addAuthorizedVoter",
  cleanup: "tmpfs session dir scrubbed and unlinked",
  health: "First voted slot observed on target",
};

/**
 * Build placeholder node-status entries from an imported operator config.
 * Used until a self-hosted live proxy returns real /status calls; preserves
 * peer ids/labels/hosts so downstream views (swap wizard, plan diff) can
 * render against the operator's actual peer ids rather than demo-only ids.
 */
export function buildLiveNodeStubs(peers: OperatorConfigMetadata["peers"]): NodeStatus[] {
  return peers.map<NodeStatus>((p, idx) => ({
    id: p.id,
    label: p.label,
    host: p.host,
    port: p.port,
    version: "—",
    identityPubkey: p.agentPubkey,
    caughtUpSlot: 0,
    slotLag: 0,
    delinquent: false,
    reachable: false,
    ...(idx === 0 ? { lastSwapAt: Date.now() - 86_400_000 } : {}),
  }));
}

/**
 * Best-effort preflight stub for non-sandbox peer ids. Marks every check as
 * pending so the operator knows real preflight has not run yet.
 */
export function buildLivePreflightStubs(peerId: string): PreflightCheck[] {
  return [
    {
      status: "warn",
      name: "preflight-pending",
      message: `Preflight has not yet run on ${peerId}. Run preflight to populate.`,
    },
  ];
}

export function demoProgressEvents(sessionId: string): SwapProgress[] {
  const base = Date.now();
  return ALL_PHASES.map((phase, idx) => ({
    sessionId,
    phase,
    detail: DEMO_DETAILS[phase] ?? "",
    slot: 312_409_117 + idx,
    ts: base + idx * 320,
  }));
}
