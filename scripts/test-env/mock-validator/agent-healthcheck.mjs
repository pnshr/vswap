#!/usr/bin/env node
// mTLS-aware healthcheck for the vswap agent container. Re-uses the
// agent's own server cert as a client cert (the test fixtures issue
// `extKeyUsage=both` on every leaf cert) so the TLS handshake
// succeeds. Exits 0 when /health returns 200, non-zero otherwise.
import { request } from "node:https";
import { readFileSync } from "node:fs";

const configDir = "/etc/vswap";
const cert = readFileSync(`${configDir}/server.crt`);
const key = readFileSync(`${configDir}/server.key`);
const ca = readFileSync(`${configDir}/ca.crt`);

const req = request(
  {
    host: "127.0.0.1",
    port: 7872,
    method: "GET",
    path: "/health",
    cert,
    key,
    ca,
    rejectUnauthorized: false,
    timeout: 2000,
  },
  (res) => {
    res.resume();
    process.exit(res.statusCode === 200 ? 0 : 1);
  },
);
req.on("error", (err) => {
  process.stderr.write(`healthcheck: ${err.message}\n`);
  process.exit(2);
});
req.on("timeout", () => {
  req.destroy(new Error("timeout"));
});
req.end();
