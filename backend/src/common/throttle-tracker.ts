import { createHash } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { API_TOKEN_PREFIX } from "@janosik/shared";
import { USER_JWT_AUDIENCE } from "@/auth/auth.types";
import { env } from "@/config/env";

/**
 * Throttler tracker (B-8): *who* a request counts against.
 *
 * The global `ThrottlerGuard` runs before any route guard, so `req.user` is
 * not resolved yet. The tracker therefore reads the credential itself:
 *
 * - a valid user access token → `user:<id>` — every tab and device of one
 *   account share a budget, and a swarm of agents on one host no longer
 *   shares a single per-IP budget with everyone behind that NAT;
 * - a personal API token that recently authenticated → `pat:<hash>` — each
 *   agent key is its own budget. Only *known-good* keys get their own
 *   bucket: otherwise an attacker could mint a fresh fake `jnk_…` per
 *   request and never hit the IP limit;
 * - anything else (anonymous, garbage, expired JWT, unknown key) → the IP.
 *
 * The JWT is verified (signature + audience), not just decoded, so a forged
 * `sub` cannot be used to spread requests over invented buckets.
 */
const verifier = new JwtService({ secret: env.JWT_SECRET });

/** Recently authenticated PAT hashes → expiry (bounded, see below). */
const knownPats = new Map<string, number>();
const KNOWN_PAT_TTL_MS = 10 * 60 * 1000;
const KNOWN_PAT_MAX = 10_000;

/** Called by `ApiTokenService` after a PAT authenticated successfully. */
export function rememberValidPat(tokenHash: string): void {
  const now = Date.now();
  if (knownPats.size >= KNOWN_PAT_MAX) {
    for (const [hash, expiresAt] of knownPats) {
      if (expiresAt <= now) knownPats.delete(hash);
    }
    // Still full of live entries: drop the oldest insertion.
    if (knownPats.size >= KNOWN_PAT_MAX) {
      const oldest = knownPats.keys().next().value;
      if (oldest !== undefined) knownPats.delete(oldest);
    }
  }
  knownPats.delete(tokenHash);
  knownPats.set(tokenHash, now + KNOWN_PAT_TTL_MS);
}

/** Drop a key from the fast path (revocation). */
export function forgetPat(tokenHash: string): void {
  knownPats.delete(tokenHash);
}

export function principalTracker(req: Record<string, unknown>): string {
  const ip = `ip:${String(req.ip ?? "unknown")}`;
  const headers = req.headers as Record<string, string | undefined> | undefined;
  const header = headers?.authorization;
  if (typeof header !== "string") return ip;
  const [scheme, raw] = header.split(" ");
  if (scheme !== "Bearer" || !raw) return ip;
  if (raw.startsWith(API_TOKEN_PREFIX)) {
    const hash = createHash("sha256").update(raw).digest("hex");
    const expiresAt = knownPats.get(hash);
    return expiresAt !== undefined && expiresAt > Date.now()
      ? `pat:${hash.slice(0, 32)}`
      : ip;
  }
  try {
    const payload = verifier.verify<{ sub?: unknown }>(raw, {
      audience: USER_JWT_AUDIENCE,
    });
    return typeof payload.sub === "string" ? `user:${payload.sub}` : ip;
  } catch {
    return ip;
  }
}
