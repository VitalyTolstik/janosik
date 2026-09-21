import { decryptSecret, encryptSecret } from "./secret-box";

describe("secret-box", () => {
  it("round-trips a plaintext secret", () => {
    const secret = "correct horse battery staple";

    const encrypted = encryptSecret(secret);

    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("produces a fresh ciphertext per call (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects a tampered ciphertext (auth tag)", () => {
    const encrypted = Buffer.from(encryptSecret("secret"), "base64");
    encrypted[encrypted.length - 1] ^= 0x01;

    expect(() => decryptSecret(encrypted.toString("base64"))).toThrow();
  });

  it("round-trips multibyte characters", () => {
    const secret = "пароль-пароль-🔐";

    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });
});
