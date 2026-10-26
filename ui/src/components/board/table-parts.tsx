import { cn } from "@/lib/utils";
import type { Card } from "@janosik/shared";

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
    <th scope="col" className={cn("px-3 py-2 text-left", className)}>
      <button
        type="button"
        data-testid={`table-sort-${sortKey}`}
        aria-sort={
          isSorted ? (sort?.dir === 1 ? "ascending" : "descending") : "none"
        }
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
