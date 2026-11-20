export const CARD_ACTIVITY_PAGE_SIZE = 50;

export interface ActivityPage<T> {
  items: T[];
  nextCursor: string | null;
  /** An exact total, when the response includes one. */
  total?: number;
}

export function mergeNewestActivity<T extends { id: string }>(
  current: ActivityPage<T>,
  newest: ActivityPage<T>,
  isPending?: (row: T) => boolean,
): ActivityPage<T> {
  const known = new Set(current.items.map((row) => row.id));
  const boundary = newest.items.at(-1);
  const total = newest.total ?? current.total;
  const hasPartialPage =
    current.nextCursor !== null || newest.nextCursor !== null;
  if (hasPartialPage && (!boundary || !known.has(boundary.id))) {
    // A burst can leave a gap, and a delete can bring an older row into this page.
    return {
      ...newest,
      items: [
        ...(isPending ? current.items.filter(isPending) : []),
        ...newest.items,
      ],
      total,
    };
  }
  const fresh = newest.items.filter((row) => !known.has(row.id));
  return {
    items: fresh.length > 0 ? [...fresh, ...current.items] : current.items,
    nextCursor: newest.nextCursor === null ? null : current.nextCursor,
    total,
  };
}

export function appendOlderActivity<T extends { id: string }>(
  current: ActivityPage<T>,
  older: ActivityPage<T>,
  cursor: string,
): ActivityPage<T> {
  if (current.nextCursor !== cursor) return current;
  const known = new Set(current.items.map((row) => row.id));
  return {
    items: [
      ...current.items,
      ...older.items.filter((row) => !known.has(row.id)),
    ],
    nextCursor: older.nextCursor,
    total: older.total ?? current.total,
  };
}

export interface ActivityCount {
  visible: number;
  /** For History, the number of feed events before folding. */
  loaded: number;
  truncated: boolean;
  total?: number;
}
