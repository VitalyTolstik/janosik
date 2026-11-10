import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import type { ScopePreset } from "@janosik/shared";
import {
  assertAgentNotPaused,
  isPauseExemptPath,
  isWriteMethod,
} from "@/auth/agent-pause";
import { ApiTokenService } from "@/auth/api-token.service";
import type { AgentSessionContext, AuthPrincipal } from "@/auth/auth-principal";
import type { AuthUser } from "@/auth/auth.types";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import {
  assertAgentRule,
  assertPatPreset,
  assertTokenBoardScope,
  LIFECYCLE_ACTIONS,
  type LifecycleAction,
} from "@/auth/token-scope";
import {
  AGENT_ACTION_KEY,
  TOKEN_SCOPE_KEY,
} from "@/auth/token-scope.decorator";
import { resolveAgentSessionHeader } from "@/agent-sessions/agent-session-context";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BOARD_ROLES_KEY } from "./board-roles.decorator";

/** A PAT SSE stream can opt into session-level pause with `?session=`. */
const SSE_PATH = /\/events\/?$/;

/** Shape of the express request bits the guards read (params only). */
export interface GuardedRequest {
  params?: Record<string, string | undefined>;
  method?: string;
  url?: string;
  originalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
  user?: AuthUser;
  boardMembership?: unknown;
  auth?: AuthPrincipal;
  agentSession?: AgentSessionContext;
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
 *
 * Authentication goes through `JwtAuthGuard`, so a personal API token
 * (TASK-36.1) opens board-scoped routes exactly like a JWT.
 */
@Injectable()
export class MembershipGuard extends JwtAuthGuard implements CanActivate {
  constructor(
    protected readonly reflector: Reflector,
    protected readonly prisma: PrismaService,
    apiTokens: ApiTokenService,
  ) {
    super(apiTokens);
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
    // TASK-157/TASK-166: a token scoped to one board must not reach any other,
    // even one its owner is a member of. Check before the board lookup so a
    // foreign and a nonexistent board answer the same refusal (no oracle).
    const method = (request.method ?? "GET").toUpperCase();
    const path = (request.originalUrl ?? request.url ?? "").split("?")[0];
    assertTokenBoardScope(request.auth, boardId, "board.access");

    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { id: true, agentPolicy: true, agentsPausedAt: true },
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
      throw new ForbiddenException({
        message: "Insufficient board role",
        code: "scope_denied",
        requiredRoles: required,
      });
    }

    const write = isWriteMethod(method);
    const isSse = method === "GET" && SSE_PATH.test(path);

    // TASK-166: board role first, then token scope. `readOnly` is already
    // refused in `JwtAuthGuard` with the legacy `pat_read_only` code; this
    // check covers an explicit `observer` preset and the admin-only routes.
    const requiredScope =
      this.reflector.getAllAndOverride<ScopePreset>(TOKEN_SCOPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? (write ? "worker" : "observer");
    assertPatPreset(request.auth, requiredScope, `${method} ${path}`);

    // Lifecycle actions (member/share/board delete, workflow, restore) carry
    // their own policy key; the command transport classifies its actions in
    // `CommandsService` instead.
    const agentAction = this.reflector.getAllAndOverride<LifecycleAction>(
      AGENT_ACTION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (agentAction !== undefined) {
      assertAgentRule(
        request.auth,
        board.agentPolicy,
        LIFECYCLE_ACTIONS[agentAction],
      );
    }

    request.boardMembership = membership;
    const pauseChecked =
      request.auth?.via === "pat" &&
      (write || isSse) &&
      !isPauseExemptPath(path);
    if (pauseChecked) {
      // Token and board first: pause precedence is token → board → session.
      assertAgentNotPaused({
        tokenIndividualPausedAt:
          request.auth?.tokenIdentity?.individualPausedAt ?? null,
        tokenStopAllPausedAt:
          request.auth?.tokenIdentity?.stopAllPausedAt ?? null,
        boardPausedAt: board.agentsPausedAt,
      });
    }

    // TASK-166: a PAT write may name an optional board-scoped session. The
    // check is skipped for reads and for the session control routes, whose
    // controller owns the path-session check: start must accept a stale/old
    // header so a new run can begin, and heartbeat/end must stay idempotent
    // on an already closed session. Query strings are stripped first — a
    // cache-buster must not change route matching.
    if (write && !SESSION_HEADER_EXEMPT.test(path)) {
      const header = headerValue(request.headers?.["x-agent-session"]);
      const session = await resolveAgentSessionHeader(
        this.prisma,
        header,
        request.auth,
        user.id,
        boardId,
      );
      if (session !== null) {
        request.agentSession = session;
      }
    }

    // A PAT SSE stream can opt into session-level pause with `?session=`.
    // Without it the stream is token-level and a session pause does not
    // close it (ADR §9.3).
    if (isSse && request.auth?.via === "pat") {
      const sessionId = queryParam(
        request.originalUrl ?? request.url,
        "session",
      );
      if (sessionId !== undefined && sessionId !== "") {
        const session = await resolveAgentSessionHeader(
          this.prisma,
          sessionId,
          request.auth,
          user.id,
          boardId,
        );
        if (session !== null) {
          request.agentSession = session;
        }
      }
    }

    if (pauseChecked) {
      assertAgentNotPaused({
        sessionPausedAt: request.agentSession?.pausedAt ?? null,
      });
    }
    return true;
  }
}

/**
 * `/boards/:id/agent-sessions` (start) and
 * `/boards/:id/agent-sessions/:sessionId/heartbeat|end`.
 */
const SESSION_HEADER_EXEMPT =
  /\/agent-sessions(?:\/[^/]+\/(?:heartbeat|end|pause|resume))?\/?$|\/agents\/(?:pause|resume)\/?$/;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function queryParam(url: string | undefined, name: string): string | undefined {
  if (url === undefined) return undefined;
  const query = url.split("?")[1];
  if (query === undefined || query === "") return undefined;
  return new URLSearchParams(query).get(name) ?? undefined;
}
