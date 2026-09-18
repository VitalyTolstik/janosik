import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { API_TOKEN_PREFIX } from "@janosik/shared";
import { ApiTokenService } from "./api-token.service";

/** Shape of the request bits the guard reads (auth header + resolved user). */
interface GuardedRequest {
  headers: Record<string, string | undefined>;
  user?: unknown;
}

/**
 * Guard for routes behind the JWT access token (§7.2), with a personal API
 * token fallback (TASK-36.1): a `Bearer jnk_…` value the JWT strategy cannot
 * parse is authenticated against `ApiToken` instead. Everything else keeps
 * the JWT-first behaviour. Admin routes use `AdminJwtAuthGuard` and never
 * accept PATs.
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
    request.user = await this.apiTokens.authenticate(raw);
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
