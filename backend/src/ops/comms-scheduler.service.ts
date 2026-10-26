import {
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { env } from "@/config/env";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MailQueueService } from "@/mailer/mail-queue.service";
import { EmailTemplateService } from "./email-template.service";
import { OpsSettingsService } from "./ops-settings.service";
import { QUEUE_NAMES, redisQueueStats, type QueueStats } from "./queue-core";

/**
 * TASK-72 — scheduled communications. A BullMQ **Job Scheduler** drives two
 * recurring jobs: a periodic **digest** (what changed on each board since the
 * last run) and **due reminders** (cards whose `dueDate` is within the lead
 * window). Recipients are accepted, non-disabled members who did not opt out
 * (`User.notifyDigest`); each letter is fanned out through the `mail` queue.
 * Cadence is configured from the Ops panel; without Redis a plain unref'd
 * timer stands in (skipped in tests).
 */
export const COMMS_QUEUE = QUEUE_NAMES.comms;
export const COMMS_JOB = "run";
export const DIGEST_SCHEDULER_ID = "comms-digest";
export const REMINDERS_SCHEDULER_ID = "comms-reminders";

export type CommsJobKind = "digest" | "due-reminders";

export interface CommsJob {
  kind: CommsJobKind;
}

@Injectable()
export class CommsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CommsSchedulerService.name);
  private digestTimer: NodeJS.Timeout | null = null;
  private reminderTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ops: OpsSettingsService,
    private readonly mail: MailQueueService,
    private readonly templates: EmailTemplateService,
    @Optional()
    @InjectQueue(COMMS_QUEUE)
    private readonly queue?: Queue<CommsJob>,
  ) {}

  get usingRedis(): boolean {
    return this.queue !== undefined;
  }

  async onModuleInit(): Promise<void> {
    await this.applySchedule().catch((error: unknown) => {
      this.logger.warn(`Comms schedule setup failed: ${String(error)}`);
    });
  }

  /** (Re)installs both recurring jobs from the configured cadence. */
  async applySchedule(): Promise<void> {
    const digest = (await this.ops.digestIntervalHours()) ?? 0;
    const lead = (await this.ops.reminderLeadHours()) ?? 0;
    if (this.queue) {
      await this.upsert(this.queue, DIGEST_SCHEDULER_ID, "digest", digest);
      await this.upsert(
        this.queue,
        REMINDERS_SCHEDULER_ID,
        "due-reminders",
        lead,
      );
      return;
    }
    this.clearTimers();
    if (env.NODE_ENV === "test") return;
    if (digest > 0) {
      this.digestTimer = setInterval(
        () => void this.run("digest").catch(() => undefined),
        digest * 3_600_000,
      );
      this.digestTimer.unref();
    }
    if (lead > 0) {
      this.reminderTimer = setInterval(
        () => void this.run("due-reminders").catch(() => undefined),
        3_600_000,
      );
      this.reminderTimer.unref();
    }
  }

  private async upsert(
    queue: Queue<CommsJob>,
    id: string,
    kind: CommsJobKind,
    hours: number,
  ): Promise<void> {
    if (hours <= 0) {
      await queue.removeJobScheduler(id);
      return;
    }
    await queue.upsertJobScheduler(
      id,
      { every: hours * 3_600_000 },
      { name: COMMS_JOB, data: { kind } },
    );
  }

  /** Runs one comms job (worker entry point + inline fallback). */
  async run(kind: CommsJobKind): Promise<{ sent: number }> {
    const sent =
      kind === "digest" ? await this.sendDigests() : await this.sendReminders();
    this.logger.log(`comms ${kind}: ${sent} letter(s) queued`);
    return { sent };
  }

  /** Per-board summary of activity since the digest interval. */
  private async sendDigests(): Promise<number> {
    const hours = (await this.ops.digestIntervalHours()) ?? 0;
    if (hours <= 0) return 0;
    const since = new Date(Date.now() - hours * 3_600_000);
    const boards = await this.prisma.board.findMany({
      where: {
        deletedAt: null,
        activity: { some: { createdAt: { gte: since } } },
      },
      select: {
        id: true,
        title: true,
        members: {
          where: { acceptedAt: { not: null } },
          select: {
            user: {
              select: {
                id: true,
                email: true,
                notifyDigest: true,
                disabledAt: true,
              },
            },
          },
        },
        _count: {
          select: {
            activity: { where: { createdAt: { gte: since } } },
          },
        },
      },
    });
    let sent = 0;
    for (const board of boards) {
      const changes = board._count.activity;
      if (changes === 0) continue;
      const message = await this.templates.digestEmail(
        board.title,
        changes,
        hours,
        "en",
      );
      for (const member of board.members) {
        const user = member.user;
        if (!user.notifyDigest || user.disabledAt !== null) continue;
        await this.mail.enqueue({ to: user.email, ...message });
        sent += 1;
      }
    }
    return sent;
  }

  /** One letter per assignee listing cards due within the lead window. */
  private async sendReminders(): Promise<number> {
    const lead = (await this.ops.reminderLeadHours()) ?? 0;
    if (lead <= 0) return 0;
    const now = new Date();
    const until = new Date(now.getTime() + lead * 3_600_000);
    const cards = await this.prisma.card.findMany({
      where: {
        deletedAt: null,
        archivedAt: null,
        dueDate: { gte: now, lte: until },
        assigneeId: { not: null },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        column: { select: { board: { select: { title: true } } } },
        assignee: {
          select: {
            id: true,
            email: true,
            notifyDigest: true,
            disabledAt: true,
          },
        },
      },
    });
    const byUser = new Map<
      string,
      {
        email: string;
        items: Array<{ title: string; board: string; due: Date }>;
      }
    >();
    for (const card of cards) {
      const assignee = card.assignee;
      if (!assignee || !assignee.notifyDigest || assignee.disabledAt !== null) {
        continue;
      }
      if (!card.dueDate) continue;
      const entry = byUser.get(assignee.id) ?? {
        email: assignee.email,
        items: [],
      };
      entry.items.push({
        title: card.title,
        board: card.column.board.title,
        due: card.dueDate,
      });
      byUser.set(assignee.id, entry);
    }
    let sent = 0;
    for (const { email, items } of byUser.values()) {
      const tasksHtml = items
        .map(
          (item) =>
            `<li><strong>${escapeHtml(item.title)}</strong> (${escapeHtml(item.board)}) — due ${item.due.toISOString()}</li>`,
        )
        .join("");
      const message = await this.templates.dueReminderEmail(
        items.length,
        tasksHtml,
        "en",
      );
      await this.mail.enqueue({ to: email, ...message });
      sent += 1;
    }
    return sent;
  }

  async stats(): Promise<QueueStats> {
    if (this.queue) return redisQueueStats(this.queue);
    return { pending: 0, processed: 0, failed: 0, backend: "memory" };
  }

  private clearTimers(): void {
    if (this.digestTimer) clearInterval(this.digestTimer);
    if (this.reminderTimer) clearInterval(this.reminderTimer);
    this.digestTimer = null;
    this.reminderTimer = null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
