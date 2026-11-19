import { createHash } from "node:crypto";
import {
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
  type OnModuleDestroy,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Prisma, type NotificationMail } from "@prisma/client";
import type { Queue } from "bullmq";
import { PrismaService } from "@/common/prisma/prisma.service";
import { activeMembershipWhere } from "@/common/membership";
import { env } from "@/config/env";
import { QUEUE_NAMES, queuesEnabled } from "@/ops/queue-core";
import { ReconcileLoop } from "@/ops/reconcile-loop";
import { BROADCAST_JOB } from "@/ops/broadcast-queue.service";
import { MAIL_JOB } from "./mail-queue.service";
import { MailerService } from "./mailer.service";
import type { SentEmail } from "./mail.types";

export interface NotificationMailJob {
  deliveryId: string;
}

const RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 300_000;
const BATCH_SIZE = 100;

export function notificationMailId(...key: string[]): string {
  // The prefix keeps even an all-decimal hash valid as a BullMQ custom id.
  return `notification-${createHash("sha256").update(JSON.stringify(key)).digest("hex")}`;
}

/**
 * Redis dispatches ready letters to workers. The database remains authoritative
 * through lost enqueue replies, Redis resets and SMTP errors. The same worker
 * logic handles a self-host configured without Redis.
 */
@Injectable()
export class NotificationDeliveryService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationDeliveryService.name);
  private readonly loop = new ReconcileLoop(this.logger, () =>
    this.reconcile(),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    @Optional()
    @InjectQueue(QUEUE_NAMES.mail)
    private readonly mailQueue?: Queue<NotificationMailJob>,
    @Optional()
    @InjectQueue(QUEUE_NAMES.broadcast)
    private readonly broadcastQueue?: Queue<NotificationMailJob>,
  ) {}

  onModuleInit(): void {
    if (env.NODE_ENV !== "test") this.loop.start(5_000);
  }

  onModuleDestroy(): Promise<void> | undefined {
    return this.loop.stop();
  }

  /** Wake the dispatcher after a durable write. The periodic pass covers crashes. */
  kick(): Promise<void> {
    return this.loop.refresh();
  }

  private async reconcile(): Promise<void> {
    if (!this.mailer.enabled && env.NODE_ENV !== "test") return;
    const now = new Date();
    const due = await this.prisma.notificationMail.findMany({
      where: { finishedAt: null, nextAttemptAt: { lte: now } },
      orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
      take: BATCH_SIZE,
      select: { id: true, kind: true },
    });
    for (const row of due) {
      const queue =
        row.kind === "broadcast" ? this.broadcastQueue : this.mailQueue;
      if (queue) {
        await queue.add(
          row.kind === "broadcast" ? BROADCAST_JOB : MAIL_JOB,
          { deliveryId: row.id },
          { jobId: row.id, removeOnComplete: true, removeOnFail: true },
        );
      } else if (queuesEnabled) {
        throw new Error(`Notification queue unavailable for ${row.kind}`);
      } else {
        await this.deliver(row.id);
      }
    }
  }

  async deliver(id: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // Only one worker can send a row, even if a queue is reset during a send.
        const [row] = await tx.$queryRaw<NotificationMail[]>`
        SELECT * FROM "NotificationMail"
        WHERE id = ${id} AND "finishedAt" IS NULL AND "nextAttemptAt" <= NOW()
        FOR UPDATE SKIP LOCKED
      `;
        if (!row) return;

        const eligible = await this.eligible(tx, row);
        if (eligible) {
          try {
            const accepted = await this.mailer.send(
              row.message as unknown as SentEmail,
              `<${id}@janosik>`,
            );
            if (!accepted) throw new Error("SMTP is disabled");
          } catch (error) {
            const attempts = row.attempts + 1;
            const delay = Math.min(
              MAX_RETRY_DELAY_MS,
              RETRY_DELAY_MS * 2 ** Math.min(attempts - 1, 8),
            );
            await tx.notificationMail.update({
              where: { id },
              data: { attempts, nextAttemptAt: new Date(Date.now() + delay) },
            });
            this.logger.warn(
              `Notification ${id} (${row.kind}) delivery failed on attempt ${attempts}: ${error instanceof Error ? error.name : "unknown error"}`,
            );
            return;
          }
        }
        const finishedAt = new Date();
        if (row.kind === "attention" && eligible) {
          await tx.attentionNotification.updateMany({
            where: { attentionMailId: id, emailedAt: null },
            data: { emailedAt: finishedAt },
          });
        }
        if (row.kind === "digest") {
          await tx.attentionNotification.updateMany({
            where: { digestMailId: id, digestedAt: null },
            data: {
              digestMailId: null,
              ...(eligible ? { digestedAt: finishedAt } : {}),
            },
          });
        }
        await tx.notificationMail.update({
          where: { id },
          data: {
            finishedAt,
            message: Prisma.DbNull,
            userId: null,
            boardIds: [],
          },
        });
      },
      { timeout: 45_000 },
    );
  }

  private async eligible(
    tx: Prisma.TransactionClient,
    row: NotificationMail,
  ): Promise<boolean> {
    if (row.userId === null) return true;
    const user = await tx.user.findUnique({
      where: { id: row.userId },
      select: {
        disabledAt: true,
        email: true,
        notifyAttention: true,
        notifyDigest: true,
      },
    });
    if (
      !user ||
      user.disabledAt ||
      user.email !== (row.message as unknown as SentEmail).to
    )
      return false;
    const enabled =
      row.kind === "attention" ? user.notifyAttention : user.notifyDigest;
    if (!enabled) return false;
    if (row.boardIds.length === 0) return true;
    return (
      (await tx.boardMember.count({
        where: {
          boardId: { in: row.boardIds },
          userId: row.userId,
          board: { deletedAt: null },
          ...activeMembershipWhere(new Date()),
        },
      })) === row.boardIds.length
    );
  }
}
