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
    createdAt: user.createdAt.getTime(),
  };
}
