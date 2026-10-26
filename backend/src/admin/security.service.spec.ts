import { createHmac } from "node:crypto";
import type { PrismaService } from "@/common/prisma/prisma.service";
import {
  SecurityService,
  isIpAllowed,
  normalizeAllowlist,
} from "./security.service";

/**
 * TASK-65: the pure parts of the master security posture — the TOTP verifier
 * and the IP allowlist matcher. The spec re-implements RFC 6238 independently
 * so a correct code is proven against an outside reference, not against the
 * code under test.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/=+$/g, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Independent RFC 6238 TOTP for a 30s step, 6 digits, SHA-1. */
function totp(secret: string, at = Date.now()): string {
  const counter = Math.floor(at / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

const SECRET = "JBSWY3DPEHPK3PXP";

describe("SecurityService.verifyCode (TOTP)", () => {
  const service = new SecurityService({} as PrismaService);

  it("accepts the code from an independent implementation", () => {
    expect(service.verifyCode(SECRET, totp(SECRET))).toBe(true);
  });

  it("rejects a wrong or malformed code", () => {
    expect(service.verifyCode(SECRET, "000000")).toBe(false);
    expect(service.verifyCode(SECRET, "12345")).toBe(false);
    expect(service.verifyCode(SECRET, "abcdef")).toBe(false);
  });
});

describe("isIpAllowed", () => {
  it("allows everything when the list is empty", () => {
    expect(isIpAllowed(null, "203.0.113.7")).toBe(true);
    expect(isIpAllowed("", null)).toBe(true);
  });

  it("matches an exact address", () => {
    expect(isIpAllowed("203.0.113.7", "203.0.113.7")).toBe(true);
    expect(isIpAllowed("203.0.113.7", "203.0.113.8")).toBe(false);
  });

  it("matches an IPv4 CIDR range", () => {
    expect(isIpAllowed("10.0.0.0/8", "10.4.5.6")).toBe(true);
    expect(isIpAllowed("10.0.0.0/8", "11.0.0.1")).toBe(false);
    expect(isIpAllowed("192.168.1.0/24", "192.168.1.255")).toBe(true);
  });

  it("refuses a request without an IP when a list is set", () => {
    expect(isIpAllowed("203.0.113.7", null)).toBe(false);
  });
});

describe("normalizeAllowlist", () => {
  it("trims, de-duplicates and joins entries", () => {
    expect(normalizeAllowlist(" 10.0.0.1, 10.0.0.1  10.0.0.2 ")).toBe(
      "10.0.0.1,10.0.0.2",
    );
  });

  it("collapses an empty list to null (allow all)", () => {
    expect(normalizeAllowlist("   ")).toBeNull();
    expect(normalizeAllowlist(null)).toBeNull();
  });
});
