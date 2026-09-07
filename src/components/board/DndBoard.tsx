import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
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
import { useCallback, useRef, useState } from "react";

import { AddColumnControl } from "@/components/board/AddColumnControl";
import { CardDialog } from "@/components/board/CardDialog";
import { CardItem } from "@/components/board/CardItem";
import { ColumnView } from "@/components/board/ColumnView";
import { useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import { applyCardOver } from "@/utils/dnd";

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

interface DndBoardProps {
  /** Per-column card ids with a filter applied — overrides each column's
   *  stored order while the filter is active. */
  filteredCardIds?: Record<string, string[]>;
  /** True while a board filter is active (disables drag & drop). */
  isFiltering?: boolean;
}

export function DndBoard({
  filteredCardIds,
  isFiltering = false,
}: DndBoardProps) {
  const { board, addColumn, moveCard, moveColumn } = useBoard();
  const { tp } = useI18n();

  const [draft, setDraftState] = useState<Draft | null>(null);
  // Ref mirror so event handlers always read the latest draft (state updates
  // are async across events).
  const draftRef = useRef<Draft | null>(null);
  const updateDraft = useCallback((next: Draft | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const [openCardId, setOpenCardId] = useState<string | null>(null);
  // dnd-kit fires a click right after a drag ends (pointerup lands on the
  // dragged element) — this flag swallows that spurious click so a drop never
  // opens the card dialog.
  const suppressNextCardClickRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (!board || isFiltering) return;
      const id = event.active.id as string;
      const type = event.active.data.current?.type;

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

      // Cross-column hover (or a column body): decide before/after from the
      // drag pointer, mirroring dnd-kit's own sortable logic — the dragged
      // card's center vs the hovered card's center. Dropping below the last
      // card's midpoint therefore inserts AFTER it → the card lands last in
      // the column instead of second-to-last. (Measured with MeasuringStrategy
      // Always so the rects are never stale during reorders.)
      const activeRect = event.active.rect.current.translated;
      const overRect = over.rect;
      let insertAfter = false;
      if (activeRect && overRect) {
        insertAfter =
          activeRect.top + activeRect.height / 2 >
          overRect.top + overRect.height / 2;
      }

      const next = applyCardOver(
        current.columns,
        activeId,
        overId,
        insertAfter,
      );
      if (!next) return;
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
      const cols = current.columns;
      const overId = event.over?.id as string | undefined;
      const toColId = Object.keys(cols).find((colId) =>
        cols[colId].includes(activeId),
      );
      if (!toColId) return;
      const toIndex = cols[toColId].indexOf(activeId);

      const fromColumn = board.columns.find((col) =>
        col.cardIds.includes(activeId),
      );
      if (!fromColumn) return;
      const fromIndex = fromColumn.cardIds.indexOf(activeId);

      // Same-column move: the draft never reordered the column, so the final
      // position comes from the over card's slot (arrayMove semantics — the
      // card lands AT the hovered card's index, which for the last card is
      // the column's end). Dropping in the column's own empty bottom area
      // (over = the column body) appends to the very end, like Trello.
      if (fromColumn.id === toColId) {
        if (overId === toColId) {
          const lastIndex = fromColumn.cardIds.length - 1;
          if (lastIndex !== fromIndex) {
            moveCard(activeId, fromColumn.id, toColId, lastIndex);
          }
          return;
        }
        if (overId && overId !== activeId) {
          const overIndex = fromColumn.cardIds.indexOf(overId);
          if (overIndex !== -1 && overIndex !== fromIndex) {
            moveCard(activeId, fromColumn.id, toColId, overIndex);
          }
        }
        return;
      }

      // No-op when nothing actually changed.
      if (fromIndex === toIndex) return;
      moveCard(activeId, fromColumn.id, toColId, toIndex);
    },
    [board, moveCard, moveColumn, updateDraft],
  );

  const handleDragCancel = useCallback(() => updateDraft(null), [updateDraft]);

  // Open the card detail dialog, ignoring the click that immediately follows
  // a finished drag.
  const handleCardClick = useCallback((cardId: string) => {
    if (suppressNextCardClickRef.current) {
      suppressNextCardClickRef.current = false;
      return;
    }
    setOpenCardId(cardId);
  }, []);

  if (!board) return null;

  // Render columns in the live draft order while a column drag is active.
  const columnOrder =
    draft?.mode === "column"
      ? draft.columnOrder
      : board.columns.map((col) => col.id);
  const columnsById = new Map(board.columns.map((col) => [col.id, col]));

  const activeCard =
    draft?.mode === "card" ? board.cards[draft.activeCardId] : undefined;
  const activeLabels = activeCard
    ? activeCard.labelIds
        .map((labelId) => board.labels.find((l) => l.id === labelId))
        .filter((l): l is NonNullable<typeof l> => Boolean(l))
    : [];
  const activeColumn =
    draft?.mode === "column"
      ? board.columns.find((col) => col.id === draft.activeColumnId)
      : undefined;

  return (
    <DndContext
      sensors={isFiltering ? [] : sensors}
      collisionDetection={closestCorners}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex flex-1 items-start gap-3 overflow-x-auto pb-4">
        <SortableContext
          items={columnOrder}
          strategy={horizontalListSortingStrategy}
        >
          {columnOrder.map((columnId) => {
            const column = columnsById.get(columnId);
            if (!column) return null;
            return (
              <ColumnView
                key={columnId}
                column={column}
                cardIds={
                  draft?.mode === "card"
                    ? draft.columns[column.id]
                    : filteredCardIds?.[column.id]
                }
                isFiltered={isFiltering}
                onCardClick={handleCardClick}
              />
            );
          })}
        </SortableContext>
        <AddColumnControl onSubmit={addColumn} />
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

      <CardDialog
        cardId={openCardId}
        open={openCardId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenCardId(null);
        }}
      />
    </DndContext>
  );
}
