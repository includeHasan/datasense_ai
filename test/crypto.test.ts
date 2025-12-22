import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret";

const { encryptSecret, decryptSecret } = await import("../src/auth/crypto.js");

describe("credential encryption", () => {
  it("round-trips a value and does not store it in plaintext", () => {
    const plain = "sk-super-secret-api-key-1234567890";
    const enc = encryptSecret(plain);

    expect(enc).not.toContain(plain);
    expect(enc).not.toEqual(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("produces a different ciphertext each call (random IV) but decrypts equally", () => {
    const plain = "another-secret";
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);

    expect(a).not.toEqual(b);
    expect(decryptSecret(a)).toBe(plain);
    expect(decryptSecret(b)).toBe(plain);
  });

  it("throws on a malformed blob", () => {
    expect(() => decryptSecret("not-a-valid-blob")).toThrow();
  });
});
