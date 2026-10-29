import type { User } from "@prisma/client";
import type { UserAvatarColor } from "@janosik/shared";
import type { AuthUser } from "./auth.types";

/**
 * Public user projection (TASK-36.1). The single mapper from a `User` row to
 * the wire shape, so `AuthService`, `JwtStrategy` and `ApiTokenService` all
 * drop the password hash and keep `avatarColor`/`createdAt` in sync.
 */
export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarColor: (user.avatarColor as UserAvatarColor | null) ?? null,
    avatarPath: user.avatarPath,
    // TASK-153: the account digest opt-out reaches the client; the default
    // (on) is omitted like every other optional field.
    ...(user.notifyDigest ? {} : { notifyDigest: false }),
    createdAt: user.createdAt.getTime(),
    // TASK-53: null → the address is not confirmed yet, the UI shows the
    // verification gate instead of the boards.
    emailVerifiedAt: user.emailVerifiedAt?.getTime() ?? null,
  };
}
