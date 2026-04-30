import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { MAX_MESSAGE_SIZE_BYTES, sodiumReady } from "@vswap/protocol";
import { loadTlsMaterial, mtlsHttpsOptions } from "./auth/mtls.js";
import { registerRoutes } from "./routes/index.js";
import { VSWAP_CONTENT_TYPE } from "./routes/envelope-helpers.js";
import type { AgentRuntime } from "./runtime.js";

export interface CreateServerOptions {
  readonly runtime: AgentRuntime;
  readonly skipTls?: boolean;
}

/**
 * Build a fully-wired Fastify app. Accepts a pre-built
 * {@link AgentRuntime}; tests can construct a runtime with a dummy
 * validator + an in-memory nonce cache and exercise the server without
 * touching the filesystem.
 *
 * When `skipTls` is true the HTTPS layer is omitted — this is only
 * meant for unit tests that never accept a real network connection.
 */
export async function createServer(
  opts: CreateServerOptions,
): Promise<FastifyInstance> {
  await sodiumReady();
  const tlsMaterial =
    opts.skipTls === true ? null : await loadTlsMaterial(opts.runtime.config);
  const app = Fastify({
    disableRequestLogging: true,
    bodyLimit: MAX_MESSAGE_SIZE_BYTES,
    ...(tlsMaterial !== null
      ? { https: mtlsHttpsOptions(tlsMaterial) }
      : {}),
  });
  app.addHook("onRequest", (req, _reply, done) => {
    opts.runtime.logger.info(
      { method: req.method, url: req.url, id: req.id },
      "http.request",
    );
    done();
  });
  app.addHook("onError", (req, _reply, err, done) => {
    opts.runtime.logger.error(
      { method: req.method, url: req.url, id: req.id, err: err.message },
      "http.error",
    );
    done();
  });
  app.addContentTypeParser(
    VSWAP_CONTENT_TYPE,
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    },
  );
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    },
  );
  await app.register(fastifyWebsocket);
  await app.register(registerRoutes, { runtime: opts.runtime });
  return app;
}
