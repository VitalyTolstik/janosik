import { Module } from "@nestjs/common";
import { ApprovalsModule } from "@/approvals/approvals.module";
import { AttachmentsModule } from "@/attachments/attachments.module";
import { AuthModule } from "@/auth/auth.module";
import { CommandsModule } from "@/commands/commands.module";
import { CommentsModule } from "@/comments/comments.module";
import { MembershipGuard } from "@/common/membership.guard";
import { RealtimeModule } from "@/realtime/realtime.module";
import { BoardsController } from "./boards.controller";
import { BoardsService } from "./boards.service";
import { DeletedItemsService } from "./deleted-items.service";
import { ReadyService } from "./ready.service";

/** Boards + membership + import/export (§7.2, TASK-25). */
@Module({
  imports: [
    AuthModule,
    CommandsModule,
    RealtimeModule,
    ApprovalsModule,
    CommentsModule,
    AttachmentsModule,
  ],
  controllers: [BoardsController],
  providers: [
    BoardsService,
    DeletedItemsService,
    ReadyService,
    MembershipGuard,
  ],
  // Reused by the master-account admin module (create/soft-delete board).
  exports: [BoardsService],
})
export class BoardsModule {}
