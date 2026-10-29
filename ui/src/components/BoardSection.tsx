import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { FilterBar } from "@/components/board/FilterBar";
import { DndBoard } from "@/components/board/DndBoard";
// Calendar/table render only after a view switch — lazy chunks (TASK-34).
import { CalendarView, TableView } from "@/components/board/views-lazy";
import { CardDialog } from "@/components/board/CardDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ViewSwitcher, type BoardView } from "@/components/board/ViewSwitcher";
import { useToast } from "@/components/Toast";
import { ColumnGlassMenu } from "@/components/board/ColumnGlassMenu";
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

const VIEW_STORAGE_KEY = "janosik-board-view";

function readStoredView(): BoardView {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "calendar" || stored === "table" || stored === "board") {
      return stored;
    }
  } catch {
    /* storage unavailable — the default view applies */
  }
  return "board";
}

/**
 * BoardSection — renders the active board in the chosen view (kanban strip,
 * calendar by due dates, or flat table), wrapped with a filter toolbar.
 * The filter state lives here so the toolbar and every view see it; the
 * open-card dialog lives here too, so a card deep-link (?card=) opens it
 * from any view. The chosen board background fills the whole area behind
 * the view. The board title lives in the header (BoardTitle) — nothing is
 * duplicated here.
 */
export function BoardSection() {
  const { board, roleOf } = useBoard();
  const { t } = useI18n();
  const { background } = useBoardBackground();
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER);
  const [view, setView] = useState<BoardView>(readStoredView);

  // Remember the last chosen view across sessions (next to janosik-lang).
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      /* storage unavailable — the choice only lasts the session */
    }
  }, [view]);

  const active = isFilterActive(filter);

  const filteredIds = useMemo(() => {
    if (!active || !board) return null;
    return filterCardIds(
      Object.fromEntries(board.columns.map((col) => [col.id, col.cardIds])),
      board.cards,
      filter,
      Date.now(),
      board.labels,
    );
  }, [active, board, filter]);

  const matchCount = filteredIds
    ? Object.values(filteredIds).reduce((sum, ids) => sum + ids.length, 0)
    : 0;

  // The open card mirrors the `?card=` URL param (shareable card links and
  // the global-search "open the card itself" behaviour): navigating with the
  // param opens the dialog in any view; closing the dialog clears the param.
  // Every open path — click included — writes the param, so the address bar
  // is always a copy-pasteable link to the open card.
  const toast = useToast();
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // The card deliberately closed a moment ago. The close handler clears the
  // `?card=` param asynchronously; a board update landing in that window
  // (e.g. the server commit of a "Duplicate card" click) would otherwise
  // re-run this effect with the stale param and reopen the just-closed
  // dialog — the "closed → flashed open → closed" churn. The marker only
  // suppresses the SAME card and resets once the URL caught up, so deep
  // links and browser Back keep working.
  const closedCardRef = useRef<string | null>(null);
  // The dead card id already reported, so StrictMode's double effect never
  // toasts the same miss twice.
  const missingCardRef = useRef<string | null>(null);
  useEffect(() => {
    const cardParam = searchParams.get("card");
    // A `?card=` that is not on this board (typo, deleted card, stale link):
    // drop the dead param so the address bar stops advertising a card that
    // cannot open, and say why nothing happened. The board must be loaded
    // first, or a cold boot would strip a valid deep link before it resolves.
    if (cardParam && board && !board.cards[cardParam]) {
      if (missingCardRef.current !== cardParam) {
        missingCardRef.current = cardParam;
        toast.error(t("card.notFound"));
      }
      const next = new URLSearchParams(searchParams);
      next.delete("card");
      setSearchParams(next, { replace: true });
      return;
    }
    if (
      cardParam &&
      board?.cards[cardParam] &&
      openCardId !== cardParam &&
      closedCardRef.current !== cardParam
    ) {
      setOpenCardId(cardParam);
    } else if (!cardParam && openCardId) {
      // The param disappeared without the dialog closing itself (browser
      // Back after a click-open) — close the dialog with it.
      setOpenCardId(null);
    }
    if (!cardParam) {
      closedCardRef.current = null;
      missingCardRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to URL changes only; including openCardId would reopen the dialog right after the user closes it (the close handler clears the param asynchronously)
  }, [searchParams, board]);
  const handleCardClick = useCallback(
    (cardId: string) => {
      setOpenCardId(cardId);
      // A history push, not a replace: Back then closes the dialog.
      const next = new URLSearchParams(searchParams);
      next.set("card", cardId);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  if (!board) {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-muted-foreground">
        {t("board.noBoard")}
      </main>
    );
  }

  // VIEWER is read-only: the server answers 403 to every command, so the UI
  // hides the mutating affordances instead of offering actions that bounce.
  const readOnly = roleOf(board.id) === "VIEWER";

  return (
    <main
      className={cn(
        "flex min-h-0 w-full flex-1 flex-col px-4 pt-4 pb-4 sm:px-6",
        boardBackgroundById(background).className,
      )}
    >
      <div className="mb-3">
        <FilterBar
          filter={filter}
          labels={board.labels}
          boardId={board.id}
          matchCount={matchCount}
          onChange={setFilter}
        />
      </div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <ViewSwitcher value={view} onChange={setView} />
        {/* Column glass settings only make sense for the board view. */}
        {view === "board" ? <ColumnGlassMenu /> : null}
      </div>
      {view === "board" ? (
        <DndBoard
          filteredCardIds={filteredIds ?? undefined}
          isFiltering={active}
          highlight={filter.query}
          onCardClick={handleCardClick}
          readOnly={readOnly}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {view === "calendar" ? (
            <CalendarView
              filteredCardIds={filteredIds ?? undefined}
              onCardClick={handleCardClick}
              readOnly={readOnly}
            />
          ) : (
            <TableView
              filteredCardIds={filteredIds ?? undefined}
              isFiltering={active}
              highlight={filter.query}
              onCardClick={handleCardClick}
              readOnly={readOnly}
            />
          )}
        </div>
      )}

      {/* A crash inside the dialog is contained here (TASK-151, C11). */}
      <ErrorBoundary compact>
        <CardDialog
          cardId={openCardId}
          open={openCardId !== null}
          readOnly={readOnly}
          onOpenChange={(open) => {
            if (!open) {
              // Mark the closing card so a server commit landing between the
              // state update and the param cleanup cannot reopen the dialog.
              closedCardRef.current = openCardId;
              setOpenCardId(null);
              // Drop only the deep-link param so a refresh doesn't reopen the card —
              // other view/query params (filter, view) must survive (TASK-152).
              if (searchParams.get("card")) {
                const next = new URLSearchParams(searchParams);
                next.delete("card");
                setSearchParams(next, { replace: true });
              }
            }
          }}
        />
      </ErrorBoundary>
    </main>
  );
}
