import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";

import { AuthModule } from "@/auth/auth.module";
import { CardAccessGuard } from "@/common/card-access.guard";
import { RealtimeModule } from "@/realtime/realtime.module";
import { queuesEnabled } from "@/ops/queue-core";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentsService } from "./attachments.service";
import { MediaService } from "./media.service";
import { MediaProcessor } from "./media.processor";
import { StorageService } from "./storage.service";
import { TranscodeProcessor } from "./transcode.processor";
import { TRANSCODE_QUEUE, TranscodeService } from "./transcode.service";
import { MEDIA_QUEUE } from "./media.service";

/** Card file attachments (TASK-47): upload/stream/delete on local disk.
 * TASK-50 adds the background video transcode ("ужиматор"); TASK-66 moves
 * it (and TASK-70 image/video derivatives) onto BullMQ when Redis is set. */
@Module({
  imports: [
    AuthModule,
    RealtimeModule,
    ...(queuesEnabled
      ? [
          BullModule.registerQueue({ name: TRANSCODE_QUEUE }),
          BullModule.registerQueue({ name: MEDIA_QUEUE }),
        ]
      : []),
  ],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    StorageService,
    TranscodeService,
    MediaService,
    CardAccessGuard,
    ...(queuesEnabled ? [TranscodeProcessor, MediaProcessor] : []),
  ],
  exports: [AttachmentsService, StorageService, TranscodeService, MediaService],
})
export class AttachmentsModule {}
