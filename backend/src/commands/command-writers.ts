import { Prisma } from "@prisma/client";
import type {
  Board,
  BoardAction,
  Card,
  Checklist,
  ChecklistItem,
} from "@janosik/shared";
import { cardOf } from "@janosik/shared";

/**
 * Per-action writers (ROADMAP §7.4.1 variant В).
 *
 * The reducer decides *what the board becomes*; these writers mirror that
 * result into the normalized §7.3 tables with the smallest possible set of
 * statements. They are intentionally literal per action (not a general
 * aggregate diff) so each command's transaction is auditable, and the
 * contract e2e locks them to the reducer (`GET /boards/:id` after the
 * command must deep-equal `boardReducer(before, action)`).
 *
 * Rules the writers follow, all inherited from the reducer:
 * - positions are rewritten for every column a command touches, because the
 *   aggregate derives `column.cardIds` from `Card.position`;
 * - `version` is incremented on every written versioned row (Board, Column,
 *   Card, Label, Checklist, ChecklistItem);
 * - soft-delete is propagated by flag, never by cascade — deleting a column
 *   soft-deletes its active cards and their checklists, while archived cards
 *   stay (the aggregate keeps them in the `cards` map);
 * - archived cards are never in `column.cardIds`, so they are left alone by
 *   reorder writers;
 * - writers are deterministic: ids and timestamps come only from the action
 *   payload (never `randomUUID()` / `Date.now()`), so replaying a command
 *   produces byte-identical rows.
 */

type Tx = Prisma.TransactionClient;

export interface WriteContext {
  boardId: string;
  action: BoardAction;
  before: Board;
  after: Board;
  at: number;
  /**
   * Authenticated author of the command (TASK-36). Stamped into every card
   * row the command writes — including the pure bookkeeping `updatedAt`s —
   * so the client can attribute the last change without a join per card.
   */
  actorId: string;
}

/**
 * TASK-96: the card-shaped command surface `writeCardAction` handles. It is
 * the narrowed set `writeAction` routes to it; typing the helper's input
 * with it makes the inner switch exhaustive (a new card-shaped command has
 * to be added here or the build fails).
 */
type CardAction = Extract<
  BoardAction,
  {
    type:
      | "UPDATE_CARD"
      | "SET_CARD_DUE_DATE"
      | "SET_CARD_PRIORITY"
      | "SET_CARD_ASSIGN"
      | "CLAIM_CARD"
      | "SET_CARD_COVER"
      | "ARCHIVE_CARD"
      | "UNARCHIVE_CARD"
      | "MOVE_CARD"
      | "DUPLICATE_CARD";
  }
>;

/** `Command.touches` label for an entity type + id (§7.3). */
export const touch = {
  board: (id: string) => `board:${id}`,
  column: (id: string) => `column:${id}`,
  card: (id: string) => `card:${id}`,
  label: (id: string) => `label:${id}`,
  checklist: (id: string) => `checklist:${id}`,
  checklistItem: (id: string) => `checklistItem:${id}`,
};

function columnOf(board: Board, columnId: string) {
  return board.columns.find((column) => column.id === columnId);
}

function cardIdsOf(board: Board, columnId: string): string[] {
  return columnOf(board, columnId)?.cardIds ?? [];
}

/**
 * Persist the order of a column's active cards (archive-aware).
 *
 * Uses raw SQL on purpose: `Card.updatedAt` carries `@updatedAt`, so a
 * Prisma `update` would bump it to "now" on every reorder — while the
 * reducer only stamps the card the command actually touched. Position is
 * bookkeeping, not content, so the row's `updatedAt` must stay put.
 */
async function writeCardPositions(
  tx: Tx,
  columnId: string,
  cardIds: string[],
): Promise<void> {
  // B-7: one `UPDATE … FROM (VALUES …)` per chunk instead of one statement
  // per card — a move between two 100-card columns used to cost ~200 round
  // trips under the board lock. Every value is a bound parameter.
  for (const chunk of chunked(cardIds, POSITION_BATCH)) {
    const rows = chunk.map(
      (id, offset) =>
        Prisma.sql`(${id}::text, ${chunk.offset + offset}::integer)`,
    );
    await tx.$executeRaw`
      UPDATE "Card" AS c
      SET "columnId" = ${columnId}, "position" = v.position
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, position)
      WHERE c."id" = v.id
    `;
  }
}

/**
 * Rows per batched position UPDATE. Two bind parameters per row keeps a
 * statement far below PostgreSQL's 65 535-parameter limit even for the
 * largest collection (`LIMITS.cardsPerColumn`).
 */
const POSITION_BATCH = 1_000;

/** Split `items` into slices that remember their starting index. */
function chunked<T>(
  items: readonly T[],
  size: number,
): Array<T[] & { offset: number }> {
  const chunks: Array<T[] & { offset: number }> = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(
      Object.assign(items.slice(start, start + size), { offset: start }),
    );
  }
  return chunks;
}

/**
 * Persist the horizontal order of the board's columns. Raw SQL for the same
 * reason as `writeCardPositions`: `Column.updatedAt` carries `@updatedAt`
 * and a reorder must not stamp it with the wall clock.
 */
async function writeColumnPositions(
  tx: Tx,
  columns: Board["columns"],
): Promise<void> {
  for (const chunk of chunked(columns, POSITION_BATCH)) {
    const rows = chunk.map(
      (column, offset) =>
        Prisma.sql`(${column.id}::text, ${chunk.offset + offset}::integer)`,
    );
    await tx.$executeRaw`
      UPDATE "Column" AS c
      SET "position" = v.position
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, position)
      WHERE c."id" = v.id
    `;
  }
}

function cardCreateData(
  card: Card,
  columnId: string,
  position: number,
  actorId: string,
): Prisma.CardUncheckedCreateInput {
  return {
    id: card.id,
    columnId,
    position,
    version: 0,
    deletedAt: null,
    lastActorId: actorId,
    title: card.title,
    description: card.description ?? null,
    coverType: card.cover?.type ?? null,
    coverValue: card.cover?.value ?? null,
    dueDate: card.dueDate !== undefined ? new Date(card.dueDate) : null,
    priority: card.priority ?? null,
    assigneeId: card.assigneeId ?? null,
    claimedBy: card.claimedBy ?? null,
    leaseUntil:
      card.leaseUntil !== undefined ? new Date(card.leaseUntil) : null,
    archivedAt:
      card.archivedAt !== undefined ? new Date(card.archivedAt) : null,
    createdAt: new Date(card.createdAt),
    updatedAt: new Date(card.updatedAt),
  };
}

function cardUpdateData(
  card: Card,
  actorId: string,
): Prisma.CardUncheckedUpdateInput {
  return {
    lastActorId: actorId,
    title: card.title,
    description: card.description ?? null,
    coverType: card.cover?.type ?? null,
    coverValue: card.cover?.value ?? null,
    dueDate: card.dueDate !== undefined ? new Date(card.dueDate) : null,
    priority: card.priority ?? null,
    assigneeId: card.assigneeId ?? null,
    claimedBy: card.claimedBy ?? null,
    leaseUntil:
      card.leaseUntil !== undefined ? new Date(card.leaseUntil) : null,
    archivedAt:
      card.archivedAt !== undefined ? new Date(card.archivedAt) : null,
    updatedAt: new Date(card.updatedAt),
  };
}

/** Insert or revive a card row (restore commands touch previously deleted rows). */
async function upsertCard(
  tx: Tx,
  card: Card,
  columnId: string,
  position: number,
  actorId: string,
): Promise<void> {
  // TASK-149 (B11): the denormalized attachment badge is not part of the
  // command payload, so a revived card would otherwise come back with the
  // stale (or default zero) count. Recompute it from the live rows and write
  // it in the same statement — a second `update` would stamp `updatedAt`
  // and break the aggregate/inverse equality.
  const liveAttachments = await tx.attachment.count({
    where: { cardId: card.id, deletedAt: null, isInline: false },
  });
  await tx.card.upsert({
    where: { id: card.id },
    create: {
      ...cardCreateData(card, columnId, position, actorId),
      attachmentCount: liveAttachments,
    },
    update: {
      ...cardUpdateData(card, actorId),
      columnId,
      position,
      deletedAt: null,
      version: { increment: 1 },
      attachmentCount: liveAttachments,
    },
  });
}

/** Replace a card's label links; unknown labels are ignored (reducer does the same). */
async function writeCardLabels(
  tx: Tx,
  boardId: string,
  cardId: string,
  labelIds: string[],
): Promise<void> {
  await tx.cardLabel.deleteMany({ where: { cardId } });
  for (const [position, labelId] of labelIds.entries()) {
    const label = await tx.label.findFirst({
      where: { id: labelId, boardId, deletedAt: null },
      select: { id: true },
    });
    if (label) {
      await tx.cardLabel.create({ data: { cardId, labelId, position } });
    }
  }
}

/**
 * Stamp the card's `updatedAt` and bump its `version` — the bookkeeping every
 * label/checklist command does on the card it edits (the reducer's
 * `cardStamp`, including inverse `cardUpdatedAt`).
 */
async function bumpCard(tx: Tx, card: Card, actorId: string): Promise<void> {
  await tx.card.update({
    where: { id: card.id },
    data: {
      lastActorId: actorId,
      updatedAt: new Date(card.updatedAt),
      version: { increment: 1 },
    },
  });
}

/**
 * Renumber a card's live link rows to the order the reducer holds them in
 * (TASK-46).
 *
 * `position` used to be written as "index of this row in the after-state
 * array", which collides as soon as a removal leaves a gap: remove the row
 * at index 0 and the next add lands on a position an existing row already
 * occupies, so the aggregate's `orderBy: position` no longer reproduces the
 * client's order. Rewriting the whole (short — capped at
 * `LIMITS.linksPerCard`) list keeps the two byte-equal.
 */
async function writeLinkPositions(
  tx: Tx,
  boardId: string,
  card: Card,
): Promise<void> {
  for (const [position, link] of (card.links ?? []).entries()) {
    await tx.cardLink.updateMany({
      where: { id: link.id, boardId },
      data: { position },
    });
  }
}

/**
 * Upsert a checklist and its items, reviving soft-deleted rows on restore.
 *
 * Used by both the RESTORE commands and the create commands: undoing an
 * `ADD_CHECKLIST` is a soft `DELETE_CHECKLIST`, so redoing it must revive
 * the row with the same id instead of inserting a duplicate.
 */
async function upsertChecklist(
  tx: Tx,
  cardId: string,
  checklist: Checklist,
  position: number,
): Promise<void> {
  await tx.checklist.upsert({
    where: { id: checklist.id },
    create: {
      id: checklist.id,
      cardId,
      title: checklist.title,
      position,
      deletedAt: null,
    },
    update: {
      cardId,
      title: checklist.title,
      position,
      deletedAt: null,
      version: { increment: 1 },
    },
  });
  for (const [index, item] of checklist.items.entries()) {
    await upsertChecklistItem(tx, checklist.id, item, index);
  }
}

/** Upsert one checklist item, reviving a soft-deleted row on redo/restore. */
async function upsertChecklistItem(
  tx: Tx,
  checklistId: string,
  item: ChecklistItem,
  position: number,
): Promise<void> {
  await tx.checklistItem.upsert({
    where: { id: item.id },
    create: {
      id: item.id,
      checklistId,
      text: item.text,
      done: item.done,
      position,
      deletedAt: null,
    },
    update: {
      checklistId,
      text: item.text,
      done: item.done,
      position,
      deletedAt: null,
      version: { increment: 1 },
    },
  });
}

/**
 * Insert or revive a column row. Undoing `ADD_COLUMN`/`DUPLICATE_COLUMN` is
 * a soft `DELETE_COLUMN`, so the redo of the original command must clear
 * `deletedAt` on the existing row — a plain `create` would hit the unique
 * id (the 500 the user saw, TASK-30.1 testing, 2026-09-17).
 */
async function upsertColumn(
  tx: Tx,
  boardId: string,
  column: Board["columns"][number],
  position: number,
  at: number,
): Promise<void> {
  await tx.column.upsert({
    where: { id: column.id },
    create: {
      id: column.id,
      boardId,
      title: column.title,
      wipLimit: column.wipLimit ?? null,
      position,
      createdAt: new Date(column.createdAt),
      updatedAt: new Date(at),
    },
    update: {
      title: column.title,
      wipLimit: column.wipLimit ?? null,
      position,
      deletedAt: null,
      updatedAt: new Date(at),
      version: { increment: 1 },
    },
  });
}

/** Insert or revive a label row — the redo of `ADD_LABEL` after an undo. */
async function upsertLabel(
  tx: Tx,
  boardId: string,
  label: Board["labels"][number],
  position: number,
): Promise<void> {
  await tx.label.upsert({
    where: { id: label.id },
    create: {
      id: label.id,
      boardId,
      name: label.name,
      color: label.color,
      position,
    },
    update: {
      name: label.name,
      color: label.color,
      position,
      deletedAt: null,
      version: { increment: 1 },
    },
  });
}

async function writeChecklists(
  tx: Tx,
  cardId: string,
  checklists: Checklist[] | undefined,
): Promise<void> {
  for (const [position, checklist] of (checklists ?? []).entries()) {
    await upsertChecklist(tx, cardId, checklist, position);
  }
}

function touchCards(ids: string[]): string[] {
  return ids.map(touch.card);
}

/**
 * Apply one command's result to the normalized tables and return the
 * `Command.touches` labels (without the board, which the caller adds).
 */
async function writeAction(tx: Tx, ctx: WriteContext): Promise<string[]> {
  const { action, before, after, boardId } = ctx;
  const boardTouch = touch.board(boardId);

  switch (action.type) {
    case "RENAME_BOARD": {
      // `after.title` is already trimmed/clamped by the reducer. The board
      // row's `updatedAt`/`version` are bumped once for every command in
      // `applyCommandWrites`, like the reducer's `commit` stamps the board.
      await tx.board.update({
        where: { id: boardId },
        data: { title: after.title },
      });
      return [boardTouch];
    }

    case "ARCHIVE_BOARD": {
      // The reducer keeps every byte and only sets `archivedAt` = `at`.
      await tx.board.update({
        where: { id: boardId },
        data: { archivedAt: new Date(ctx.at) },
      });
      return [boardTouch];
    }

    case "UNARCHIVE_BOARD": {
      await tx.board.update({
        where: { id: boardId },
        data: { archivedAt: null },
      });
      return [boardTouch];
    }

    case "ADD_COLUMN": {
      const column = columnOf(after, action.newColumnId);
      if (!column) return [boardTouch];
      const position = after.columns.findIndex((c) => c.id === column.id);
      await upsertColumn(tx, boardId, column, position, ctx.at);
      return [boardTouch, touch.column(column.id)];
    }

    case "RENAME_COLUMN": {
      const column = columnOf(after, action.columnId);
      if (!column) return [boardTouch];
      await tx.column.update({
        where: { id: column.id },
        data: {
          title: column.title,
          updatedAt: new Date(ctx.at),
          version: { increment: 1 },
        },
      });
      return [boardTouch, touch.column(column.id)];
    }

    case "DELETE_COLUMN": {
      const now = new Date(ctx.at);
      const activeCards = await tx.card.findMany({
        where: { columnId: action.columnId, archivedAt: null, deletedAt: null },
        select: { id: true },
      });
      const activeIds = activeCards.map((card) => card.id);
      let checklistIds: string[] = [];
      let itemIds: string[] = [];
      if (activeIds.length > 0) {
        const checklists = await tx.checklist.findMany({
          where: { cardId: { in: activeIds }, deletedAt: null },
          select: { id: true },
        });
        checklistIds = checklists.map((checklist) => checklist.id);
        const items = await tx.checklistItem.findMany({
          where: { checklistId: { in: checklistIds }, deletedAt: null },
          select: { id: true },
        });
        itemIds = items.map((item) => item.id);
        await tx.checklistItem.updateMany({
          where: { id: { in: itemIds } },
          data: { deletedAt: now, version: { increment: 1 } },
        });
        await tx.checklist.updateMany({
          where: { id: { in: checklistIds } },
          data: { deletedAt: now, version: { increment: 1 } },
        });
        // Label links are kept (TASK-149): the card row still exists soft-
        // deleted, and the links are what lets a restore rebuild `labelIds`.
        await tx.card.updateMany({
          where: { id: { in: activeIds } },
          data: { deletedAt: now, updatedAt: now, version: { increment: 1 } },
        });
      }
      // Archived cards were never in `column.cardIds`, so the reducer keeps
      // them untouched; in the DB they still reference this column and would
      // block its purge forever. Repoint them at the invisible orphan column
      // (TASK-156).
      const orphanId = await ensureOrphanColumn(tx, boardId, ctx.at);
      // Raw SQL: `Card.updatedAt` is `@updatedAt`, and a Prisma update would
      // stamp the archived card with the wall clock — the reducer keeps it
      // byte-identical (TASK-156).
      await tx.$executeRaw`
        UPDATE "Card"
        SET "columnId" = ${orphanId}
        WHERE "columnId" = ${action.columnId}
          AND "archivedAt" IS NOT NULL
          AND "deletedAt" IS NULL
      `;
      await tx.column.update({
        where: { id: action.columnId },
        data: { deletedAt: now, updatedAt: now, version: { increment: 1 } },
      });
      return [
        boardTouch,
        touch.column(action.columnId),
        ...touchCards(activeIds),
        ...checklistIds.map((id) => touch.checklist(id)),
        ...itemIds.map((id) => touch.checklistItem(id)),
      ];
    }

    case "DUPLICATE_COLUMN": {
      const copy = columnOf(after, action.newColumnId);
      if (!copy) return [boardTouch];
      await upsertColumn(
        tx,
        boardId,
        copy,
        after.columns.findIndex((c) => c.id === copy.id),
        ctx.at,
      );
      for (const [position, column] of after.columns.entries()) {
        if (column.id === copy.id) continue;
        await tx.column.update({
          where: { id: column.id },
          data: { position },
        });
      }
      for (const [position, cardId] of copy.cardIds.entries()) {
        const card = cardOf(after, cardId);
        if (!card) continue;
        await upsertCard(tx, card, copy.id, position, ctx.actorId);
        await writeCardLabels(tx, boardId, card.id, card.labelIds);
      }
      await writeColumnPositions(tx, after.columns);
      return [boardTouch, touch.column(copy.id), ...touchCards(copy.cardIds)];
    }

    case "MOVE_COLUMN": {
      await writeColumnPositions(tx, after.columns);
      return [boardTouch, ...after.columns.map((c) => touch.column(c.id))];
    }

    case "SORT_COLUMN":
    case "SET_COLUMN_CARD_ORDER": {
      // TASK-97: always mirror the aggregate's order — an inverse
      // `SET_COLUMN_CARD_ORDER` may differ from `action.cardIds` (it keeps
      // the remembered order and appends cards added since), and the contract
      // e2e requires `GET /boards/:id` to deep-equal `boardReducer`.
      const cardIds = cardIdsOf(after, action.columnId);
      await writeCardPositions(tx, action.columnId, cardIds);
      return [
        boardTouch,
        touch.column(action.columnId),
        ...touchCards(cardIds),
      ];
    }

    case "SET_COLUMN_WIP_LIMIT": {
      const column = columnOf(after, action.columnId);
      if (!column) return [boardTouch];
      await tx.column.update({
        where: { id: column.id },
        data: {
          wipLimit: column.wipLimit ?? null,
          updatedAt: new Date(ctx.at),
          version: { increment: 1 },
        },
      });
      return [boardTouch, touch.column(column.id)];
    }

    case "ADD_CARD": {
      const card = cardOf(after, action.newCardId);
      if (!card) return [boardTouch];
      const column = after.columns.find((c) => c.cardIds.includes(card.id));
      if (!column) return [boardTouch];
      await upsertCard(
        tx,
        card,
        column.id,
        column.cardIds.indexOf(card.id),
        ctx.actorId,
      );
      await writeCardLabels(tx, boardId, card.id, card.labelIds);
      await writeCardPositions(tx, column.id, column.cardIds);
      return [boardTouch, touch.column(column.id), touch.card(card.id)];
    }

    case "UPDATE_CARD":
    case "SET_CARD_DUE_DATE":
    case "SET_CARD_PRIORITY":
    case "SET_CARD_ASSIGN":
    case "CLAIM_CARD":
    case "SET_CARD_COVER":
    case "ARCHIVE_CARD":
    case "UNARCHIVE_CARD":
    case "MOVE_CARD":
    case "DUPLICATE_CARD": {
      // `action` is narrowed to `CardAction` by the grouped cases above.
      return writeCardAction(tx, { ...ctx, action });
    }

    case "DELETE_CARD": {
      const now = new Date(ctx.at);
      const card = cardOf(before, action.cardId);
      if (!card) return [boardTouch];
      const checklists = await tx.checklist.findMany({
        where: { cardId: card.id, deletedAt: null },
        select: { id: true },
      });
      const checklistIds = checklists.map((c) => c.id);
      const items = await tx.checklistItem.findMany({
        where: { checklistId: { in: checklistIds }, deletedAt: null },
        select: { id: true },
      });
      const itemIds = items.map((item) => item.id);
      await tx.checklistItem.updateMany({
        where: { id: { in: itemIds } },
        data: { deletedAt: now, version: { increment: 1 } },
      });
      await tx.checklist.updateMany({
        where: { id: { in: checklistIds } },
        data: { deletedAt: now, version: { increment: 1 } },
      });
      // Label links are kept (TASK-149) for the same reason as DELETE_COLUMN.
      await tx.card.update({
        where: { id: card.id },
        data: {
          deletedAt: now,
          lastActorId: ctx.actorId,
          updatedAt: now,
          version: { increment: 1 },
        },
      });
      return [
        boardTouch,
        touch.card(card.id),
        ...checklistIds.map((id) => touch.checklist(id)),
        ...itemIds.map((id) => touch.checklistItem(id)),
      ];
    }

    case "TOUCH_CARD": {
      const card = cardOf(after, action.cardId);
      if (!card) return [boardTouch];
      await tx.card.update({
        where: { id: card.id },
        data: {
          lastActorId: ctx.actorId,
          updatedAt: new Date(card.updatedAt),
        },
      });
      return [boardTouch, touch.card(card.id)];
    }

    case "ARCHIVE_COLUMN_CARDS": {
      const ids =
        before.columns.find((c) => c.id === action.columnId)?.cardIds ?? [];
      const archived: string[] = [];
      for (const id of ids) {
        const card = cardOf(after, id);
        if (!card?.archivedAt) continue;
        await tx.card.update({
          where: { id },
          data: {
            archivedAt: new Date(card.archivedAt),
            lastActorId: ctx.actorId,
            updatedAt: new Date(card.updatedAt),
            version: { increment: 1 },
          },
        });
        archived.push(id);
      }
      return [
        boardTouch,
        touch.column(action.columnId),
        ...touchCards(archived),
      ];
    }

    case "RESTORE_CARD": {
      const card = action.card;
      // The reducer only inserts into a column when the command names one
      // that exists; then the aggregate must list the card in that column.
      const column = after.columns.find((c) => c.cardIds.includes(card.id));
      if (column) {
        await upsertCard(
          tx,
          card,
          column.id,
          column.cardIds.indexOf(card.id),
          ctx.actorId,
        );
        await writeCardLabels(tx, boardId, card.id, card.labelIds);
        await writeChecklists(tx, card.id, card.checklists);
        await writeCardPositions(tx, column.id, column.cardIds);
        return [boardTouch, touch.card(card.id), touch.column(column.id)];
      }
      // No target column: the reducer puts the card back only into the
      // `cards` map and changes no `column.cardIds`. Park it in the board's
      // deterministic, soft-deleted orphan column so the aggregate returns
      // it in `cards` and in no column — byte-for-byte the reducer's result.
      const orphanId = await ensureOrphanColumn(tx, boardId, ctx.at);
      await upsertCard(tx, card, orphanId, 0, ctx.actorId);
      await writeCardLabels(tx, boardId, card.id, card.labelIds);
      await writeChecklists(tx, card.id, card.checklists);
      return [boardTouch, touch.card(card.id)];
    }

    case "RESTORE_COLUMN": {
      const column = columnOf(after, action.column.id);
      const position = after.columns.findIndex(
        (c) => c.id === action.column.id,
      );
      await tx.column.upsert({
        where: { id: action.column.id },
        create: {
          id: action.column.id,
          boardId,
          title: action.column.title,
          wipLimit: action.column.wipLimit ?? null,
          position,
          createdAt: new Date(action.column.createdAt),
          updatedAt: new Date(ctx.at),
        },
        update: {
          title: action.column.title,
          wipLimit: action.column.wipLimit ?? null,
          position,
          deletedAt: null,
          updatedAt: new Date(ctx.at),
          version: { increment: 1 },
        },
      });
      await writeColumnPositions(tx, after.columns);
      const touchList = [boardTouch, touch.column(action.column.id)];
      for (const card of action.cards) {
        const cardPosition = column
          ? Math.max(0, column.cardIds.indexOf(card.id))
          : 0;
        await upsertCard(tx, card, action.column.id, cardPosition, ctx.actorId);
        await writeCardLabels(tx, boardId, card.id, card.labelIds);
        await writeChecklists(tx, card.id, card.checklists);
        touchList.push(touch.card(card.id));
      }
      return touchList;
    }

    case "RESTORE_COLUMN_CARDS": {
      const column = columnOf(after, action.columnId);
      if (!column) return [boardTouch];
      const touchList = [boardTouch, touch.column(column.id)];
      for (const card of action.cards) {
        const cardPosition = column.cardIds.indexOf(card.id);
        await upsertCard(
          tx,
          card,
          column.id,
          cardPosition < 0 ? 0 : cardPosition,
          ctx.actorId,
        );
        await writeCardLabels(tx, boardId, card.id, card.labelIds);
        await writeChecklists(tx, card.id, card.checklists);
        touchList.push(touch.card(card.id));
      }
      await writeCardPositions(tx, column.id, column.cardIds);
      return touchList;
    }

    case "SET_CARD_LABEL": {
      const card = cardOf(after, action.cardId);
      if (!card) return [boardTouch];
      await writeCardLabels(tx, boardId, card.id, card.labelIds);
      await bumpCard(tx, card, ctx.actorId);
      return [boardTouch, touch.card(card.id)];
    }

    case "ADD_CARD_LINK": {
      const card = cardOf(after, action.cardId);
      if (!card) return [boardTouch];
      await bumpCard(tx, card, ctx.actorId);
      const links = card.links ?? [];
      if (!links.some((link) => link.id === action.linkId)) {
        return [boardTouch, touch.card(card.id)];
      }
      // Revive-or-create, scoped to this board. An `upsert` on the bare id
      // would let a command name a row that belongs to another board and
      // repoint it (the id guard in `commands.service` refuses that first,
      // but the writer must not be the only thing standing between the two
      // boards). Undo of a remove re-adds the same row id, so the update
      // branch has to clear `deletedAt` rather than insert a duplicate.
      const revived = await tx.cardLink.updateMany({
        where: { id: action.linkId, boardId },
        data: {
          fromCardId: card.id,
          toCardId: action.targetCardId,
          type: action.linkType,
          deletedAt: null,
        },
      });
      if (revived.count === 0) {
        await tx.cardLink.create({
          data: {
            id: action.linkId,
            boardId,
            fromCardId: card.id,
            toCardId: action.targetCardId,
            type: action.linkType,
            deletedAt: null,
          },
        });
      }
      await writeLinkPositions(tx, boardId, card);
      return [boardTouch, touch.card(card.id)];
    }

    case "REMOVE_CARD_LINK": {
      const card = cardOf(after, action.cardId);
      if (!card) return [boardTouch];
      await bumpCard(tx, card, ctx.actorId);
      // Soft delete: the row survives so redo (the re-add) revives it, and
      // `RESTORE_CARD` of the target keeps the aggregate byte-equal to the
      // reducer, which never scrubs a dangling row either. Scoped by board
      // for the same reason the add is.
      await tx.cardLink.updateMany({
        where: { id: action.linkId, boardId, deletedAt: null },
        data: { deletedAt: new Date(ctx.at) },
      });
      await writeLinkPositions(tx, boardId, card);
      return [boardTouch, touch.card(card.id)];
    }

    case "ADD_LABEL": {
      const position = after.labels.findIndex((l) => l.id === action.label.id);
      const label = after.labels[position];
      if (!label) return [boardTouch];
      await upsertLabel(tx, boardId, label, position);
      return [boardTouch, touch.label(label.id)];
    }

    case "RENAME_LABEL":
    case "SET_LABEL_COLOR": {
      const label = after.labels.find((l) => l.id === action.labelId);
      if (!label) return [boardTouch];
      await tx.label.update({
        where: { id: label.id },
        data: {
          name: label.name,
          color: label.color,
          version: { increment: 1 },
        },
      });
      return [boardTouch, touch.label(label.id)];
    }

    case "DELETE_LABEL": {
      // TASK-156: only the links of live/archived cards — exactly the cards
      // in the reducer's state — are removed. Links of soft-deleted cards
      // are kept, the same way DELETE_CARD/DELETE_COLUMN keep them: that
      // card row is the restore record, and hard-deleting its links here
      // would strip the label from a card revived later. The join rows of
      // soft-deleted cards are invisible in the aggregate anyway (the
      // label itself is soft-deleted below).
      const links = await tx.cardLabel.findMany({
        where: { labelId: action.labelId, card: { deletedAt: null } },
        select: { cardId: true },
      });
      await tx.cardLabel.deleteMany({
        where: { labelId: action.labelId, card: { deletedAt: null } },
      });
      await tx.label.update({
        where: { id: action.labelId },
        data: { deletedAt: new Date(ctx.at), version: { increment: 1 } },
      });
      return [
        boardTouch,
        touch.label(action.labelId),
        ...links.map((link) => touch.card(link.cardId)),
      ];
    }

    case "RESTORE_LABEL": {
      const label = action.label;
      const position = after.labels.findIndex((l) => l.id === label.id);
      if (position === -1) return [boardTouch];
      await tx.label.upsert({
        where: { id: label.id },
        create: {
          id: label.id,
          boardId,
          name: label.name,
          color: label.color,
          position,
        },
        update: {
          name: label.name,
          color: label.color,
          position,
          deletedAt: null,
          version: { increment: 1 },
        },
      });
      // Renumber the labels after it (raw SQL: the order is bookkeeping and
      // no other label's version should move).
      for (const [index, entry] of after.labels.entries()) {
        if (entry.id === label.id) continue;
        await tx.$executeRaw`
          UPDATE "Label" SET "position" = ${index} WHERE "id" = ${entry.id}
        `;
      }
      const touched = [touch.label(label.id)];
      for (const { cardId } of action.assignments ?? []) {
        const card = cardOf(after, cardId);
        if (!card || !card.labelIds.includes(label.id)) continue;
        await writeCardLabels(tx, boardId, card.id, card.labelIds);
        touched.push(touch.card(card.id));
      }
      return [boardTouch, ...touched];
    }

    case "ADD_CHECKLIST": {
      const card = cardOf(after, action.cardId);
      const checklists = card?.checklists ?? [];
      const position = checklists.findIndex(
        (c) => c.id === action.newChecklistId,
      );
      const checklist = checklists[position];
      if (!card || !checklist) return [boardTouch];
      await upsertChecklist(tx, card.id, checklist, position);
      await bumpCard(tx, card, ctx.actorId);
      return [boardTouch, touch.card(card.id), touch.checklist(checklist.id)];
    }

    case "RENAME_CHECKLIST": {
      const card = cardOf(after, action.cardId);
      const checklist = card?.checklists?.find(
        (c) => c.id === action.checklistId,
      );
      if (!card || !checklist) return [boardTouch];
      await tx.checklist.update({
        where: { id: checklist.id },
        data: { title: checklist.title, version: { increment: 1 } },
      });
      await bumpCard(tx, card, ctx.actorId);
      return [boardTouch, touch.card(card.id), touch.checklist(checklist.id)];
    }

    case "DELETE_CHECKLIST": {
      const card = cardOf(after, action.cardId);
      if (!card) return [boardTouch];
      const now = new Date(ctx.at);
      // TASK-156 (item 2 remainder): only the checklist's live items are
      // part of this deletion. A previously deleted item must keep its own
      // `deletedAt` — restamping it would shift its retention window (and
      // a later admin restore would resurrect it as part of this op).
      const items = await tx.checklistItem.findMany({
        where: { checklistId: action.checklistId, deletedAt: null },
        select: { id: true },
      });
      await tx.checklistItem.updateMany({
        where: { id: { in: items.map((item) => item.id) } },
        data: { deletedAt: now, version: { increment: 1 } },
      });
      await tx.checklist.update({
        where: { id: action.checklistId },
        data: { deletedAt: now, version: { increment: 1 } },
      });
      await bumpCard(tx, card, ctx.actorId);
      return [
        boardTouch,
        touch.card(card.id),
        touch.checklist(action.checklistId),
        ...items.map((item) => touch.checklistItem(item.id)),
      ];
    }

    case "ADD_CHECKLIST_ITEM": {
      const card = cardOf(after, action.cardId);
      const checklist = card?.checklists?.find(
        (c) => c.id === action.checklistId,
      );
      const position =
        checklist?.items.findIndex((i) => i.id === action.newItemId) ?? -1;
      const item = checklist?.items[position];
      if (!card || !checklist || !item) return [boardTouch];
      await upsertChecklistItem(tx, checklist.id, item, position);
      await bumpCard(tx, card, ctx.actorId);
      return [
        boardTouch,
        touch.card(card.id),
        touch.checklist(checklist.id),
        touch.checklistItem(item.id),
      ];
    }

    case "SET_CHECKLIST_ITEM_DONE":
    case "RENAME_CHECKLIST_ITEM": {
      const card = cardOf(after, action.cardId);
      const checklist = card?.checklists?.find(
        (c) => c.id === action.checklistId,
      );
      const item = checklist?.items.find((i) => i.id === action.itemId);
      if (!card || !checklist || !item) return [boardTouch];
      // Both commands write the item's state as the reducer left it; the
      // unchanged field is written with its current value.
      await tx.checklistItem.update({
        where: { id: item.id },
        data: { text: item.text, done: item.done, version: { increment: 1 } },
      });
      await bumpCard(tx, card, ctx.actorId);
      return [
        boardTouch,
        touch.card(card.id),
        touch.checklist(checklist.id),
        touch.checklistItem(item.id),
      ];
    }

    case "DELETE_CHECKLIST_ITEM": {
      const card = cardOf(after, action.cardId);
      if (!card) return [boardTouch];
      await tx.checklistItem.update({
        where: { id: action.itemId },
        data: { deletedAt: new Date(ctx.at), version: { increment: 1 } },
      });
      await bumpCard(tx, card, ctx.actorId);
      return [
        boardTouch,
        touch.card(card.id),
        touch.checklist(action.checklistId),
        touch.checklistItem(action.itemId),
      ];
    }

    case "RESTORE_CHECKLIST": {
      const card = cardOf(after, action.cardId);
      const position =
        card?.checklists?.findIndex((c) => c.id === action.checklist.id) ?? -1;
      if (!card || position === -1) return [boardTouch];
      await bumpCard(tx, card, ctx.actorId);
      await upsertChecklist(tx, card.id, action.checklist, position);
      // Renumber the card's other live checklists so the restored one is
      // back at its old index (Checklist has no `updatedAt` to disturb).
      for (const [index, checklist] of (card.checklists ?? []).entries()) {
        if (checklist.id === action.checklist.id) continue;
        await tx.checklist.update({
          where: { id: checklist.id },
          data: { position: index },
        });
      }
      return [
        boardTouch,
        touch.card(card.id),
        touch.checklist(action.checklist.id),
      ];
    }

    case "RESTORE_CHECKLIST_ITEM": {
      const card = cardOf(after, action.cardId);
      if (!card) return [boardTouch];
      const checklist = card.checklists?.find(
        (c) => c.id === action.checklistId,
      );
      await tx.card.update({
        where: { id: card.id },
        data: {
          lastActorId: ctx.actorId,
          updatedAt: new Date(card.updatedAt),
          version: { increment: 1 },
        },
      });
      if (checklist) {
        const position =
          card.checklists?.findIndex((c) => c.id === checklist.id) ?? 0;
        await upsertChecklist(tx, card.id, checklist, position);
      }
      return [
        boardTouch,
        touch.card(card.id),
        touch.checklist(action.checklistId),
        touch.checklistItem(action.item.id),
      ];
    }

    default: {
      // TASK-96: only the aggregate-level actions (board create/import/delete)
      // can reach here — the command endpoint never routes them. If a new
      // board-scoped action is added to `BoardAction` and left unhandled
      // above, `action` stops fitting this `Extract` and the build fails,
      // instead of the writer silently mirroring nothing.
      const aggregateOnly: Extract<
        BoardAction,
        {
          type:
            "RESTORE_BOARD" | "IMPORT_BOARDS" | "ADD_BOARD" | "REMOVE_BOARD";
        }
      > = action;
      void aggregateOnly;
      return [boardTouch];
    }
  }
}

/** Card-shaped actions: create/update/archive/move/duplicate. */
async function writeCardAction(
  tx: Tx,
  ctx: WriteContext & { action: CardAction },
): Promise<string[]> {
  const { action, after, boardId, before, actorId } = ctx;
  const boardTouch = touch.board(boardId);
  const cardId = "cardId" in action ? action.cardId : undefined;

  if (action.type === "DUPLICATE_CARD") {
    const copy = cardOf(after, action.newCardId);
    if (!copy) return [boardTouch];
    const column = after.columns.find((c) => c.cardIds.includes(copy.id));
    if (!column) return [boardTouch];
    await upsertCard(
      tx,
      copy,
      column.id,
      column.cardIds.indexOf(copy.id),
      ctx.actorId,
    );
    await writeCardLabels(tx, boardId, copy.id, copy.labelIds);
    await writeCardPositions(tx, column.id, column.cardIds);
    return [boardTouch, touch.column(column.id), touch.card(copy.id)];
  }

  const card = cardId ? cardOf(after, cardId) : undefined;
  if (!card || !cardId) return [boardTouch];

  switch (action.type) {
    case "UPDATE_CARD":
    case "SET_CARD_DUE_DATE":
    case "SET_CARD_PRIORITY":
    case "SET_CARD_ASSIGN":
    case "CLAIM_CARD":
    case "SET_CARD_COVER": {
      await tx.card.update({
        where: { id: card.id },
        data: {
          lastActorId: actorId,
          title: card.title,
          description: card.description ?? null,
          coverType: card.cover?.type ?? null,
          coverValue: card.cover?.value ?? null,
          dueDate: card.dueDate !== undefined ? new Date(card.dueDate) : null,
          priority: card.priority ?? null,
          assigneeId: card.assigneeId ?? null,
          claimedBy: card.claimedBy ?? null,
          leaseUntil:
            card.leaseUntil !== undefined ? new Date(card.leaseUntil) : null,
          updatedAt: new Date(card.updatedAt),
          version: { increment: 1 },
        },
      });
      return [boardTouch, touch.card(card.id)];
    }

    case "ARCHIVE_CARD": {
      const sourceColumn = before.columns.find((c) =>
        c.cardIds.includes(card.id),
      );
      await tx.card.update({
        where: { id: card.id },
        data: {
          archivedAt: card.archivedAt
            ? new Date(card.archivedAt)
            : new Date(ctx.at),
          lastActorId: actorId,
          updatedAt: new Date(card.updatedAt),
          version: { increment: 1 },
        },
      });
      if (sourceColumn) {
        await writeCardPositions(
          tx,
          sourceColumn.id,
          cardIdsOf(after, sourceColumn.id),
        );
      }
      return [boardTouch, touch.card(card.id)];
    }

    case "UNARCHIVE_CARD": {
      const column = after.columns.find((c) => c.cardIds.includes(card.id));
      if (!column) return [boardTouch, touch.card(card.id)];
      await tx.card.update({
        where: { id: card.id },
        data: {
          archivedAt: null,
          columnId: column.id,
          lastActorId: actorId,
          updatedAt: new Date(card.updatedAt),
          version: { increment: 1 },
        },
      });
      await writeCardPositions(tx, column.id, column.cardIds);
      return [boardTouch, touch.column(column.id), touch.card(card.id)];
    }

    case "MOVE_CARD": {
      const column = after.columns.find((c) => c.cardIds.includes(card.id));
      const toColumnId = column?.id ?? action.toColumnId;
      await tx.card.update({
        where: { id: card.id },
        data: {
          columnId: toColumnId,
          lastActorId: actorId,
          updatedAt: new Date(card.updatedAt),
          version: { increment: 1 },
        },
      });
      await writeCardPositions(
        tx,
        action.fromColumnId,
        cardIdsOf(after, action.fromColumnId),
      );
      if (action.toColumnId !== action.fromColumnId) {
        await writeCardPositions(
          tx,
          action.toColumnId,
          cardIdsOf(after, action.toColumnId),
        );
      }
      return [
        boardTouch,
        touch.column(action.fromColumnId),
        touch.column(action.toColumnId),
        touch.card(card.id),
      ];
    }

    default: {
      // TASK-96: every action routed to `writeCardAction` is handled above;
      // a new card-shaped command makes this fail to compile.
      const exhaustive: never = action;
      void exhaustive;
      return [boardTouch];
    }
  }
}

/**
 * Deterministic id of a board's orphan column. Derived from the board id so
 * replaying a restore writes the same row twice — no `randomUUID()`.
 */
function orphanColumnId(boardId: string): string {
  return `orphan:${boardId}`;
}

/**
 * The soft-deleted column that holds revived cards the reducer did not place
 * into any column. It never appears in the aggregate (`deletedAt` is set),
 * but gives such a card a valid `Card.columnId`. The `orphan:` id prefix
 * marks it as internal — any future UI that lists deleted columns must
 * filter it out.
 */
async function ensureOrphanColumn(
  tx: Tx,
  boardId: string,
  at: number,
): Promise<string> {
  const id = orphanColumnId(boardId);
  const deletedAt = new Date(at);
  await tx.column.upsert({
    where: { id },
    create: {
      id,
      boardId,
      title: "Orphaned cards",
      position: 0,
      deletedAt,
      createdAt: deletedAt,
      updatedAt: deletedAt,
    },
    update: { deletedAt },
  });
  return id;
}

/** Persist a command's result, bumping the board once. */
export async function applyCommandWrites(
  tx: Tx,
  ctx: WriteContext,
): Promise<string[]> {
  const touches = await writeAction(tx, ctx);
  await tx.board.update({
    where: { id: ctx.boardId },
    data: {
      updatedAt: new Date(ctx.after.updatedAt),
      version: { increment: 1 },
    },
  });
  return [...new Set([touch.board(ctx.boardId), ...touches])];
}

/** Read back the version of every touched entity for the `200` response. */
export async function collectVersions(
  tx: Tx,
  boardId: string,
  touches: string[],
): Promise<Record<string, number>> {
  const versions: Record<string, number> = {};
  const idsFor = (prefix: string) =>
    touches
      .filter((label) => label.startsWith(`${prefix}:`))
      .map((label) => label.slice(prefix.length + 1));

  const board = await tx.board.findUnique({
    where: { id: boardId },
    select: { version: true },
  });
  if (board) versions[touch.board(boardId)] = board.version;

  const groups: {
    prefix: string;
    load: (ids: string[]) => Promise<{ id: string; version: number }[]>;
  }[] = [
    {
      prefix: "column",
      load: (ids) =>
        tx.column.findMany({
          where: { id: { in: ids } },
          select: { id: true, version: true },
        }),
    },
    {
      prefix: "card",
      load: (ids) =>
        tx.card.findMany({
          where: { id: { in: ids } },
          select: { id: true, version: true },
        }),
    },
    {
      prefix: "label",
      load: (ids) =>
        tx.label.findMany({
          where: { id: { in: ids } },
          select: { id: true, version: true },
        }),
    },
    {
      prefix: "checklist",
      load: (ids) =>
        tx.checklist.findMany({
          where: { id: { in: ids } },
          select: { id: true, version: true },
        }),
    },
    {
      prefix: "checklistItem",
      load: (ids) =>
        tx.checklistItem.findMany({
          where: { id: { in: ids } },
          select: { id: true, version: true },
        }),
    },
  ];

  for (const group of groups) {
    const ids = idsFor(group.prefix);
    if (ids.length === 0) continue;
    const rows = await group.load(ids);
    for (const row of rows) {
      versions[`${group.prefix}:${row.id}`] = row.version;
    }
  }

  return versions;
}
