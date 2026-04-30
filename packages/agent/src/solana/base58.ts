/**
 * Minimal base58 encoder/decoder using the Bitcoin alphabet, which is
 * what Solana uses for every pubkey, transaction, and signature. The
 * implementation is intentionally small: we only need the encode side
 * for deriving human-readable pubkeys, and decode is unused here.
 */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }
  // Count leading zeros.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros++;
  }
  // Work on a mutable copy to avoid clobbering the caller's buffer.
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
    for (
      let it = size - 1;
      (carry !== 0 || j < length) && it >= 0;
      it--, j++
    ) {
      const b = b58[it] ?? 0;
      carry += 256 * b;
      b58[it] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }
  // Skip leading zeros in the base58 digit buffer.
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
