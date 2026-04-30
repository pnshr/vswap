import { Buffer } from "node:buffer";
import { ExitCode } from "../util/exit-codes.js";
import { resolveConfigPaths } from "../config/paths.js";
import { loadClientConfig } from "../config/load.js";
import { PeersStore } from "../config/peers.js";

export interface ExportOptions {
  readonly configPath?: string;
  readonly forWeb?: boolean;
}

export async function runExport(
  opts: ExportOptions,
  stdout: NodeJS.WriteStream = process.stdout,
): Promise<number> {
  if (opts.forWeb !== true) {
    stdout.write("Nothing to export. Pass --for-web to write a web dashboard bundle.\n");
    return ExitCode.Generic;
  }

  const paths = resolveConfigPaths(opts.configPath);
  const config = await loadClientConfig(paths);
  const peers = await PeersStore.open(paths.peers);

  const bundle = {
    version: 1,
    name: "vswap-operator-config",
    operatorPubkey: config.identity.publicKeyBase58,
    peers: peers.list().map((peer) => {
      const { host, port } = splitAddress(peer.address);
      return {
        id: peer.label,
        label: peer.label,
        host,
        port,
        agentPubkey: peer.longTermPubkey,
      };
    }),
    secret: {
      format: "vswap-web-secret/v1",
      operatorPubkey: config.identity.publicKeyBase58,
      signingSecretKeyBase64: Buffer.from(
        config.identity.secretKey.reveal(),
      ).toString("base64"),
      clientCertPem: config.tls.clientCert.toString("utf8"),
      clientKeyPem: config.tls.clientKey.toString("utf8"),
      caCertPem: config.tls.caCert.toString("utf8"),
    },
  };

  stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
  return ExitCode.Success;
}

function splitAddress(address: string): { host: string; port: number } {
  const idx = address.lastIndexOf(":");
  if (idx <= 0 || idx === address.length - 1) {
    return { host: address, port: 7872 };
  }
  const host = address.slice(0, idx);
  const parsed = Number.parseInt(address.slice(idx + 1), 10);
  return {
    host,
    port: Number.isFinite(parsed) ? parsed : 7872,
  };
}
