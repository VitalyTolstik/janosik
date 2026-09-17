import type { Board, Card, Label } from "@janosik/shared";

/**
 * Which entities a freshly fetched aggregate disagrees with (TASK-29).
 *
 * The focus refetch replaces the local board with the server's copy; before
 * that, the ids of everything the server has moved on from are collected so
 * the undo history can mark its steps dead (§7.0: undoing a rename someone
 * else has since changed would clobber their text). Comparison is deep per
 * entity (JSON), not per field: a single mismatch is enough to make the
 * entity foreign, and the undo step records ids, not fields.
 */

/** Key-order-insensitive JSON, so "same data, different literal order" is equal. */
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

/** Snapshot equality for entities that may be missing on either side. */
function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

/**
 * The card stripped of client-only state. Server aggregates never carry the
 * activity feed — the backend derives card events from the command log
 * (§7.4) — while the local card gains `activity` on every dispatched action.
 * Diffing it would mark every touched card "foreign" on each focus refetch
 * and kill the user's own undo steps (found live, 2026-09-17: undo/redo
 * vanished after switching windows even though nobody else had edited).
 */
function comparableCard(card: Card): Omit<Card, "activity"> {
  const { activity: _activity, ...rest } = card;
  return rest;
}

function changedColumns(local: Board, server: Board): string[] {
  const ids: string[] = [];
  const byId = new Map(server.columns.map((column) => [column.id, column]));
  for (const column of local.columns) {
    const fresh = byId.get(column.id);
    if (fresh === undefined || !same(column, fresh)) ids.push(column.id);
    byId.delete(column.id);
  }
  // Columns the server added are foreign too (their id is new to us).
  for (const id of byId.keys()) ids.push(id);
  return ids;
}

function changedCards(local: Board, server: Board): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const [id, card] of Object.entries(local.cards)) {
    seen.add(id);
    const fresh: Card | undefined = server.cards[id];
    if (
      fresh === undefined ||
      !same(comparableCard(card), comparableCard(fresh))
    ) {
      ids.push(id);
    }
  }
  for (const id of Object.keys(server.cards)) {
    if (!seen.has(id)) ids.push(id);
  }
  return ids;
}

function changedLabels(local: Board, server: Board): string[] {
  const ids: string[] = [];
  const byId = new Map(server.labels.map((label) => [label.id, label]));
  for (const label of local.labels) {
    const fresh: Label | undefined = byId.get(label.id);
    if (fresh === undefined || !same(label, fresh)) ids.push(label.id);
    byId.delete(label.id);
  }
  for (const id of byId.keys()) ids.push(id);
  return ids;
}

/** Plain ids (cards, columns, labels, or the board itself) that differ. */
export function changedEntityIds(local: Board, server: Board): string[] {
  const ids = [
    ...changedColumns(local, server),
    ...changedCards(local, server),
    ...changedLabels(local, server),
  ];
  if (local.title !== server.title || local.archivedAt !== server.archivedAt) {
    ids.push(local.id);
  }
  return ids;
}
