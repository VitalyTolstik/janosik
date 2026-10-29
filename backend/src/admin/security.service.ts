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

/**
 * The time-step a code belongs to inside a ±1 window, or `null` when it
 * matches nothing. The step (not a bare boolean) is what lets the service
 * reject a replay: the same code always maps to the same step.
 */
function matchingTotpStep(
  secretBase32: string,
  code: string,
  at = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(at / 1000 / PERIOD_SEC);
  for (let drift = -1; drift <= 1; drift += 1) {
    const step = counter + drift;
    if (hotp(secret, step) === code) return step;
  }
  return null;
}

function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) + BigInt(n);
  }
  return value;
}

/** IPv6 as a 128-bit integer. `%zone` is ignored; no zone-scoped semantics. */
function ipv6ToBigInt(input: string): bigint | null {
  const zone = input.indexOf("%");
  let ip = zone === -1 ? input : input.slice(0, zone);
  if (ip === "") return null;
  // An embedded IPv4 tail (`::ffff:192.0.2.1`) becomes two hex groups.
  if (ip.includes(".")) {
    const lastColon = ip.lastIndexOf(":");
    if (lastColon === -1) return null;
    const v4 = ipv4ToBigInt(ip.slice(lastColon + 1));
    if (v4 === null) return null;
    const hi = ((v4 >> 16n) & 0xffffn).toString(16);
    const lo = (v4 & 0xffffn).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] === "" ? [] : parts[0].split(":");
  const tail = parts.length === 2 && parts[1] !== "" ? parts[1].split(":") : [];
  if (parts.length === 1 && head.length !== 8) return null;
  if (parts.length === 2 && head.length + tail.length > 7) return null;
  const all =
    parts.length === 2
      ? [
          ...head,
          ...Array<string>(8 - head.length - tail.length).fill("0"),
          ...tail,
        ]
      : head;
  if (all.length !== 8) return null;
  let value = 0n;
  for (const group of all) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) + BigInt(parseInt(group, 16));
  }
  return value;
}

interface ParsedIp {
  version: 4 | 6;
  value: bigint;
}

/**
 * Parses an address to a comparable integer. IPv4-mapped IPv6
 * (`::ffff:127.0.0.1`, what a dual-stack listener reports) folds to IPv4 so an
 * IPv4 allowlist keeps matching.
 */
function parseIp(input: string): ParsedIp | null {
  const ip = input.trim();
  if (ip === "") return null;
  if (ip.includes(":")) {
    const value = ipv6ToBigInt(ip);
    if (value === null) return null;
    if (value >> 32n === 0xffffn) {
      return { version: 4, value: value & 0xffffffffn };
    }
    return { version: 6, value };
  }
  const value = ipv4ToBigInt(ip);
  return value === null ? null : { version: 4, value };
}

/** True when `entry` (an exact address or a CIDR) is a well-formed entry. */
function isValidAllowlistEntry(entry: string): boolean {
  const slash = entry.indexOf("/");
  if (slash === -1) return parseIp(entry) !== null;
  if (entry.indexOf("/", slash + 1) !== -1) return false;
  const network = parseIp(entry.slice(0, slash));
  const bits = entry.slice(slash + 1);
  if (network === null || !/^\d{1,3}$/.test(bits)) return false;
  const max = network.version === 4 ? 32 : 128;
  const prefix = Number(bits);
  return prefix >= 0 && prefix <= max;
}

/**
 * Matches one allowlist entry against an address. Both sides are parsed to
 * integers, so a CIDR with out-of-range prefix bits (the old `~0 << (32-33)`
 * shift wrapped modulo 32) simply never matches, and IPv6 prefixes work
 * instead of silently comparing strings.
 */
function cidrOrExactMatches(entry: string, ip: string): boolean {
  if (entry === ip) return true;
  const slash = entry.indexOf("/");
  const target = parseIp(ip);
  if (target === null) return false;
  if (slash === -1) {
    const exact = parseIp(entry);
    return (
      exact !== null &&
      exact.version === target.version &&
      exact.value === target.value
    );
  }
  if (!isValidAllowlistEntry(entry)) return false;
  const network = parseIp(entry.slice(0, slash));
  if (network === null || network.version !== target.version) return false;
  const max = network.version === 4 ? 32 : 128;
  const shift = BigInt(max - Number(entry.slice(slash + 1)));
  return network.value >> shift === target.value >> shift;
}

/**
 * Master security posture (TASK-65): TOTP two-factor, an IP allowlist and a
 * derived suspicious-activity feed. `2FA` is a real gate at login — when
 * enabled, the master must present a valid code after the password.
 */
@Injectable()
export class SecurityService {
  /**
   * Last accepted TOTP step per admin (TASK-147, B18). A code stays valid for
   * its whole ±1 window, so without this the same six digits could sign in
   * again and again. In-memory on purpose: the master contour is a single
   * small account, and a restart only re-opens one 30 s window.
   */
  private readonly lastTotpStep = new Map<string, number>();

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
    if (!this.verifyCode(secret, code, admin.id)) {
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

  /**
   * Verifies a code. When `adminId` is given the accepted time-step is
   * recorded and the same code is refused a second time (TASK-147, B18) — a
   * replayed, shoulder-surfed or phished code is useless once used. Callers
   * without an admin (the pure unit tests) keep the stateless behaviour.
   */
  verifyCode(secret: string, code: string, adminId?: string): boolean {
    const step = matchingTotpStep(secret, code);
    if (step === null) return false;
    if (adminId === undefined) return true;
    const last = this.lastTotpStep.get(adminId);
    if (last !== undefined && step <= last) return false;
    this.lastTotpStep.set(adminId, step);
    return true;
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
      // A malformed entry (bad prefix, unknown shorthand) silently matched
      // nothing and could lock the owner out believing the list was saved
      // (TASK-147, B17). Refuse it instead.
      const invalid = invalidAllowlistEntries(dto.ipAllowlist);
      if (invalid.length > 0) {
        throw new BadRequestException(
          `Invalid allowlist entries: ${invalid.join(", ")}`,
        );
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
      if (
        secret &&
        (!dto.totpCode || !this.verifyCode(secret, dto.totpCode, admin.id))
      ) {
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

/** The entries a save should refuse (TASK-147, B17), de-duplicated. */
export function invalidAllowlistEntries(value: string | null): string[] {
  if (value === null) return [];
  const bad = value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => !isValidAllowlistEntry(entry));
  return Array.from(new Set(bad));
}

/** True when the IP matches any entry (exact address or IPv4/IPv6 CIDR). */
export function isIpAllowed(
  allowlist: string | null,
  ip: string | null,
): boolean {
  if (!allowlist || allowlist.trim() === "") return true;
  if (!ip) return false;
  const entries = allowlist.split(",").map((entry) => entry.trim());
  return entries.some((entry) => cidrOrExactMatches(entry, ip));
}
