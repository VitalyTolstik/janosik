import type { Prisma } from "@prisma/client";
import type {
  Board,
  BoardAction,
  Card,
  Checklist,
  ChecklistItem,
} from "@janosik/shared";
import { invert } from "@janosik/shared";
import { jsonSafe } from "./command-validation";

/**
 * TASK-166.7 run pre-images (ADR §11.3).
 *
 * Every command that belongs to an `AgentRun` stores a `CommandPreimage`:
 * the full state of every entity it writes *before* the command, the version
 * before/after, and the inverse action the rollback replays. The inverse is
 * computed at apply time from the same `boardReducer` state the writers see,
 * so a later revert does not have to reconstruct an aggregate from partial
 * rows. The snapshots still let a board ADMIN inspect the diff and let the
 * conflict check compare the run's post-state with the current rows.
 */

type Tx = Prisma.TransactionClient;

/** Entity kinds a pre-image can describe. */
type EntityKind =
  "board" | "column" | "card" | "label" | "checklist" | "checklistItem";

export interface PreimageEntity {
  /** `Command.touches` label (`card:<id>`, …). */
  touch: string;
  id: string;
  exists: boolean;
  /** Row version before the command (0 for a created entity). */
  version: number;
  /** Full entity state before the command; null when it did not exist. */
  snapshot: unknown;
  /** Row version after the command applied; null when it no longer exists. */
  postVersion: number | null;
  /** Soft-delete stamp after the command (Unix ms), when it was deleted. */
  postDeletedAt: number | null;
}

export interface PreimageData {
  schemaVersion: 1;
  /** `Board.version` before the command. */
  boardVersion: number;
  entities: PreimageEntity[];
  /** Inverse action replayed by rollback (internal; omitted when absent). */
  inverse?: BoardAction | null;
}

/** Before-state captured ahead of the writers; finalized after they ran. */
export interface PreimageSeed {
  boardVersion: number;
  entities: Map<string, PreimageEntity>;
}

interface CandidateIds {
  board: Set<string>;
  column: Set<string>;
  card: Set<string>;
  label: Set<string>;
  checklist: Set<string>;
  checklistItem: Set<string>;
}

const BOARD_LEVEL_ACTIONS = new Set<string>([
  "RENAME_BOARD",
  "SET_BOARD_COLUMN_STYLE",
  "SET_BOARD_WORKFLOW",
  "ARCHIVE_BOARD",
  "UNARCHIVE_BOARD",
]);

/** Whether the action mutates a board-level field (not just its seq/version). */
export function isBoardLevelAction(action: BoardAction): boolean {
  return BOARD_LEVEL_ACTIONS.has(action.type);
}

/** Inverse of a board bookmark action, which `invert` deliberately omits. */
function boardBookkeepingInverse(
  before: Board,
  action: BoardAction,
): BoardAction | null {
  const head = {
    boardId: before.id,
    at: "at" in action ? action.at : before.updatedAt,
    boardUpdatedAt: before.updatedAt,
    inverse: true,
  };
  if (action.type === "ARCHIVE_BOARD") {
    return { ...head, type: "UNARCHIVE_BOARD" } as BoardAction;
  }
  if (action.type === "UNARCHIVE_BOARD") {
    return {
      ...head,
      // ARCHIVE_BOARD stamps `archivedAt` from its own clock.
      at: before.archivedAt ?? head.at,
      type: "ARCHIVE_BOARD",
    } as BoardAction;
  }
  return null;
}

/** The exact compensating command for one run member. */
export function inverseOf(
  before: Board,
  action: BoardAction,
): BoardAction | null {
  return invert(before, action) ?? boardBookkeepingInverse(before, action);
}

function add(
  ids: CandidateIds,
  kind: EntityKind,
  id: string | undefined,
): void {
  if (typeof id !== "string" || id === "") return;
  ids[kind].add(id);
}

/**
 * Which entities could this command write? The set is deliberately a little
 * broad for the destructive actions (the writer touches nested children), but
 * it never expands a rename into a column's whole card list.
 */
function candidateIds(before: Board, action: BoardAction): CandidateIds {
  const ids: CandidateIds = {
    board: new Set([before.id]),
    column: new Set(),
    card: new Set(),
    label: new Set(),
    checklist: new Set(),
    checklistItem: new Set(),
  };
  const record = action as unknown as Record<string, unknown>;

  add(ids, "card", record.cardId as string | undefined);
  add(ids, "card", record.newCardId as string | undefined);
  add(ids, "column", record.columnId as string | undefined);
  add(ids, "column", record.newColumnId as string | undefined);
  add(ids, "column", record.fromColumnId as string | undefined);
  add(ids, "column", record.toColumnId as string | undefined);
  add(ids, "label", record.labelId as string | undefined);
  add(ids, "checklist", record.checklistId as string | undefined);
  add(ids, "checklist", record.newChecklistId as string | undefined);
  add(ids, "checklistItem", record.itemId as string | undefined);
  add(ids, "checklistItem", record.newItemId as string | undefined);

  if (Array.isArray(record.newCardIds)) {
    for (const id of record.newCardIds) add(ids, "card", id as string);
  }
  if (Array.isArray(record.cardIds)) {
    for (const id of record.cardIds) add(ids, "card", id as string);
  }

  const snapshot = (value: unknown, kind: EntityKind): void => {
    if (typeof value !== "object" || value === null) return;
    add(ids, kind, (value as { id?: string }).id);
  };
  snapshot(record.card, "card");
  snapshot(record.column, "column");
  snapshot(record.label, "label");
  snapshot(record.checklist, "checklist");
  snapshot(record.item, "checklistItem");
  if (Array.isArray(record.cards)) {
    for (const card of record.cards) snapshot(card, "card");
  }
  if (Array.isArray(record.assignments)) {
    for (const assignment of record.assignments) {
      if (typeof assignment !== "object" || assignment === null) continue;
      add(ids, "card", (assignment as { cardId?: string }).cardId);
      add(ids, "label", (assignment as { labelId?: string }).labelId);
    }
  }

  // Destructive writers touch nested rows as well.
  switch (action.type) {
    case "DELETE_CARD": {
      const card = before.cards[action.cardId];
      for (const checklist of card?.checklists ?? []) {
        add(ids, "checklist", checklist.id);
        for (const item of checklist.items) add(ids, "checklistItem", item.id);
      }
      break;
    }
    case "DELETE_COLUMN": {
      const column = before.columns.find(
        (entry) => entry.id === action.columnId,
      );
      for (const cardId of column?.cardIds ?? []) {
        add(ids, "card", cardId);
        const card = before.cards[cardId];
        for (const checklist of card?.checklists ?? []) {
          add(ids, "checklist", checklist.id);
          for (const item of checklist.items)
            add(ids, "checklistItem", item.id);
        }
      }
      break;
    }
    case "ARCHIVE_COLUMN_CARDS": {
      const column = before.columns.find(
        (entry) => entry.id === action.columnId,
      );
      for (const cardId of column?.cardIds ?? []) add(ids, "card", cardId);
      break;
    }
    case "DELETE_LABEL": {
      for (const card of Object.values(before.cards)) {
        if (card.labelIds.includes(action.labelId)) add(ids, "card", card.id);
      }
      break;
    }
    case "DELETE_CHECKLIST": {
      const card = before.cards[action.cardId];
      const checklist = card?.checklists?.find(
        (entry) => entry.id === action.checklistId,
      );
      for (const item of checklist?.items ?? [])
        add(ids, "checklistItem", item.id);
      break;
    }
    case "DELETE_CHECKLIST_ITEM": {
      add(ids, "checklist", action.checklistId);
      break;
    }
    default:
      break;
  }

  return ids;
}

function boardSnapshot(before: Board): Record<string, unknown> {
  return {
    id: before.id,
    title: before.title,
    ...(before.columnStyle !== undefined
      ? { columnStyle: before.columnStyle }
      : {}),
    ...(before.workflow !== undefined ? { workflow: before.workflow } : {}),
    ...(before.archivedAt !== undefined
      ? { archivedAt: before.archivedAt }
      : {}),
    updatedAt: before.updatedAt,
  };
}

function findChecklist(
  before: Board,
  checklistId: string,
): { checklist: Checklist; card: Card } | null {
  for (const card of Object.values(before.cards)) {
    const checklist = card.checklists?.find(
      (entry) => entry.id === checklistId,
    );
    if (checklist) return { checklist, card };
  }
  return null;
}

function findChecklistItem(
  before: Board,
  itemId: string,
): ChecklistItem | null {
  for (const card of Object.values(before.cards)) {
    for (const checklist of card.checklists ?? []) {
      const item = checklist.items.find((entry) => entry.id === itemId);
      if (item) return item;
    }
  }
  return null;
}

function snapshotOf(
  before: Board,
  kind: EntityKind,
  id: string,
): unknown | null {
  switch (kind) {
    case "board":
      return boardSnapshot(before);
    case "column": {
      const column = before.columns.find((entry) => entry.id === id);
      if (!column) return null;
      return {
        id: column.id,
        title: column.title,
        cardIds: column.cardIds,
        ...(column.wipLimit !== undefined ? { wipLimit: column.wipLimit } : {}),
        ...(column.accent !== undefined ? { accent: column.accent } : {}),
        createdAt: column.createdAt,
      };
    }
    case "card":
      return before.cards[id] ?? null;
    case "label": {
      const label = before.labels.find((entry) => entry.id === id);
      return label ?? null;
    }
    case "checklist":
      return findChecklist(before, id)?.checklist ?? null;
    case "checklistItem":
      return findChecklistItem(before, id);
  }
}

/** Load the row versions the pre-image compares against. */
async function loadRows(
  tx: Tx,
  ids: CandidateIds,
): Promise<Map<string, { version: number; deletedAt: Date | null }>> {
  const rows = new Map<string, { version: number; deletedAt: Date | null }>();
  const put = (
    prefix: string,
    values: { id: string; version: number; deletedAt?: Date | null }[],
  ) => {
    for (const row of values) {
      rows.set(`${prefix}:${row.id}`, {
        version: row.version,
        deletedAt: row.deletedAt ?? null,
      });
    }
  };

  const [boards, columns, cards, labels, checklists, items] = await Promise.all(
    [
      ids.board.size === 0
        ? Promise.resolve([])
        : tx.board.findMany({
            where: { id: { in: [...ids.board] } },
            select: { id: true, version: true, deletedAt: true },
          }),
      ids.column.size === 0
        ? Promise.resolve([])
        : tx.column.findMany({
            where: { id: { in: [...ids.column] } },
            select: { id: true, version: true, deletedAt: true },
          }),
      ids.card.size === 0
        ? Promise.resolve([])
        : tx.card.findMany({
            where: { id: { in: [...ids.card] } },
            select: { id: true, version: true, deletedAt: true },
          }),
      ids.label.size === 0
        ? Promise.resolve([])
        : tx.label.findMany({
            where: { id: { in: [...ids.label] } },
            select: { id: true, version: true, deletedAt: true },
          }),
      ids.checklist.size === 0
        ? Promise.resolve([])
        : tx.checklist.findMany({
            where: { id: { in: [...ids.checklist] } },
            select: { id: true, version: true, deletedAt: true },
          }),
      ids.checklistItem.size === 0
        ? Promise.resolve([])
        : tx.checklistItem.findMany({
            where: { id: { in: [...ids.checklistItem] } },
            select: { id: true, version: true, deletedAt: true },
          }),
    ],
  );

  put("board", boards);
  put("column", columns);
  put("card", cards);
  put("label", labels);
  put("checklist", checklists);
  put("checklistItem", items);
  return rows;
}

/** Capture every candidate entity's before-state, before the writer runs. */
export async function capturePreimage(
  tx: Tx,
  params: { before: Board; action: BoardAction },
): Promise<PreimageSeed> {
  const { before, action } = params;
  const ids = candidateIds(before, action);
  const rows = await loadRows(tx, ids);
  const boardVersion = rows.get(`board:${before.id}`)?.version ?? 0;
  const entities = new Map<string, PreimageEntity>();

  const kinds: EntityKind[] = [
    "board",
    "column",
    "card",
    "label",
    "checklist",
    "checklistItem",
  ];
  for (const kind of kinds) {
    for (const id of ids[kind]) {
      const row = rows.get(`${kind}:${id}`);
      entities.set(`${kind}:${id}`, {
        touch: `${kind}:${id}`,
        id,
        exists: row !== undefined,
        version: row?.version ?? 0,
        snapshot: snapshotOf(before, kind, id),
        postVersion: null,
        postDeletedAt: null,
      });
    }
  }

  return { boardVersion, entities };
}

/**
 * Keep the entities the command actually wrote and record their post-state.
 * A touch the seed does not know about (a created entity the writer found) is
 * added as `exists: false`, which is what rollback needs to delete it.
 */
export async function finalizePreimage(
  tx: Tx,
  params: {
    seed: PreimageSeed;
    touches: string[];
    inverse: BoardAction | null;
  },
): Promise<PreimageData> {
  const { seed, touches, inverse } = params;
  const ids: CandidateIds = {
    board: new Set(),
    column: new Set(),
    card: new Set(),
    label: new Set(),
    checklist: new Set(),
    checklistItem: new Set(),
  };
  const wanted = new Set(touches);
  for (const label of touches) {
    const [kind, id] = label.split(":");
    if (id === undefined) continue;
    if (
      kind === "board" ||
      kind === "column" ||
      kind === "card" ||
      kind === "label" ||
      kind === "checklist" ||
      kind === "checklistItem"
    ) {
      ids[kind].add(id);
      const seeded = seed.entities.get(label);
      if (seeded === undefined) {
        seed.entities.set(label, {
          touch: label,
          id,
          exists: false,
          version: 0,
          snapshot: null,
          postVersion: null,
          postDeletedAt: null,
        });
      }
    }
  }

  const rows = await loadRows(tx, ids);
  const entities: PreimageEntity[] = [];
  for (const [label, entity] of seed.entities) {
    if (!wanted.has(label)) continue;
    const row = rows.get(`${label.split(":")[0]}:${entity.id}`);
    entities.push({
      ...entity,
      postVersion: row?.version ?? null,
      postDeletedAt: row?.deletedAt ? row.deletedAt.getTime() : null,
    });
  }

  return {
    schemaVersion: 1,
    boardVersion: seed.boardVersion,
    entities,
    inverse,
  };
}

/** Write the pre-image row; `data` is JSON-safe at this boundary. */
export async function writePreimage(
  tx: Tx,
  params: {
    commandId: string;
    boardId: string;
    runId: string;
    data: PreimageData;
  },
): Promise<void> {
  await tx.commandPreimage.create({
    data: {
      commandId: params.commandId,
      boardId: params.boardId,
      runId: params.runId,
      data: jsonSafe(params.data) as Prisma.InputJsonValue,
    },
  });
}

/** Read a stored pre-image as the typed shape (defensive at the JSON edge). */
export function readPreimageData(value: unknown): PreimageData | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !Array.isArray(record.entities)) {
    return null;
  }
  return value as PreimageData;
}
