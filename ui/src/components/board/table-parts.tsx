import { cn } from "@/lib/utils";
import type { Card } from "@janosik/shared";
import { priorityRank } from "@/utils/priority";

/**
 * Table view helpers (TASK-14.1) — the pure column/sort math and the sort
 * header, split out of `TableView` so the view file keeps only the row and
 * cell rendering (TASK-118).
 */

export function checklistProgress(card: Card): { done: number; total: number } {
  const items = (card.checklists ?? []).flatMap((c) => c.items);
  return { done: items.filter((i) => i.done).length, total: items.length };
}

/** Sortable headers (TASK-14.1 item 7). */
export type SortKey =
  "title" | "column" | "due" | "priority" | "assignee" | "createdAt";

export interface SortState {
  key: SortKey;
  dir: 1 | -1;
}

/** One table row as the comparators see it: a card and its column. */
export interface TableSortRow {
  card: Card;
  column: { id: string };
}

/**
 * Order two table rows by `sort`. Pure and exported so every comparator —
 * including column/priority/assignee, which previously had no unit coverage —
 * can be tested without mounting the table (TASK-162 review, T-03).
 *
 * Invariants:
 * - undated cards stay last in BOTH directions (same as the reducer);
 * - unassigned rows stay last in BOTH directions (Jira convention);
 * - the third click's board-order reset is handled by the caller.
 */
export function compareTableRows(
  a: TableSortRow,
  b: TableSortRow,
  sort: SortState,
  columnIndex: Map<string, number>,
  assigneeName: (userId: string) => string,
  lang: string,
): number {
  switch (sort.key) {
    case "title":
      return (
        a.card.title.localeCompare(b.card.title, lang, {
          sensitivity: "base",
        }) * sort.dir
      );
    case "column":
      return (
        ((columnIndex.get(a.column.id) ?? 0) -
          (columnIndex.get(b.column.id) ?? 0)) *
        sort.dir
      );
    case "due": {
      const aDue = typeof a.card.dueDate === "number" ? a.card.dueDate : null;
      const bDue = typeof b.card.dueDate === "number" ? b.card.dueDate : null;
      if (aDue === null && bDue === null) return 0;
      if (aDue === null) return 1;
      if (bDue === null) return -1;
      return (aDue - bDue) * sort.dir;
    }
    case "priority":
      return (
        (priorityRank(a.card.priority) - priorityRank(b.card.priority)) *
        sort.dir
      );
    case "assignee": {
      // Unassigned rows sort last regardless of direction (Jira).
      if (!a.card.assigneeId && !b.card.assigneeId) return 0;
      if (!a.card.assigneeId) return 1;
      if (!b.card.assigneeId) return -1;
      return (
        assigneeName(a.card.assigneeId).localeCompare(
          assigneeName(b.card.assigneeId),
        ) * sort.dir
      );
    }
    case "createdAt":
      return (a.card.createdAt - b.card.createdAt) * sort.dir;
  }
}

/** Optional columns beyond the four base ones (TASK-14.1 item 11). */
export const OPTIONAL_COLUMNS = [
  "priority",
  "assignee",
  "checklists",
  "description",
  "createdAt",
  "updatedAt",
  "activity",
] as const;
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];

const COLUMNS_STORAGE_KEY = "janosik-table-columns";

export function readStoredColumns(): OptionalColumn[] {
  try {
    const stored = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.filter((c): c is OptionalColumn =>
          (OPTIONAL_COLUMNS as readonly string[]).includes(c as string),
        );
      }
    }
  } catch {
    /* storage unavailable — the defaults apply */
  }
  // Default set (owner's call): the assignee column is always on until
  // the user builds their own column set.
  return ["assignee"];
}

export function writeStoredColumns(columns: OptionalColumn[]): void {
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  } catch {
    /* storage unavailable — the choice only lasts the session */
  }
}

/** A sortable `<th>`: neutral icon until sorted, then the direction arrow. */
export function SortHeader({
  label,
  sortKey,
  sort,
  onCycle,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onCycle: (key: SortKey) => void;
  className?: string;
}) {
  const isSorted = sort?.key === sortKey;
  return (
    <th
      scope="col"
      // ARIA requires `aria-sort` on the columnheader, not on the button
      // nested inside it; screen readers announce the direction on the cell.
      aria-sort={
        isSorted ? (sort?.dir === 1 ? "ascending" : "descending") : "none"
      }
      className={cn("px-3 py-2 text-left", className)}
    >
      <button
        type="button"
        data-testid={`table-sort-${sortKey}`}
        title={label}
        onClick={() => onCycle(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors hover:text-foreground",
          isSorted ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {/* A neutral icon hints the header is sortable; it turns into the
            direction arrow once sorted. */}
        <span aria-hidden className="text-[10px]">
          {isSorted ? (sort?.dir === 1 ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
