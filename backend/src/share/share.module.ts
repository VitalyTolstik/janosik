import { Module } from "@nestjs/common";
import { AttachmentsModule } from "@/attachments/attachments.module";
import { AuthModule } from "@/auth/auth.module";
import { BoardsModule } from "@/boards/boards.module";
import { CommandsModule } from "@/commands/commands.module";
import { CommentsModule } from "@/comments/comments.module";
import { MembershipGuard } from "@/common/membership.guard";
import { RealtimeModule } from "@/realtime/realtime.module";
import { BoardSharesController } from "./board-shares.controller";
import { ShareAccessGuard } from "./share-access.guard";
import { ShareThrottlerGuard } from "./share-throttler.guard";
import { ShareController } from "./share.controller";
import { ShareService } from "./share.service";

/**
 * Public read-only board sharing (TASK-58, §7.9). Serves the token contour,
 * owns the `BoardShare` lifecycle and hosts the owner-side management routes
 * (`/boards/:id/shares`, ADMIN). The demo runner (TASK-57) reuses
 * `ShareService` to mint its live observation link.
 */
@Module({
  imports: [
    AuthModule,
    BoardsModule,
    CommentsModule,
    AttachmentsModule,
    CommandsModule,
    RealtimeModule,
  ],
  controllers: [ShareController, BoardSharesController],
  providers: [
    ShareService,
    ShareAccessGuard,
    ShareThrottlerGuard,
    MembershipGuard,
  ],
  exports: [ShareService],
})
export class ShareModule {}
