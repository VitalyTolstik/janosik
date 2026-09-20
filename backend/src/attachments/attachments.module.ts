import { Module } from "@nestjs/common";

import { AuthModule } from "@/auth/auth.module";
import { CardAccessGuard } from "@/common/card-access.guard";
import { RealtimeModule } from "@/realtime/realtime.module";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentsService } from "./attachments.service";
import { StorageService } from "./storage.service";

/** Card file attachments (TASK-47): upload/stream/delete on local disk. */
@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, StorageService, CardAccessGuard],
  exports: [StorageService],
})
export class AttachmentsModule {}
