import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ThrottlerException } from "@nestjs/throttler";
import { API_TOKEN_PREFIX } from "@janosik/shared";
import { assertTokenNotPaused } from "@/auth/agent-pause";
import { PAT_FORBIDDEN_MESSAGE } from "@/auth/auth-principal";
import { consumeTokenRate } from "@/common/token-rate-limit";
import { ApiTokenService, type TokenScope } from "./api-token.service";
import type { AuthPrincipal } from "./auth-principal";
import { assertImpersonationAllows } from "./impersonation-policy";

/** HTTP methods that mutate state — refused for a read-only PAT. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * TASK-166.3 human-only pause routes. These are checked here, before the
 * board membership/role guard, so a MEMBER or read-only PAT gets the
 * documented `pat_forbidden` rather than a role/scope error.
 */
const PAT_SESSION_ONLY_PATHS = [
  /\/boards\/[^/]+\/agents\/(?:pause|resume)\/?$/,
  /\/boards\/[^/]+\/agent-sessions\/[^/]+\/(?:pause|resume)\/?$/,
  /\/users\/me\/tokens\/[^/]+\/(?:pause|resume)\/?$/,
  /\/agents\/(?:pause-all|resume-all)\/?$/,
];

/**
 * Board-scoped PAT writes defer the legacy `pat_read_only` refusal to
 * `MembershipGuard`, which can check pause first (ADR §5.2 evaluation order).
 * Account routes such as `POST /boards/import` are not deferred.
 */
const BOARD_SCOPED_WRITE_PATHS = [
  /\/boards\/(?!import(?:\/|$))[^/]+(?:\/|$)/,
  /\/cards\/[^/]+(?:\/|$)/,
  /\/comments\/[^/]+(?:\/|$)/,
  /\/attachments\/[^/]+(?:\/|$)/,
];

/** Shape of the request bits the guard reads (auth header + resolved user). */
interface GuardedRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers: Record<string, string | undefined>;
  user?: unknown;
  auth?: AuthPrincipal;
}

/**
 * Guard for routes behind the JWT access token (§7.2), with a personal API
 * token fallback (TASK-36.1): a `Bearer jnk_…` value the JWT strategy cannot
 * parse is authenticated against `ApiToken` instead. Everything else keeps
 * the JWT-first behaviour. Admin routes use `AdminJwtAuthGuard` and never
 * accept PATs.
 *
 * B-2: the guard also records *how* the caller authenticated on
 * `req.auth` (`{ via: "jwt" }` or `{ via: "pat", apiTokenId }`), so
 * `SessionOnlyGuard` can keep agent keys away from credential management
 * and open SSE streams can re-validate the exact token they were opened with.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly apiTokens: ApiTokenService) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const raw = bearerToken(request.headers.authorization);
    const isPat = raw !== undefined && raw.startsWith(API_TOKEN_PREFIX);
    try {
      if (await super.canActivate(context)) {
        // The strategy has verified this token; only read a claim from it.
        const impersonatedBy = impersonatorOf(raw);
        request.auth = {
          via: "jwt",
          impersonatedBy,
          authMethod: authMethodOf(raw),
        };
        // TASK-147 (B3): an impersonation token is a full user token, so the
        // read-only rule is enforced here — every user-contour route,
        // `MembershipGuard` included, authenticates through this guard.
        if (impersonatedBy !== null) {
          assertImpersonationAllows(
            request.method ?? "GET",
            request.originalUrl ?? request.url ?? "",
          );
        }
        return true;
      }
    } catch (error) {
      // A PAT is not a JWT, so the strategy always rejects it — fall back.
      // Any other failure keeps its original answer.
      if (!isPat) {
        throw error;
      }
    }
    if (!isPat || raw === undefined) {
      throw new UnauthorizedException();
    }
    const { user, tokenId, tokenName, identity, scope } =
      await this.apiTokens.authenticate(raw);
    // Per-token budget first, so an abusive token is counted even when the
    // request is then refused on scope grounds (TASK-157).
    if (
      scope.rateLimitPerMinute !== null &&
      !consumeTokenRate(tokenId, scope.rateLimitPerMinute)
    ) {
      throw new ThrottlerException("Too many requests for this API token");
    }
    // TASK-166.3: human control-plane routes are session-only. Run before
    // membership/role/read-only checks so every PAT gets `pat_forbidden`.
    assertPatNotOnSessionOnlyPath(request.originalUrl ?? request.url);
    // TASK-166.3: a paused token cannot write anywhere. Board/session pause
    // is checked later, once the board and optional session are resolved.
    assertTokenNotPaused(
      identity,
      request.method,
      request.originalUrl ?? request.url,
    );
    if (
      !isBoardScopedWritePath(request.originalUrl ?? request.url) ||
      !isWriteMethod(request.method)
    ) {
      assertPatScopeAllows(request.method, scope);
    }
    request.user = user;
    request.auth = {
      via: "pat",
      apiTokenId: tokenId,
      apiTokenName: tokenName,
      tokenIdentity: identity,
      tokenScope: scope,
    };
    return true;
  }
}

/** Refuse a write for a read-only PAT (TASK-157). */
export function assertPatScopeAllows(
  method: string | undefined,
  scope: TokenScope | undefined,
): void {
  if (scope?.readOnly && WRITE_METHODS.has((method ?? "GET").toUpperCase())) {
    throw new ForbiddenException({
      message:
        "This API token is read-only — writes require a read/write token",
      code: "pat_read_only",
    });
  }
}

function isWriteMethod(method: string | undefined): boolean {
  return WRITE_METHODS.has((method ?? "GET").toUpperCase());
}

function pathOf(url: string | undefined): string {
  return (url ?? "").split("?")[0];
}

function assertPatNotOnSessionOnlyPath(url: string | undefined): void {
  const path = pathOf(url);
  if (!PAT_SESSION_ONLY_PATHS.some((pattern) => pattern.test(path))) return;
  throw new ForbiddenException({
    message: PAT_FORBIDDEN_MESSAGE,
    code: "pat_forbidden",
  });
}

function isBoardScopedWritePath(url: string | undefined): boolean {
  const path = pathOf(url);
  return BOARD_SCOPED_WRITE_PATHS.some((pattern) => pattern.test(path));
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const [scheme, value] = header.split(" ");
  return scheme === "Bearer" && value ? value : undefined;
}

/** The `imp` claim of an already-verified access token, else `null`. */
function impersonatorOf(token: string | undefined): string | null {
  const claims = claimsOf(token);
  return typeof claims?.imp === "string" ? claims.imp : null;
}

/** TASK-166: the OAuth marker of an already-verified access token. */
function authMethodOf(token: string | undefined): "password" | "oauth" {
  return claimsOf(token)?.authMethod === "oauth" ? "oauth" : "password";
}

function claimsOf(token: string | undefined): Record<string, unknown> | null {
  const payload = token?.split(".")[1];
  if (payload === undefined) return null;
  try {
    return JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}
