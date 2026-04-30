import process from "node:process";
import { sodiumReady } from "@vswap/protocol";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { buildRuntime } from "./runtime.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  await sodiumReady();
  const config = loadConfig();
  const logger = createLogger({ level: config.logging.level });
  const runtime = await buildRuntime({ config, logger });
  const app = await createServer({ runtime });
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "agent shutting down");
    try {
      await app.close();
    } catch (err) {
      logger.error({ err }, "error closing agent");
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  await app.listen({
    host: config.listen.host,
    port: config.listen.port,
  });
  logger.info(
    {
      host: config.listen.host,
      port: config.listen.port,
      pubkey: runtime.identity.publicKeyBase58,
    },
    "vswap agent listening",
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
