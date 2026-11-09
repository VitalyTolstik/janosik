import { createHmac } from "node:crypto";

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30-second period) for the master panel.
 * Mirrors `backend/src/admin/security.service.ts`; no external dependency.
 */

const PERIOD_SEC = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const normalized = input.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function hotp(secret: Buffer, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function totpStep(at = Date.now()): number {
  return Math.floor(at / 1000 / PERIOD_SEC);
}

export function totp(secret: string, at = Date.now(), offsetSteps = 0): string {
  return hotp(base32Decode(secret), totpStep(at) + offsetSteps);
}

/** Milliseconds until the next 30-second TOTP window starts. */
export function msUntilNextStep(at = Date.now()): number {
  return PERIOD_SEC * 1000 - (at % (PERIOD_SEC * 1000));
}

/**
 * A code strictly newer than `afterStep` (the last accepted step). The server
 * accepts only the current ±1 window and refuses any step it has already
 * recorded, so the helper waits for a window where such a code exists instead
 * of guessing `+1` blindly across a boundary.
 */
export async function totpCodeAfter(
  secret: string,
  afterStep: number,
): Promise<{ code: string; step: number }> {
  for (;;) {
    const current = totpStep();
    if (current > afterStep) {
      return { code: hotp(base32Decode(secret), current), step: current };
    }
    if (current === afterStep) {
      return {
        code: hotp(base32Decode(secret), current + 1),
        step: current + 1,
      };
    }
    await new Promise((resolve) =>
      setTimeout(resolve, msUntilNextStep() + 100),
    );
  }
}

/**
 * Wait for a fresh code window. TOTP codes are single-use on the server, so a
 * test that already consumed a step must wait for the next one instead of
 * trying `step + 1` (which may still be inside the accepted window).
 */
export async function waitForNextTotpStep(): Promise<void> {
  const wait = msUntilNextStep() + 250;
  await new Promise((resolve) => setTimeout(resolve, wait));
}
