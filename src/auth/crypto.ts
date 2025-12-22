import crypto from "node:crypto";
import config from "../config.js";

/**
 * Symmetric encryption for user-provided third-party LLM API keys.
 *
 * These keys must never be stored in plaintext, so they are encrypted at rest
 * with AES-256-GCM (authenticated encryption). The 32-byte key is derived by
 * hashing a configured secret: a dedicated CREDENTIALS_SECRET in production,
 * falling back to JWT_SECRET so the feature works out of the box in dev (see
 * src/config.ts / .env.example).
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, the recommended IV size for GCM.

/** Derives the 32-byte AES key from the configured secret. */
function encryptionKey(): Buffer {
  const secret = config.credentialsSecret || config.jwtSecret;
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts `plain` and returns a compact, self-describing string of the form
 * `iv:tag:ciphertext` (each part base64), which `decryptSecret` reverses. A
 * fresh random IV is generated per call so identical plaintexts produce
 * different ciphertexts.
 */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Reverses {@link encryptSecret}. Throws if the blob is malformed or its
 * authentication tag does not verify (tampering / wrong key).
 */
export function decryptSecret(enc: string): string {
  const parts = enc.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted secret.");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
