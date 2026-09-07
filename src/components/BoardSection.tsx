import { useMemo, useState } from "react";

import { FilterBar } from "@/components/board/FilterBar";
import { DndBoard } from "@/components/board/DndBoard";
import { useBoardBackground } from "@/hooks/use-board-background";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoard } from "@/store/BoardContext";
import { boardBackgroundById } from "@/types/board-background";
import {
  EMPTY_FILTER,
  filterCardIds,
  isFilterActive,
  type CardFilter,
} from "@/utils/filter";

/**
 * BoardSection — renders the active board as a horizontally scrollable strip
 * of columns, wrapped in the DndBoard drag context, with a filter toolbar.
 * The filter state lives here so both the toolbar and the columns see it.
 * The chosen board background fills the whole area behind the column strip.
 */
export function BoardSection() {
  const { board } = useBoard();
  const { t } = useI18n();
  const { background } = useBoardBackground();
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER);

  const active = isFilterActive(filter);

  const filteredIds = useMemo(() => {
    if (!active || !board) return null;
    return filterCardIds(
      Object.fromEntries(board.columns.map((col) => [col.id, col.cardIds])),
      board.cards,
      filter,
    );
  }, [active, board, filter]);

  const matchCount = filteredIds
    ? Object.values(filteredIds).reduce((sum, ids) => sum + ids.length, 0)
    : 0;

  if (!board) {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-muted-foreground">
        {t("board.noBoard")}
      </main>
    );
  }

  return (
    <main
      className={cn(
        "flex w-full flex-1 flex-col px-4 py-4 sm:px-6",
        boardBackgroundById(background).className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">{board.title}</h2>
      </div>
      <div className="mb-3">
        <FilterBar
          filter={filter}
          labels={board.labels}
          matchCount={matchCount}
          onChange={setFilter}
        />
      </div>
      <DndBoard
        filteredCardIds={filteredIds ?? undefined}
        isFiltering={active}
      />
    </main>
  );
}
