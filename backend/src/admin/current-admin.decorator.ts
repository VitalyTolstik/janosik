import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { AdminPrincipal } from "./admin.types";

/** Injects the authenticated master account into a controller handler. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminPrincipal => {
    const request = context.switchToHttp().getRequest<Request>();
    return request.user as AdminPrincipal;
  },
);
