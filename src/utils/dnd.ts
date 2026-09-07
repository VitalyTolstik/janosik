/**
 * Pure logic for a CARD hover during a CROSS-COLUMN drag, operating on the
 * draft map of column → ordered card ids. Used by DndBoard.handleDragOver.
 *
 * Same-column hovers deliberately return null: within a column the sortable
 * strategy animates the gap itself and the FINAL position is decided on
 * drop (arrayMove into the over card's slot) — reordering the draft here
 * re-mounts the DOM mid-drag and makes droppable rects stale.
 *
 * Invariant: a card id can never appear twice in the map. The active card is
 * always removed from its source column first, so the invariant holds by
 * construction even when it is re-inserted into the target.
 *
 * `insertAfter` decides whether the active card lands before or after the
 * hovered card (computed by the caller from the drag pointer: past the
 * hovered card's midpoint → after). This matters at the very end of a column:
 * hovering the last card with the pointer below it must place the card LAST,
 * not second-to-last. Hovering a column body always appends.
 *
 * @returns a new map with the card moved, or null when the input is invalid
 *          or the hover would not change anything.
 */
export function applyCardOver(
 columns: Record<string, string[]>,
 activeId: string,
 overId: string,
 insertAfter = false,
): Record<string, string[]> | null {
 const columnOf = (cardId: string) =>
  Object.keys(columns).find((colId) => columns[colId].includes(cardId));

 const fromColId = columnOf(activeId);
 if (!fromColId) return null;
 const toColId = overId in columns ? overId : columnOf(overId);
 if (!toColId) return null;

 // Same-column reorders are the sortable strategy's job (no-op here).
 if (fromColId === toColId) return null;

 const from = [...columns[fromColId]];
 const fromIndex = from.indexOf(activeId);
 if (fromIndex === -1) return null;
 from.splice(fromIndex, 1);

 const to = [...columns[toColId]];

 let insertAt: number;
 if (overId in columns) {
  // Hovering a column body → append at the end.
  insertAt = to.length;
 } else {
  const overIndex = to.indexOf(overId);
  if (overIndex === -1) return null;
  // Insert before the hovered card, or after it (+1) once the dragged
  // card's center passed the hovered card's center. Clamped so that
  // "after the last card" means "last".
  insertAt = Math.min(overIndex + (insertAfter ? 1 : 0), to.length);
 }

 to.splice(insertAt, 0, activeId);

 const result = { ...columns, [fromColId]: from, [toColId]: to };

 // A hover that leaves every column untouched is a no-op (keeps the API's
 // "null when nothing changed" contract for callers and tests).
 const unchanged = Object.keys(result).every(
  (colId) =>
   result[colId].length === columns[colId].length &&
   result[colId].every((id, i) => id === columns[colId][i]),
 );
 return unchanged ? null : result;
}
