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
export const MAX_NOTIFICATION_ATTEMPTS = 8;

function smtpReplyCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("responseCode" in error))
    return undefined;
  return typeof error.responseCode === "number"
    ? error.responseCode
    : undefined;
}

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
    let after: { nextAttemptAt: Date; id: string } | undefined;
    for (;;) {
      const due = await this.prisma.notificationMail.findMany({
        where: {
          finishedAt: null,
          nextAttemptAt: { lte: now },
          ...(after && {
            OR: [
              { nextAttemptAt: { gt: after.nextAttemptAt } },
              { nextAttemptAt: after.nextAttemptAt, id: { gt: after.id } },
            ],
          }),
        },
        orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
        take: BATCH_SIZE,
        select: { id: true, kind: true, nextAttemptAt: true },
      });
      await this.dispatchPage(
        due.filter((row) => row.kind === "broadcast"),
        this.broadcastQueue,
        BROADCAST_JOB,
      );
      await this.dispatchPage(
        due.filter((row) => row.kind !== "broadcast"),
        this.mailQueue,
        MAIL_JOB,
      );
      if (due.length < BATCH_SIZE) return;
      after = due[due.length - 1];
    }
  }

  private async dispatchPage(
    rows: { id: string }[],
    queue: Queue<NotificationMailJob> | undefined,
    name: string,
  ): Promise<void> {
    if (rows.length === 0) return;
    if (queue) {
      await queue.addBulk(
        rows.map(({ id }) => ({
          name,
          data: { deliveryId: id },
          opts: { jobId: id, removeOnComplete: true, removeOnFail: true },
        })),
      );
      return;
    }
    if (queuesEnabled)
      throw new Error(`Notification queue unavailable for ${name}`);
    for (const { id } of rows) await this.deliver(id);
  }

  async deliver(id: string): Promise<void> {
    if (!this.mailer.enabled && env.NODE_ENV !== "test") return;
    await this.prisma.$transaction(
      async (tx) => {
        // Account deletion locks the user before deleting their outbox rows.
        // Use the same lock order and hold eligibility stable through SMTP.
        const [broadcastRecipient] = await tx.$queryRaw<{ id: string }[]>`
          SELECT recipient.id
          FROM "NotificationMail" AS mail
          JOIN "User" AS recipient ON recipient.id = mail."userId"
          WHERE mail.id = ${id} AND mail.kind = 'broadcast'
            AND mail."finishedAt" IS NULL AND mail."nextAttemptAt" <= NOW()
            AND recipient."disabledAt" IS NULL
            AND recipient.email = mail.message->>'to'
          FOR SHARE OF recipient
        `;
        // Only one worker can send a row, even if a queue is reset during a send.
        const [row] = await tx.$queryRaw<NotificationMail[]>`
        SELECT * FROM "NotificationMail"
        WHERE id = ${id} AND "finishedAt" IS NULL AND "nextAttemptAt" <= NOW()
        FOR UPDATE SKIP LOCKED
      `;
        if (!row) return;

        const eligible =
          row.kind === "broadcast"
            ? row.userId === null || broadcastRecipient?.id === row.userId
            : await this.eligible(tx, row);
        let failedAttempts = row.attempts;
        let terminalFailure = false;
        if (eligible) {
          try {
            const accepted = await this.mailer.send(
              row.message as unknown as SentEmail,
              `<${id}@janosik>`,
            );
            if (!accepted) return;
          } catch (error) {
            failedAttempts += 1;
            const code = smtpReplyCode(error);
            terminalFailure =
              (code !== undefined && code >= 500 && code < 600) ||
              failedAttempts >= MAX_NOTIFICATION_ATTEMPTS;
            const reason =
              code ?? (error instanceof Error ? error.name : "unknown error");
            if (terminalFailure) {
              this.logger.error(
                `Notification ${id} (${row.kind}) delivery stopped after ${failedAttempts} attempt(s): ${reason}`,
              );
            } else {
              const delay = Math.min(
                MAX_RETRY_DELAY_MS,
                RETRY_DELAY_MS * 2 ** (failedAttempts - 1),
              );
              await tx.notificationMail.update({
                where: { id },
                data: {
                  attempts: failedAttempts,
                  nextAttemptAt: new Date(Date.now() + delay),
                },
              });
              this.logger.warn(
                `Notification ${id} (${row.kind}) delivery failed on attempt ${failedAttempts}: ${reason}`,
              );
              return;
            }
          }
        }
        const finishedAt = new Date();
        const delivered = eligible && !terminalFailure;
        if (row.kind === "attention" && delivered) {
          await tx.attentionNotification.updateMany({
            where: { attentionMailId: id, emailedAt: null },
            data: { emailedAt: finishedAt },
          });
        }
        // A terminal digest keeps its reservations until attention retention
        // removes them; otherwise the next run would retry the same events.
        if (row.kind === "digest" && !terminalFailure) {
          await tx.attentionNotification.updateMany({
            where: { digestMailId: id, digestedAt: null },
            data: {
              digestMailId: null,
              ...(delivered ? { digestedAt: finishedAt } : {}),
            },
          });
        }
        await tx.notificationMail.update({
          where: { id },
          data: {
            finishedAt,
            ...(terminalFailure
              ? { failedAt: finishedAt, attempts: failedAttempts }
              : {}),
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
