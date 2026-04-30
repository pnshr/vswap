import type { FastifyPluginAsync } from "fastify";
import { registerHealthRoute } from "./health.js";
import { registerPreflightRoute } from "./preflight.js";
import { registerPairRoute } from "./pair.js";
import { registerSwapInitRoute } from "./swap-init.js";
import { registerSwapSendRoute } from "./swap-send.js";
import { registerSwapApplyRoute } from "./swap-apply.js";
import { registerSwapRollbackRoute } from "./swap-rollback.js";
import { registerSwapProgressRoute } from "./swap-progress.js";
import { registerStatusRoute } from "./status.js";
import type { AgentRuntime } from "../runtime.js";

export interface RegisterRoutesOptions {
  readonly runtime: AgentRuntime;
}

export const registerRoutes: FastifyPluginAsync<RegisterRoutesOptions> = (
  app,
  opts,
) => {
  registerHealthRoute(app);
  registerPreflightRoute(app, opts.runtime);
  registerPairRoute(app, opts.runtime);
  registerSwapInitRoute(app, opts.runtime);
  registerSwapSendRoute(app, opts.runtime);
  registerSwapApplyRoute(app, opts.runtime);
  registerSwapRollbackRoute(app, opts.runtime);
  registerStatusRoute(app, opts.runtime);
  registerSwapProgressRoute(app, opts.runtime);
  return Promise.resolve();
};
