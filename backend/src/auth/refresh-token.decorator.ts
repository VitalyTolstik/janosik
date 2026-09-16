import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { REFRESH_COOKIE } from "./auth.types";

/** Injects the raw refresh token from the httpOnly cookie, if present. */
export const RefreshToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest().cookies?.[REFRESH_COOKIE],
);
