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
import type {
  AdminDemoStartRequest,
  AdminDemoStatusDto,
} from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BoardWriteService } from "@/common/board-write.service";
import { withBoardWriteContext } from "@/common/request-context";
import { BoardsService } from "@/boards/boards.service";
import { CommandsService } from "@/commands/commands.service";
import { CommentsService } from "@/comments/comments.service";
import { deleteCommentActivitySnapshots } from "@/comments/comment-history";
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
/** Bounded command/key/detail pages during demo cleanup (TASK-200.11). */
const DEMO_COMMAND_PURGE_CHUNK = 500;
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
const PENDING_RUN = { status: { in: ["running", "stopping", "finished"] } };
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
  specs?: DemoCardSpec[];
  // Older runs used the command log as their only record of these rows.
  checklistIds?: string[];
  itemIds?: string[];
  linkIds?: string[];
  cardLabels?: Record<string, string[]>;
}

interface DemoCardSpec {
  cardId: string;
  worker: string;
  checklistId?: string;
  itemIds?: string[];
}

interface ProvisionedCard extends DemoCardSpec {
  checklistId: string;
  itemIds: string[];
  labelIds: string[];
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
 * Master-panel demo lifecycle (TASK-57). The runner provisions demo users,
 * workflow columns, labels and cards on a dedicated or selected board.
 * Start records ownership before provisioning. Cleanup uses the manifest
 * and protects rows that depend on the recorded demo footprint.
 *
 * The board writes go through `CommandsService`/`CommentsService` — the same
 * services the user API uses — so the run flows through the command log, the
 * SSE fan-out and the attribution path, nothing is written twice.
 */
@Injectable()
export class DemoService implements OnModuleDestroy {
  private readonly logger = new Logger(DemoService.name);
  private active: ActiveRun | null = null;
  private lifecycleTail: Promise<void> = Promise.resolve();
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
      where: PENDING_RUN,
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
      // with the progress the worker wrote. Stopping rows can await a retry.
      running: pending.status === "running",
      boardId: manifest.boardId,
      startedAt: pending.startedAt.toISOString(),
      users: manifest.userIds.length,
      columns: manifest.columnIds.length,
      labels: manifest.labelIds.length,
      cards: manifest.cardIds.length,
      cardsDone: pending.progress,
      cleanupPending: true,
      shareToken:
        pending.status === "stopping" ? null : (manifest.shareToken ?? null),
    };
  }

  /**
   * Provision a demo population and (unless `run === false`) start the swarm.
   * Refuses while another run is active.
   */
  start(
    input: AdminDemoStartRequest,
    startedBy: string,
  ): Promise<AdminDemoStatusDto> {
    return this.serializeLifecycle(() => this.startRun(input, startedBy));
  }

  private async startRun(
    input: AdminDemoStartRequest,
    startedBy: string,
  ): Promise<AdminDemoStatusDto> {
    if (this.active) throw new ConflictException("A demo is already running");
    if (this.demoQueue.usingRedis) {
      const running = await this.prisma.demoRun.findMany({
        where: { status: "running" },
        select: { id: true },
      });
      for (const { id } of running) {
        if (await this.demoQueue.hasActiveJob(id)) {
          throw new ConflictException("A demo is already running");
        }
      }
    }
    // M4: the live observation link is part of the demo product. Refuse before
    // cleanup/provisioning when public sharing is off, so a start cannot
    // leave a half-built demo board behind a 404 from ShareService.
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

    if (
      input.boardId &&
      !(await this.prisma.board.findFirst({
        where: { id: input.boardId, deletedAt: null },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException("Board not found");
    }
    this.lastRun = null;
    // Finish any pending cleanup before reserving a new run.
    await this.purgeAllRecorded();
    // The flag is runtime state and cleanup can take a while: re-check after
    // the boundary, before any row of the new run exists.
    await this.assertPublicSharingEnabled();
    const runTag = randomBytes(3).toString("hex");
    const userIds = Array.from({ length: agents + 1 }, () => newId("du"));
    const columns = Object.fromEntries(
      COLS.map((title) => [title, newId("col")]),
    );
    const labels = LABELS.map((label) => ({ id: newId("lbl"), ...label }));
    const labelsByName = new Map(labels.map(({ name, id }) => [name, id]));
    const cardLabels: Record<string, string[]> = {};
    const specs = Array.from({ length: cards }, (_, index): ProvisionedCard => {
      const cardId = newId("card");
      const labelIds = [
        labelsByName.get(index % 2 === 0 ? "feature" : "bug")!,
        ...(index % 3 === 0 ? [labelsByName.get("ui")!] : []),
      ];
      for (const id of labelIds) (cardLabels[id] ??= []).push(cardId);
      return {
        cardId,
        worker: userIds[1 + (index % agents)],
        checklistId: newId("chk"),
        itemIds: Array.from({ length: 3 }, () => newId("it")),
        labelIds,
      };
    });
    const boardId = input.boardId ?? newId("demo");
    const manifest: DemoManifest = {
      boardId,
      createdBoard: !input.boardId,
      userIds,
      shareId: newId("share"),
      columnIds: Object.values(columns),
      labelIds: labels.map(({ id }) => id),
      cardIds: specs.map(({ cardId }) => cardId),
      checklistIds: specs.map(({ checklistId }) => checklistId),
      itemIds: specs.flatMap(({ itemIds }) => itemIds),
      // This scenario does not create card links.
      linkIds: [],
      cardLabels,
      columns,
      specs,
    };

    // Reserve ownership before the first write. Cleanup can replay a partial
    // provisioning attempt even if the process exits between writes.
    const created = await this.prisma.demoRun.create({
      data: {
        boardId,
        startedBy,
        status: "stopping",
        manifest: this.manifestJson(manifest),
      },
    });
    try {
      await this.provision(manifest, columns, labels, specs, startedBy, runTag);
      await this.prisma.demoRun.update({
        where: { id: created.id },
        data: { status: "running", manifest: this.manifestJson(manifest) },
      });
    } catch (error) {
      await this.rollbackPartialStart(created.id, manifest);
      throw error;
    }

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
        this.launch(created.id, run, specs);
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
    columns: Record<string, string>,
    labels: Array<{ id: string; name: string; color: string }>,
    specs: ProvisionedCard[],
    startedBy: string,
    runTag: string,
  ): Promise<void> {
    const [dispatcherId] = manifest.userIds;
    const { boardId } = manifest;
    await this.prisma.user.createMany({
      data: manifest.userIds.map((id, index) => ({
        id,
        email: `demo-${runTag}-${index}@janosik.demo`,
        displayName:
          index === 0 ? "Диспетчер" : `Агент ${String(index).padStart(2, "0")}`,
        emailVerifiedAt: new Date(),
      })),
    });
    if (manifest.createdBoard) {
      await this.boards.createBoard(
        dispatcherId,
        {
          title: `${DEMO_BOARD_PREFIX} (${runTag})`,
        },
        undefined,
        boardId,
      );
    }

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
      undefined,
      undefined,
      false,
      manifest.shareId,
    );
    manifest.shareToken = share.token;

    // 4. Flow columns and labels (as the dispatcher).
    for (const [title, id] of Object.entries(columns)) {
      await this.send(boardId, dispatcherId, {
        type: "ADD_COLUMN",
        newColumnId: id,
        title,
      });
    }
    for (const label of labels) {
      await this.send(boardId, dispatcherId, { type: "ADD_LABEL", label });
    }

    // 5. One card per task, in the backlog, assigned round-robin.
    for (const [i, { cardId, worker, labelIds }] of specs.entries()) {
      const summary = SUMMARIES[i % SUMMARIES.length];
      await this.send(boardId, dispatcherId, {
        type: "ADD_CARD",
        newCardId: cardId,
        columnId: columns["Новые"],
        title: `DEMO-${String(i + 1).padStart(2, "0")}: ${summary}`,
        description: `Задача демо-агента ${i + 1}.`,
      });
      for (const labelId of labelIds) {
        await this.send(boardId, worker, {
          type: "SET_CARD_LABEL",
          cardId,
          labelId,
          on: true,
        });
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
    }
  }

  /** Stop the swarm and clean pending recorded runs. */
  stop(stoppedBy: string): Promise<AdminDemoStatusDto> {
    return this.serializeLifecycle(() => this.stopRun(stoppedBy));
  }

  private serializeLifecycle<T>(work: () => Promise<T>): Promise<T> {
    const result = this.lifecycleTail.then(work);
    this.lifecycleTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private manifestJson(manifest: DemoManifest): Prisma.InputJsonValue {
    return manifest as unknown as Prisma.InputJsonValue;
  }

  private async stopRun(stoppedBy: string): Promise<AdminDemoStatusDto> {
    const active = this.active;
    if (active) {
      active.stop = true;
      await Promise.all(active.tasks);
      this.active = null;
    }
    this.lastRun = null;
    const { runs, users, cards } = await this.purgeAllRecorded();
    if (runs === 0) throw new ConflictException("No demo to stop");
    this.logger.log(
      `Demo stopped (by ${stoppedBy}): ${users} users, ${cards} cards removed`,
    );
    return this.status();
  }

  // ------------------------------------------------------------- internals

  /**
   * Retry pending runs, including interrupted provisioning and cleanup.
   * Completed runs have already been checked for a remaining dedicated board.
   */
  private async purgeAllRecorded() {
    const runs = await this.prisma.demoRun.findMany({ where: PENDING_RUN });
    let users = 0;
    let cards = 0;
    let pending = false;
    for (const entry of runs) {
      const manifest = entry.manifest as unknown as DemoManifest;
      await this.prisma.demoRun.update({
        where: { id: entry.id },
        data: { status: "stopping" },
      });
      await this.demoQueue.cancel(entry.id).catch(() => undefined);
      const removed = await this.purge(entry.id, manifest);
      users += removed.users;
      cards += removed.cards;
      pending ||= removed.pending;
    }
    if (pending) {
      throw new ConflictException({
        code: "demo_cleanup_pending",
        message:
          "Demo cleanup is pending because some rows still have dependencies.",
      });
    }
    return { runs: runs.length, users, cards };
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
    spec: DemoCardSpec,
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
    const membership = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId: spec.worker } },
      select: { id: true, role: true },
    });
    if (!membership) return;
    // Every queued write rechecks this membership under the board lock.
    // Cleanup removes it in that same lock, so a late worker cannot write.
    await withBoardWriteContext(
      {
        boardId,
        userId: spec.worker,
        membershipId: membership.id,
        role: membership.role,
      },
      () => this.processCard(run, spec, live),
    );
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

  /** Best-effort rollback. A failed rollback leaves a retryable run. */
  private async rollbackPartialStart(
    runId: string,
    manifest: DemoManifest,
  ): Promise<void> {
    try {
      const result = await this.purge(runId, manifest);
      if (!result.pending) {
        await this.prisma.demoRun.delete({ where: { id: runId } });
      }
    } catch (error) {
      this.logger.warn(
        `Demo rollback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
  private launch(runId: string, run: ActiveRun, specs: DemoCardSpec[]): void {
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
    void Promise.all(run.tasks).then(async () => {
      await this.prisma.demoRun
        .updateMany({
          where: { id: runId, status: "running" },
          data: { status: "finished", progress: run.done },
        })
        .catch((error: unknown) =>
          this.logger.warn(
            `Could not record demo completion: ${String(error)}`,
          ),
        );
      if (this.active === run) {
        this.lastRun = run;
        this.active = null;
      }
    });
  }

  private async processCard(
    run: ActiveRun,
    spec: DemoCardSpec,
    liveOverride?: () => Promise<boolean>,
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
    // Restarted legacy jobs still rely on their creation commands for cleanup.
    const itemIds = spec.itemIds ?? [newId("it"), newId("it"), newId("it")];
    const checklistId = spec.checklistId ?? newId("chk");

    if (!(await live())) return;
    await move("Новые", "В работе");
    await this.comments.create(cardId, worker, { text: "Взял в работу." });
    await sleep(jitter(400, 900));

    if (!(await live())) return;

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

    if (!(await live())) return;

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

    if (Math.random() < 0.45 && (await live())) {
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

    if (!(await live())) return;
    await move("На ревью", "Тестирование");
    await this.comments.create(cardId, worker, {
      text: "Ушло на тестирование.",
    });
    await sleep(jitter(500, 1100));

    if (!(await live())) return;

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

  private async childIds(
    tx: Prisma.TransactionClient,
    manifest: DemoManifest,
  ): Promise<
    Required<Pick<DemoManifest, "checklistIds" | "itemIds" | "linkIds">>
  > {
    const { boardId, userIds, checklistIds, itemIds, linkIds } = manifest;
    if (checklistIds && itemIds && linkIds) {
      return { checklistIds, itemIds, linkIds };
    }

    const legacy = {
      checklistIds: [] as string[],
      itemIds: [] as string[],
      linkIds: [] as string[],
    };
    const commands = await tx.command.findMany({
      where: {
        boardId,
        actorId: { in: userIds },
        type: { in: ["ADD_CHECKLIST", "ADD_CHECKLIST_ITEM", "ADD_CARD_LINK"] },
      },
      select: { type: true, payload: true },
    });
    for (const { type, payload } of commands) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        continue;
      if (
        type === "ADD_CHECKLIST" &&
        typeof payload.newChecklistId === "string"
      ) {
        legacy.checklistIds.push(payload.newChecklistId);
      }
      if (
        type === "ADD_CHECKLIST_ITEM" &&
        typeof payload.newItemId === "string"
      ) {
        legacy.itemIds.push(payload.newItemId);
      }
      if (type === "ADD_CARD_LINK" && typeof payload.linkId === "string") {
        legacy.linkIds.push(payload.linkId);
      }
    }
    return {
      checklistIds: checklistIds ?? legacy.checklistIds,
      itemIds: itemIds ?? legacy.itemIds,
      linkIds: linkIds ?? legacy.linkIds,
    };
  }

  /**
   * Clean the recorded footprint under the board lock. Keep parents needed
   * by other rows and leave a retained dedicated board pending for retry.
   */
  private async purge(runId: string, manifest: DemoManifest) {
    const { boardId, createdBoard, userIds, columnIds, labelIds, cardIds } =
      manifest;
    const cards = { in: cardIds };
    const demoUsers = { in: userIds };
    const result = await this.boardWrite.run(boardId, async (tx) => {
      const ids = await this.childIds(tx, manifest);
      const { checklistIds, itemIds, linkIds } = ids;
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
      const cardLabels =
        manifest.cardLabels ??
        Object.fromEntries(labelIds.map((labelId) => [labelId, cardIds]));
      await tx.cardLabel.deleteMany({
        where: {
          card: demoCards,
          OR: Object.entries(cardLabels).map(([labelId, linkedCardIds]) => ({
            labelId,
            cardId: { in: linkedCardIds },
          })),
        },
      });
      const demoCommentRows = await tx.comment.findMany({
        where: { card: { column: { boardId } }, authorId: demoUsers },
        select: { id: true },
      });
      const demoCommentIds = demoCommentRows.map((row) => row.id);
      if (demoCommentIds.length > 0) {
        // TASK-185.1: remove immutable revisions and their feed snapshots
        // before the direct Comment.deleteMany.
        await deleteCommentActivitySnapshots(tx, demoCommentIds);
        await tx.commentRevision.deleteMany({
          where: { commentId: { in: demoCommentIds } },
        });
        await tx.comment.deleteMany({
          where: { id: { in: demoCommentIds } },
        });
      }
      await tx.activity.deleteMany({ where: { boardId, actorId: demoUsers } });
      // TASK-200.11: page the command log so detail/key deletes stay bounded;
      // only demo actors' commands are removed, real rows on a configured
      // board keep their keys.
      for (;;) {
        const page = await tx.command.findMany({
          where: { boardId, actorId: demoUsers },
          select: { id: true },
          take: DEMO_COMMAND_PURGE_CHUNK,
        });
        if (page.length === 0) break;
        const ids = page.map((row) => row.id);
        await tx.commandDetail.deleteMany({
          where: { commandId: { in: ids } },
        });
        await tx.commandKey.deleteMany({ where: { id: { in: ids } } });
        await tx.command.deleteMany({
          where: { id: { in: ids }, boardId, actorId: demoUsers },
        });
        if (page.length < DEMO_COMMAND_PURGE_CHUNK) break;
      }
      // Bounded board-orphan cleanup for legacy demo rows whose command was
      // already gone; real commands on a configured shared board keep their
      // key/detail.
      for (;;) {
        const removed = await tx.$executeRaw`
          WITH victims AS (
            SELECT DISTINCT d."commandId"
              FROM "CommandDetail" d
             WHERE d."boardId" = ${boardId}
               AND NOT EXISTS (
                 SELECT 1 FROM "Command" c
                  WHERE c."id" = d."commandId" AND c."boardId" = d."boardId"
               )
             LIMIT ${DEMO_COMMAND_PURGE_CHUNK}
          )
          DELETE FROM "CommandDetail" d
           USING victims v
           WHERE d."commandId" = v."commandId" AND d."boardId" = ${boardId}
        `;
        if (removed === 0) break;
      }
      for (;;) {
        const removed = await tx.$executeRaw`
          WITH victims AS (
            SELECT k."id"
              FROM "CommandKey" k
             WHERE k."boardId" = ${boardId}
               AND NOT EXISTS (
                 SELECT 1 FROM "Command" c
                  WHERE c."id" = k."id" AND c."boardId" = k."boardId"
               )
             LIMIT ${DEMO_COMMAND_PURGE_CHUNK}
          )
          DELETE FROM "CommandKey" k
           USING victims v
           WHERE k."id" = v."id" AND k."boardId" = ${boardId}
        `;
        if (removed === 0) break;
      }
      // Keep recorded parents when other users have added dependent rows.
      const { count: removedCards } = await tx.card.deleteMany({
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
      let retainedBoard = false;
      if (createdBoard) {
        // Agent records have scalar board ids and are not covered by the
        // board's foreign-key relations.
        const agentRows = await Promise.all([
          tx.agentSession.count({ where: { boardId } }),
          tx.agentRun.count({ where: { boardId } }),
          tx.approvalRequest.count({ where: { boardId } }),
        ]);
        const deleted = agentRows.some((count) => count > 0)
          ? { count: 0 }
          : await tx.board.deleteMany({
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
        retainedBoard =
          deleted.count === 0 &&
          (await tx.board.count({ where: { id: boardId } })) > 0;
      }
      // A demo identity may now be referenced by user-created rows, including
      // on another board. Preserve those relations (some use SET NULL).
      const { count: removedUsers } = await tx.user.deleteMany({
        where: {
          id: demoUsers,
          memberships: { none: {} },
          invitedMembers: { none: {} },
          assignedCards: { none: { NOT: demoCards } },
          commands: { none: {} },
          comments: { none: {} },
          commentRevisions: { none: {} },
          attachments: { none: {} },
          activity: { none: {} },
          apiTokens: { none: {} },
          refreshTokens: { none: {} },
        },
      });
      const retainedUsers =
        removedUsers < userIds.length
          ? await tx.user.count({ where: { id: demoUsers } })
          : 0;
      const pending = retainedBoard || retainedUsers > 0;
      await tx.demoRun.update({
        where: { id: runId },
        data: {
          // A legacy retry must still know these IDs after deleting commands.
          manifest: this.manifestJson({ ...manifest, ...ids }),
          status: pending ? "stopping" : "stopped",
          stoppedAt: pending ? null : new Date(),
        },
      });
      return {
        cards: removedCards,
        users: removedUsers,
        pending,
        retainedBoard,
        retainedUsers,
      };
    });
    if (result.pending) {
      this.logger.warn(
        `Demo cleanup pending for run ${runId} on board ${boardId}: dedicated board retained=${result.retainedBoard}, users retained=${result.retainedUsers}`,
      );
    }
    return result;
  }
}
