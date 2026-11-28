import type { Board, Epic, EpicProgress } from "./types/kanban";
import { LIMITS } from "./types/kanban";
import { clampText } from "./utils/text";
import { workflowDoneColumnIds } from "./workflow";

export const MAX_EPIC_POSITION = 2_147_483_647;

export function epicOf(
  board: Pick<Board, "epics">,
  id: string | null | undefined,
): Epic | undefined {
  return board.epics?.find((epic) => epic.id === id);
}

export function compareEpics(a: Epic, b: Epic): number {
  return (
    a.position - b.position ||
    a.createdAt - b.createdAt ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function epicDate(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= 8.64e15
    ? Math.trunc(value)
    : undefined;
}

export function normalizeEpic(value: unknown, index: number): Epic | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Partial<Epic>;
  const id = raw.id;
  if (
    typeof id !== "string" ||
    !id.trim() ||
    id === "__proto__" ||
    id.length > 128
  ) {
    return undefined;
  }
  const title =
    typeof raw.title === "string"
      ? clampText(raw.title.trim(), LIMITS.epicTitle)
      : "";
  const createdAt = epicDate(raw.createdAt);
  const updatedAt = epicDate(raw.updatedAt);
  if (!title || createdAt === undefined || updatedAt === undefined)
    return undefined;
  const status = raw.status === "completed" ? "completed" : "active";
  const epic: Epic = {
    id,
    title,
    color: "rose",
    status,
    position:
      typeof raw.position === "number" && Number.isFinite(raw.position)
        ? Math.max(0, Math.min(MAX_EPIC_POSITION, Math.trunc(raw.position)))
        : index,
    createdAt,
    updatedAt,
  };
  if (typeof raw.description === "string") {
    epic.description = clampText(raw.description, LIMITS.epicDescription);
  }
  if (
    typeof raw.ownerId === "string" &&
    raw.ownerId.trim() &&
    raw.ownerId.length <= 128 &&
    raw.ownerId !== "__proto__"
  ) {
    epic.ownerId = raw.ownerId;
  }
  const startDate = epicDate(raw.startDate);
  const dueDate = epicDate(raw.dueDate);
  const completedAt = epicDate(raw.completedAt);
  if (startDate !== undefined) epic.startDate = startDate;
  if (dueDate !== undefined) epic.dueDate = dueDate;
  if (status === "completed" && completedAt !== undefined)
    epic.completedAt = completedAt;
  return epic;
}

/** Roll up a stream of active card placements in one pass. */
export function countEpicProgress(
  board: Pick<Board, "workflow"> & { columns: readonly { id: string }[] },
  epicIds: readonly string[],
  placements: Iterable<{ columnId: string; epicId?: string | null }>,
): Map<string, EpicProgress> {
  const progress = new Map(
    epicIds.map((id) => [id, { total: 0, done: 0, open: 0 }]),
  );
  if (progress.size === 0) return progress;
  const doneColumns = new Set(workflowDoneColumnIds(board));
  for (const { columnId, epicId } of placements) {
    if (epicId == null) continue;
    const count = progress.get(epicId);
    if (!count) continue;
    count.total++;
    if (doneColumns.has(columnId)) count.done++;
    else count.open++;
  }
  return progress;
}

/** Column card ids are the live placements on a local/full board. */
export function boardEpicProgress(board: Board): Map<string, EpicProgress> {
  function* placements() {
    for (const column of board.columns) {
      for (const id of column.cardIds) {
        const card = Object.hasOwn(board.cards, id)
          ? board.cards[id]
          : undefined;
        if (card?.epicId !== undefined && card.archivedAt === undefined) {
          yield { columnId: column.id, epicId: card.epicId };
        }
      }
    }
  }
  return countEpicProgress(
    board,
    (board.epics ?? []).map(({ id }) => id),
    placements(),
  );
}
