import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { env } from "@/config/env";

/**
 * Envelope encryption for credentials the master panel stores (TASK-52).
 * AES-256-GCM with a key derived from SETTINGS_SECRET (or JWT_SECRET when
 * the dedicated key is not configured) — the ciphertext is self-contained
 * (`iv | tag | data`, base64) and the plaintext never leaves the backend.
 */

const key = createHash("sha256")
  .update(
    env.SETTINGS_SECRET === ""
      ? `settings:${env.JWT_SECRET}`
      : env.SETTINGS_SECRET,
  )
  .digest();

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
