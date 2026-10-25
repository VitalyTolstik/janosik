import { Global, Module } from "@nestjs/common";
import { BroadcastQueueService } from "./broadcast-queue.service";
import { EmailTemplateService } from "./email-template.service";
import { FeatureFlagsService } from "./feature-flags.service";
import { OpsSettingsService } from "./ops-settings.service";

/**
 * Runtime ops surface (TASK-61): feature flags, the ops singleton and the
 * helpers that gate behaviour (maintenance, per-user limits). Global so any
 * module — auth, shares, attachments — can consult a flag without threading
 * the provider through. The admin panel drives it; nothing here imports the
 * admin module, so there is no cycle.
 */
@Global()
@Module({
  providers: [
    FeatureFlagsService,
    OpsSettingsService,
    EmailTemplateService,
    BroadcastQueueService,
  ],
  exports: [
    FeatureFlagsService,
    OpsSettingsService,
    EmailTemplateService,
    BroadcastQueueService,
  ],
})
export class OpsModule {}
