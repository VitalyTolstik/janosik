import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthUser } from "./auth.types";

/** Injects the AuthUser resolved by JwtStrategy (req.user). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
