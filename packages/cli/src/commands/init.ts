/**
 * `vswap init` — first-run setup. Creates the operator's config dir,
 * generates a long-term Ed25519 keypair, builds a small mTLS PKI (CA
 * + client cert/key), and writes an empty peers file.
 *
 * Heavy dependencies (`node-forge`, libsodium key generation) are
 * loaded lazily so `vswap --help` and `vswap --version` stay snappy.
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { generateSigningKeypair } from "@vswap/protocol";
import type * as ForgeNs from "node-forge";
import { resolveConfigPaths, type ConfigPaths } from "../config/paths.js";
import { PeersStore } from "../config/peers.js";
import { encodeBase58 } from "../util/base58.js";
import { ExitCode } from "../util/exit-codes.js";
import { emitJson } from "../ui/json.js";

export interface InitOptions {
  readonly configPath?: string;
  readonly force?: boolean;
  readonly json?: boolean;
}

export interface InitArtifacts {
  readonly paths: ConfigPaths;
  readonly clientPubkeyBase58: string;
  /** Subject CN written into the generated client certificate. */
  readonly clientCertSubject: string;
  /** SHA-256 fingerprint of the CA cert (uppercase hex, colon-separated). */
  readonly caFingerprint: string;
}

/**
 * Run the init flow. Returns the exit code (0 success, non-zero when
 * config already exists and `--force` was not set).
 */
export async function runInit(
  opts: InitOptions,
  stdout: NodeJS.WriteStream = process.stdout,
): Promise<number> {
  const paths = resolveConfigPaths(opts.configPath);
  if (await rootIsPopulated(paths) && opts.force !== true) {
    stdout.write(
      `Refusing to overwrite existing config at ${paths.root}. ` +
        "Pass --force to regenerate everything (this rotates the operator's long-term key).\n",
    );
    return ExitCode.Generic;
  }
  await mkdir(paths.root, { recursive: true, mode: 0o700 });

  const kp = await generateSigningKeypair();
  const secretBytes = kp.secretKey.reveal();
  const pubkeyBase58 = encodeBase58(kp.publicKey);
  await writeSecret(paths.clientSecretKey, Buffer.from(secretBytes));
  await writeFile(paths.clientPublicKey, Buffer.from(kp.publicKey), { mode: 0o644 });

  const pki = await generateClientPki(pubkeyBase58);
  await writeFile(paths.caCert, pki.caCertPem, { mode: 0o644 });
  await writeSecret(paths.caKey, Buffer.from(pki.caKeyPem, "utf8"));
  await writeFile(paths.clientCert, pki.clientCertPem, { mode: 0o644 });
  await writeSecret(paths.clientKey, Buffer.from(pki.clientKeyPem, "utf8"));

  await PeersStore.init(paths.peers, opts.force === true);
  await mkdir(paths.logsDir, { recursive: true, mode: 0o700 });

  const artifacts: InitArtifacts = {
    paths,
    clientPubkeyBase58: pubkeyBase58,
    clientCertSubject: pki.subject,
    caFingerprint: pki.caFingerprint,
  };

  if (opts.json === true) {
    emitJson("init.completed", artifacts, stdout);
  } else {
    renderHumanSummary(artifacts, stdout);
  }
  return ExitCode.Success;
}

async function rootIsPopulated(paths: ConfigPaths): Promise<boolean> {
  for (const f of [paths.clientSecretKey, paths.clientPublicKey, paths.caCert]) {
    try {
      await stat(f);
      return true;
    } catch {
      /* missing — keep checking */
    }
  }
  return false;
}

async function writeSecret(path: string, content: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600 });
}

interface GeneratedPki {
  readonly caCertPem: string;
  readonly caKeyPem: string;
  readonly clientCertPem: string;
  readonly clientKeyPem: string;
  readonly subject: string;
  readonly caFingerprint: string;
}

/**
 * Build a self-signed CA + a client cert/key signed by the CA.
 *
 * `node-forge` is dynamically imported so `vswap --version` does not
 * pay for ~120 KB of cert machinery on the hot path.
 */
async function generateClientPki(clientPubkeyBase58: string): Promise<GeneratedPki> {
  const forge = (await import("node-forge")).default;

  const now = new Date();
  const tenYears = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000 * 10);

  const caKeys = forge.pki.rsa.generateKeyPair(2048);
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = caKeys.publicKey;
  caCert.serialNumber = randomSerial();
  caCert.validity.notBefore = now;
  caCert.validity.notAfter = tenYears;
  const caSubject = [
    { name: "commonName", value: "vswap operator CA" },
    { name: "organizationName", value: "vswap" },
  ];
  caCert.setSubject(caSubject);
  caCert.setIssuer(caSubject);
  caCert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);
  caCert.sign(caKeys.privateKey, forge.md.sha256.create());

  const clientKeys = forge.pki.rsa.generateKeyPair(2048);
  const clientCert = forge.pki.createCertificate();
  clientCert.publicKey = clientKeys.publicKey;
  clientCert.serialNumber = randomSerial();
  clientCert.validity.notBefore = now;
  clientCert.validity.notAfter = tenYears;
  const clientCommonName = `vswap-cli-${clientPubkeyBase58.slice(0, 16)}`;
  clientCert.setSubject([
    { name: "commonName", value: clientCommonName },
    { name: "organizationName", value: "vswap" },
  ]);
  clientCert.setIssuer(caSubject);
  clientCert.setExtensions([
    { name: "basicConstraints", cA: false, critical: true },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", clientAuth: true, serverAuth: false },
    { name: "subjectKeyIdentifier" },
  ]);
  clientCert.sign(caKeys.privateKey, forge.md.sha256.create());

  const caCertPem = forge.pki.certificateToPem(caCert);
  const caKeyPem = forge.pki.privateKeyToPem(caKeys.privateKey);
  const clientCertPem = forge.pki.certificateToPem(clientCert);
  const clientKeyPem = forge.pki.privateKeyToPem(clientKeys.privateKey);
  const caFingerprint = caCertFingerprint(forge, caCert);

  return {
    caCertPem,
    caKeyPem,
    clientCertPem,
    clientKeyPem,
    subject: clientCommonName,
    caFingerprint,
  };
}

function caCertFingerprint(
  forge: typeof ForgeNs,
  cert: ForgeNs.pki.Certificate,
): string {
  const md = forge.md.sha256.create();
  md.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  const hex = md.digest().toHex().toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    groups.push(hex.slice(i, i + 2));
  }
  return groups.join(":");
}

/**
 * Generate a 128-bit positive serial number using a cryptographically
 * secure RNG. RFC 5280 §4.1.2.2 / CA-Browser Forum guidance both
 * require >=64 bits of CSPRNG-sourced entropy in cert serial numbers
 * to prevent collisions and birthday attacks.
 */
function randomSerial(): string {
  const bytes = randomBytes(16);
  bytes[0] = (bytes[0] ?? 0) & 0x7f; // strip the sign bit so DER stays positive
  return bytes.toString("hex");
}

function renderHumanSummary(
  artifacts: InitArtifacts,
  stdout: NodeJS.WriteStream,
): void {
  const lines: string[] = [];
  lines.push(`vswap config initialised at ${artifacts.paths.root}`);
  lines.push("");
  lines.push("Operator long-term identity:");
  lines.push(`  Pubkey (base58): ${artifacts.clientPubkeyBase58}`);
  lines.push(`  Secret key file: ${artifacts.paths.clientSecretKey} (mode 0600)`);
  lines.push(`  Public key file: ${artifacts.paths.clientPublicKey}`);
  lines.push("");
  lines.push("mTLS material:");
  lines.push(`  CA certificate:     ${artifacts.paths.caCert}`);
  lines.push(`  CA fingerprint:     ${artifacts.caFingerprint}`);
  lines.push(`  CA private key:     ${artifacts.paths.caKey} (mode 0600)`);
  lines.push(`  Client certificate: ${artifacts.paths.clientCert} (CN=${artifacts.clientCertSubject})`);
  lines.push(`  Client private key: ${artifacts.paths.clientKey} (mode 0600)`);
  lines.push("");
  lines.push("Distribute to each agent host:");
  lines.push(`  1. Copy ${artifacts.paths.caCert} to the agent's tls.caPath (e.g. /etc/vswap/tls/ca.crt).`);
  lines.push("  2. On the agent host, generate a server cert/key signed by the same CA and");
  lines.push("     write them to tls.certPath / tls.keyPath. (Use openssl or your existing PKI.)");
  lines.push("  3. Run `vswap pair --agent <host:port> --label <name>` from this machine to");
  lines.push("     exchange long-term Ed25519 pubkeys with the agent.");
  for (const line of lines) {
    stdout.write(`${line}\n`);
  }
}
