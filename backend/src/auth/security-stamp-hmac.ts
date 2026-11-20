import { createHmac } from "node:crypto";
import type { User } from "@prisma/client";

export type StampUser = Pick<
  User,
  "id" | "email" | "passwordHash" | "emailVerifiedAt"
>;

/** Changes whenever credentials or mailbox ownership change. */
export function securityStamp(user: StampUser, secret: string): string {
  return createHmac("sha256", secret)
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
