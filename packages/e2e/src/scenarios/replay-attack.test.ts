/**
 * replay-attack.test.ts — intercept the first signed envelope the CLI
 * sends, resend it verbatim, and expect a protocol-level rejection
 * from the nonce cache.
 *
 * We use Node's `http.request` with `ALPNProtocols: ["http/1.1"]` and
 * a self-signed client cert we can read from the operator fixtures.
 * The envelope we capture comes from a completed /status request so
 * we can replay without triggering any side-effects on first try.
 */
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startEnv, resetScenario, FIXTURES_DIR } from "../harness/index.js";

const OPERATOR_DIR = join(FIXTURES_DIR, "operator", ".vswap");
const AGENT_A = "127.0.0.1:7872";

/** Load operator mTLS material once per describe. */
function loadClientTls(): { cert: Buffer; key: Buffer; ca: Buffer } {
  return {
    cert: readFileSync(join(OPERATOR_DIR, "client.crt")),
    key: readFileSync(join(OPERATOR_DIR, "client.key")),
    ca: readFileSync(join(OPERATOR_DIR, "ca.crt")),
  };
}

/**
 * Issue a raw HTTPS request with the given msgpack body and return
 * the response body + status code. No envelope parsing here — we only
 * care whether the agent replies with 2xx or a 4xx/5xx on replay.
 */
function rawPost(
  pathName: string,
  body: Uint8Array,
  tls: { cert: Buffer; key: Buffer; ca: Buffer },
): Promise<{ statusCode: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const [host, port] = AGENT_A.split(":");
    const req = request(
      {
        host,
        port: Number(port),
        path: pathName,
        method: "POST",
        cert: tls.cert,
        key: tls.key,
        ca: tls.ca,
        rejectUnauthorized: false,
        headers: {
          "content-type": "application/vswap+msgpack",
          "content-length": String(body.byteLength),
        },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(body);
    req.end();
  });
}

describe("replay-attack: reusing a signed envelope", () => {
  beforeAll(async () => {
    await startEnv();
  });

  beforeEach(async () => {
    await resetScenario();
  });

  afterAll(async () => {
    await resetScenario();
  });

  it("second use of the same envelope is rejected by nonce cache", async () => {
    // Build a signed envelope by importing from the protocol package.
    // We issue the request once (success expected), then re-send the
    // exact same bytes (replay).
    const protocol = await import("@vswap/protocol");
    const { sealEnvelope, SigningSecretKey, PROTOCOL_VERSION } =
      protocol as unknown as {
        sealEnvelope: (
          msg: unknown,
          secretKey: unknown,
          publicKey: Uint8Array,
        ) => Promise<Uint8Array>;
        SigningSecretKey: new (bytes: Uint8Array) => unknown;
        PROTOCOL_VERSION: string;
      };

    // Operator keypair: 64 raw bytes.
    const raw = readFileSync(join(OPERATOR_DIR, "client.sk"));
    const secretKey = new Uint8Array(
      raw.buffer,
      raw.byteOffset,
      raw.byteLength,
    );
    const pubRaw = readFileSync(join(OPERATOR_DIR, "client.pk"));
    const publicKey = new Uint8Array(
      pubRaw.buffer,
      pubRaw.byteOffset,
      pubRaw.byteLength,
    );

    // A PreflightRequest is the cheapest authenticated call.
    const nonce = new Uint8Array(24);
    for (let i = 0; i < 24; i++) nonce[i] = Math.floor(Math.random() * 256);
    const correlationId = "11111111-1111-1111-1111-111111111111";
    const message = {
      type: "PreflightRequest",
      version: PROTOCOL_VERSION,
      nonce,
      timestamp: Date.now(),
      correlationId,
      agentVersion: "0.1.0",
      capabilities: ["status"],
    };
    const signing = new SigningSecretKey(secretKey);
    const envelope = await sealEnvelope(message, signing, publicKey);

    const tls = loadClientTls();
    const first = await rawPost("/preflight", envelope, tls);
    expect(first.statusCode).toBe(200);

    const replay = await rawPost("/preflight", envelope, tls);
    // The agent rejects replayed nonces with 4xx (401 or 409 depending
    // on version). The important invariant is that it did NOT return
    // 2xx again.
    expect(replay.statusCode).toBeGreaterThanOrEqual(400);
    expect(replay.statusCode).toBeLessThan(500);
  });
});
