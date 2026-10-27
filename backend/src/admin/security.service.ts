import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  AdminSecurityDto,
  AdminSecurityAlertDto,
  AdminTotpSetupDto,
  AdminUpdateSecurityRequest,
} from "@janosik/shared";
import { createHmac, randomBytes } from "node:crypto";
import { PrismaService } from "@/common/prisma/prisma.service";
import { decryptSecret, encryptSecret } from "@/mailer/secret-box";
import type { AdminPrincipal } from "./admin.types";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_SEC = 30;
const DIGITS = 6;

/** RFC 4648 base32 (no padding) — the encoding authenticator apps expect. */
function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
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

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/** Verifies a TOTP code inside a ±1 step window. */
function verifyTotp(
  secretBase32: string,
  code: string,
  at = Date.now(),
): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(at / 1000 / PERIOD_SEC);
  for (let drift = -1; drift <= 1; drift += 1) {
    if (hotp(secret, counter + drift) === code) return true;
  }
  return false;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

/**
 * Master security posture (TASK-65): TOTP two-factor, an IP allowlist and a
 * derived suspicious-activity feed. `2FA` is a real gate at login — when
 * enabled, the master must present a valid code after the password.
 */
@Injectable()
export class SecurityService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------- 2FA

  async setup(admin: AdminPrincipal): Promise<AdminTotpSetupDto> {
    const secret = base32Encode(randomBytes(20));
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { totpSecretEnc: encryptSecret(secret) },
    });
    const label = encodeURIComponent(`Janosik:${admin.email}`);
    const otpauthUrl =
      `otpauth://totp/${label}?secret=${secret}` +
      `&issuer=Janosik&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_SEC}`;
    return { secret, otpauthUrl };
  }

  async confirm(
    admin: AdminPrincipal,
    code: string,
  ): Promise<{ totpEnabled: true }> {
    const secret = await this.secretFor(admin.id);
    if (!secret) throw new BadRequestException("Start enrollment first");
    if (!verifyTotp(secret, code)) {
      throw new UnauthorizedException("Invalid code");
    }
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { totpEnabled: true },
    });
    return { totpEnabled: true };
  }

  private async secretFor(adminId: string): Promise<string | null> {
    const row = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { totpSecretEnc: true },
    });
    return row?.totpSecretEnc ? decryptSecret(row.totpSecretEnc) : null;
  }

  /**
   * Login-time gate: returns the TOTP secret to check against when 2FA is on,
   * or `null` when the master has no second factor.
   */
  async requiredSecret(adminId: string): Promise<string | null> {
    const row = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { totpEnabled: true, totpSecretEnc: true },
    });
    if (!row?.totpEnabled || !row.totpSecretEnc) return null;
    return decryptSecret(row.totpSecretEnc);
  }

  verifyCode(secret: string, code: string): boolean {
    return verifyTotp(secret, code);
  }

  // -------------------------------------------------------------- allowlist

  /** Login-time gate: is `ip` permitted for this master? Empty list = all. */
  async isIpAllowed(adminId: string, ip: string | null): Promise<boolean> {
    const row = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { ipAllowlist: true },
    });
    return isIpAllowed(row?.ipAllowlist ?? null, ip);
  }

  // ------------------------------------------------------------------- dto

  async get(admin: AdminPrincipal): Promise<AdminSecurityDto> {
    const row = await this.prisma.adminUser.findUnique({
      where: { id: admin.id },
      select: { totpEnabled: true, ipAllowlist: true },
    });
    return {
      totpEnabled: row?.totpEnabled ?? false,
      ipAllowlist: row?.ipAllowlist ?? null,
      alerts: await this.alerts(),
    };
  }

  async update(
    admin: AdminPrincipal,
    dto: AdminUpdateSecurityRequest,
    callerIp: string | null = null,
  ): Promise<AdminSecurityDto> {
    if (dto.ipAllowlist !== undefined) {
      // The IP allowlist is an OWNER-only control (TASK-65 addendum): an
      // operator must not be able to widen (or lock) their own sign-in origin.
      if (admin.role !== "OWNER") {
        throw new ForbiddenException("Owner rights are required");
      }
      const allowlist = normalizeAllowlist(dto.ipAllowlist);
      // The list is enforced on every admin request now, so saving one that
      // excludes the caller's own address would lock them out mid-session.
      if (!isIpAllowed(allowlist, callerIp)) {
        throw new BadRequestException(
          `The allowlist must include your current address (${callerIp ?? "unknown"})`,
        );
      }
      await this.prisma.adminUser.update({
        where: { id: admin.id },
        data: { ipAllowlist: allowlist },
      });
    }
    if (dto.totpEnabled === false) {
      const secret = await this.secretFor(admin.id);
      if (secret && (!dto.totpCode || !verifyTotp(secret, dto.totpCode))) {
        throw new UnauthorizedException("A valid 2FA code is required");
      }
      await this.prisma.adminUser.update({
        where: { id: admin.id },
        data: { totpEnabled: false, totpSecretEnc: null },
      });
    }
    return this.get(admin);
  }

  /** Suspicious-activity feed: failed/locked logins in the last 24 hours. */
  async alerts(): Promise<AdminSecurityAlertDto[]> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.prisma.adminAuditLog.findMany({
      where: {
        action: { in: ["admin.login_failed", "admin.login_locked"] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((row) => {
      const details = (row.details as Record<string, unknown> | null) ?? {};
      return {
        id: row.id,
        action: row.action,
        adminEmail: row.adminEmail,
        ip: typeof details.ip === "string" ? details.ip : null,
        createdAt: row.createdAt.getTime(),
        detail:
          row.action === "admin.login_locked"
            ? "Account temporarily locked after repeated failures"
            : "Failed sign-in attempt",
      };
    });
  }
}

/** Trims blanks and de-duplicates a CSV allowlist; empty → null (allow all). */
export function normalizeAllowlist(value: string | null): string | null {
  if (value === null) return null;
  const entries = value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? Array.from(new Set(entries)).join(",") : null;
}

/** True when the IP matches any entry (exact string or IPv4 CIDR). */
export function isIpAllowed(
  allowlist: string | null,
  ip: string | null,
): boolean {
  if (!allowlist || allowlist.trim() === "") return true;
  if (!ip) return false;
  const entries = allowlist.split(",").map((entry) => entry.trim());
  for (const entry of entries) {
    if (entry === ip) return true;
    if (entry.includes("/")) {
      const [network, bitsRaw] = entry.split("/");
      const bits = Number(bitsRaw);
      const net = ipv4ToInt(network);
      const target = ipv4ToInt(ip);
      if (net !== null && target !== null && Number.isInteger(bits)) {
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        if ((net & mask) === (target & mask)) return true;
      }
    }
  }
  return false;
}
