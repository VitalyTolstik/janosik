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
import { activeMembershipWhere } from "@/common/membership";
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
/** setTimeout caps at 2^31-1 ms; cadences beyond it are chunked (TASK-83). */
const MAX_TIMER_MS = 2_147_483_647;
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
    // Fallback cadence mirrors the BullMQ path (TASK-83): the reminder job
    // runs every `lead` hours, not every hour — otherwise a `lead`-wide window
    // fires the same reminder once per hour. Large cadences are chunked
    // because `setTimeout` caps at 2^31-1 ms.
    if (digest > 0) {
      this.armRecurring(
        "digest",
        digest * 3_600_000,
        () => void this.run("digest").catch(() => undefined),
      );
    }
    if (lead > 0) {
      this.armRecurring(
        "reminder",
        lead * 3_600_000,
        () => void this.run("due-reminders").catch(() => undefined),
      );
    }
  }

  /**
   * Recurring timer that survives a cadence beyond `setTimeout`'s 2^31-1 ms
   * cap by waiting in chunks (TASK-83). The latest pending handle is kept in
   * `digestTimer`/`reminderTimer`, so `clearTimers` stops the chain (a cleared
   * timeout never fires, and only a fired timeout re-arms).
   */
  private armRecurring(
    slot: "digest" | "reminder",
    ms: number,
    run: () => void,
  ): void {
    const arm = (remaining: number): void => {
      const handle = setTimeout(
        () => {
          if (remaining > MAX_TIMER_MS) {
            arm(remaining - MAX_TIMER_MS);
            return;
          }
          run();
          arm(ms);
        },
        Math.min(remaining, MAX_TIMER_MS),
      );
      handle.unref();
      if (slot === "digest") this.digestTimer = handle;
      else this.reminderTimer = handle;
    };
    arm(ms);
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
      {
        name: COMMS_JOB,
        data: { kind },
        // TASK-148 (B7): bound the completed/failed history the scheduler
        // leaves in Redis; each fired letter job used to stay forever.
        opts: { removeOnComplete: 100, removeOnFail: 100 },
      },
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
    const now = new Date();
    const since = new Date(now.getTime() - hours * 3_600_000);
    const boards = await this.prisma.board.findMany({
      where: {
        deletedAt: null,
        activity: { some: { createdAt: { gte: since } } },
      },
      select: {
        id: true,
        title: true,
        members: {
          where: activeMembershipWhere(now),
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
        column: {
          select: {
            boardId: true,
            board: { select: { title: true } },
          },
        },
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
    // B5 (TASK-147): only an *active* member may be reminded. A removed or
    // expired assignee still holds the card's `assigneeId`, so the address is
    // resolved against current membership in one batched query, not per card.
    const memberKeys = await this.activeMemberKeys(cards, now);
    const byUser = new Map<
      string,
      {
        email: string;
        items: Array<{
          cardId: string;
          title: string;
          board: string;
          due: Date;
        }>;
      }
    >();
    for (const card of cards) {
      const assignee = card.assignee;
      if (!assignee || !assignee.notifyDigest || assignee.disabledAt !== null) {
        continue;
      }
      if (!card.dueDate) continue;
      if (!memberKeys.has(`${card.column.boardId}:${assignee.id}`)) continue;
      const entry = byUser.get(assignee.id) ?? {
        email: assignee.email,
        items: [],
      };
      entry.items.push({
        cardId: card.id,
        title: card.title,
        board: card.column.board.title,
        due: card.dueDate,
      });
      byUser.set(assignee.id, entry);
    }
    let sent = 0;
    for (const [userId, { email, items }] of byUser.entries()) {
      // Persistent dedupe (TASK-83): never remind the same (card, user,
      // dueDate) twice, even across a restart or an overlapping run. A
      // rescheduled card has a new dueDate, so it re-arms naturally.
      const already = await this.prisma.reminderSent.findMany({
        where: { userId, cardId: { in: items.map((item) => item.cardId) } },
        select: { cardId: true, dueDate: true },
      });
      const reminded = new Set(
        already.map((row) => `${row.cardId}:${row.dueDate.getTime()}`),
      );
      const fresh = items.filter(
        (item) => !reminded.has(`${item.cardId}:${item.due.getTime()}`),
      );
      if (fresh.length === 0) continue;
      const tasksHtml = fresh
        .map(
          (item) =>
            `<li><strong>${escapeHtml(item.title)}</strong> (${escapeHtml(item.board)}) — due ${item.due.toISOString()}</li>`,
        )
        .join("");
      const message = await this.templates.dueReminderEmail(
        fresh.length,
        tasksHtml,
        "en",
      );
      await this.mail.enqueue({ to: email, ...message });
      await this.prisma.reminderSent.createMany({
        data: fresh.map((item) => ({
          cardId: item.cardId,
          userId,
          dueDate: item.due,
        })),
        skipDuplicates: true,
      });
      sent += 1;
    }
    return sent;
  }

  /**
   * The `boardId:userId` pairs among `cards` that are still active members
   * (TASK-147, B5). One batched query for the whole due-reminder run; the
   * result is a Set so the per-card loop is O(1).
   */
  private async activeMemberKeys(
    cards: Array<{
      column: { boardId: string };
      assignee: { id: string } | null;
    }>,
    now: Date,
  ): Promise<Set<string>> {
    const boardIds = new Set<string>();
    const userIds = new Set<string>();
    for (const card of cards) {
      if (!card.assignee) continue;
      boardIds.add(card.column.boardId);
      userIds.add(card.assignee.id);
    }
    if (boardIds.size === 0 || userIds.size === 0) return new Set();
    const members = await this.prisma.boardMember.findMany({
      where: {
        boardId: { in: [...boardIds] },
        userId: { in: [...userIds] },
        ...activeMembershipWhere(now),
      },
      select: { boardId: true, userId: true },
    });
    return new Set(members.map((m) => `${m.boardId}:${m.userId}`));
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
