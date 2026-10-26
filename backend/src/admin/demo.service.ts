import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { randomBytes } from "node:crypto";
import type { AdminDemoStatusDto } from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BoardWriteService } from "@/common/board-write.service";
import { BoardsService } from "@/boards/boards.service";
import { CommandsService } from "@/commands/commands.service";
import { CommentsService } from "@/comments/comments.service";
import { ShareService } from "@/share/share.service";
import { DemoQueueService } from "./demo-queue.service";

const COLS = ["Новые", "В работе", "На ревью", "Тестирование", "Готово"];
const LABELS: Array<{ name: string; color: string }> = [
  { name: "bug", color: "red" },
  { name: "feature", color: "green" },
  { name: "ui", color: "brand" },
  { name: "backend", color: "blue" },
  { name: "urgent", color: "orange" },
];
const SUMMARIES = [
  "Починить вёрстку карточки на мобиле",
  "Добавить фильтр по меткам",
  "Ускорить запрос доски",
  "Поправить экспорт в JSON",
  "Онбординг для новых участников",
  "Ретраи для SSE-стрима",
  "Тултип на кнопке undo",
  "Сортировка по сроку",
  "Тёмная тема для диалогов",
  "Логирование команд",
];
const MAX_USERS = 100;
const MAX_CARDS = 1000;
/** Title prefix of a board this service creates — our own cleanup marker. */
const DEMO_BOARD_PREFIX = "Демо · рой агентов";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (a: number, b: number): number => a + Math.random() * (b - a);
const newId = (prefix: string): string =>
  `${prefix}${randomBytes(8).toString("hex")}`;

/** Exact ids a run created — the only thing `stop` is allowed to delete. */
interface DemoManifest {
  boardId: string;
  createdBoard: boolean;
  /** Demo users created by the run — deleted on cleanup. */
  userIds: string[];
  /** Live observation share minted for the run's board (TASK-58). */
  shareId?: string;
  shareToken?: string;
  columnIds: string[];
  labelIds: string[];
  cardIds: string[];
  // TASK-69: the data the queued job needs to rebuild the swarm without the
  // in-memory run (column title → id, and the card/worker pairing).
  columns?: Record<string, string>;
  specs?: Array<{ cardId: string; worker: string }>;
}

interface ActiveRun {
  manifest: DemoManifest;
  columns: Record<string, string>;
  startedAt: string;
  done: number;
  stop: boolean;
  tasks: Promise<void>[];
}

/**
 * Master-panel demo lifecycle (TASK-57). The runner provisions a throwaway
 * population on a **dedicated** board — demo users on the `@janosik.demo`
 * domain, the five flow columns, a label set and one card per agent — then
 * drives the cards across the flow, so the operator can watch a swarm work
 * live from the panel (and see it on the traffic gauge). Every id it creates
 * is written to the run's manifest and to `DemoRun`, so `stop` deletes
 * **exactly** those rows and never guesses what is "demo" by name.
 *
 * The board writes go through `CommandsService`/`CommentsService` — the same
 * services the user API uses — so the run flows through the command log, the
 * SSE fan-out and the attribution path, nothing is written twice.
 */
@Injectable()
export class DemoService implements OnModuleDestroy {
  private readonly logger = new Logger(DemoService.name);
  private active: ActiveRun | null = null;
  /** The most recently finished run — shown (not "running") until cleaned. */
  private lastRun: ActiveRun | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly boardWrite: BoardWriteService,
    private readonly boards: BoardsService,
    private readonly commands: CommandsService,
    private readonly comments: CommentsService,
    private readonly shares: ShareService,
    private readonly demoQueue: DemoQueueService,
  ) {}

  onModuleDestroy(): void {
    if (this.active) this.active.stop = true;
  }

  /** `GET /admin/demo` — the live run, the last finished one, or the DB. */
  async status(): Promise<AdminDemoStatusDto> {
    const run = this.active ?? this.lastRun;
    if (run) {
      const { manifest, done, startedAt } = run;
      return {
        running: this.active !== null,
        boardId: manifest.boardId,
        startedAt,
        users: manifest.userIds.length,
        columns: manifest.columnIds.length,
        labels: manifest.labelIds.length,
        cards: manifest.cardIds.length,
        cardsDone: done,
        cleanupPending: true,
        shareToken: manifest.shareToken ?? null,
      };
    }
    const pending = await this.prisma.demoRun.findFirst({
      where: { status: { in: ["running", "stopping", "finished"] } },
      orderBy: { startedAt: "desc" },
    });
    if (pending === null) {
      return {
        running: false,
        boardId: null,
        startedAt: null,
        users: 0,
        columns: 0,
        labels: 0,
        cards: 0,
        cardsDone: 0,
        cleanupPending: false,
        shareToken: null,
      };
    }
    const manifest = pending.manifest as unknown as DemoManifest;
    return {
      running: false,
      boardId: manifest.boardId,
      startedAt: pending.startedAt.toISOString(),
      users: manifest.userIds.length,
      columns: manifest.columnIds.length,
      labels: manifest.labelIds.length,
      cards: manifest.cardIds.length,
      cardsDone: pending.progress,
      cleanupPending: true,
      shareToken: manifest.shareToken ?? null,
    };
  }

  /**
   * Provision a demo population and (unless `run === false`) start the swarm.
   * Refuses while another run is active.
   */
  async start(
    input: {
      boardId?: string;
      users?: number;
      cards?: number;
      run?: boolean;
    },
    startedBy: string,
  ): Promise<AdminDemoStatusDto> {
    if (this.active) {
      throw new ConflictException("A demo is already running");
    }
    // Clean everything a previous demo left behind, then create the new one —
    // so a fresh start never accumulates boards or demo users.
    await this.cleanAllDemo();
    this.lastRun = null;
    const agents = input.users ?? 20;
    if (!Number.isInteger(agents) || agents < 1 || agents > MAX_USERS) {
      throw new BadRequestException({
        message: `users must be an integer between 1 and ${MAX_USERS}`,
        field: "users",
      });
    }
    const cards = input.cards ?? agents;
    if (!Number.isInteger(cards) || cards < 1 || cards > MAX_CARDS) {
      throw new BadRequestException({
        message: `cards must be an integer between 1 and ${MAX_CARDS}`,
        field: "cards",
      });
    }

    const runTag = randomBytes(3).toString("hex");
    const manifest: DemoManifest = {
      boardId: "",
      createdBoard: false,
      userIds: [],
      columnIds: [],
      labelIds: [],
      cardIds: [],
    };

    // 1. Dispatcher (opens a dedicated board). Always a throwaway demo account:
    //    observing the swarm no longer needs a second real login — the run's
    //    live share link (TASK-58) is the watching path instead.
    const dispatcherId = await this.createUser(runTag, "Диспетчер", 0);
    manifest.userIds.push(dispatcherId);

    // 2. N demo agents on the reserved `@janosik.demo` domain.
    const workers: string[] = [];
    for (let i = 0; i < agents; i += 1) {
      const id = await this.createUser(
        runTag,
        `Агент ${String(i + 1).padStart(2, "0")}`,
        i + 1,
      );
      manifest.userIds.push(id);
      workers.push(id);
    }

    // 3. Board — a provided one, or a fresh dedicated "Демо" board.
    if (input.boardId) {
      const existing = await this.prisma.board.findFirst({
        where: { id: input.boardId, deletedAt: null },
        select: { id: true },
      });
      if (existing === null) {
        throw new NotFoundException("Board not found");
      }
      manifest.boardId = existing.id;
    } else {
      const board = await this.boards.createBoard(dispatcherId, {
        title: `${DEMO_BOARD_PREFIX} (${runTag})`,
      });
      manifest.boardId = board.id;
      manifest.createdBoard = true;
    }
    const boardId = manifest.boardId;

    // 3. Membership for every demo agent (idempotent).
    for (const userId of manifest.userIds) {
      await this.prisma.boardMember.upsert({
        where: { boardId_userId: { boardId, userId } },
        create: { boardId, userId, role: Role.MEMBER, acceptedAt: new Date() },
        update: { acceptedAt: new Date(), role: Role.MEMBER },
      });
    }

    // 3b. Live observation share (TASK-58): the whole point of replacing the
    //     watcher account — open `/s/<token>` with no login and watch the
    //     swarm move. Comments are on (this is "watch how we work").
    const share = await this.shares.create(boardId, startedBy, {
      mode: "live",
      title: "Демо-рой · живой просмотр",
      includeComments: true,
      includeAttachments: false,
    });
    manifest.shareId = share.id;
    manifest.shareToken = share.token;

    // 4. Flow columns and labels (as the dispatcher).
    const columns: Record<string, string> = {};
    for (const title of COLS) {
      const id = newId("col");
      await this.send(boardId, dispatcherId, {
        type: "ADD_COLUMN",
        newColumnId: id,
        title,
      });
      columns[title] = id;
      manifest.columnIds.push(id);
    }
    const labels = new Map<string, string>();
    for (const label of LABELS) {
      const id = newId("lbl");
      await this.send(boardId, dispatcherId, {
        type: "ADD_LABEL",
        label: { id, ...label },
      });
      labels.set(label.name, id);
      manifest.labelIds.push(id);
    }

    // 5. One card per agent, in the backlog, assigned to that agent.
    const specs: Array<{ cardId: string; summary: string; worker: string }> =
      [];
    for (let i = 0; i < cards; i += 1) {
      const cardId = newId("card");
      const summary = SUMMARIES[i % SUMMARIES.length];
      const worker = workers[i % workers.length];
      await this.send(boardId, dispatcherId, {
        type: "ADD_CARD",
        newCardId: cardId,
        columnId: columns["Новые"],
        title: `DEMO-${String(i + 1).padStart(2, "0")}: ${summary}`,
        description: `Задача демо-агента ${i + 1}.`,
      });
      const picks = [
        i % 2 === 0 ? "feature" : "bug",
        ...(i % 3 === 0 ? ["ui"] : []),
      ];
      for (const name of picks) {
        const labelId = labels.get(name);
        if (labelId) {
          await this.send(boardId, worker, {
            type: "SET_CARD_LABEL",
            cardId,
            labelId,
            on: true,
          });
        }
      }
      await this.send(boardId, worker, {
        type: "SET_CARD_PRIORITY",
        cardId,
        priority: i % 5 === 0 ? "high" : "medium",
      });
      await this.send(boardId, worker, {
        type: "SET_CARD_DUE_DATE",
        cardId,
        dueDate: Date.now() + (2 + (i % 7)) * 86_400_000,
      });
      await this.send(boardId, worker, {
        type: "SET_CARD_ASSIGN",
        cardId,
        assigneeId: worker,
      });
      await this.comments.create(cardId, worker, {
        text: "Беру задачу в работу.",
      });
      manifest.cardIds.push(cardId);
      specs.push({ cardId, summary, worker });
    }

    // TASK-69: the manifest also carries what a queued job needs to rebuild
    // the swarm (columns map + card/worker pairing).
    manifest.columns = columns;
    manifest.specs = specs.map((spec) => ({
      cardId: spec.cardId,
      worker: spec.worker,
    }));

    const created = await this.prisma.demoRun.create({
      data: {
        boardId,
        status: "running",
        manifest: manifest as unknown as Prisma.InputJsonValue,
        startedBy,
      },
    });

    const run: ActiveRun = {
      manifest,
      columns,
      startedAt: new Date().toISOString(),
      done: 0,
      stop: false,
      tasks: [],
    };
    this.active = run;
    if (input.run !== false) {
      // Prefer the Redis-backed job (progress/cancel survive restarts); fall
      // back to the in-process launcher when there is no Redis.
      const queued = await this.demoQueue.enqueue(created.id);
      if (!queued) this.launch(run, specs);
    }
    this.logger.log(
      `Demo started on board ${boardId}: ${agents} agents, ${manifest.cardIds.length} cards`,
    );
    return this.status();
  }

  /** Stop the swarm and delete every recorded run's footprint. */
  async stop(stoppedBy: string): Promise<AdminDemoStatusDto> {
    if (this.active) {
      this.active.stop = true;
      this.active = null;
    }
    this.lastRun = null;
    const runs = await this.prisma.demoRun.findMany({
      where: { status: { in: ["running", "stopping", "finished"] } },
      select: { id: true },
    });
    // TASK-69: a queued run is cancelled by removing its job; the worker also
    // sees the `stopping` status and stops between acts.
    for (const run of runs) {
      await this.demoQueue.cancel(run.id).catch(() => undefined);
    }
    const pending = runs.length;
    if (pending === 0) {
      throw new ConflictException("No demo to stop");
    }
    await this.prisma.demoRun.updateMany({
      where: { status: { in: ["running", "stopping"] } },
      data: { status: "stopping" },
    });
    const { users, cards } = await this.purgeAllRecorded();
    this.logger.log(
      `Demo stopped (by ${stoppedBy}): ${users} users, ${cards} cards removed`,
    );
    return this.status();
  }

  // ------------------------------------------------------------- internals

  /**
   * Delete every recorded run's footprint, whatever its status — a finished
   * run, one left by a restart, or an already-stopped row whose board somehow
   * survived. Idempotent; used by `start` ("clean everything, then create")
   * and `stop`. Returns the totals removed, for logging.
   */
  private async purgeAllRecorded(): Promise<{ users: number; cards: number }> {
    const runs = await this.prisma.demoRun.findMany();
    let users = 0;
    let cards = 0;
    for (const entry of runs) {
      const manifest = entry.manifest as unknown as DemoManifest;
      try {
        await this.purge(manifest);
        users += manifest.userIds.length;
        cards += manifest.cardIds.length;
      } catch (error) {
        this.logger.warn(
          `Demo cleanup failed for ${manifest.boardId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    await this.prisma.demoRun.updateMany({
      where: { status: { in: ["running", "stopping", "finished"] } },
      data: { status: "stopped", stoppedAt: new Date() },
    });
    return { users, cards };
  }

  /**
   * TASK-69: drive one `DemoRun` from the DB manifest. Used by the `demo`
   * queue worker (and by the in-process fallback indirectly). Progress is
   * written to `DemoRun.progress` and reported through `onProgress`, and the
   * run stops between acts once its status leaves `running` (a stop request).
   */
  async executeRun(
    runId: string,
    onProgress?: (done: number, total: number) => Promise<void> | void,
  ): Promise<void> {
    const entry = await this.prisma.demoRun.findUnique({
      where: { id: runId },
    });
    if (!entry) return;
    const manifest = entry.manifest as unknown as DemoManifest;
    const columns = manifest.columns ?? {};
    const specs = manifest.specs ?? [];
    const boardId = manifest.boardId;
    const total = specs.length;
    let done = 0;

    const stillRunning = async (): Promise<boolean> => {
      const row = await this.prisma.demoRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      return row?.status === "running";
    };

    await Promise.all(
      specs.map(async (spec) => {
        try {
          if (await stillRunning()) {
            await this.processCardFromSpec(
              boardId,
              columns,
              spec,
              stillRunning,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Demo card ${spec.cardId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        done += 1;
        await this.prisma.demoRun
          .update({ where: { id: runId }, data: { progress: done } })
          .catch(() => undefined);
        await onProgress?.(done, total);
      }),
    );

    // The swarm settled: mark the run finished (still cleanup-pending) unless
    // a stop already moved it past that.
    await this.prisma.demoRun
      .updateMany({
        where: { id: runId, status: "running" },
        data: { status: "finished" },
      })
      .catch(() => undefined);
  }

  /** `processCard` with the run/stop lookups abstracted (TASK-69 job path). */
  private async processCardFromSpec(
    boardId: string,
    columns: Record<string, string>,
    spec: { cardId: string; worker: string },
    live: () => Promise<boolean>,
  ): Promise<void> {
    const run: ActiveRun = {
      manifest: { boardId } as DemoManifest,
      columns,
      startedAt: new Date().toISOString(),
      done: 0,
      stop: false,
      tasks: [],
    };
    // Mirror the DB stop flag into a cheap sync flag processCard can poll.
    let stopped = false;
    const poll = setInterval(() => {
      void live().then((ok) => {
        if (!ok) stopped = true;
      });
    }, 1_000);
    try {
      await this.processCard(run, spec, () => !stopped);
    } finally {
      clearInterval(poll);
    }
  }

  /**
   * Clean every demo artifact before a new run: the recorded runs plus any
   * orphan board a failed/older run left behind (recognised by our own title
   * marker — never a user board). Then the caller can create a fresh demo.
   */
  private async cleanAllDemo(): Promise<void> {
    await this.purgeAllRecorded();
    const orphans = await this.prisma.board.findMany({
      where: { title: { startsWith: DEMO_BOARD_PREFIX } },
      select: { id: true },
    });
    for (const { id } of orphans) {
      try {
        await this.purgeWholeBoard(id);
      } catch (error) {
        this.logger.warn(
          `Demo orphan cleanup failed for ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * Remove a whole board this service created — every child row, its demo
   * users and the board itself. Safe because the board is ours (title marker);
   * used to clean orphans that predate a recorded manifest.
   */
  private async purgeWholeBoard(boardId: string): Promise<void> {
    const cards = await this.prisma.card.findMany({
      where: { column: { boardId } },
      select: { id: true },
    });
    const cardIds = cards.map((card) => card.id);
    const members = await this.prisma.boardMember.findMany({
      where: { boardId, user: { email: { endsWith: "@janosik.demo" } } },
      select: { userId: true },
    });
    const userIds = members.map((member) => member.userId);
    await this.boardWrite.run(boardId, async (tx) => {
      await tx.cardLabel.deleteMany({ where: { cardId: { in: cardIds } } });
      await tx.checklistItem.deleteMany({
        where: { checklist: { cardId: { in: cardIds } } },
      });
      await tx.checklist.deleteMany({ where: { cardId: { in: cardIds } } });
      await tx.cardLink.deleteMany({ where: { boardId } });
      await tx.attachment.deleteMany({ where: { cardId: { in: cardIds } } });
      await tx.comment.deleteMany({ where: { cardId: { in: cardIds } } });
      await tx.activity.deleteMany({ where: { boardId } });
      await tx.command.deleteMany({ where: { boardId } });
      await tx.boardShare.deleteMany({ where: { boardId } });
      await tx.card.deleteMany({ where: { id: { in: cardIds } } });
      await tx.column.deleteMany({ where: { boardId } });
      await tx.label.deleteMany({ where: { boardId } });
      // The whole board is ours (title marker): clear every member, watcher
      // included, before the FK-bound board delete.
      await tx.boardMember.deleteMany({ where: { boardId } });
      await tx.board.deleteMany({ where: { id: boardId } });
    });
    if (userIds.length > 0) {
      await this.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }

  private async createUser(
    runTag: string,
    displayName: string,
    index: number,
  ): Promise<string> {
    return (
      await this.prisma.user.create({
        data: {
          id: newId("du"),
          email: `demo-${runTag}-${index}@janosik.demo`,
          displayName,
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;
  }

  /** Apply one board command as `actorId`; `newId` keeps each one idempotent. */
  private async send(
    boardId: string,
    actorId: string,
    action: Record<string, unknown> & { type: string },
  ): Promise<void> {
    await this.commands.apply(boardId, actorId, {
      commandId: newId("cmd"),
      action: { boardId, at: Date.now(), ...action },
    });
  }

  /** Fan out the per-card flow; every task checks the stop flag between acts. */
  private launch(
    run: ActiveRun,
    specs: Array<{ cardId: string; summary: string; worker: string }>,
  ): void {
    for (const spec of specs) {
      const task = this.processCard(run, spec)
        .then(() => {
          run.done += 1;
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Demo card ${spec.cardId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      run.tasks.push(task);
    }
    // When the whole swarm settles, the run is no longer "live": keep it for
    // display/cleanup but free the start slot so a new demo can begin.
    void Promise.all(run.tasks).then(() => {
      if (this.active === run) {
        this.lastRun = run;
        this.active = null;
      }
    });
  }

  private async processCard(
    run: ActiveRun,
    spec: { cardId: string; summary?: string; worker: string },
    liveOverride?: () => boolean,
  ): Promise<void> {
    const { cardId, worker } = spec;
    const boardId = run.manifest.boardId;
    const live = liveOverride ?? (() => !run.stop);
    const move = (from: string, to: string) =>
      this.send(boardId, worker, {
        type: "MOVE_CARD",
        cardId,
        fromColumnId: run.columns[from],
        fromIndex: 0,
        toColumnId: run.columns[to],
        toIndex: 0,
      });
    const itemIds = [newId("it"), newId("it"), newId("it")];
    const checklistId = newId("chk");

    if (!live()) return;
    await move("Новые", "В работе");
    await this.comments.create(cardId, worker, { text: "Взял в работу." });
    await sleep(jitter(400, 900));

    await this.send(boardId, worker, {
      type: "ADD_CHECKLIST",
      cardId,
      newChecklistId: checklistId,
      title: "Подзадачи",
    });
    for (const [i, text] of ["Разобраться", "Сделать", "Проверить"].entries()) {
      await this.send(boardId, worker, {
        type: "ADD_CHECKLIST_ITEM",
        cardId,
        checklistId,
        newItemId: itemIds[i],
        text,
      });
    }
    await sleep(jitter(300, 700));

    await this.send(boardId, worker, {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId,
      checklistId,
      itemId: itemIds[0],
      done: true,
    });
    await this.send(boardId, worker, {
      type: "UPDATE_CARD",
      cardId,
      description: "Первый подход сделан, детали в комментариях.",
    });
    await move("В работе", "На ревью");
    await this.comments.create(cardId, worker, { text: "Прошу ревью." });
    await sleep(jitter(700, 1500));

    if (Math.random() < 0.45 && live()) {
      await this.comments.create(cardId, worker, {
        text: "Ревью: нужны правки, вернул в работу.",
      });
      await move("На ревью", "В работе");
      await sleep(jitter(600, 1200));
      await this.send(boardId, worker, {
        type: "SET_CHECKLIST_ITEM_DONE",
        cardId,
        checklistId,
        itemId: itemIds[1],
        done: true,
      });
      await move("В работе", "На ревью");
    }

    if (!live()) return;
    await move("На ревью", "Тестирование");
    await this.comments.create(cardId, worker, {
      text: "Ушло на тестирование.",
    });
    await sleep(jitter(500, 1100));

    await move("Тестирование", "Готово");
    await this.send(boardId, worker, {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId,
      checklistId,
      itemId: itemIds[2],
      done: true,
    });
    await this.comments.create(cardId, worker, {
      text: "Тестирование пройдено.",
    });
  }

  /**
   * Delete exactly the rows a run created. Runs in one board-locked
   * transaction: board content first (children → cards → columns → labels),
   * then memberships, demo users and — for a board the run created — the
   * board itself.
   */
  private async purge(manifest: DemoManifest): Promise<void> {
    const { boardId, createdBoard, userIds, columnIds, labelIds, cardIds } =
      manifest;
    const cards = { in: cardIds };
    // Demo users author the commands/activity; cleanup deletes them outright
    // (no watcher account survives now — the live share is the observation
    // path, TASK-58).
    const demoUsers = { in: userIds };
    await this.boardWrite.run(boardId, async (tx) => {
      await tx.cardLabel.deleteMany({ where: { cardId: cards } });
      await tx.checklistItem.deleteMany({
        where: { checklist: { cardId: cards } },
      });
      await tx.checklist.deleteMany({ where: { cardId: cards } });
      await tx.cardLink.deleteMany({ where: { boardId } });
      await tx.attachment.deleteMany({ where: { cardId: cards } });
      await tx.comment.deleteMany({ where: { cardId: cards } });
      await tx.activity.deleteMany({
        where: createdBoard
          ? { boardId }
          : { boardId, OR: [{ actorId: demoUsers }, { cardId: cards }] },
      });
      await tx.command.deleteMany({
        where: createdBoard ? { boardId } : { boardId, actorId: demoUsers },
      });
      await tx.card.deleteMany({ where: { id: cards } });
      await tx.column.deleteMany({ where: { id: { in: columnIds } } });
      await tx.label.deleteMany({ where: { id: { in: labelIds } } });
      // The run's live share dies with the run: the token must stop resolving
      // the instant `stop` runs (a live share of a deleted board would only
      // answer 410; deleting the row is cleaner). On a created board every
      // share is ours; on a provided board only the one we minted.
      await tx.boardShare.deleteMany({
        where: createdBoard
          ? { boardId }
          : { id: manifest.shareId ?? "__none__" },
      });
      // A board the run created is entirely ours: drop every membership before
      // deleting it, or the board FK (BoardMember.boardId) blocks the delete.
      // A provided board keeps its other members; only ours go.
      await tx.boardMember.deleteMany({
        where: createdBoard ? { boardId } : { boardId, userId: demoUsers },
      });
      if (createdBoard) {
        await tx.board.deleteMany({ where: { id: boardId } });
      }
    });
    // Demo users have no rows left pointing at them once the board content and
    // their authored commands/activity are gone.
    await this.prisma.user.deleteMany({ where: { id: demoUsers } });
  }
}
