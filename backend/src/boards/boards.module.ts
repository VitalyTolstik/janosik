import { Module } from "@nestjs/common";
import { ApprovalsModule } from "@/approvals/approvals.module";
import { AttachmentsModule } from "@/attachments/attachments.module";
import { AuthModule } from "@/auth/auth.module";
import { CommandsModule } from "@/commands/commands.module";
import { CommentsModule } from "@/comments/comments.module";
import {
  BOARD_READ_LIMITS,
  BoardReadService,
  type BoardReadLimits,
} from "@/common/board-read.service";
import { MembershipGuard } from "@/common/membership.guard";
import { env } from "@/config/env";
import { RealtimeModule } from "@/realtime/realtime.module";
import { BoardsController } from "./boards.controller";
import { BoardsService } from "./boards.service";
import { DeletedItemsService } from "./deleted-items.service";

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
    MembershipGuard,
    // TASK-200.6: one limiter/coalescer per process, shared by every board.
    {
      provide: BOARD_READ_LIMITS,
      useFactory: (): BoardReadLimits => ({
        maxConcurrent: env.BOARD_READ_CAP,
        queueMax: env.BOARD_READ_QUEUE_MAX,
        waitMs: env.BOARD_READ_WAIT_MS,
        timeoutMs: env.BOARD_READ_TIMEOUT_MS,
        retryAfterSeconds: env.BOARD_READ_RETRY_AFTER_SECONDS,
        compressMinBytes: env.BOARD_READ_COMPRESS_MIN_BYTES,
      }),
    },
    BoardReadService,
  ],
  // Reused by the master-account admin module (create/soft-delete board).
  exports: [BoardsService],
})
export class BoardsModule {}
