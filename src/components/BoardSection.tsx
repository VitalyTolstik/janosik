import { SquareKanban } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { FilterBar } from "@/components/board/FilterBar";
import { DndBoard } from "@/components/board/DndBoard";
import { useBoardBackground } from "@/hooks/use-board-background";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Pencil } from "lucide-react";
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
  const { board, renameBoard } = useBoard();
  const { t } = useI18n();
  const { background } = useBoardBackground();
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER);

  // Inline board-title editing: click the title → input, Enter/blur saves,
  // Escape cancels.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  const startEditTitle = () => {
    setTitleDraft(board?.title ?? "");
    setEditingTitle(true);
    requestAnimationFrame(() => titleRef.current?.select());
  };

  const saveTitle = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && board && trimmed !== board.title) {
      renameBoard(trimmed);
    }
  };

  const cancelEditTitle = () => setEditingTitle(false);

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
        <div className="group flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 via-primary/10 to-cyan-500/15 text-primary ring-1 ring-primary/10 transition-shadow group-hover:ring-primary/25"
          >
            <SquareKanban className="h-[18px] w-[18px]" />
          </span>
          {editingTitle ? (
            <input
              ref={titleRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                else if (e.key === "Escape") cancelEditTitle();
              }}
              aria-label={t("board.editTitleAria")}
              className="h-9 w-56 rounded-lg border border-primary/40 bg-background/80 px-2.5 text-xl font-semibold tracking-tight outline-none ring-2 ring-primary/20 backdrop-blur-sm sm:w-72"
            />
          ) : (
            <h2
              onClick={startEditTitle}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  startEditTitle();
                }
              }}
              title={t("board.editTitleHint")}
              className="flex cursor-pointer items-center gap-1.5 text-xl font-semibold tracking-tight text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {board.title}
              <Pencil className="janosik-title-pencil h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-70" />
            </h2>
          )}
        </div>
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
