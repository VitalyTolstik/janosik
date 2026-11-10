import { Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { SecurityAuditModule } from "@/common/security-audit/security-audit.module";
import { MembershipGuard } from "@/common/membership.guard";
import { RealtimeModule } from "@/realtime/realtime.module";
import { ApprovalsController } from "./approvals.controller";
import { ApprovalsService } from "./approvals.service";

/** TASK-166.5: approval queue, decision/cancel and plan consumption. */
@Module({
  imports: [AuthModule, RealtimeModule, SecurityAuditModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, MembershipGuard],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
