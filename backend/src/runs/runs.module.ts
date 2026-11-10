import { Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { CommandsModule } from "@/commands/commands.module";
import { MembershipGuard } from "@/common/membership.guard";
import { SecurityAuditModule } from "@/common/security-audit/security-audit.module";
import { RealtimeModule } from "@/realtime/realtime.module";
import { RunsController } from "./runs.controller";
import { RunsService } from "./runs.service";

/** TASK-166.7: run listing, detail, dry-run and human-only rollback. */
@Module({
  imports: [AuthModule, CommandsModule, RealtimeModule, SecurityAuditModule],
  controllers: [RunsController],
  providers: [RunsService, MembershipGuard],
})
export class RunsModule {}
