import { Module } from "@nestjs/common";
import { ApprovalsModule } from "@/approvals/approvals.module";
import { AuthModule } from "@/auth/auth.module";
import { CommandsModule } from "@/commands/commands.module";
import { MembershipGuard } from "@/common/membership.guard";
import { PlansController } from "./plans.controller";
import { PlansService } from "./plans.service";

/** TASK-166.8: dry-run plan preview and atomic apply. */
@Module({
  imports: [AuthModule, ApprovalsModule, CommandsModule],
  controllers: [PlansController],
  providers: [PlansService, MembershipGuard],
})
export class PlansModule {}
