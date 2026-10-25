import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { BoardShare } from "@prisma/client";
import type { ShareRequest } from "./share-access.guard";

/**
 * The share `ShareAccessGuard` resolved for this request (TASK-58). Only
 * meaningful on public `/share/:token` routes, where the guard always runs
 * first — the controller never looks the token up again.
 */
export const CurrentShare = createParamDecorator(
  (_data: unknown, context: ExecutionContext): BoardShare => {
    const request = context.switchToHttp().getRequest<ShareRequest>();
    if (!request.share) {
      throw new Error("CurrentShare used outside a ShareAccessGuard route");
    }
    return request.share;
  },
);
