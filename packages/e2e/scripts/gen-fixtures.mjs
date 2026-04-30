#!/usr/bin/env node
/**
 * Generate every artifact the e2e test environment needs. Idempotent:
 * re-runs are cheap no-ops, `--force` wipes and regenerates.
 *
 * Outputs layout (all under scripts/test-env/fixtures/):
 *
 *   ca/
 *     ca.crt                    CA root certificate (PEM)
 *     ca.key                    CA private key (PEM, 0600)
 *   agent-a/
 *     long-term.sk              64-byte raw ed25519 secret (0600)
 *     long-term.pk              32-byte raw ed25519 public
 *     long-term.base58          base58(pubkey), convenience
 *     server.crt                mTLS server cert (PEM)
 *     server.key                mTLS server key (PEM, 0600)
 *     agent.yaml                agent config
 *   agent-b/                    same
 *   validator-a/
 *     staked.json               Solana CLI-format keypair (64-byte JSON array)
 *     unstaked.json             same
 *     identity.json             symlink target (points to staked on boot)
 *   validator-b/                same
 *   operator/
 *     .vswap/
 *       client.sk               CLI long-term secret (64 raw bytes)
 *       client.pk               CLI long-term public (32 raw bytes)
 *       ca.crt, ca.key          copy of CA (key 0600)
 *       client.crt, client.key  CA-signed client cert
 *       peers.json              empty (populated by `vswap pair`)
 *
 * Everything derives from a single random root. The CA is our own, the
 * mock validator image accepts any Solana keypair file, and the agent
 * configs reference absolute paths inside the containers (they are
 * bind-mounted, not baked into images).
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sodiumPromise from "libsodium-wrappers";
import forge from "node-forge";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/gen-fixtures.mjs → packages/e2e → repo root → scripts/test-env
const REPO_ROOT = join(__dirname, "..", "..", "..");
const FIXTURES_ROOT = join(REPO_ROOT, "scripts", "test-env", "fixtures");

const BASE58 =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Encode raw bytes to Solana-style base58 (Bitcoin alphabet). */
function encodeBase58(bytes) {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const source = Array.from(bytes);
  const size = Math.ceil((bytes.length * 138) / 100) + 1;
  const b58 = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < source.length; i++) {
    let carry = source[i];
    let j = 0;
    for (
      let it = size - 1;
      (carry !== 0 || j < length) && it >= 0;
      it -= 1, j += 1
    ) {
      carry += 256 * b58[it];
      b58[it] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }
  let iter = size - length;
  while (iter < size && b58[iter] === 0) iter += 1;
  let out = "1".repeat(zeros);
  while (iter < size) {
    out += BASE58[b58[iter]];
    iter += 1;
  }
  return out;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeSecret(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function writePublic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data, { mode: 0o644 });
}

/**
 * Create a fresh ed25519 keypair using libsodium. Returns the 64-byte
 * secret (seed||pubkey), the 32-byte public, and the base58 public.
 */
function genEd25519(sodium) {
  const kp = sodium.crypto_sign_keypair();
  return {
    secret: Buffer.from(kp.privateKey),
    public: Buffer.from(kp.publicKey),
    base58: encodeBase58(kp.publicKey),
  };
}

/**
 * Build a self-signed CA cert/key using node-forge. We use RSA-2048
 * (forge's default) because ed25519 PKI support in forge is limited
 * and Node's TLS stack accepts RSA certs everywhere.
 */
function generateCa(commonName) {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `0${randomBytes(16).toString("hex")}`;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 5);
  const attrs = [{ name: "commonName", value: commonName }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    {
      name: "keyUsage",
      keyCertSign: true,
      cRLSign: true,
      critical: true,
    },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certObj: cert,
    keyObj: keys.privateKey,
  };
}

/**
 * Generate a leaf cert signed by the given CA. `usage` picks between
 * server and client ext-key-usage; SANs include the passed DNS names
 * and 127.0.0.1.
 */
function generateLeaf(ca, { commonName, sans, usage }) {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `0${randomBytes(16).toString("hex")}`;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 5);
  cert.setSubject([{ name: "commonName", value: commonName }]);
  cert.setIssuer(ca.certObj.subject.attributes);
  const altNames = sans.map((s) => {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return { type: 7, ip: s };
    return { type: 2, value: s };
  });
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true,
      critical: true,
    },
    {
      name: "extKeyUsage",
      serverAuth: usage === "server" || usage === "both",
      clientAuth: usage === "client" || usage === "both",
    },
    { name: "subjectAltName", altNames },
  ]);
  cert.sign(ca.keyObj, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

/** Solana CLI-format keypair file: JSON array of 64 uint8 values. */
function toSolanaKeypairJson(secret) {
  return JSON.stringify(Array.from(secret));
}

/** YAML serialiser — hand-rolled because the agent reads strict YAML
 *  and we only need a handful of scalars. */
function toYaml(obj, indent = 0) {
  const pad = "  ".repeat(indent);
  let out = "";
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      out += `${pad}${k}:\n${toYaml(v, indent + 1)}`;
    } else {
      out += `${pad}${k}: ${JSON.stringify(v)}\n`;
    }
  }
  return out;
}

async function buildAgentFixtures(name, containerHostname, port, sodium, ca) {
  const dir = join(FIXTURES_ROOT, name);
  await mkdir(dir, { recursive: true });

  const lt = genEd25519(sodium);
  await writeSecret(join(dir, "long-term.sk"), lt.secret);
  await writePublic(join(dir, "long-term.pk"), lt.public);
  await writePublic(join(dir, "long-term.base58"), lt.base58);

  const leaf = generateLeaf(ca, {
    commonName: containerHostname,
    sans: [containerHostname, "localhost", "127.0.0.1"],
    usage: "both",
  });
  await writePublic(join(dir, "server.crt"), leaf.certPem);
  await writeSecret(join(dir, "server.key"), leaf.keyPem);

  // The config assumes paths inside the agent container. The compose
  // file bind-mounts this fixture dir at /etc/vswap and the validator
  // fixture at /var/validator. The shared ledger volume is mounted at
  // /var/ledger. `dataDir` lives on a private tmpfs per container.
  const config = {
    listen: { host: "0.0.0.0", port },
    tls: {
      certPath: "/etc/vswap/server.crt",
      keyPath: "/etc/vswap/server.key",
      caPath: "/etc/vswap/ca.crt",
    },
    validator: {
      ledgerPath: "/var/ledger",
      stakedIdentityPath: "/var/validator/staked.json",
      unstakedIdentityPath: "/var/validator/unstaked.json",
      identitySymlinkPath: "/var/validator/identity.json",
      binary: "/usr/local/bin/agave-validator",
    },
    identity: {
      longTermSigningKeyPath: "/etc/vswap/long-term.sk",
      longTermPublicKeyPath: "/etc/vswap/long-term.pk",
    },
    tmpfs: { basePath: "/dev/shm/vswap" },
    dataDir: "/var/lib/vswap",
    logging: { level: "info" },
  };
  await writePublic(join(dir, "agent.yaml"), toYaml(config));
  await writePublic(
    join(dir, "ca.crt"),
    await readFile(join(FIXTURES_ROOT, "ca/ca.crt")),
  );
  return { ...lt, dir };
}

async function buildValidatorFixtures(name, sodium) {
  const dir = join(FIXTURES_ROOT, name);
  await mkdir(dir, { recursive: true });

  const staked = genEd25519(sodium);
  const unstaked = genEd25519(sodium);

  // Solana CLI format — 64-byte JSON array.
  await writeSecret(
    join(dir, "staked.json"),
    toSolanaKeypairJson(staked.secret),
  );
  await writeSecret(
    join(dir, "unstaked.json"),
    toSolanaKeypairJson(unstaked.secret),
  );
  // identity.json starts as a verbatim copy of staked.json. The agent
  // rewrites it during swap/rollback. We deliberately avoid a symlink
  // because bind-mounted volumes confuse symlink semantics across
  // container boundaries.
  await writeSecret(
    join(dir, "identity.json"),
    toSolanaKeypairJson(staked.secret),
  );

  // Metadata for test assertions — which pubkey is "the staked one".
  await writePublic(
    join(dir, "pubkeys.json"),
    JSON.stringify(
      { staked: staked.base58, unstaked: unstaked.base58 },
      null,
      2,
    ),
  );
  return { staked, unstaked, dir };
}

async function buildOperatorFixtures(sodium, ca) {
  const dir = join(FIXTURES_ROOT, "operator", ".vswap");
  await mkdir(dir, { recursive: true });

  const lt = genEd25519(sodium);
  await writeSecret(join(dir, "client.sk"), lt.secret);
  await writePublic(join(dir, "client.pk"), lt.public);
  await writePublic(
    join(dir, "ca.crt"),
    await readFile(join(FIXTURES_ROOT, "ca/ca.crt")),
  );
  await writeSecret(
    join(dir, "ca.key"),
    await readFile(join(FIXTURES_ROOT, "ca/ca.key")),
  );

  const leaf = generateLeaf(ca, {
    commonName: `operator-${lt.base58.slice(0, 12)}`,
    sans: ["localhost", "127.0.0.1"],
    usage: "client",
  });
  await writePublic(join(dir, "client.crt"), leaf.certPem);
  await writeSecret(join(dir, "client.key"), leaf.keyPem);

  // Empty peers file — `vswap pair` populates it.
  await writePublic(
    join(dir, "peers.json"),
    JSON.stringify({ version: 1, peers: [] }, null, 2),
  );
  return { ...lt, dir };
}

async function main() {
  const force = process.argv.includes("--force");
  if (force && (await exists(FIXTURES_ROOT))) {
    await rm(FIXTURES_ROOT, { recursive: true, force: true });
  }
  await mkdir(FIXTURES_ROOT, { recursive: true });

  const caDir = join(FIXTURES_ROOT, "ca");
  if (!(await exists(join(caDir, "ca.crt")))) {
    const ca = generateCa("vswap-test-env CA");
    await writePublic(join(caDir, "ca.crt"), ca.certPem);
    await writeSecret(join(caDir, "ca.key"), ca.keyPem);
  }
  const caCertPem = await readFile(join(caDir, "ca.crt"), "utf8");
  const caKeyPem = await readFile(join(caDir, "ca.key"), "utf8");
  const caObj = {
    certPem: caCertPem,
    keyPem: caKeyPem,
    certObj: forge.pki.certificateFromPem(caCertPem),
    keyObj: forge.pki.privateKeyFromPem(caKeyPem),
  };

  const sodium = sodiumPromise;
  await sodium.ready;

  const validatorA = await buildValidatorFixtures("validator-a", sodium);
  const validatorB = await buildValidatorFixtures("validator-b", sodium);
  const agentA = await buildAgentFixtures("agent-a", "agent-a", 7872, sodium, caObj);
  const agentB = await buildAgentFixtures("agent-b", "agent-b", 7872, sodium, caObj);
  const operator = await buildOperatorFixtures(sodium, caObj);

  const manifest = {
    generatedAt: new Date().toISOString(),
    ca: { certPath: "ca/ca.crt" },
    validators: {
      "validator-a": {
        staked: validatorA.staked.base58,
        unstaked: validatorA.unstaked.base58,
      },
      "validator-b": {
        staked: validatorB.staked.base58,
        unstaked: validatorB.unstaked.base58,
      },
    },
    agents: {
      "agent-a": { longTermPubkey: agentA.base58 },
      "agent-b": { longTermPubkey: agentB.base58 },
    },
    operator: { longTermPubkey: operator.base58 },
  };
  await writePublic(
    join(FIXTURES_ROOT, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  process.stdout.write(
    `Fixtures ready at ${FIXTURES_ROOT}\n` +
      `  operator:    ${operator.base58}\n` +
      `  agent-a:     ${agentA.base58}\n` +
      `  agent-b:     ${agentB.base58}\n` +
      `  validator-a staked:   ${validatorA.staked.base58}\n` +
      `  validator-a unstaked: ${validatorA.unstaked.base58}\n` +
      `  validator-b staked:   ${validatorB.staked.base58}\n` +
      `  validator-b unstaked: ${validatorB.unstaked.base58}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `gen-fixtures failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
