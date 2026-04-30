import { createHash } from "node:crypto";

/**
 * Minimal base58 encoder + decoder using the Bitcoin alphabet (Solana
 * convention). Lifted from `@vswap/agent`'s `src/solana/base58.ts` so
 * the CLI does not have to depend on a runtime sibling. Both modules
 * MUST agree on this alphabet.
 */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros++;
  }
  const source = Array.from(bytes);
  const size = Math.ceil((bytes.length * 138) / 100) + 1;
  const b58 = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < source.length; i++) {
    const current = source[i];
    if (current === undefined) {
      continue;
    }
    let carry = current;
    let j = 0;
    for (let it = size - 1; (carry !== 0 || j < length) && it >= 0; it--, j++) {
      const b = b58[it] ?? 0;
      carry += 256 * b;
      b58[it] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }
  let offset = size - length;
  while (offset < size && b58[offset] === 0) {
    offset++;
  }
  let out = "";
  for (let i = 0; i < zeros; i++) {
    out += ALPHABET[0];
  }
  for (let i = offset; i < size; i++) {
    const digit = b58[i];
    if (digit === undefined) {
      continue;
    }
    out += ALPHABET[digit] ?? "";
  }
  return out;
}

export function decodeBase58(value: string): Uint8Array {
  if (value.length === 0) {
    return new Uint8Array(0);
  }
  let zeros = 0;
  while (zeros < value.length && value[zeros] === ALPHABET[0]) {
    zeros++;
  }
  const size = Math.ceil((value.length * 733) / 1000) + 1;
  const b256 = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < value.length; i++) {
    const ch = value[i];
    if (ch === undefined) {
      continue;
    }
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) {
      throw new RangeError(`invalid base58 character at index ${i}: ${ch}`);
    }
    let carry = digit;
    let j = 0;
    for (let it = size - 1; (carry !== 0 || j < length) && it >= 0; it--, j++) {
      const b = b256[it] ?? 0;
      carry += 58 * b;
      b256[it] = carry & 0xff;
      carry >>= 8;
    }
    length = j;
  }
  let offset = size - length;
  while (offset < size && b256[offset] === 0) {
    offset++;
  }
  const out = new Uint8Array(zeros + (size - offset));
  for (let i = 0; i < zeros; i++) {
    out[i] = 0;
  }
  let writeIdx = zeros;
  for (let i = offset; i < size; i++) {
    out[writeIdx++] = b256[i] ?? 0;
  }
  return out;
}

/**
 * Compute a short fingerprint string for a base58-encoded long-term
 * pubkey: groups of 4 hex digits derived from the SHA-256 of the raw
 * bytes, separated by colons. Used in the pair confirmation prompt.
 *
 * We keep the helper synchronous and avoid pulling in libsodium just
 * for the digest — `node:crypto` is part of the standard library.
 */
export function fingerprintPubkey(base58Pubkey: string): string {
  const raw = decodeBase58(base58Pubkey);
  const digest = createHash("sha256").update(raw).digest("hex").toUpperCase();
  // First 32 hex chars → 8 groups of 4.
  const slice = digest.slice(0, 32);
  const groups: string[] = [];
  for (let i = 0; i < slice.length; i += 4) {
    groups.push(slice.slice(i, i + 4));
  }
  return groups.join(":");
}
