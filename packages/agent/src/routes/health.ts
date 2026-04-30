import type { FastifyInstance } from "fastify";

/**
 * Liveness probe. Deliberately minimal: no version, no config, no
 * paths — just 200 OK so load balancers can detect a crash loop.
 */
export function registerHealthRoute(app: FastifyInstance): void {
  app.get("/health", async (_req, reply) => {
    await reply.code(200).type("text/plain").send("ok");
  });
}
