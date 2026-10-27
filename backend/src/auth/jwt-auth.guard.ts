import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { API_TOKEN_PREFIX } from "@janosik/shared";
import { ApiTokenService } from "./api-token.service";
import type { AuthPrincipal } from "./auth-principal";

/** Shape of the request bits the guard reads (auth header + resolved user). */
interface GuardedRequest {
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
        request.auth = {
          via: "jwt",
          impersonatedBy: impersonatorOf(raw),
        };
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
    const { user, tokenId } = await this.apiTokens.authenticate(raw);
    request.user = user;
    request.auth = { via: "pat", apiTokenId: tokenId };
    return true;
  }
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
  const payload = token?.split(".")[1];
  if (payload === undefined) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { imp?: unknown };
    return typeof claims.imp === "string" ? claims.imp : null;
  } catch {
    return null;
  }
}
