import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { REFRESH_COOKIE } from "./auth.types";

/**
 * Injects the raw refresh token from the httpOnly cookie, if present.
 * The cookie name defaults to the user contour and can be overridden —
 * the admin contour passes its own cookie name (TASK-36).
 */
export const RefreshToken = createParamDecorator(
  (cookieName: string | undefined, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest().cookies?.[cookieName ?? REFRESH_COOKIE],
);
