import {
  type CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthUser } from "@/auth/auth.types";
import { FeatureFlagsService } from "@/ops/feature-flags.service";

/**
 * M5: the `realtime_sse` feature flag is a real kill switch. Guards run
 * before an `@Sse()` handler starts its stream, so a disabled flag produces a
 * clean 404 (the client treats it as fatal and stops reconnecting) instead of
 * an open stream that never delivers anything.
 *
 * The per-user override is honoured for an authenticated board stream; a
 * public share stream has no user and uses the global value.
 */
@Injectable()
export class RealtimeFlagGuard implements CanActivate {
  constructor(private readonly flags: FeatureFlagsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (
      !(await this.flags.isEnabled("realtime_sse", request.user?.id ?? null))
    ) {
      throw new NotFoundException("Realtime updates are disabled");
    }
    return true;
  }
}
