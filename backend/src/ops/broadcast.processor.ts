import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import {
  NotificationDeliveryService,
  type NotificationMailJob,
} from "@/mailer/notification-delivery.service";
import {
  BROADCAST_QUEUE,
  BroadcastQueueService,
  type BroadcastJob,
} from "./broadcast-queue.service";

/** Delivers durable broadcasts and accepts the legacy payload during upgrades. */
@Processor(BROADCAST_QUEUE)
export class BroadcastProcessor extends WorkerHost {
  constructor(
    private readonly notifications: NotificationDeliveryService,
    private readonly broadcasts: BroadcastQueueService,
  ) {
    super();
  }

  async process(
    job: Job<BroadcastJob | NotificationMailJob>,
  ): Promise<unknown> {
    if ("deliveryId" in job.data) {
      return this.notifications.deliver(job.data.deliveryId);
    }
    return this.broadcasts.deliver(job.data);
  }
}
