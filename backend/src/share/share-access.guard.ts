import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { BoardShare } from "@prisma/client";
import { ShareService } from "./share.service";

/** The request with the resolved, still-valid share the guard attaches. */
export interface ShareRequest extends Request {
  share?: BoardShare;
}

/**
 * The single gate of the public `/share/:token` contour (TASK-58, §7.9.4).
 *
 * Resolves the `:token` to a live share — enforcing the `ALLOW_PUBLIC_SHARES`
 * master switch, revocation and expiry — and hangs it on the request so the
 * controller never re-queries. A missing/revoked/expired token and a disabled
 * instance all answer the same 404 (no existence leak). This guard is
 * entirely separate from `MembershipGuard`/`CardAccessGuard`: the public
 * contour is read-only and outside the user JWT.
 */
@Injectable()
export class ShareAccessGuard implements CanActivate {
  constructor(private readonly shares: ShareService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ShareRequest>();
    const token = request.params.token as string;
    const share = await this.shares.resolveToken(token);
    // The SSE route is the only one that needs the board to be alive *at the
    // socket level*: a live stream of a deleted board has to end with 410 Gone
    // before bytes flow, and a snapshot has no stream at all (404).
    if (context.getHandler().name === "events") {
      await this.shares.liveBoardId(share);
    }
    request.share = share;
    return true;
  }
}
