import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { ApiTokenIdentityDto } from "@janosik/shared";
import type { TokenScope } from "./api-token.service";

/**
 * The board-scoped agent session a PAT named in `X-Agent-Session` (TASK-166).
 * Only the fields later writers need ride along; the full row lives in
 * `AgentSession`.
 */
export interface AgentSessionContext {
  id: string;
  userId: string;
  apiTokenId: string;
  boardId: string;
  status: string;
  endedAt: Date | null;
  pausedAt: Date | null;
  lastHeartbeatAt: Date;
}

/**
 * How the caller of a user-contour route authenticated (B-2). Kept on the
 * request next to `req.user` — never on the `AuthUser` projection itself,
 * which is returned verbatim by `GET /auth/me` and must stay the wire shape.
 *
 * - `jwt` — a browser session (access token minted by login/refresh/OAuth);
 * - `pat` — a personal API token (`jnk_…`), i.e. an agent or integration.
 */
export interface AuthPrincipal {
  via: "jwt" | "pat";
  /** `ApiToken.id` of the presenting token — set only when `via === "pat"`. */
  apiTokenId?: string;
  /** `ApiToken.name` snapshot for attribution (TASK-166). */
  apiTokenName?: string;
  /** Non-secret identity of the presenting PAT (TASK-166). */
  tokenIdentity?: ApiTokenIdentityDto;
  /** Resolved `X-Agent-Session` id, when the request named one. */
  agentSessionId?: string;
  /** Scope of the presenting PAT (TASK-157) — set only when `via === "pat"`. */
  tokenScope?: TokenScope;
  /**
   * `AdminUser.id` from the access token's `imp` claim when a master
   * impersonates this user (TASK-59); `null` for ordinary sessions and PATs.
   */
  impersonatedBy?: string | null;
  /**
   * TASK-166: how a browser JWT authenticated — `password` (the default) or
   * `oauth`. A PAT has no value. `GET /auth/me` exposes it so the account
   * panel can send the current access token as `oauthProof`.
   */
  authMethod?: "password" | "oauth";
}

/** The request bits the auth layer reads/writes. */
export interface PrincipalRequest {
  auth?: AuthPrincipal;
  agentSession?: AgentSessionContext;
}

/** The principal `JwtAuthGuard` resolved, or `undefined` on public routes. */
export function principalOf(request: unknown): AuthPrincipal | undefined {
  return (request as PrincipalRequest | undefined)?.auth;
}

/**
 * Attribution for a request (TASK-157): a personal API token (`jnk_…`) means
 * an agent/integration, anything else a person at a browser session. Defaults
 * to `"human"` when no principal was recorded (public/legacy paths).
 */
export function actorTypeOf(
  principal: AuthPrincipal | undefined,
): "human" | "agent" {
  return principal?.via === "pat" ? "agent" : "human";
}

/** Injects the `AuthPrincipal` `JwtAuthGuard` recorded (may be undefined). */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal | undefined =>
    principalOf(ctx.switchToHttp().getRequest()),
);

/**
 * Injects the board-scoped `AgentSessionContext` resolved by
 * `MembershipGuard` (TASK-166), or `undefined` when the request carried no
 * `X-Agent-Session` header.
 */
export const CurrentAgentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AgentSessionContext | undefined => {
    const request = ctx.switchToHttp().getRequest<PrincipalRequest>();
    return request.agentSession;
  },
);

/**
 * Message of the 403 a PAT gets on account-credential routes. Stable on
 * purpose: the MCP server and the UI can match on it.
 */
export const PAT_FORBIDDEN_MESSAGE =
  "Personal API tokens cannot manage account credentials — sign in with a browser session";

/**
 * Refuses personal API tokens (B-2): a PAT authenticates as its owner for
 * board work, but it must never be able to mint more tokens, rotate the
 * password or move the account to another mailbox — otherwise one leaked
 * agent key (prompt injection, a log line) is a full, persistent account
 * takeover. Runs *after* `JwtAuthGuard` (or `MembershipGuard`), which tags
 * the principal: `@UseGuards(JwtAuthGuard, SessionOnlyGuard)`.
 */
@Injectable()
export class SessionOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const principal = principalOf(context.switchToHttp().getRequest());
    if (principal?.via === "pat") {
      throw new ForbiddenException({
        message: PAT_FORBIDDEN_MESSAGE,
        code: "pat_forbidden",
      });
    }
    return true;
  }
}
