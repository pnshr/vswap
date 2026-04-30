/**
 * HTTP clients for the validator's chaos/observation plane. Wrapping
 * these into typed helpers keeps scenarios terse.
 *
 * The two profiles (`mock` and `real`) implement the same API surface
 * but back it with different machinery — the mock validator hosts its
 * chaos plane in-process; the real validator has a sibling "ops"
 * sidecar that mounts the same ledger volume + admin.rpc socket.
 *
 * Endpoint URLs default to the host-port mapping in
 * `docker-compose.yml` / `docker-compose.real.yml`. They are
 * env-overridable via:
 *
 *   VSWAP_E2E_CHAOS_A_URL  (default per profile)
 *   VSWAP_E2E_CHAOS_B_URL  (default per profile)
 *
 * The defaults differ between profiles because the host port
 * reservations differ — the mock keeps the original 7999/7998 (and
 * Windows hosts override via docker-compose.override.yml + env vars to
 * dodge the 7981–8080 Hyper-V reservation), while the real profile
 * publishes the sidecar HTTP plane on 17999/17998 by default.
 */

import { activeProfile } from "./paths.js";

export interface ValidatorState {
  readonly currentIdentity: string;
  readonly initialIdentity: string;
  readonly voters: readonly string[];
  readonly chaos: readonly string[];
  readonly towerExists: boolean;
  /**
   * Optional per-profile metadata. The real-validator sidecar adds
   * `slot` (current slot from getSlot) and `clusterVersion` so
   * scenarios can sanity-check the validator is actually running.
   */
  readonly profile?: "mock" | "real";
  readonly slot?: number;
  readonly clusterVersion?: string;
}

const DEFAULT_URLS: Record<"mock" | "real", { a: string; b: string }> = {
  mock: {
    a: "http://127.0.0.1:7999",
    b: "http://127.0.0.1:7998",
  },
  real: {
    a: "http://127.0.0.1:17999",
    b: "http://127.0.0.1:17998",
  },
};

function resolveUrl(side: "a" | "b"): string {
  const envKey = side === "a" ? "VSWAP_E2E_CHAOS_A_URL" : "VSWAP_E2E_CHAOS_B_URL";
  const fromEnv = process.env[envKey];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  const profile = activeProfile();
  return side === "a" ? DEFAULT_URLS[profile].a : DEFAULT_URLS[profile].b;
}

const BASE_URLS = {
  get "validator-a"(): string {
    return resolveUrl("a");
  },
  get "validator-b"(): string {
    return resolveUrl("b");
  },
};

export type ValidatorLabel = "validator-a" | "validator-b";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init?.method ?? "GET"} ${url} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const validator = {
  async state(label: ValidatorLabel): Promise<ValidatorState> {
    return fetchJson<ValidatorState>(`${BASE_URLS[label]}/state`);
  },

  /** Set chaos flags. Pass an empty array to clear them. */
  async setChaos(label: ValidatorLabel, flags: readonly string[]): Promise<void> {
    await fetchJson<{ ok: boolean }>(`${BASE_URLS[label]}/chaos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flags }),
    });
  },

  /** Delete the tower file for the current identity (preflight will fail). */
  async deleteTower(label: ValidatorLabel): Promise<void> {
    await fetchJson<{ ok: boolean }>(`${BASE_URLS[label]}/tower/delete`, {
      method: "POST",
    });
  },

  /**
   * Rename the tower file so its embedded pubkey no longer matches the
   * current identity — exercises the tower-pubkey-mismatch check.
   */
  async corruptTower(
    label: ValidatorLabel,
    impostorPubkey: string,
  ): Promise<void> {
    await fetchJson<{ ok: boolean }>(`${BASE_URLS[label]}/tower/corrupt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ impostorPubkey }),
    });
  },

  /** Re-create a tower file for the current identity if missing. */
  async ensureTower(label: ValidatorLabel): Promise<void> {
    await fetchJson<{ ok: boolean }>(`${BASE_URLS[label]}/tower/ensure`, {
      method: "POST",
    });
  },

  /** Force the validator's identity back to its boot-time staked pubkey. */
  async resetIdentity(label: ValidatorLabel): Promise<void> {
    await fetchJson<{ ok: boolean }>(`${BASE_URLS[label]}/reset-identity`, {
      method: "POST",
    });
  },
};
