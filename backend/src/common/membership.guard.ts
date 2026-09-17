import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { Role } from "@prisma/client";
import type { AuthUser } from "@/auth/auth.types";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BOARD_ROLES_KEY } from "./board-roles.decorator";

/** Shape of the express request bits the guards read (params only). */
export interface GuardedRequest {
  params?: Record<string, string | undefined>;
  user?: AuthUser;
  boardMembership?: unknown;
}

/**
 * Board-scoped access guard (§7.0): authenticates the JWT, resolves the
 * caller's membership for the board in the route params and enforces the
 * role required by `@BoardRoles()`.
 *
 * Order of answers (matters for not leaking board existence):
 * - missing/invalid token → 401 (from the passport strategy);
 * - unknown or soft-deleted board → 404;
 * - no membership → 403;
 * - expired VIEWER (expiresAt in the past) → 403 and the expired row is
 *   cleaned lazily;
 * - role not allowed by `@BoardRoles()` → 403.
 *
 * The resolved membership is attached to `req.boardMembership` and is
 * available through `@CurrentMembership()`. `CardAccessGuard` extends this
 * class with card/comment → board resolution.
 */
@Injectable()
export class MembershipGuard extends AuthGuard("jwt") implements CanActivate {
  constructor(
    protected readonly reflector: Reflector,
    protected readonly prisma: PrismaService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) {
      return false;
    }

    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const user = request.user as AuthUser;
    const boardId = await this.resolveBoardId(request);
    if (!boardId) {
      throw new NotFoundException("Board not found");
    }

    return this.enforceMembership(context, request, user, boardId);
  }

  /** Which board does this route target? Board routes answer from params. */
  protected async resolveBoardId(
    request: GuardedRequest,
  ): Promise<string | undefined> {
    return request.params?.id ?? request.params?.boardId;
  }

  /** The shared membership/role check once the target board is known. */
  protected async enforceMembership(
    context: ExecutionContext,
    request: GuardedRequest,
    user: AuthUser,
    boardId: string,
  ): Promise<boolean> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { id: true },
    });
    if (!board) {
      throw new NotFoundException("Board not found");
    }

    const membership = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId: user.id } },
    });
    if (!membership || membership.acceptedAt === null) {
      // A pending invitation is not membership — it must be accepted first
      // (TASK-35 addendum); both cases answer the same 403.
      throw new ForbiddenException("No access to this board");
    }

    // A time-limited VIEWER membership that has expired is denied and the
    // stale row is dropped so the invariant is enforced by the data itself.
    if (membership.expiresAt && membership.expiresAt.getTime() <= Date.now()) {
      await this.prisma.boardMember.deleteMany({
        where: { id: membership.id },
      });
      throw new ForbiddenException("Board membership expired");
    }

    const required: Role[] = this.reflector.getAllAndOverride<Role[]>(
      BOARD_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    ) ?? [Role.ADMIN, Role.MEMBER, Role.VIEWER];
    if (!required.includes(membership.role)) {
      throw new ForbiddenException("Insufficient board role");
    }

    request.boardMembership = membership;
    return true;
  }
}
