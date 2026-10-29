import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import type { AuthUser } from "@/auth/auth.types";
import { AttachmentsService } from "./attachments.service";

/**
 * Per-user upload budget, enforced *before* the file is read (TASK-147
 * follow-up to TASK-146).
 *
 * `FileInterceptor` (multer) buffers the whole multipart body in memory, and
 * interceptors run after guards — so a rate check inside the service, which
 * only runs once the body is already in RAM, does not bound peak memory: N
 * concurrent 25 MiB uploads all get buffered and only the N+1th is refused.
 * As a guard this runs before any parsing, so the budget actually caps
 * concurrent buffering, not just attempts.
 *
 * Runs after the controller's `CardAccessGuard`, so `request.user` is set.
 */
@Injectable()
export class UploadRateGuard implements CanActivate {
  constructor(private readonly attachments: AttachmentsService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const userId = request.user?.id;
    if (userId !== undefined) this.attachments.assertUploadRate(userId);
    return true;
  }
}
