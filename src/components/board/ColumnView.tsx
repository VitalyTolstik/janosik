import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useState } from "react";

import { CardComposer } from "@/components/board/CardComposer";
import { ColumnMenu } from "@/components/board/ColumnMenu";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { RenameColumnDialog } from "@/components/board/RenameColumnDialog";
import { SortableCard } from "@/components/board/SortableCard";
import { WipLimitDialog } from "@/components/board/WipLimitDialog";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import type { Column } from "@/types/kanban";
import { LIMITS } from "@/types/kanban";

interface ColumnViewProps {
  column: Column;
  /** Ordered card ids — overrides column.cardIds during an active drag. */
  cardIds?: string[];
  className?: string;
  onCardClick?: (cardId: string) => void;
  /** True while a board filter is active (changes the empty-state text). */
  isFiltered?: boolean;
  /** Filter/search query highlighted on the card fronts. */
  highlight?: string;
  /** The j/k keyboard cursor card — rendered with a focus ring. */
  cursorCardId?: string;
}

/**
 * A single column: header (title + count badge + menu), scrollable card list
 * (with an empty state), and a CardComposer footer.
 *
 * - The whole column is droppable (so cards can be dropped anywhere on an
 *   empty column) AND sortable (columns are reorderable by dragging the
 *   header — visible grip handles).
 * - The card list is a SortableContext for vertical card sorting.
 * - Double-click the title or use the menu to rename; menu → Delete column
 *   asks for confirmation (cascades to its cards).
 */
export function ColumnView({
  column,
  cardIds,
  className,
  onCardClick,
  isFiltered = false,
  highlight,
  cursorCardId,
}: ColumnViewProps) {
  const {
    board,
    addCard,
    renameColumn,
    deleteColumn,
    duplicateCard,
    duplicateColumn,
    sortColumn,
    setColumnWipLimit,
  } = useBoard();
  const { t, tp } = useI18n();
  const [renameOpen, setRenameOpen] = useState(false);
  const [wipLimitOpen, setWipLimitOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging: isColumnDragging,
  } = useSortable({ id: column.id, data: { type: "column" } });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: column.id,
  });

  if (!board) return null;

  const ids = cardIds ?? column.cardIds;
  const count = ids.length;
  const wipLimit = column.wipLimit;
  // The visible count includes hidden-by-filter cards only when no filter
  // overrides `cardIds` — the limit is judged on the real column contents.
  const atWipLimit = wipLimit !== undefined && count >= wipLimit;
  const overWipLimit = wipLimit !== undefined && count > wipLimit;

  const setNodeRef = (node: HTMLElement | null) => {
    setSortableRef(node);
    setDroppableRef(node);
  };

  const handleRename = (title: string) => {
    renameColumn(column.id, title);
    setRenameOpen(false);
  };

  const handleDelete = () => {
    deleteColumn(column.id);
    setConfirmDelete(false);
  };

  return (
    <>
      <section
        ref={setNodeRef}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          // Column glass — driven by --janosik-glass-* (BoardGlassProvider).
          // transparency 0 = opaque, 100 = frame only; blur 0 = no frosting.
          backgroundColor:
            "color-mix(in oklab, var(--card) calc((100 - var(--janosik-glass-transparency)) * 1%), transparent)",
          backdropFilter: "blur(var(--janosik-glass-blur))",
        }}
        className={cn(
          "flex max-h-full w-[80vw] max-w-72 shrink-0 flex-col rounded-xl border transition-colors sm:w-72 sm:max-w-none",
          isColumnDragging
            ? "border-primary/60 opacity-50"
            : isOver
              ? "border-primary/60"
              : "border-border",
          className,
        )}
      >
        <header
          className="flex cursor-grab items-center justify-between gap-1 px-2 py-2.5 pl-3 active:cursor-grabbing"
          {...attributes}
          {...listeners}
          title={t("column.dragHint")}
        >
          <h3
            className="truncate text-sm font-semibold text-foreground"
            onDoubleClick={() => setRenameOpen(true)}
          >
            {column.title}
          </h3>
          <span className="flex shrink-0 items-center gap-1">
            <span
              title={
                atWipLimit
                  ? t("column.wipLimitReached", { limit: wipLimit })
                  : undefined
              }
              className={cn(
                "flex h-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-medium",
                overWipLimit
                  ? "bg-danger/15 text-danger"
                  : atWipLimit
                    ? "bg-warning/15 text-warning"
                    : "bg-hover text-muted-foreground",
              )}
            >
              {wipLimit !== undefined ? `${count}/${wipLimit}` : count}
            </span>
            <ColumnMenu
              onRename={() => setRenameOpen(true)}
              onDuplicate={() =>
                duplicateColumn(
                  column.id,
                  t("column.duplicateTitle", { title: column.title }),
                )
              }
              onDelete={() => setConfirmDelete(true)}
              onSort={(sortBy) => sortColumn(column.id, sortBy)}
              onSetWipLimit={() => setWipLimitOpen(true)}
              wipLimit={wipLimit}
            />
            <GripVertical
              aria-hidden
              className="h-4 w-4 shrink-0 text-muted-foreground/60"
            />
          </span>
        </header>

        <div className="flex-1 overflow-y-auto px-2 pb-1">
          {count === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground/70">
              {isFiltered && column.cardIds.length > 0
                ? t("filter.noMatch")
                : t("column.empty")}
            </div>
          ) : (
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2 py-1">
                {ids.map((cardId) => {
                  const card = board.cards[cardId];
                  if (!card) return null;
                  const labels = card.labelIds
                    .map((labelId) =>
                      board.labels.find((l) => l.id === labelId),
                    )
                    .filter((l): l is NonNullable<typeof l> => Boolean(l));
                  return (
                    <li key={cardId}>
                      <SortableCard
                        card={card}
                        labels={labels}
                        highlight={highlight}
                        isCursor={card.id === cursorCardId}
                        onCardClick={
                          onCardClick ? () => onCardClick(card.id) : undefined
                        }
                        onCardDuplicate={() =>
                          duplicateCard(
                            card.id,
                            t("card.duplicateTitle", { title: card.title }),
                          )
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </SortableContext>
          )}
        </div>

        <footer className="px-2 pb-2 pt-1.5">
          <CardComposer
            columnId={column.id}
            labels={board.labels}
            disabled={
              column.cardIds.length >= LIMITS.cardsPerColumn || atWipLimit
            }
            disabledReason={
              column.cardIds.length >= LIMITS.cardsPerColumn
                ? t("limits.maxItems", {
                    limit: LIMITS.cardsPerColumn,
                  })
                : atWipLimit
                  ? t("column.wipLimitReached", { limit: wipLimit })
                  : undefined
            }
            onSubmit={(title, labelIds) => addCard(column.id, title, labelIds)}
          />
        </footer>
      </section>

      <RenameColumnDialog
        open={renameOpen}
        initialTitle={column.title}
        onOpenChange={setRenameOpen}
        onSave={handleRename}
      />

      <WipLimitDialog
        open={wipLimitOpen}
        columnTitle={column.title}
        initialLimit={wipLimit}
        onOpenChange={setWipLimitOpen}
        onSave={(wipLimit) => setColumnWipLimit(column.id, wipLimit)}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("column.deleteTitle")}
        description={tp("column.deleteDescription", count, {
          title: column.title,
        })}
        confirmLabel={t("column.delete")}
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}
