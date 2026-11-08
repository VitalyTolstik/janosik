/**
 * The empty state's "everything is archived" message is only true when the
 * account has boards and every one of them is archived. A workspace with an
 * active board is about to redirect to it, so it must not flash the archived
 * copy.
 */
export function allBoardsArchived(
  boards: ReadonlyArray<{ archivedAt?: number | null }>,
): boolean {
  return boards.length > 0 && boards.every((entry) => entry.archivedAt != null);
}
