import { ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { ThrottlerGuard, type ThrottlerLimitDetail } from "@nestjs/throttler";
import { PasswordResetAuditService } from "./password-reset-audit.service";

@Injectable()
export class PasswordResetThrottlerGuard extends ThrottlerGuard {
  @Inject(PasswordResetAuditService)
  private readonly audit!: PasswordResetAuditService;

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const req = context
      .switchToHttp()
      .getRequest<{ path: string; ip?: string }>();
    if (
      req.path.endsWith("/auth/password/reset/request") ||
      req.path.endsWith("/auth/password/reset/confirm")
    ) {
      await this.audit.record("rate_limited", req.ip ?? null);
    }
    return super.throwThrottlingException(context, detail);
  }
}
