import type { BoardAction } from "@janosik/shared";

/**
 * Client-supplied entity ids carried by a command action (TASK-30.2).
 *
 * The writers upsert by global id, so an id that already exists on another
 * board would silently rewrite that board's row (rename it, move it, or
 * re-parent a checklist). Every id a command can name — including the
 * nested ids of `RESTORE_*` snapshots, which are upserted too — is
 * collected here; the caller checks them against the entity tables before
 * applying the command. References to ids that exist nowhere keep their
 * reducer semantics (no-op), and ids that belong to the target board pass.
 */

/**
 * Direct id fields of the flat action shapes.
 *
 * Keep this list in step with every id a command can name. An id that is
 * missing here is simply not checked, and the writer that upserts on it
 * becomes a cross-board write primitive — which is exactly what happened
 * to `linkId` between TASK-30.2 and TASK-46.
 */
const DIRECT_KEYS = [
  "cardId",
  "newCardId",
  "columnId",
  "newColumnId",
  "toColumnId",
  "fromColumnId",
  "labelId",
  "checklistId",
  "newChecklistId",
  "itemId",
  "newItemId",
  // Card links (TASK-46): `ADD_CARD_LINK` upserts the row by this id.
  "linkId",
] as const;

/** Array id fields: bulk orders, duplicate ids and fresh activity ids. */
const ARRAY_KEYS = ["newCardIds", "cardIds", "activityIds"] as const;

export function referencedEntityIds(action: BoardAction): string[] {
  const record = action as unknown as Record<string, unknown>;
  const ids = new Set<string>();

  for (const key of DIRECT_KEYS) {
    const value = record[key];
    if (typeof value === "string") ids.add(value);
  }
  for (const key of ARRAY_KEYS) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry === "string") ids.add(entry);
    }
  }

  collectSnapshot(record.card, ids);
  collectSnapshot(record.column, ids);
  collectSnapshot(record.label, ids);
  collectSnapshot(record.checklist, ids);
  collectSnapshot(record.item, ids);
  if (Array.isArray(record.cards)) {
    for (const card of record.cards) collectSnapshot(card, ids);
  }
  if (Array.isArray(record.assignments)) {
    for (const assignment of record.assignments) {
      if (typeof assignment !== "object" || assignment === null) continue;
      const entry = assignment as Record<string, unknown>;
      if (typeof entry.cardId === "string") ids.add(entry.cardId);
      if (typeof entry.labelId === "string") ids.add(entry.labelId);
    }
  }

  return [...ids];
}

/** Ids of one restore snapshot: the entity itself plus everything nested. */
function collectSnapshot(value: unknown, ids: Set<string>): void {
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string") ids.add(record.id);
  if (Array.isArray(record.cardIds)) {
    for (const id of record.cardIds) {
      if (typeof id === "string") ids.add(id);
    }
  }
  if (Array.isArray(record.labelIds)) {
    for (const id of record.labelIds) {
      if (typeof id === "string") ids.add(id);
    }
  }
  if (Array.isArray(record.checklists)) {
    for (const checklist of record.checklists) collectSnapshot(checklist, ids);
  }
  if (Array.isArray(record.items)) {
    for (const item of record.items) collectSnapshot(item, ids);
  }
}
