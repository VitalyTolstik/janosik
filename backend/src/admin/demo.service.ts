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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (a: number, b: number): number => a + Math.random() * (b - a);
const newId = (prefix: string): string =>
  `${prefix}${randomBytes(8).toString("hex")}`;

/** Exact ids a run created — the only thing `stop` is allowed to delete. */
interface DemoManifest {
  boardId: string;
  createdBoard: boolean;
  userIds: string[];
  columnIds: string[];
  labelIds: string[];
  cardIds: string[];
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly boardWrite: BoardWriteService,
    private readonly boards: BoardsService,
    private readonly commands: CommandsService,
    private readonly comments: CommentsService,
  ) {}

  onModuleDestroy(): void {
    if (this.active) this.active.stop = true;
  }

  /** `GET /admin/demo` — the live run, or the last one from the DB. */
  async status(): Promise<AdminDemoStatusDto> {
    if (this.active) {
      const { manifest, done, startedAt } = this.active;
      return {
        running: true,
        boardId: manifest.boardId,
        startedAt,
        users: manifest.userIds.length,
        columns: manifest.columnIds.length,
        labels: manifest.labelIds.length,
        cards: manifest.cardIds.length,
        cardsDone: done,
      };
    }
    const last = await this.prisma.demoRun.findFirst({
      orderBy: { startedAt: "desc" },
    });
    if (last === null) {
      return {
        running: false,
        boardId: null,
        startedAt: null,
        users: 0,
        columns: 0,
        labels: 0,
        cards: 0,
        cardsDone: 0,
      };
    }
    const manifest = last.manifest as unknown as DemoManifest;
    return {
      running: false,
      boardId: manifest.boardId,
      startedAt: last.startedAt.toISOString(),
      users: manifest.userIds.length,
      columns: manifest.columnIds.length,
      labels: manifest.labelIds.length,
      cards: manifest.cardIds.length,
      cardsDone: 0,
    };
  }

  /**
   * Provision a demo population and (unless `run === false`) start the swarm.
   * Refuses while another run is active.
   */
  async start(
    input: { boardId?: string; users?: number; cards?: number; run?: boolean },
    startedBy: string,
  ): Promise<AdminDemoStatusDto> {
    if (this.active) {
      throw new ConflictException("A demo is already running");
    }
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

    // 1. Demo participants — one dispatcher (board opener) + N agents, all on
    //    the reserved `@janosik.demo` domain and already verified.
    const dispatcherId = await this.createUser(runTag, "Диспетчер", 0);
    manifest.userIds.push(dispatcherId);
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

    // 2. Board — a provided one, or a fresh dedicated "Демо" board.
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
        title: `Демо · рой агентов (${runTag})`,
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

    await this.prisma.demoRun.create({
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
      this.launch(run, specs);
    }
    this.logger.log(
      `Demo started on board ${boardId}: ${agents} agents, ${manifest.cardIds.length} cards`,
    );
    return this.status();
  }

  /** Stop the swarm and delete exactly the run's footprint (board + users). */
  async stop(stoppedBy: string): Promise<AdminDemoStatusDto> {
    const run = this.active;
    if (run) {
      run.stop = true;
      this.active = null;
    }
    const last = await this.prisma.demoRun.findFirst({
      where: { status: "running" },
      orderBy: { startedAt: "desc" },
    });
    const target =
      run?.manifest ?? (last?.manifest as unknown as DemoManifest | undefined);
    if (target === undefined || target === null) {
      throw new ConflictException("No demo to stop");
    }
    await this.purge(target);
    await this.prisma.demoRun.updateMany({
      where: { boardId: target.boardId, status: "running" },
      data: { status: "stopped", stoppedAt: new Date() },
    });
    this.logger.log(
      `Demo stopped (by ${stoppedBy}): ${target.userIds.length} users, ${target.cardIds.length} cards removed`,
    );
    return this.status();
  }

  // ------------------------------------------------------------- internals

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
    if (this.active?.stop) return;
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
  }

  private async processCard(
    run: ActiveRun,
    spec: { cardId: string; summary: string; worker: string },
  ): Promise<void> {
    const { cardId, worker } = spec;
    const boardId = run.manifest.boardId;
    const live = () => !run.stop;
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
    const users = { in: userIds };
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
          : { boardId, OR: [{ actorId: users }, { cardId: cards }] },
      });
      await tx.command.deleteMany({
        where: createdBoard ? { boardId } : { boardId, actorId: users },
      });
      await tx.card.deleteMany({ where: { id: cards } });
      await tx.column.deleteMany({ where: { id: { in: columnIds } } });
      await tx.label.deleteMany({ where: { id: { in: labelIds } } });
      await tx.boardMember.deleteMany({ where: { boardId, userId: users } });
      if (createdBoard) {
        await tx.board.delete({ where: { id: boardId } });
      }
    });
    // Demo users have no rows left pointing at them once the board content and
    // their authored commands/activity are gone.
    await this.prisma.user.deleteMany({ where: { id: users } });
  }
}
