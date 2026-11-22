import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api, isApiEnabled } from "@/api/client";
import { FilterBar } from "@/components/board/FilterBar";
import { DndBoard } from "@/components/board/DndBoard";
// Calendar/table render only after a view switch — lazy chunks (TASK-34).
import {
  CalendarView,
  TableView,
  WatchView,
} from "@/components/board/views-lazy";
import { CardDialog } from "@/components/board/CardDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useBoardView } from "@/components/board/BoardViewProvider";
import { ViewSwitcher } from "@/components/board/ViewSwitcher";
import { BoardDisplayMenu } from "@/components/board/BoardDisplayMenu";
import { useBoardDensity } from "@/hooks/use-board-density";
import { useToast } from "@/components/Toast";
import { useBoardBackground } from "@/hooks/use-board-background";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoard } from "@/store/BoardContext";
import { boardBackgroundById } from "@/types/board-background";
import { DEFAULT_COLUMN_ACCENT_STYLE } from "@janosik/shared";
import { hasCard } from "@/utils/card-nav";
import {
  filterCardIds,
  isFilterActive,
  readFilterParams,
  resolveFilterChange,
  writeFilterParams,
  type FilterChange,
} from "@/utils/filter";
import { copySearchParamsWithoutLanguageHandoff } from "@/utils/search-params";

/**
 * Quiet period before the board filter asks the server about text the board
 * aggregate cannot see (comments, attachment names). The local narrowing is
 * instant; this only adds the extra hits.
 */
const SERVER_FILTER_DEBOUNCE_MS = 250;

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
  const { board, roleOf, setBoardColumnStyle } = useBoard();
  const { t } = useI18n();
  const { background } = useBoardBackground();
  // The filter lives in the URL (TASK-162 review, F-02): a reload, a shared
  // link and browser Back/Forward all carry the same filtered view. Writes
  // use `replace` so typing a query does not fill the history with a step per
  // keystroke; the open-card param (`?card=`) is preserved by the serializer.
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = useMemo(() => readFilterParams(searchParams), [searchParams]);
  // The URL is the source of truth, but the router applies it in a transition:
  // until that render lands, `filter` above is stale. Two quick facet picks
  // (or a facet pick followed by typing) would otherwise compute from the
  // same old prop and the later write would silently drop the earlier facet.
  // This ref holds the last filter written or observed, so every update
  // composes on top of it.
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);
  const setFilter = useCallback(
    (change: FilterChange) => {
      const next = resolveFilterChange(change, filterRef.current);
      filterRef.current = next;
      setSearchParams((current) => writeFilterParams(next, current), {
        replace: true,
      });
    },
    [setSearchParams],
  );
  const { view, setView } = useBoardView();
  // Card density (TASK-142): a per-browser display preference, persisted next
  // to the chosen view; it only affects the kanban card face.
  const { density, setDensity } = useBoardDensity();

  const active = isFilterActive(filter);
  const serverMode = isApiEnabled();
  const query = filter.query.trim();
  // Comment/attachment ids matched by the server for exactly this query.
  // The query is stored with the ids so a pending response can never leak
  // into the next query: a mismatch shows nothing, not the previous hits.
  const [serverMatch, setServerMatch] = useState<{
    boardId: string;
    query: string;
    cardIds: ReadonlySet<string>;
  } | null>(null);

  const boardId = board?.id;
  useEffect(() => {
    if (!serverMode || boardId === undefined || query === "") return;
    let alive = true;
    const timer = setTimeout(() => {
      api
        .searchBoardCards(boardId, query, { includeMatches: false })
        .then((result) => {
          if (!alive) return;
          setServerMatch({
            boardId,
            query,
            // The filter needs ids only; `matches` is empty unless a caller
            // explicitly asks for the bounded explanatory list.
            cardIds: new Set(result.cardIds),
          });
        })
        .catch(() => {
          // Search is an enhancement: an old server without the route or a
          // transient failure keeps the local filter working (no toast).
          // Resolve the query with no extra ids so the UI leaves its pending
          // state and can show the truthful local-only result.
          if (alive) {
            setServerMatch({ boardId, query, cardIds: new Set<string>() });
          }
        });
    }, SERVER_FILTER_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [serverMode, boardId, query]);

  const serverPending =
    serverMode &&
    boardId !== undefined &&
    query !== "" &&
    (serverMatch === null ||
      serverMatch.boardId !== boardId ||
      serverMatch.query !== query);
  const serverCardIds =
    serverMatch !== null &&
    serverMatch.boardId === board?.id &&
    serverMatch.query === query &&
    query !== ""
      ? serverMatch.cardIds
      : undefined;

  const filteredIds = useMemo(() => {
    if (!active || !board) return null;
    return filterCardIds(
      Object.fromEntries(board.columns.map((col) => [col.id, col.cardIds])),
      board.cards,
      filter,
      Date.now(),
      board.labels,
      serverCardIds,
    );
  }, [active, board, filter, serverCardIds]);

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
    const cardExists = board !== undefined && hasCard(board, cardParam);
    // A `?card=` that is not on this board (typo, deleted card, stale link):
    // drop the dead param so the address bar stops advertising a card that
    // cannot open, and say why nothing happened. The board must be loaded
    // first, or a cold boot would strip a valid deep link before it resolves.
    if (cardParam && board && !cardExists) {
      // The card the user just closed (or deleted) is not "missing": the
      // close handler clears the deep link, but the board update can land
      // one render before the param cleanup settles. Only a card that was
      // not just closed with the dialog still reports.
      const justClosed = closedCardRef.current === cardParam;
      if (!justClosed && missingCardRef.current !== cardParam) {
        missingCardRef.current = cardParam;
        toast.error(t("card.notFound"));
      }
      const next = copySearchParamsWithoutLanguageHandoff(searchParams);
      // The row params only ever accompany a live card deep link.
      next.delete("card");
      next.delete("comment");
      next.delete("attachment");
      setSearchParams(next, { replace: true });
      return;
    }
    if (cardParam && cardExists) {
      // A marker for a different card must not outlive the navigation: it
      // could otherwise suppress a later genuine "missing card" toast.
      if (
        closedCardRef.current !== null &&
        closedCardRef.current !== cardParam
      ) {
        closedCardRef.current = null;
      }
      if (openCardId !== cardParam && closedCardRef.current !== cardParam) {
        setOpenCardId(cardParam);
      }
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
      // A history push, not a replace: Back then closes the dialog. The
      // functional update keeps this callback stable across URL changes, so
      // opening a card does not hand every table row a fresh `onOpen` prop.
      // A plain card click starts at the top, so a leftover search deep link
      // to a comment/attachment must not follow it.
      setSearchParams((current) => {
        const next = copySearchParamsWithoutLanguageHandoff(current);
        next.set("card", cardId);
        next.delete("comment");
        next.delete("attachment");
        return next;
      });
    },
    [setSearchParams],
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
  // An archived board is read-only for the same reason: the command path
  // refuses writes until the board is restored from the switcher.
  const readOnly =
    roleOf(board.id) === "VIEWER" || board.archivedAt !== undefined;
  // A global-search hit can name the exact comment/attachment under the card
  // (TASK-177.13). The dialog scrolls to it and highlights it; an id that is
  // not in the loaded page/list is ignored, so the fallback is the card with
  // its dialog open at the top. The params never enable anything on their own.
  const focusCommentId = searchParams.get("comment") ?? undefined;
  const focusAttachmentId = searchParams.get("attachment") ?? undefined;

  return (
    <main
      data-testid="board-main"
      tabIndex={-1}
      className={cn(
        "flex min-h-0 w-full flex-1 flex-col px-4 pt-4 pb-4 outline-none sm:px-6",
        boardBackgroundById(background).className,
      )}
    >
      {/* The watch view reads the whole board feed; a card filter would only
          contradict it, so the toolbar is hidden there. */}
      {view !== "watch" ? (
        <div className="mb-3">
          <FilterBar
            filter={filter}
            labels={board.labels}
            boardId={board.id}
            matchCount={matchCount}
            matchPending={serverPending}
            onChange={setFilter}
          />
        </div>
      ) : null}
      {serverPending ? (
        <p
          role="status"
          aria-live="polite"
          data-testid="filter-server-pending"
          className="mb-3 text-xs text-muted-foreground"
        >
          {t("filter.searchingServer")}
        </p>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <ViewSwitcher value={view} onChange={setView} />
        {/* Board-view display controls: column style, glass + card density. */}
        {view === "board" ? (
          <BoardDisplayMenu
            density={density}
            onDensityChange={setDensity}
            columnStyle={board.columnStyle ?? DEFAULT_COLUMN_ACCENT_STYLE}
            onColumnStyleChange={setBoardColumnStyle}
            readOnly={readOnly}
          />
        ) : null}
      </div>
      {view === "board" ? (
        <DndBoard
          filteredCardIds={filteredIds ?? undefined}
          isFiltering={active}
          filterPending={serverPending}
          highlight={filter.query}
          onCardClick={handleCardClick}
          density={density}
          readOnly={readOnly}
        />
      ) : view === "watch" ? (
        <WatchView boardId={board.id} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {view === "calendar" ? (
            <CalendarView
              filteredCardIds={filteredIds ?? undefined}
              isFiltering={active}
              onCardClick={handleCardClick}
              readOnly={readOnly}
            />
          ) : (
            <TableView
              filteredCardIds={filteredIds ?? undefined}
              isFiltering={active}
              filterPending={serverPending}
              highlight={filter.query}
              onCardClick={handleCardClick}
              readOnly={readOnly}
            />
          )}
        </div>
      )}

      {/* A crash inside the dialog is contained here (TASK-151, C11) and resets
          for the next card (TASK-156) instead of pinning the fallback. The
          fallback's Close clears the crash: the card closes (and its deep
          link with it) so the remount starts from a closed dialog, not from
          the same crash (TASK-156 review). */}
      <ErrorBoundary
        compact
        resetKey={openCardId ?? "closed"}
        onReset={() => {
          closedCardRef.current = openCardId;
          setOpenCardId(null);
          if (searchParams.get("card")) {
            const next = copySearchParamsWithoutLanguageHandoff(searchParams);
            next.delete("card");
            next.delete("comment");
            next.delete("attachment");
            setSearchParams(next, { replace: true });
          }
        }}
      >
        <CardDialog
          cardId={openCardId}
          open={openCardId !== null}
          readOnly={readOnly}
          focusCommentId={focusCommentId}
          focusAttachmentId={focusAttachmentId}
          onOpenChange={(open) => {
            if (!open) {
              // Mark the closing card so a server commit landing between the
              // state update and the param cleanup cannot reopen the dialog.
              closedCardRef.current = openCardId;
              setOpenCardId(null);
              // Clear the deep link so a refresh doesn't reopen the card,
              // while keeping filter and view state (TASK-152).
              if (searchParams.get("card")) {
                const next =
                  copySearchParamsWithoutLanguageHandoff(searchParams);
                next.delete("card");
                next.delete("comment");
                next.delete("attachment");
                setSearchParams(next, { replace: true });
              }
            }
          }}
        />
      </ErrorBoundary>
    </main>
  );
}
