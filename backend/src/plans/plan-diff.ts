import type { Board, PlanChangeDto } from "@janosik/shared";

/**
 * TASK-166.8: net diff between two board aggregates.
 *
 * The plan preview replays the same `boardReducer` the apply would run and
 * hands the resulting aggregate here. Only entities that actually differ are
 * emitted: a create/delete carries the full entity, an update carries the
 * changed top-level fields only, so a 50-card plan stays readable instead of
 * echoing the whole board twice. Board-level bookkeeping (`updatedAt`, the
 * agent policy, pause state) is not intent and is excluded.
 */

type JsonRecord = Record<string, unknown>;

/** Deterministic JSON for equality checks (object keys sorted). */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(entry).sort()) {
        sorted[key] = (entry as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return entry;
  });
}

function asRecord(value: object): JsonRecord {
  return value as unknown as JsonRecord;
}

/** Copy only the named fields that the source actually has. */
function pick(source: JsonRecord, fields: string[]): JsonRecord {
  const out: JsonRecord = {};
  for (const field of fields) {
    if (field in source) out[field] = source[field];
  }
  return out;
}

function changedFields(before: JsonRecord, after: JsonRecord): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => stable(before[key]) !== stable(after[key]))
    .sort();
}

function diffEntities<T extends { id: string }>(
  before: T[],
  after: T[],
  prefix: string,
  out: PlanChangeDto[],
): void {
  const beforeById = new Map(before.map((entry) => [entry.id, entry]));
  const afterById = new Map(after.map((entry) => [entry.id, entry]));
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
  for (const id of ids) {
    const previous = beforeById.get(id);
    const next = afterById.get(id);
    const touch = `${prefix}:${id}`;
    if (previous === undefined && next !== undefined) {
      out.push({ touch, kind: "create", before: null, after: asRecord(next) });
      continue;
    }
    if (previous !== undefined && next === undefined) {
      out.push({
        touch,
        kind: "delete",
        before: asRecord(previous),
        after: null,
      });
      continue;
    }
    if (previous === undefined || next === undefined) continue;
    const beforeRecord = asRecord(previous);
    const afterRecord = asRecord(next);
    if (stable(beforeRecord) === stable(afterRecord)) continue;
    const fields = changedFields(beforeRecord, afterRecord);
    out.push({
      touch,
      kind: "update",
      before: pick(beforeRecord, fields),
      after: pick(afterRecord, fields),
      fields,
    });
  }
}

/** Board fields the reducer can change and a human cares about. */
function boardFieldsOf(board: Board): JsonRecord {
  return {
    title: board.title,
    ...(board.columnStyle !== undefined
      ? { columnStyle: board.columnStyle }
      : {}),
    ...(board.workflow !== undefined ? { workflow: board.workflow } : {}),
    ...(board.archivedAt !== undefined ? { archivedAt: board.archivedAt } : {}),
  };
}

/** The net change from `before` to `after`, grouped by `touch` label. */
export function diffBoards(before: Board, after: Board): PlanChangeDto[] {
  const changes: PlanChangeDto[] = [];

  const beforeBoard = boardFieldsOf(before);
  const afterBoard = boardFieldsOf(after);
  const boardFields = changedFields(beforeBoard, afterBoard);
  if (boardFields.length > 0) {
    changes.push({
      touch: `board:${before.id}`,
      kind: "update",
      before: pick(beforeBoard, boardFields),
      after: pick(afterBoard, boardFields),
      fields: boardFields,
    });
  }

  diffEntities(before.columns, after.columns, "column", changes);
  diffEntities(
    Object.values(before.cards),
    Object.values(after.cards),
    "card",
    changes,
  );
  diffEntities(before.labels, after.labels, "label", changes);

  return changes.sort((a, b) => a.touch.localeCompare(b.touch));
}

/** True when two aggregates serialize identically (the reducer no-op check). */
export function boardsEqual(before: Board, after: Board): boolean {
  return stable(before) === stable(after);
}
