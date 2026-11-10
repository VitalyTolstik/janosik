import type { BoardState } from "@janosik/shared";

/**
 * TASK-166.6: cheap preflight for the combined UI export. It intentionally
 * over-counts fixed JSON structure but uses one byte per string character, so
 * a non-ASCII payload may still need the exact post-serialization check.
 * The point is to refuse a 150 MB board before `JSON.stringify` allocates it.
 */
export function estimateBoardExportBytes(boards: BoardState): number {
  let bytes = 128;
  for (const board of boards) {
    bytes += 128 + board.title.length;
    for (const column of board.columns) {
      bytes += 64 + column.title.length + column.cardIds.length * 16;
    }
    for (const label of board.labels) {
      bytes += 32 + label.name.length;
    }
    for (const card of Object.values(board.cards)) {
      bytes += 96 + card.title.length + (card.description?.length ?? 0);
      for (const labelId of card.labelIds ?? []) bytes += labelId.length + 8;
      bytes += (card.links?.length ?? 0) * 96;
      for (const checklist of card.checklists ?? []) {
        bytes += 128 + checklist.title.length;
        for (const item of checklist.items) {
          bytes += 96 + item.text.length;
        }
      }
    }
  }
  return bytes;
}
