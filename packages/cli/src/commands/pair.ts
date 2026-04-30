/**
 * `vswap pair` — exchange long-term Ed25519 pubkeys with an agent and
 * persist the result to peers.json. Confirms the agent's pubkey
 * fingerprint with the operator (TOFU pattern).
 */

import { ExitCode } from "../util/exit-codes.js";
import { resolveConfigPaths } from "../config/paths.js";
import { loadClientConfig } from "../config/load.js";
import { PeersStore } from "../config/peers.js";
import { AgentClient } from "../client/agent-client.js";
import { encodeBase58, fingerprintPubkey } from "../util/base58.js";
import { emitJson } from "../ui/json.js";
import {
  classifyValidatorVersion,
  type ValidatorVersionStatus,
} from "../util/validator-versions.js";

export interface PairOptions {
  readonly agent: string;
  readonly label: string;
  readonly configPath?: string;
  readonly note?: string;
  readonly yes?: boolean;
  readonly force?: boolean;
  readonly json?: boolean;
}

export async function runPair(
  opts: PairOptions,
  stdout: NodeJS.WriteStream = process.stdout,
): Promise<number> {
  const paths = resolveConfigPaths(opts.configPath);
  const config = await loadClientConfig(paths);
  const peers = await PeersStore.open(paths.peers);

  const client = new AgentClient({ config });
  const correlationId = undefined; // use default
  const response = await client.pair(
    { address: opts.agent },
    { secretKey: config.identity.secretKey, publicKey: config.identity.publicKey },
    correlationId,
  );
  const agentPubkeyBase58 = encodeBase58(response.message.senderLongTermPubkey);
  const fingerprint = fingerprintPubkey(agentPubkeyBase58);
  const validatorVersion = response.message.validatorVersion ?? null;
  const validatorVersionStatus: ValidatorVersionStatus =
    classifyValidatorVersion(validatorVersion);

  if (opts.json !== true) {
    stdout.write(`Agent at ${opts.agent} responded with long-term pubkey:\n`);
    stdout.write(`  pubkey:      ${agentPubkeyBase58}\n`);
    stdout.write(`  fingerprint: ${fingerprint}\n`);
    if (validatorVersion !== null) {
      stdout.write(`  validator:   ${validatorVersion}\n`);
    } else {
      stdout.write(
        `  validator:   <not reported> (older agent or version probe failed)\n`,
      );
    }
    if (validatorVersionStatus.kind === "untested") {
      stdout.write(
        `\nWARNING: validator version "${validatorVersionStatus.version}" is not in the tested matrix.\n`,
      );
      stdout.write(
        `         vswap will still pair, but proceed with caution and report issues.\n`,
      );
      stdout.write(`         See docs/supported-versions.md.\n`);
    } else if (validatorVersionStatus.kind === "broken") {
      stdout.write(
        `\nWARNING: validator version "${validatorVersionStatus.version}" has a known regression\n`,
      );
      stdout.write(
        `         (${validatorVersionStatus.reason}).\n`,
      );
      stdout.write(
        `         vswap will still pair, but a swap may fail. See docs/supported-versions.md.\n`,
      );
    }
  }

  const accepted = await acceptOrPrompt(opts, fingerprint, stdout);
  if (!accepted) {
    if (opts.json === true) {
      emitJson(
        "pair.aborted",
        { agent: opts.agent, label: opts.label, fingerprint },
        stdout,
      );
    } else {
      stdout.write("Aborted: fingerprint not confirmed.\n");
    }
    return ExitCode.AbortedByUser;
  }

  await peers.upsert(
    {
      label: opts.label,
      address: opts.agent,
      longTermPubkey: agentPubkeyBase58,
      addedAt: Date.now(),
      ...(opts.note !== undefined ? { note: opts.note } : {}),
    },
    { force: opts.force === true },
  );

  if (opts.json === true) {
    emitJson(
      "pair.completed",
      {
        agent: opts.agent,
        label: opts.label,
        fingerprint,
        longTermPubkey: agentPubkeyBase58,
        validatorVersion,
        validatorVersionStatus: validatorVersionStatus.kind,
        ...(validatorVersionStatus.kind === "broken"
          ? { validatorVersionWarning: validatorVersionStatus.reason }
          : {}),
      },
      stdout,
    );
  } else {
    stdout.write(`Paired '${opts.label}' (${opts.agent}).\n`);
  }
  return ExitCode.Success;
}

async function acceptOrPrompt(
  opts: PairOptions,
  fingerprint: string,
  stdout: NodeJS.WriteStream,
): Promise<boolean> {
  if (opts.yes === true) return true;
  if (!process.stdin.isTTY) {
    // Non-TTY without --yes is treated as a refusal — operators must
    // opt in explicitly when scripting `vswap pair`.
    stdout.write(
      "stdin is not a TTY; pass --yes to confirm the pairing without an interactive prompt.\n",
    );
    return false;
  }
  stdout.write(
    "\nVerify the fingerprint above matches the value the agent operator gave you out of band.\n",
  );
  stdout.write(`Type the fingerprint or 'yes' to accept, anything else to abort: `);
  const { input } = await import("@inquirer/prompts");
  let answer: string;
  try {
    answer = await input({ message: ">" });
  } catch {
    return false;
  }
  const trimmed = answer.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.toLowerCase() === "yes") return true;
  return trimmed.toUpperCase() === fingerprint;
}
