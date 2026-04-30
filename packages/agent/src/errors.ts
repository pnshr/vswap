import { ProtocolError } from "@vswap/protocol";
import type { ErrorCode } from "@vswap/protocol";
import type { ErrorContext } from "@vswap/protocol";

/**
 * Agent-specific error codes. They extend the base {@link ErrorCode}
 * space from `@vswap/protocol` so a single mapping from code → HTTP
 * status is enough for the whole agent.
 */
export const AgentErrorCode = {
  ConfigInvalid: "AGENT_CONFIG_INVALID",
  ValidatorUnreachable: "AGENT_VALIDATOR_UNREACHABLE",
  PreflightFailed: "AGENT_PREFLIGHT_FAILED",
  SwapAlreadyInProgress: "AGENT_SWAP_ALREADY_IN_PROGRESS",
  SwapSessionUnknown: "AGENT_SWAP_SESSION_UNKNOWN",
  SwapSessionExpired: "AGENT_SWAP_SESSION_EXPIRED",
  TowerMissing: "AGENT_TOWER_MISSING",
  TowerPubkeyMismatch: "AGENT_TOWER_PUBKEY_MISMATCH",
  IdentityPubkeyMismatch: "AGENT_IDENTITY_PUBKEY_MISMATCH",
  PeerUnknown: "AGENT_PEER_UNKNOWN",
  TimestampOutOfWindow: "AGENT_TIMESTAMP_OUT_OF_WINDOW",
  TmpfsUnavailable: "AGENT_TMPFS_UNAVAILABLE",
  AdminRpcFailed: "AGENT_ADMIN_RPC_FAILED",
  CliFailed: "AGENT_CLI_FAILED",
  KeyfilePermissionsUnsafe: "AGENT_KEYFILE_PERMISSIONS_UNSAFE",
} as const;

export type AgentErrorCodeValue =
  (typeof AgentErrorCode)[keyof typeof AgentErrorCode];

/** Base class for agent-side errors (distinct from pure protocol-layer errors). */
export class AgentError extends ProtocolError {
  constructor(
    code: AgentErrorCodeValue,
    message: string,
    context: ErrorContext = {},
  ) {
    // Upstream ProtocolError keeps the code string as-is; we use a
    // distinct namespace so callers can tell agent errors apart.
    super(code as unknown as typeof ErrorCode.Protocol, message, context);
    this.name = "AgentError";
  }
}

export class SwapAlreadyInProgressError extends AgentError {
  constructor(context: ErrorContext = {}) {
    super(
      AgentErrorCode.SwapAlreadyInProgress,
      "another swap is already in progress on this agent",
      context,
    );
    this.name = "SwapAlreadyInProgressError";
  }
}

export class SwapSessionUnknownError extends AgentError {
  constructor(context: ErrorContext = {}) {
    super(
      AgentErrorCode.SwapSessionUnknown,
      "no active swap session matches the supplied id",
      context,
    );
    this.name = "SwapSessionUnknownError";
  }
}

export class SwapSessionExpiredError extends AgentError {
  constructor(context: ErrorContext = {}) {
    super(
      AgentErrorCode.SwapSessionExpired,
      "swap session has expired",
      context,
    );
    this.name = "SwapSessionExpiredError";
  }
}

export class TowerPubkeyMismatchError extends AgentError {
  constructor(context: ErrorContext = {}) {
    super(
      AgentErrorCode.TowerPubkeyMismatch,
      "tower filename does not embed the expected pubkey",
      context,
    );
    this.name = "TowerPubkeyMismatchError";
  }
}

export class IdentityPubkeyMismatchError extends AgentError {
  constructor(context: ErrorContext = {}) {
    super(
      AgentErrorCode.IdentityPubkeyMismatch,
      "identity keypair does not derive to the expected pubkey",
      context,
    );
    this.name = "IdentityPubkeyMismatchError";
  }
}

export class PeerUnknownError extends AgentError {
  constructor(context: ErrorContext = {}) {
    super(
      AgentErrorCode.PeerUnknown,
      "sender long-term pubkey is not in the paired peers list",
      context,
    );
    this.name = "PeerUnknownError";
  }
}

export class TimestampOutOfWindowError extends AgentError {
  constructor(context: ErrorContext = {}) {
    super(
      AgentErrorCode.TimestampOutOfWindow,
      "message timestamp is outside the acceptable window",
      context,
    );
    this.name = "TimestampOutOfWindowError";
  }
}

export class AdminRpcFailedError extends AgentError {
  constructor(message: string, context: ErrorContext = {}) {
    super(AgentErrorCode.AdminRpcFailed, message, context);
    this.name = "AdminRpcFailedError";
  }
}

export class CliFailedError extends AgentError {
  constructor(message: string, context: ErrorContext = {}) {
    super(AgentErrorCode.CliFailed, message, context);
    this.name = "CliFailedError";
  }
}

export class KeyfilePermissionsUnsafeError extends AgentError {
  constructor(context: ErrorContext = {}) {
    super(
      AgentErrorCode.KeyfilePermissionsUnsafe,
      "sensitive key file must have mode 0600 or stricter",
      context,
    );
    this.name = "KeyfilePermissionsUnsafeError";
  }
}

export class ConfigInvalidError extends AgentError {
  constructor(message: string, context: ErrorContext = {}) {
    super(AgentErrorCode.ConfigInvalid, message, context);
    this.name = "ConfigInvalidError";
  }
}

export class ValidatorUnreachableError extends AgentError {
  constructor(message: string, context: ErrorContext = {}) {
    super(AgentErrorCode.ValidatorUnreachable, message, context);
    this.name = "ValidatorUnreachableError";
  }
}
