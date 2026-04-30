import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FIXTURES_DIR } from "./paths.js";

export interface ValidatorFixture {
  readonly staked: string;
  readonly unstaked: string;
}

export interface FixtureManifest {
  readonly generatedAt: string;
  readonly ca: { readonly certPath: string };
  readonly validators: {
    readonly "validator-a": ValidatorFixture;
    readonly "validator-b": ValidatorFixture;
  };
  readonly agents: {
    readonly "agent-a": { readonly longTermPubkey: string };
    readonly "agent-b": { readonly longTermPubkey: string };
  };
  readonly operator: { readonly longTermPubkey: string };
}

/**
 * Parse `scripts/test-env/fixtures/manifest.json`. Throws a helpful
 * message if the file is missing — tests should call
 * {@link ComposeController.up} first, which regenerates fixtures when
 * needed.
 */
export async function loadManifest(): Promise<FixtureManifest> {
  const path = join(FIXTURES_DIR, "manifest.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(
      `fixtures manifest not found at ${path}; run \`bash scripts/test-env/up.sh\` first (cause: ${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
  return JSON.parse(raw) as FixtureManifest;
}
