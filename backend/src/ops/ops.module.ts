import { Global, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { env } from "@/config/env";
import { BroadcastProcessor } from "./broadcast.processor";
import {
  BROADCAST_QUEUE,
  BroadcastQueueService,
} from "./broadcast-queue.service";
import { EmailTemplateService } from "./email-template.service";
import { FeatureFlagsService } from "./feature-flags.service";
import { OpsSettingsService } from "./ops-settings.service";

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
const queuesEnabled = env.REDIS_URL.trim().length > 0;

@Global()
@Module({
  imports: queuesEnabled
    ? [BullModule.registerQueue({ name: BROADCAST_QUEUE })]
    : [],
  providers: [
    FeatureFlagsService,
    OpsSettingsService,
    EmailTemplateService,
    BroadcastQueueService,
    ...(queuesEnabled ? [BroadcastProcessor] : []),
  ],
  exports: [
    FeatureFlagsService,
    OpsSettingsService,
    EmailTemplateService,
    BroadcastQueueService,
  ],
})
export class OpsModule {}
