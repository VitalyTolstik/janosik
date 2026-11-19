import { Global, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AttachmentsModule } from "@/attachments/attachments.module";
import { queuesEnabled } from "./queue-core";
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
 */
@Global()
@Module({
  imports: [
    AttachmentsModule,
    ...(queuesEnabled
      ? [
          BullModule.registerQueue({ name: MAINTENANCE_QUEUE }),
          BullModule.registerQueue({ name: COMMS_QUEUE }),
        ]
      : []),
  ],
  providers: [
    FeatureFlagsService,
    OpsSettingsService,
    EmailTemplateService,
    MaintenanceService,
    MaintenanceQueueService,
    CommsSchedulerService,
    ...(queuesEnabled ? [MaintenanceProcessor, CommsProcessor] : []),
  ],
  exports: [
    FeatureFlagsService,
    OpsSettingsService,
    EmailTemplateService,
    MaintenanceService,
    MaintenanceQueueService,
    CommsSchedulerService,
  ],
})
export class OpsModule {}
