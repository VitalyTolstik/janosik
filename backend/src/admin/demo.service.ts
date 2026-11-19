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
import { FeatureFlagsService } from "@/ops/feature-flags.service";
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
/** Display title for dedicated demo boards. */
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
    private readonly flags: FeatureFlagsService,
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
      // TASK-82: a queued run lives only in the DB — reflect its real status
      // (running/stopping) with the progress the worker wrote.
      running: pending.status === "running" || pending.status === "stopping",
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
    // M4: the live observation link is part of the demo product. Refuse before
    // cleanup/provisioning when public sharing is off, so a start cannot
    // leave a half-built demo board behind a 404 from ShareService.
    await this.assertPublicSharingEnabled();
    // Clean everything a previous demo left behind, then create the new one —
    // so a fresh start never accumulates boards or demo users.
    await this.purgeAllRecorded();
    this.lastRun = null;
    // The flag is runtime state and cleanup can take a while: re-check after
    // the boundary, before any row of the new run exists.
    await this.assertPublicSharingEnabled();
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

    const { created, columns, specs } = await this.provision(
      manifest,
      input.boardId,
      startedBy,
      runTag,
      agents,
      cards,
    ).catch(async (error: unknown) => {
      await this.rollbackPartialStart(manifest);
      throw error;
    });
    const boardId = manifest.boardId;

    const run: ActiveRun = {
      manifest,
      columns,
      startedAt: new Date().toISOString(),
      done: 0,
      stop: false,
      tasks: [],
    };
    if (input.run !== false) {
      // Prefer the Redis-backed job (progress/cancel survive restarts); fall
      // back to the in-process launcher when there is no Redis.
      const queued = await this.demoQueue.enqueue(created.id);
      if (queued) {
        // TASK-82: in queued mode the worker owns the run and writes progress
        // to `DemoRun`. Holding it in `this.active` here would pin the status
        // at "running, 0 done" forever and make every later `start` conflict —
        // so the in-memory slot stays empty and `status()` reads the row.
        this.active = null;
      } else {
        this.active = run;
        this.launch(run, specs);
      }
    } else {
      // Provision-only: nothing is driving it, so keep it for display/cleanup.
      this.active = run;
    }
    this.logger.log(
      `Demo started on board ${boardId}: ${agents} agents, ${manifest.cardIds.length} cards`,
    );
    return this.status();
  }

  private async provision(
    manifest: DemoManifest,
    requestedBoardId: string | undefined,
    startedBy: string,
    runTag: string,
    agents: number,
    cards: number,
  ) {
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
    if (requestedBoardId) {
      const existing = await this.prisma.board.findFirst({
        where: { id: requestedBoardId, deletedAt: null },
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
    await this.assertPublicSharingEnabled();
    const share = await this.shares.create(
      boardId,
      startedBy,
      {
        mode: "live",
        title: "Демо-рой · живой просмотр",
        includeComments: true,
        includeAttachments: false,
      },
      "admin",
    );
    manifest.shareId = share.id;
    manifest.shareToken = share.token;

    // 4. Flow columns and labels (as the dispatcher).
    const columns: Record<string, string> = {};
    for (const title of COLS) {
      const id = newId("col");
      manifest.columnIds.push(id);
      await this.send(boardId, dispatcherId, {
        type: "ADD_COLUMN",
        newColumnId: id,
        title,
      });
      columns[title] = id;
    }
    const labels = new Map<string, string>();
    for (const label of LABELS) {
      const id = newId("lbl");
      manifest.labelIds.push(id);
      await this.send(boardId, dispatcherId, {
        type: "ADD_LABEL",
        label: { id, ...label },
      });
      labels.set(label.name, id);
    }

    // 5. One card per agent, in the backlog, assigned to that agent.
    const specs: Array<{ cardId: string; summary: string; worker: string }> =
      [];
    for (let i = 0; i < cards; i += 1) {
      const cardId = newId("card");
      const summary = SUMMARIES[i % SUMMARIES.length];
      const worker = workers[i % workers.length];
      manifest.cardIds.push(cardId);
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

    return { created, columns, specs };
  }

  /** Stop the swarm and delete every recorded run's footprint. */
  async stop(stoppedBy: string): Promise<AdminDemoStatusDto> {
    const active = this.active;
    if (active) {
      active.stop = true;
      await Promise.all(active.tasks);
      this.active = null;
    }
    this.lastRun = null;
    const pending = await this.prisma.demoRun.count({
      where: { status: { in: ["running", "stopping", "finished"] } },
    });
    if (pending === 0) throw new ConflictException("No demo to stop");
    const { users, cards } = await this.purgeAllRecorded();
    this.logger.log(
      `Demo stopped (by ${stoppedBy}): ${users} users, ${cards} cards removed`,
    );
    return this.status();
  }

  // ------------------------------------------------------------- internals

  /**
   * Delete every recorded run's footprint, whatever its status — a finished
   * run or one left by a restart. A failed cleanup stays pending for retry.
   */
  private async purgeAllRecorded(): Promise<{ users: number; cards: number }> {
    const runs = await this.prisma.demoRun.findMany({
      where: { status: { in: ["running", "stopping", "finished"] } },
    });
    let users = 0;
    let cards = 0;
    for (const entry of runs) {
      const manifest = entry.manifest as unknown as DemoManifest;
      await this.prisma.demoRun.updateMany({
        where: { id: entry.id, status: "running" },
        data: { status: "stopping" },
      });
      await this.demoQueue.cancel(entry.id).catch(() => undefined);
      await this.purge(manifest);
      await this.prisma.demoRun.update({
        where: { id: entry.id },
        data: { status: "stopped", stoppedAt: new Date() },
      });
      users += manifest.userIds.length;
      cards += manifest.cardIds.length;
    }
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

  /** M4: the live observation link is part of the demo product. */
  private publicSharingDisabled(): ConflictException {
    return new ConflictException({
      message:
        "The demo needs public sharing for its live view. Enable public shares and try again.",
      code: "public_shares_disabled",
    });
  }

  private async assertPublicSharingEnabled(): Promise<void> {
    if (!(await this.flags.isEnabled("public_shares"))) {
      throw this.publicSharingDisabled();
    }
  }

  /** Best-effort rollback when provisioning aborts before the run is stored. */
  private async rollbackPartialStart(manifest: DemoManifest): Promise<void> {
    try {
      if (manifest.boardId !== "") {
        await this.purge(manifest);
      } else if (manifest.userIds.length > 0) {
        await this.prisma.user.deleteMany({
          where: { id: { in: manifest.userIds } },
        });
      }
    } catch (error) {
      this.logger.warn(
        `Demo rollback failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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

    if (!live()) return;

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

    if (!live()) return;

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

    if (!live()) return;

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
    const demoUsers = { in: userIds };
    await this.boardWrite.run(boardId, async (tx) => {
      const commands = await tx.command.findMany({
        where: {
          boardId,
          actorId: demoUsers,
          type: {
            in: ["ADD_CHECKLIST", "ADD_CHECKLIST_ITEM", "ADD_CARD_LINK"],
          },
        },
        select: { type: true, payload: true },
      });
      const checklistIds: string[] = [];
      const itemIds: string[] = [];
      const linkIds: string[] = [];
      for (const { type, payload } of commands) {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          continue;
        }
        if (
          type === "ADD_CHECKLIST" &&
          typeof payload.newChecklistId === "string"
        ) {
          checklistIds.push(payload.newChecklistId);
        }
        if (
          type === "ADD_CHECKLIST_ITEM" &&
          typeof payload.newItemId === "string"
        ) {
          itemIds.push(payload.newItemId);
        }
        if (type === "ADD_CARD_LINK" && typeof payload.linkId === "string") {
          linkIds.push(payload.linkId);
        }
      }

      const demoCards = { id: cards, column: { boardId } };
      await tx.checklistItem.deleteMany({
        where: { id: { in: itemIds }, checklist: { card: demoCards } },
      });
      await tx.checklist.deleteMany({
        where: {
          id: { in: checklistIds },
          card: demoCards,
          items: { none: {} },
        },
      });
      await tx.cardLink.deleteMany({
        where: { id: { in: linkIds }, boardId },
      });
      await tx.cardLabel.deleteMany({
        where: { card: demoCards, labelId: { in: labelIds } },
      });
      await tx.comment.deleteMany({
        where: { card: { column: { boardId } }, authorId: demoUsers },
      });
      await tx.activity.deleteMany({ where: { boardId, actorId: demoUsers } });
      await tx.command.deleteMany({ where: { boardId, actorId: demoUsers } });
      // Keep recorded parents when other users have added dependent rows.
      await tx.card.deleteMany({
        where: {
          ...demoCards,
          linksFrom: { none: {} },
          linksTo: { none: {} },
          checklists: { none: {} },
          labels: { none: {} },
          comments: { none: {} },
          attachments: { none: {} },
          activity: { none: {} },
        },
      });
      await tx.column.deleteMany({
        where: { id: { in: columnIds }, boardId, cards: { none: {} } },
      });
      await tx.label.deleteMany({
        where: { id: { in: labelIds }, boardId, cards: { none: {} } },
      });
      if (manifest.shareId) {
        await tx.boardShare.deleteMany({
          where: { id: manifest.shareId, boardId },
        });
      }
      await tx.boardMember.deleteMany({
        where: { boardId, userId: demoUsers },
      });
      if (createdBoard) {
        await tx.board.deleteMany({
          where: {
            id: boardId,
            columns: { none: {} },
            labels: { none: {} },
            cardLinks: { none: {} },
            members: { none: {} },
            activity: { none: {} },
            commands: { none: {} },
            shares: { none: {} },
          },
        });
      }
      await tx.user.deleteMany({ where: { id: demoUsers } });
    });
  }
}
