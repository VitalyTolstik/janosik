import { UnauthorizedException } from "@nestjs/common";
import type { JwtService } from "@nestjs/jwt";
import type { User } from "@prisma/client";
import { env } from "@/config/env";
import { USER_JWT_AUDIENCE } from "./auth.types";
import { securityStamp } from "./security-stamp";

/** A re-authentication proof must come from an OAuth login this recent. */
export const OAUTH_PROOF_MAX_AGE_MS = 10 * 60 * 1000;

export interface OAuthProofClaims {
  sub: string;
  authTime: number;
  stamp: string;
}

function invalidProof(): UnauthorizedException {
  return new UnauthorizedException({
    message: "OAuth proof is invalid or expired",
    code: "oauth_proof_invalid",
  });
}

/**
 * Verify the signature, audience and freshness of an OAuth access token used
 * as a re-authentication proof (TASK-166 §12.5). The caller must still compare
 * the returned `stamp`/`sub` with the row it locks — a proof that was fresh
 * when this function ran may be stale by the time a credential change lands.
 */
export async function verifyOAuthProofToken(
  jwt: JwtService,
  proof: string | undefined,
): Promise<OAuthProofClaims> {
  if (!proof) {
    throw new UnauthorizedException({
      message: "OAuth re-authentication is required",
      code: "oauth_proof_required",
    });
  }
  let payload: {
    sub?: unknown;
    authMethod?: unknown;
    authTime?: unknown;
    stamp?: unknown;
  };
  try {
    payload = await jwt.verifyAsync(proof, {
      secret: env.JWT_SECRET,
      audience: USER_JWT_AUDIENCE,
    });
  } catch {
    throw invalidProof();
  }
  const authTime =
    typeof payload.authTime === "number" ? payload.authTime : Number.NaN;
  if (
    payload.authMethod !== "oauth" ||
    typeof payload.sub !== "string" ||
    typeof payload.stamp !== "string" ||
    !Number.isFinite(authTime) ||
    authTime > Date.now() ||
    Date.now() - authTime > OAUTH_PROOF_MAX_AGE_MS
  ) {
    throw invalidProof();
  }
  return { sub: payload.sub, authTime, stamp: payload.stamp };
}

/** Bind a verified proof to the current credential version of `user`. */
export function assertOAuthProofMatchesUser(
  claims: OAuthProofClaims,
  user: User,
): void {
  if (claims.sub !== user.id || claims.stamp !== securityStamp(user)) {
    throw invalidProof();
  }
}
