import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";

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
  /**
   * `AdminUser.id` from the access token's `imp` claim when a master
   * impersonates this user (TASK-59); `null` for ordinary sessions and PATs.
   */
  impersonatedBy?: string | null;
}

/** The request bits the auth layer reads/writes. */
export interface PrincipalRequest {
  auth?: AuthPrincipal;
}

/** The principal `JwtAuthGuard` resolved, or `undefined` on public routes. */
export function principalOf(request: unknown): AuthPrincipal | undefined {
  return (request as PrincipalRequest | undefined)?.auth;
}

/** Injects the `AuthPrincipal` `JwtAuthGuard` recorded (may be undefined). */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal | undefined =>
    principalOf(ctx.switchToHttp().getRequest()),
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
