import { Global, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AttachmentsModule } from "@/attachments/attachments.module";
import { queuesEnabled } from "./queue-core";
import { BroadcastProcessor } from "./broadcast.processor";
import {
  BROADCAST_QUEUE,
  BroadcastQueueService,
} from "./broadcast-queue.service";
import { EmailTemplateService } from "./email-template.service";
import { FeatureFlagsService } from "./feature-flags.service";
import { MaintenanceProcessor } from "./maintenance.processor";
import { MaintenanceService } from "./maintenance.service";
import {
  MAINTENANCE_QUEUE,
  MaintenanceQueueService,
} from "./maintenance-queue.service";
import { OpsSettingsService } from "./ops-settings.service";
import { CommsProcessor } from "./comms.processor";
import { COMMS_QUEUE, CommsSchedulerService } from "./comms-scheduler.service";

/**
 * Runtime ops surface (TASK-61): feature flags, the ops singleton and the
 * helpers that gate behaviour (maintenance, per-user limits). Global so any
 * module — auth, shares, attachments — can consult a flag without threading
 * the provider through. The admin panel drives it; nothing here imports the
 * admin module, so there is no cycle.
 *
 * TASK-62: when `REDIS_URL` is configured, the outgoing-mail broadcast runs
 * as a BullMQ queue (Redis-backed, retried, scalable); the worker is only
 * registered then, and `BroadcastQueueService` otherwise falls back to an
 * in-process drain — so a self-host without Redis is unchanged.
 */
@Global()
@Module({
  imports: [
    AttachmentsModule,
    ...(queuesEnabled
      ? [
          BullModule.registerQueue({ name: BROADCAST_QUEUE }),
          BullModule.registerQueue({ name: MAINTENANCE_QUEUE }),
          BullModule.registerQueue({ name: COMMS_QUEUE }),
        ]
      : []),
  ],
  providers: [
    FeatureFlagsService,
    OpsSettingsService,
    EmailTemplateService,
    BroadcastQueueService,
    MaintenanceService,
    MaintenanceQueueService,
    CommsSchedulerService,
    ...(queuesEnabled
      ? [BroadcastProcessor, MaintenanceProcessor, CommsProcessor]
      : []),
  ],
  exports: [
    FeatureFlagsService,
    OpsSettingsService,
    EmailTemplateService,
    BroadcastQueueService,
    MaintenanceService,
    MaintenanceQueueService,
    CommsSchedulerService,
  ],
})
export class OpsModule {}
