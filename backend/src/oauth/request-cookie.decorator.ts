import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/**
 * Injects a named request cookie (cookie-parser provides `req.cookies`).
 * Nest has no built-in multi-cookie param decorator — the refresh contour
 * has its dedicated one (`@RefreshToken`), the OAuth state round trip
 * (TASK-54) uses this generic one.
 */
export const RequestCookie = createParamDecorator(
  (name: string, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest().cookies?.[name],
);
