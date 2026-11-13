import { createHmac } from "node:crypto";
import type { User } from "@prisma/client";
import { env } from "@/config/env";

/** Changes whenever credentials or mailbox ownership change. */
export function securityStamp(user: User): string {
  return createHmac("sha256", env.JWT_SECRET)
    .update(
      JSON.stringify([
        user.id,
        user.email,
        user.passwordHash,
        user.emailVerifiedAt?.toISOString() ?? null,
      ]),
    )
    .digest("base64url");
}
