/**
 * `vswap version` — prints the CLI version, the supported wire
 * protocol version, and the supported `agave-validator` versions in a
 * machine- and human-friendly form.
 */

import { PROTOCOL_VERSION } from "@vswap/protocol";
import { ExitCode } from "../util/exit-codes.js";

export const CLI_VERSION = "0.1.0";

/** Range of `agave-validator` builds the agent / CLI have been tested against. */
export const SUPPORTED_VALIDATOR_VERSIONS: ReadonlyArray<string> = [
  "agave-validator 2.0.x (works); 3.1.x (source-compat)",
];

export interface VersionOptions {
  readonly json?: boolean;
}

export interface VersionPayload {
  readonly cli: string;
  readonly protocol: string;
  readonly supportedValidators: ReadonlyArray<string>;
}

export function versionPayload(): VersionPayload {
  return {
    cli: CLI_VERSION,
    protocol: PROTOCOL_VERSION,
    supportedValidators: SUPPORTED_VALIDATOR_VERSIONS,
  };
}

export function runVersion(opts: VersionOptions): number {
  const payload = versionPayload();
  if (opts.json === true) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return ExitCode.Success;
  }
  process.stdout.write(`vswap ${payload.cli}\n`);
  process.stdout.write(`  protocol: ${payload.protocol}\n`);
  process.stdout.write(`  supported agave-validator: ${payload.supportedValidators.join(", ")}\n`);
  return ExitCode.Success;
}
