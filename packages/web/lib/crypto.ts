"use client";

/**
 * WebCrypto wrapper. Encrypts/decrypts operator client cert + signing
 * key under a passphrase using PBKDF2-HMAC-SHA256 (600k iterations) +
 * AES-GCM-256.
 *
 * Plaintext shape is opaque to the caller (decrypted JSON string). The
 * web app never persists the plaintext; it lives in React state for
 * the duration of the operator session.
 */
import type { SecretRecord } from "./storage";

const ITERATIONS = 600_000;

async function deriveKey(
  passphrase: string,
  salt: ArrayBuffer,
  iterations: number,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(
  passphrase: string,
  plaintext: string,
): Promise<SecretRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt.buffer, ITERATIONS);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext),
  );
  return {
    ciphertext,
    iv: iv.buffer,
    salt: salt.buffer,
    iterations: ITERATIONS,
  };
}

export async function decryptSecret(
  passphrase: string,
  rec: SecretRecord,
): Promise<string> {
  const key = await deriveKey(passphrase, rec.salt, rec.iterations);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: rec.iv },
    key,
    rec.ciphertext,
  );
  return new TextDecoder().decode(plain);
}
