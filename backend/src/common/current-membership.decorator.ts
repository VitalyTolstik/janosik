import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { BoardMember } from "@prisma/client";

/**
 * Injects the `BoardMember` resolved by `MembershipGuard` (req.boardMembership).
 * Only meaningful on routes behind that guard.
 */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BoardMember =>
    ctx.switchToHttp().getRequest().boardMembership,
);
