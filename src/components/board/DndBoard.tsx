import {
  closestCenter,
  DndContext,
  DragOverlay,
  getFirstCollision,
  KeyboardSensor,
  MeasuringStrategy,
  pointerWithin,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AddColumnControl } from "@/components/board/AddColumnControl";
import { CardItem } from "@/components/board/CardItem";
import { ColumnView } from "@/components/board/ColumnView";
import { useCardLabels } from "@/hooks/use-card-labels";
import { useCardList } from "@/hooks/use-card-list";
import { useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import { useToast } from "@/components/Toast";
import { isColumnFull } from "@/utils/column-limits";
import { applyCardOver } from "@/utils/dnd";
import { LIMITS, type Card, type Column, type Label } from "@/types/kanban";

/** Stable empties, so the resolvers survive a board-less render. */
const NO_LABELS: Label[] = [];
const NO_CARDS: Record<string, Card> = {};
const NO_COLUMNS: Column[] = [];

/**
 * Live draft while a drag is in progress. The store is only touched on drag
 * end; during the drag we keep a working copy so moves stay smooth and local.
 *
 * - Card mode: each column's ordered card ids (dragging a card).
 * - Column mode: the ordered list of column ids (dragging a column header).
 */
type CardDraft = {
  mode: "card";
  columns: Record<string, string[]>;
  activeCardId: string;
};

type ColumnDraft = {
  mode: "column";
  columnOrder: string[];
  activeColumnId: string;
};

type Draft = CardDraft | ColumnDraft;

const KEYBOARD_SENSOR_OPTIONS = {
  coordinateGetter: sortableKeyboardCoordinates,
} as const;

const POINTER_SENSOR_OPTIONS = {
  activationConstraint: { distance: 5 },
} as const;

/**
 * Both hoisted out of the render (TASK-21.4.1): every prop of `DndContext`
 * lands in dnd-kit's context, so a fresh array/object here re-renders every
 * `useSortable`/`useDroppable` consumer — each column and card — on every
 * keystroke, `memo` or not. `sensors: []` disables dragging while a filter
 * is active; `Always` re-measures droppables, and a new object asked for
 * that measurement again on every render.
 */
const NO_SENSORS: ReturnType<typeof useSensors> = [];
const MEASURING = {
  droppable: { strategy: MeasuringStrategy.Always },
} as const;

interface DndBoardProps {
  /** Per-column card ids with a filter applied — overrides each column's
   *  stored order while the filter is active. */
  filteredCardIds?: Record<string, string[]>;
  /** True while a board filter is active (disables drag & drop). */
  isFiltering?: boolean;
  /** Filter/search query highlighted on the card fronts. */
  highlight?: string;
  /** Fired on a card click (and the e/Enter hotkey) — the dialog itself
   *  lives in BoardSection so it works from every view. */
  onCardClick: (cardId: string) => void;
}

export function DndBoard({
  filteredCardIds,
  isFiltering = false,
  highlight,
  onCardClick,
}: DndBoardProps) {
  const { board, addColumn, moveCard, moveColumn } = useBoard();
  const { tp, t } = useI18n();
  const toast = useToast();
  const resolveLabels = useCardLabels(board?.labels ?? NO_LABELS);
  const resolveCards = useCardList(board?.cards ?? NO_CARDS);

  const [draft, setDraftState] = useState<Draft | null>(null);
  // Ref mirror so event handlers always read the latest draft (state updates
  // are async across events).
  const draftRef = useRef<Draft | null>(null);
  const updateDraft = useCallback((next: Draft | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  // Keyboard cursor (j/k navigation): flat index over the visible cards —
  // columns in board order, cards in (filtered) column order. `e`/Enter
  // opens the cursor's card dialog. Cleared by Escape or when the board
  // changes (the index belongs to one board's layout).
  const [cursor, setCursor] = useState<number | null>(null);
  const boardId = board?.id;
  useEffect(() => {
    setCursor(null);
  }, [boardId]);
  // Scroll the cursor's card into view as it moves.
  useEffect(() => {
    if (cursor === null) return;
    const el = document.querySelector('[data-card-cursor="true"]');
    // jsdom (tests) has no scrollIntoView.
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [cursor]);
  // dnd-kit fires a click right after a drag ends (pointerup lands on the
  // dragged element) — this flag swallows that spurious click so a drop never
  // opens the card dialog.
  const suppressNextCardClickRef = useRef(false);

  // Collision-detection memory, following dnd-kit's canonical
  // MultipleContainers preset: remember the last matched droppable so a
  // layout-shift frame (over === null right after a cross-column move) never
  // makes the card "fall out" of the target column mid-drag.
  const lastOverIdRef = useRef<string | null>(null);
  const recentlyMovedRef = useRef(false);
  useEffect(() => {
    requestAnimationFrame(() => {
      recentlyMovedRef.current = false;
    });
  }, [draft]);

  /**
   * Collision detection optimized for kanban (columns of cards), following
   * the official dnd-kit "Multiple Containers" recipe:
   *
   * - Column drag: only column droppables are candidates (closestCenter).
   * - Card drag: prefer droppables under the POINTER (pointerWithin), fall
   *   back to rect intersection, and finally to the last matched target.
   *   A hit on a column body narrows to the closest CARD inside it (Trello
   *   slots are decided between cards); an EMPTY column stays the target so
   *   cards can be dropped into it.
   */
  const collisionDetectionStrategy = useCallback<CollisionDetection>(
    (args) => {
      const current = draftRef.current;
      const columnIds = board ? board.columns.map((col) => col.id) : [];

      if (current?.mode === "column") {
        return closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) =>
            columnIds.includes(String(c.id)),
          ),
        });
      }

      const pointerIntersections = pointerWithin(args);
      const intersections =
        pointerIntersections.length > 0
          ? pointerIntersections
          : rectIntersection(args);
      let overId = getFirstCollision(intersections, "id");

      if (overId != null) {
        const columnCards =
          current?.mode === "card"
            ? current.columns[overId as string]
            : undefined;
        if (columnCards && columnCards.length > 0) {
          // Column body hit — resolve to its closest card instead.
          overId = closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter((c) =>
              columnCards.includes(String(c.id)),
            ),
          })[0]?.id;
        }
        if (overId != null) {
          lastOverIdRef.current = String(overId);
          return [{ id: overId }];
        }
      }

      if (recentlyMovedRef.current && current?.mode === "card") {
        lastOverIdRef.current = current.activeCardId;
      }
      return lastOverIdRef.current ? [{ id: lastOverIdRef.current }] : [];
    },
    [board],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (!board || isFiltering) return;
      const id = event.active.id as string;
      const type = event.active.data.current?.type;
      lastOverIdRef.current = null;
      recentlyMovedRef.current = false;

      if (type === "column") {
        updateDraft({
          mode: "column",
          columnOrder: board.columns.map((col) => col.id),
          activeColumnId: id,
        });
        return;
      }

      updateDraft({
        mode: "card",
        columns: Object.fromEntries(
          board.columns.map((col) => [col.id, [...col.cardIds]]),
        ),
        activeCardId: id,
      });
    },
    [board, isFiltering, updateDraft],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeId = active.id as string;
      const overId = over.id as string;
      if (activeId === overId) return;

      const current = draftRef.current;
      if (!current) return;

      // ---- Column drag: reorder the column list ----
      if (current.mode === "column") {
        if (activeId !== current.activeColumnId) return;
        const order = current.columnOrder;
        const fromIndex = order.indexOf(activeId);
        if (fromIndex === -1) return;

        // Resolve the drop target to a column id (either the column itself
        // or the column that owns the hovered card).
        const toIndex = order.indexOf(overId);
        const toColId = board?.columns.find((col) =>
          col.cardIds.includes(overId),
        );
        const targetIndex =
          toIndex === -1 ? (toColId ? order.indexOf(toColId.id) : -1) : toIndex;
        if (targetIndex === -1 || targetIndex === fromIndex) return;

        updateDraft({
          ...current,
          columnOrder: arrayMove(order, fromIndex, targetIndex),
        });
        return;
      }

      // ---- Card drag ----
      if (current.activeCardId !== activeId) return;

      // Same-column hover: the sortable strategy animates the gap itself and
      // the final position is chosen on drop (arrayMove into the over card's
      // slot). Skipping the draft update here also keeps the droppable rects
      // accurate (no mid-drag DOM reordering of the column).
      const fromColId = Object.keys(current.columns).find((colId) =>
        current.columns[colId].includes(activeId),
      );
      if (!fromColId) return;
      const toColId =
        overId in current.columns
          ? overId
          : Object.keys(current.columns).find((colId) =>
              current.columns[colId].includes(overId),
            );
      if (!toColId || fromColId === toColId) return;

      // Cross-column hover (or a column body): insert next to the hovered
      // card using dnd-kit's canonical MultipleContainers rule — the dragged
      // card's TOP vs the hovered card's BOTTOM decides before/after. This
      // matches Trello's slot behavior: hovering the upper part of a card
      // inserts before it, past its bottom edge inserts after it (dropping
      // below the last card therefore appends). Measured with
      // MeasuringStrategy Always so the rects are never stale during
      // reorders.
      const translated = event.active.rect.current.translated;
      const insertAfter =
        translated != null && translated.top > over.rect.top + over.rect.height;

      const next = applyCardOver(
        current.columns,
        activeId,
        overId,
        insertAfter,
      );
      if (!next) return;
      recentlyMovedRef.current = true;
      updateDraft({ ...current, columns: next });
    },
    [board, updateDraft],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const current = draftRef.current;
      updateDraft(null);
      // dnd-kit fires a click right after pointerup; swallow only that one.
      suppressNextCardClickRef.current = true;
      window.setTimeout(() => {
        suppressNextCardClickRef.current = false;
      }, 300);
      if (!current || !board) return;

      const activeId = event.active.id as string;

      // ---- Commit column reorder ----
      if (current.mode === "column") {
        const fromIndex = board.columns.findIndex(
          (col) => col.id === current.activeColumnId,
        );
        const toIndex = current.columnOrder.indexOf(current.activeColumnId);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
        moveColumn(current.activeColumnId, fromIndex, toIndex);
        return;
      }

      // ---- Commit card move ----
      // Canonical MultipleContainers semantics: the final slot is derived
      // from `over` at DROP time (arrayMove in the landed container), not
      // from the draft. During a long auto-scrolled drag onDragOver stops
      // firing while `over` stays the same card, so the draft alone can be
      // one slot stale — dragEnd's arrayMove fixes exactly that.
      const cols = current.columns;
      const overId = event.over?.id as string | undefined;
      if (!overId) return; // no valid target — the draft is discarded anyway

      const findCol = (id: string) =>
        id in cols ? id : Object.keys(cols).find((c) => cols[c].includes(id));
      const activeContainer = findCol(activeId);
      const overContainer = findCol(overId);
      if (!activeContainer || !overContainer) return;

      const fromColumn = board.columns.find((col) =>
        col.cardIds.includes(activeId),
      );
      if (!fromColumn) return;

      /**
       * TASK-13: a full destination refuses cards from other columns —
       * its own WIP limit or the hard cards-per-column cap (the same
       * condition the reducer's guard uses). The draft already shows the
       * card in the target column (drag-over commits visually) — on a
       * blocked drop the draft is discarded with it, so the card visually
       * snaps back to its source column.
       */
      const isWipBlocked = (targetColumnId: string) => {
        if (targetColumnId === fromColumn.id) return false;
        const target = board.columns.find((col) => col.id === targetColumnId);
        return target !== undefined && isColumnFull(target);
      };
      const notifyWipBlocked = (targetColumnId: string) => {
        const target = board.columns.find((col) => col.id === targetColumnId);
        if (!target) return;
        toast.error(
          target.wipLimit !== undefined
            ? t("toast.wipLimitBlocked", {
                title: target.title,
                limit: target.wipLimit,
              })
            : t("limits.maxItems", { limit: LIMITS.cardsPerColumn }),
        );
      };

      if (activeContainer === overContainer) {
        // The card already sits in the landed column (same-column reorder —
        // the draft never touched it — or an earlier cross-column hover).
        // arrayMove into the hovered card's slot; `over` being the dragged
        // card itself means the pointer rests on it → keep the draft slot
        // (a plain click-style drop commits the cross-column entry slot).
        if (isWipBlocked(activeContainer)) {
          notifyWipBlocked(activeContainer);
          return;
        }
        const activeIndex = cols[activeContainer].indexOf(activeId);
        const toIndex =
          overId === activeId
            ? activeIndex
            : cols[overContainer].indexOf(overId);
        if (toIndex !== -1) {
          moveCard(activeId, fromColumn.id, activeContainer, toIndex);
        }
        return;
      }

      // The pointer crossed into another column without dragOver committing
      // it (very fast flick). Insert with the canonical below-modifier.
      const translated = event.active.rect.current.translated;
      const overRect = event.over?.rect;
      const insertAfter =
        translated != null &&
        overRect != null &&
        translated.top > overRect.top + overRect.height;
      const overItems = cols[overContainer];
      const targetIndex =
        overId in cols
          ? overItems.length
          : Math.max(0, overItems.indexOf(overId)) + (insertAfter ? 1 : 0);
      if (isWipBlocked(overContainer)) {
        notifyWipBlocked(overContainer);
        return;
      }
      moveCard(
        activeId,
        fromColumn.id,
        overContainer,
        Math.min(targetIndex, overItems.length),
      );
    },
    [board, moveCard, moveColumn, updateDraft, toast, t],
  );

  const handleDragCancel = useCallback(() => updateDraft(null), [updateDraft]);

  // Open the card detail dialog (owned by BoardSection), ignoring the click
  // that immediately follows a finished drag.
  const handleCardClick = useCallback(
    (cardId: string) => {
      if (suppressNextCardClickRef.current) {
        suppressNextCardClickRef.current = false;
        return;
      }
      onCardClick(cardId);
    },
    [onCardClick],
  );

  // Shared guard: single-letter shortcuts are inert while the user types or
  // while an overlay (dialog/popover/menu) is open.
  const shortcutsBlocked = (event: KeyboardEvent) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    )
      return true;
    return (
      document.querySelector(
        '[role="dialog"], [data-radix-popper-content-wrapper]',
      ) !== null
    );
  };

  // j/k navigate the visible cards, e/Enter open the cursor's dialog,
  // n opens a composer (cursor's column, else the first), c opens the
  // column composer, Escape clears the cursor. The overlay itself lives in
  // ShortcutsDialog ("?"). Hooks stay above the `!board` early return, so
  // the visible-card derivation is repeated here for the keydown closure.
  useEffect(() => {
    if (!board) return;
    const order =
      draft?.mode === "column"
        ? draft.columnOrder
        : board.columns.map((col) => col.id);
    const columns = new Map(board.columns.map((col) => [col.id, col]));
    const flatCardIds = order.flatMap(
      (colId) => filteredCardIds?.[colId] ?? columns.get(colId)?.cardIds ?? [],
    );
    const focusedCardId = cursor !== null ? flatCardIds[cursor] : undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (shortcutsBlocked(event)) return;
      const key = event.key;
      if (key === "j" || key === "k") {
        event.preventDefault();
        setCursor((prev) => {
          const total = flatCardIds.length;
          if (total === 0) return null;
          if (prev === null) return key === "j" ? 0 : total - 1;
          return Math.min(
            Math.max(key === "j" ? prev + 1 : prev - 1, 0),
            total - 1,
          );
        });
      } else if ((key === "e" || key === "Enter") && focusedCardId) {
        event.preventDefault();
        onCardClick(focusedCardId);
      } else if (key === "n") {
        event.preventDefault();
        const columnId =
          (focusedCardId &&
            order.find((colId) =>
              (
                filteredCardIds?.[colId] ??
                columns.get(colId)?.cardIds ??
                []
              ).includes(focusedCardId),
            )) ||
          order[0];
        document
          .querySelector<HTMLElement>(`[data-composer-trigger="${columnId}"]`)
          ?.click();
      } else if (key === "c") {
        event.preventDefault();
        document
          .querySelector<HTMLElement>("[data-add-column-trigger]")
          ?.click();
      } else if (key === "Escape" && cursor !== null) {
        setCursor(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [board, draft, cursor, filteredCardIds, onCardClick]);

  // Render columns in the live draft order while a column drag is active.
  // Both memoized because `columnOrder` feeds `SortableContext items`:
  // a fresh array there changes dnd-kit's sortable context on every render,
  // and that re-renders every `useSortable` consumer — every column and
  // every card — straight through their `memo` (TASK-21.4.1).
  const columnOrder = useMemo(
    () =>
      draft?.mode === "column"
        ? draft.columnOrder
        : (board?.columns ?? NO_COLUMNS).map((col) => col.id),
    [draft, board?.columns],
  );
  const columnsById = useMemo(
    () => new Map((board?.columns ?? NO_COLUMNS).map((col) => [col.id, col])),
    [board?.columns],
  );

  if (!board) return null;

  // Flat list of visible card ids (columns in order, filtered column
  // contents) — the coordinate space of the j/k keyboard cursor.
  const visibleCardIds = columnOrder.flatMap(
    (colId) =>
      filteredCardIds?.[colId] ?? columnsById.get(colId)?.cardIds ?? [],
  );
  const cursorCardId = cursor !== null ? visibleCardIds[cursor] : undefined;

  const activeCard =
    draft?.mode === "card" ? board.cards[draft.activeCardId] : undefined;
  const activeLabels = activeCard
    ? resolveLabels(activeCard.labelIds)
    : NO_LABELS;
  const activeColumn =
    draft?.mode === "column"
      ? board.columns.find((col) => col.id === draft.activeColumnId)
      : undefined;

  return (
    <DndContext
      sensors={isFiltering ? NO_SENSORS : sensors}
      collisionDetection={collisionDetectionStrategy}
      measuring={MEASURING}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto pb-4">
        <SortableContext
          items={columnOrder}
          strategy={horizontalListSortingStrategy}
        >
          {columnOrder.map((columnId) => {
            const column = columnsById.get(columnId);
            if (!column) return null;
            // A drag draft or an active filter overrides the column's own
            // order; otherwise the column renders its stored order.
            const override =
              draft?.mode === "card"
                ? draft.columns[column.id]
                : filteredCardIds?.[column.id];
            return (
              <ColumnView
                key={columnId}
                column={column}
                cards={resolveCards(column, override ?? column.cardIds)}
                labels={board.labels}
                overridden={override !== undefined}
                isFiltered={isFiltering}
                highlight={highlight}
                cursorCardId={cursorCardId}
                onCardClick={handleCardClick}
                canDuplicateColumn={
                  board.columns.length < LIMITS.columnsPerBoard
                }
              />
            );
          })}
        </SortableContext>
        <AddColumnControl
          disabled={board.columns.length >= LIMITS.columnsPerBoard}
          disabledReason={t("limits.maxItems", {
            limit: LIMITS.columnsPerBoard,
          })}
          onSubmit={addColumn}
        />
      </div>

      <DragOverlay>
        {activeCard ? (
          <div className="rotate-3 cursor-grabbing">
            <CardItem card={activeCard} labels={activeLabels} />
          </div>
        ) : activeColumn ? (
          <div className="w-72 rotate-2 cursor-grabbing rounded-xl border border-primary/60 bg-card/95 p-3 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {activeColumn.title}
              </span>
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-hover px-1.5 text-[11px] font-medium text-muted-foreground">
                {activeColumn.cardIds.length}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {tp("overlay.columnCardCount", activeColumn.cardIds.length)}
            </p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
