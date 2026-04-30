export { run, buildProgram } from "./cli.js";
export { CLI_VERSION, runVersion } from "./commands/version.js";
export { runInit } from "./commands/init.js";
export { runPair } from "./commands/pair.js";
export { runStatus } from "./commands/status.js";
export { runPreflight, runBothPreflights, parsePreflightRows } from "./commands/preflight.js";
export { runSwap } from "./commands/swap.js";
export { runRollback } from "./commands/rollback.js";
export { ExitCode, EXIT_CODE_DOCS } from "./util/exit-codes.js";
export type { ExitCodeValue } from "./util/exit-codes.js";
export {
  AgentClient,
  AgentResponseError,
  AgentTransportError,
  type AgentTransport,
  type AgentResponse,
  type SignerLike,
  type TransportRequest,
} from "./client/agent-client.js";
export { renderPlan, type PlanInputs } from "./ui/plan.js";
export { formatError, type ErrorView } from "./ui/errors.js";
export { resolveConfigPaths, type ConfigPaths } from "./config/paths.js";
export { PeersStore, type PairedPeer } from "./config/peers.js";
export { encodeBase58, decodeBase58, fingerprintPubkey } from "./util/base58.js";
