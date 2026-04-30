import { readlink, stat } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import type { AgentConfig } from "../config.js";
import type { AdminRpcClient } from "../solana/admin-rpc.js";
import type { ValidatorCli } from "../solana/cli.js";
import { findTowerFile } from "../solana/tower.js";
import { readKeypairFile, derivePubkeyBase58 } from "../solana/identity.js";
import { scrub } from "@vswap/protocol";

export type PreflightCheckStatus = "ok" | "warning" | "fail";

export interface PreflightCheck {
  readonly name: string;
  readonly status: PreflightCheckStatus;
  readonly message: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface PreflightReport {
  readonly role: "source" | "target";
  readonly checks: ReadonlyArray<PreflightCheck>;
  readonly ok: boolean;
}

export interface PreflightOptions {
  readonly role: "source" | "target";
  readonly config: AgentConfig;
  readonly rpc: AdminRpcClient;
  readonly cli: ValidatorCli;
}

/**
 * Orchestrate every readiness check a swap role cares about. Returns a
 * structured report; the caller decides whether to abort.
 */
export async function runPreflight(
  opts: PreflightOptions,
): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];

  checks.push(await checkValidatorReachable(opts.rpc));
  checks.push(await checkCliVersion(opts.cli));
  if (opts.role === "source") {
    checks.push(await checkCaughtUp(opts.cli));
  }

  const stakedCheck = await checkKeypair(
    opts.config.validator.stakedIdentityPath,
    "staked identity",
  );
  checks.push(stakedCheck.check);
  const unstakedCheck = await checkKeypair(
    opts.config.validator.unstakedIdentityPath,
    "unstaked identity",
  );
  checks.push(unstakedCheck.check);

  if (opts.role === "source" && stakedCheck.pubkey !== null) {
    checks.push(
      await checkTowerFile(
        opts.config.validator.ledgerPath,
        stakedCheck.pubkey,
      ),
    );
  }

  checks.push(
    await checkIdentitySymlink(
      opts.config.validator.identitySymlinkPath,
      opts.config.validator.stakedIdentityPath,
    ),
  );

  const ok = checks.every((c) => c.status !== "fail");
  return { role: opts.role, checks, ok };
}

async function checkValidatorReachable(
  rpc: AdminRpcClient,
): Promise<PreflightCheck> {
  try {
    const info = await rpc.contactInfo();
    return {
      name: "validator.reachable",
      status: "ok",
      message: `admin RPC reachable; identity ${info.identity}`,
      context: { identity: info.identity, version: info.version },
    };
  } catch (err) {
    return {
      name: "validator.reachable",
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkCliVersion(cli: ValidatorCli): Promise<PreflightCheck> {
  try {
    const version = await cli.version();
    return {
      name: "validator.cli",
      status: "ok",
      message: version,
    };
  } catch (err) {
    return {
      name: "validator.cli",
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkCaughtUp(cli: ValidatorCli): Promise<PreflightCheck> {
  try {
    const stdout = await cli.catchup();
    const caughtUp = /has caught up/i.test(stdout);
    return {
      name: "validator.catchup",
      status: caughtUp ? "ok" : "warning",
      message: caughtUp
        ? "validator is caught up"
        : "validator not confirmed caught up; proceed with caution",
    };
  } catch (err) {
    return {
      name: "validator.catchup",
      status: "warning",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkKeypair(
  path: string,
  label: string,
): Promise<{ check: PreflightCheck; pubkey: string | null }> {
  try {
    const kp = await readKeypairFile(path);
    try {
      // Double-check derivation since `readKeypairFile` already computes
      // the pubkey; this gives us a belt-and-braces error if the cached
      // derivation ever drifts from the primitive.
      const derived = await derivePubkeyBase58(kp.secretKey);
      return {
        check: {
          name: `keypair.${label}`,
          status: derived === kp.publicKey ? "ok" : "fail",
          message: derived === kp.publicKey
            ? `${label} pubkey ${kp.publicKey}`
            : `${label} pubkey derivation mismatch`,
          context: { path },
        },
        pubkey: kp.publicKey,
      };
    } finally {
      scrub(kp.secretKey);
    }
  } catch (err) {
    return {
      check: {
        name: `keypair.${label}`,
        status: "fail",
        message: err instanceof Error ? err.message : String(err),
        context: { path },
      },
      pubkey: null,
    };
  }
}

async function checkTowerFile(
  ledgerPath: string,
  expectedPubkey: string,
): Promise<PreflightCheck> {
  try {
    const path = await findTowerFile(ledgerPath, expectedPubkey);
    if (path === null) {
      return {
        name: "tower.present",
        status: "fail",
        message: `no tower file found for pubkey ${expectedPubkey}`,
        context: { ledgerPath },
      };
    }
    return {
      name: "tower.present",
      status: "ok",
      message: `tower file located`,
      context: { path },
    };
  } catch (err) {
    return {
      name: "tower.present",
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkIdentitySymlink(
  symlinkPath: string,
  expectedTarget: string,
): Promise<PreflightCheck> {
  try {
    let actualTarget: string;
    try {
      actualTarget = await readlink(symlinkPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EINVAL") {
        // Not a symlink — still acceptable if it resolves to the file
        // the operator configured.
        await stat(symlinkPath);
        actualTarget = symlinkPath;
      } else {
        throw err;
      }
    }
    const resolved = resolvePath(
      symlinkPath,
      "..",
      actualTarget,
    );
    const expectedResolved = resolvePath(expectedTarget);
    return {
      name: "identity.symlink",
      status: resolved === expectedResolved ? "ok" : "warning",
      message:
        resolved === expectedResolved
          ? `identity symlink points at expected target`
          : `identity symlink points elsewhere; expected ${expectedResolved}`,
      context: { symlinkPath, resolved },
    };
  } catch (err) {
    return {
      name: "identity.symlink",
      status: "warning",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
