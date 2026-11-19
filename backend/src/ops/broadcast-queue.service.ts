import { Injectable, Optional } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MailerService } from "@/mailer/mailer.service";
import type { SentEmail } from "@/mailer/mail.types";
import { QUEUE_NAMES, redisQueueStats, type QueueStats } from "./queue-core";

export const BROADCAST_QUEUE = QUEUE_NAMES.broadcast;
export const BROADCAST_JOB = "broadcast";

/** Payload retained for jobs queued before the durable outbox migration. */
export type BroadcastJob = SentEmail;

@Injectable()
export class BroadcastQueueService {
  constructor(
    private readonly mailer: MailerService,
    private readonly prisma: PrismaService,
    @Optional()
    @InjectQueue(BROADCAST_QUEUE)
    private readonly queue?: Queue,
  ) {}

  async deliver(job: BroadcastJob): Promise<{ sent: number }> {
    const sent = await this.mailer.send(job);
    return { sent: sent ? 1 : 0 };
  }

  async stats(): Promise<QueueStats> {
    const redis = this.queue ? await redisQueueStats(this.queue) : undefined;
    const [pending, processed, failed] = await Promise.all([
      this.prisma.notificationMail.count({
        where: { kind: "broadcast", finishedAt: null },
      }),
      this.prisma.notificationMail.count({
        where: { kind: "broadcast", finishedAt: { not: null } },
      }),
      this.prisma.notificationMail.count({
        where: { kind: "broadcast", finishedAt: null, attempts: { gt: 0 } },
      }),
    ]);
    return {
      pending: Math.max(pending, redis?.pending ?? 0),
      processed: processed + (redis?.processed ?? 0),
      failed: failed + (redis?.failed ?? 0),
      backend: redis?.backend ?? "memory",
    };
  }
}
