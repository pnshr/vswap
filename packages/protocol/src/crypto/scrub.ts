import sodium from "libsodium-wrappers";

/**
 * Lookup the libsodium `memzero` implementation, if the runtime has
 * finished initialising and exposes it. Exported so tests can stub the
 * result without monkey-patching the sodium module.
 */
export function resolveMemzero():
  | ((buffer: Uint8Array) => void)
  | undefined {
  const candidate = (sodium as unknown as { memzero?: unknown }).memzero;
  return typeof candidate === "function"
    ? (candidate as (buffer: Uint8Array) => void)
    : undefined;
}

/**
 * Zero out the contents of a typed-array buffer in place. Uses
 * libsodium's `sodium_memzero` when it is available at the point of
 * call (best-effort defence against compilers optimising the write
 * away); falls back to `Uint8Array.fill(0)` otherwise. Safe to call on
 * views — only the referenced window is cleared.
 */
export function scrub(buffer: Uint8Array): void {
  if (buffer.byteLength === 0) {
    return;
  }
  const memzero = resolveMemzero();
  if (memzero !== undefined) {
    memzero(buffer);
    return;
  }
  buffer.fill(0);
}

/**
 * Run `fn` with `buffer`, guaranteeing that `buffer` is scrubbed on exit,
 * whether `fn` returns normally or throws. The value returned by `fn` is
 * forwarded verbatim; callers must make sure `fn`'s return value does not
 * reference the to-be-scrubbed buffer.
 */
export function withScrub<T>(buffer: Uint8Array, fn: (buf: Uint8Array) => T): T {
  try {
    return fn(buffer);
  } finally {
    scrub(buffer);
  }
}

/** Async analogue of {@link withScrub}. */
export async function withScrubAsync<T>(
  buffer: Uint8Array,
  fn: (buf: Uint8Array) => Promise<T>,
): Promise<T> {
  try {
    return await fn(buffer);
  } finally {
    scrub(buffer);
  }
}
