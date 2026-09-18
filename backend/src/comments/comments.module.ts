import { Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { CardAccessGuard } from "@/common/card-access.guard";
import { RealtimeModule } from "@/realtime/realtime.module";
import { CommentsController } from "./comments.controller";
import { CommentsService } from "./comments.service";

/** Card comments, plain REST (§7.2, TASK-28); SSE fan-out (TASK-37). */
@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [CommentsController],
  providers: [CommentsService, CardAccessGuard],
})
export class CommentsModule {}
