import sodium from "libsodium-wrappers";

let readyPromise: Promise<void> | null = null;

/**
 * Await libsodium's WASM initialisation exactly once. All crypto entry
 * points must call this before invoking any `sodium.*` primitive.
 */
export function sodiumReady(): Promise<void> {
  if (readyPromise === null) {
    readyPromise = sodium.ready.then(() => undefined);
  }
  return readyPromise;
}
