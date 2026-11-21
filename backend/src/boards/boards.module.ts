import { Module } from "@nestjs/common";
import { ApprovalsModule } from "@/approvals/approvals.module";
import { AuthModule } from "@/auth/auth.module";
import { CommandsModule } from "@/commands/commands.module";
import { MembershipGuard } from "@/common/membership.guard";
import { RealtimeModule } from "@/realtime/realtime.module";
import { BoardsController } from "./boards.controller";
import { BoardsService } from "./boards.service";

/** Boards + membership + import/export (§7.2, TASK-25). */
@Module({
  imports: [AuthModule, CommandsModule, RealtimeModule, ApprovalsModule],
  controllers: [BoardsController],
  providers: [BoardsService, MembershipGuard],
  // Reused by the master-account admin module (create/soft-delete board).
  exports: [BoardsService],
})
export class BoardsModule {}
