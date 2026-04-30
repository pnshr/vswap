#!/usr/bin/env node
import("../dist/cli.js")
  .then((m) => m.run(process.argv))
  .catch((err) => {
    process.stderr.write(
      `vswap: failed to start: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
