import { Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { CardAccessGuard } from "@/common/card-access.guard";
import { RealtimeModule } from "@/realtime/realtime.module";
import { CommentRevisionsService } from "./comment-revisions.service";
import { CommentsController } from "./comments.controller";
import { CommentsService } from "./comments.service";

/** Card comments, plain REST (§7.2, TASK-28); SSE fan-out (TASK-37). */
@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [CommentsController],
  providers: [CommentsService, CommentRevisionsService, CardAccessGuard],
  // Reused by the master-panel demo runner (TASK-57) to post as demo agents
  // and by the master revision route (TASK-185.3).
  exports: [CommentsService, CommentRevisionsService],
})
export class CommentsModule {}
