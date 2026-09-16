import { SetMetadata } from "@nestjs/common";
import type { Role } from "@prisma/client";

/**
 * Metadata key read by `MembershipGuard` to decide which board roles may hit
 * a route. Absent metadata means "any member" (ADMIN, MEMBER or VIEWER).
 */
export const BOARD_ROLES_KEY = "boardRoles";

/** Restrict a board-scoped route to the given membership roles (§7.0). */
export const BoardRoles = (...roles: Role[]) =>
  SetMetadata(BOARD_ROLES_KEY, roles);
