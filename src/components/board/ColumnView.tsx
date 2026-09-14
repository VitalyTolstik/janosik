import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { AddCardZone } from "@/components/board/AddCardZone";
import { CardComposer } from "@/components/board/CardComposer";
import { ColumnMenu } from "@/components/board/ColumnMenu";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { RenameColumnDialog } from "@/components/board/RenameColumnDialog";
import { SortableCard } from "@/components/board/SortableCard";
import { WipLimitDialog } from "@/components/board/WipLimitDialog";
import { useCardLabels } from "@/hooks/use-card-labels";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useBoardActions } from "@/store/BoardContext";
import type { Card, Column, Label } from "@/types/kanban";
import { LIMITS } from "@/types/kanban";

interface ColumnViewProps {
  column: Column;
  /**
   * The ids to render, in order — the column's own order, or a filter/drag
   * override. Straight from the store, so it keeps its identity until the
   * order itself changes: it is `SortableContext`'s `items`, and a fresh
   * array there re-renders every card through dnd-kit's context, `memo` or
   * not (TASK-21.4.1).
   */
  cardIds: string[];
  /**
   * Those ids resolved to cards, in the same order. Resolved by the caller
   * (`useCardList`) so the array keeps its identity while nothing in this
   * column changes — that is what makes the `memo` below effective.
   */
  cards: Card[];
  /** The board's labels — card chips and the composer's picker. */
  labels: Label[];
  /** True when `cards` is a filter/drag override of the column's own order. */
  overridden?: boolean;
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
function ColumnViewBody({
  column,
  cardIds,
  cards,
  labels,
  overridden = false,
  className,
  onCardClick,
  isFiltered = false,
  highlight,
  cursorCardId,
}: ColumnViewProps) {
  const {
    addCard,
    renameColumn,
    deleteColumn,
    duplicateCard,
    archiveCard,
    archiveColumnCards,
    duplicateColumn,
    sortColumn,
    setColumnWipLimit,
  } = useBoardActions();
  const { t, tp } = useI18n();
  const [renameOpen, setRenameOpen] = useState(false);
  const [wipLimitOpen, setWipLimitOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmArchiveCards, setConfirmArchiveCards] = useState(false);
  /**
   * Inline "add between cards" composer (Trello-style hover zones):
   * `index` is the gap the composer opened at, `count` how many cards were
   * committed there — the insert position slides down with each commit so
   * rapid entries keep their order.
   */
  const [inlineAdd, setInlineAdd] = useState<{
    index: number;
    count: number;
  } | null>(null);

  // The card callbacks must keep their identity across renders, otherwise
  // `memo` on SortableCard/CardItem never holds (TASK-21.4). They take a
  // card id and read the current cards from a ref instead of closing over
  // one card, so a single handler serves the whole column.
  const cardsRef = useRef(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);
  const resolveLabels = useCardLabels(labels);

  const handleCardClick = useCallback(
    (cardId: string) => onCardClick?.(cardId),
    [onCardClick],
  );
  const handleCardDuplicate = useCallback(
    (cardId: string) => {
      const card = cardsRef.current.find((item) => item.id === cardId);
      duplicateCard(
        cardId,
        card ? t("card.duplicateTitle", { title: card.title }) : undefined,
      );
    },
    [duplicateCard, t],
  );
  // Stable too, so the insert zones can be memoized (TASK-21.4.1): the zone
  // reports the gap it sits in instead of each one closing over its index.
  const handleInsertAt = useCallback((index: number) => {
    setInlineAdd({ index, count: 0 });
  }, []);

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

  const count = cardIds.length;
  const wipLimit = column.wipLimit;
  // The visible count includes hidden-by-filter cards only when no filter
  // overrides `cardIds` — the limit is judged on the real column contents.
  const atWipLimit = wipLimit !== undefined && count >= wipLimit;
  const overWipLimit = wipLimit !== undefined && count > wipLimit;
  // Hover zones insert into the real column order, so they only make sense
  // when the rendered ids ARE the column order (no filter override, no
  // active card-drag draft) and the column can still take cards.
  const inlineAddAllowed =
    !overridden && column.cardIds.length < LIMITS.cardsPerColumn && !atWipLimit;

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
              onArchiveCards={() => setConfirmArchiveCards(true)}
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
            inlineAdd ? (
              // Empty column + opened inline composer: the composer takes
              // the empty state's place (first commit moves to the regular
              // list rendering with hover zones).
              <div className="py-1">
                <CardComposer
                  key={`inline-empty`}
                  labels={labels}
                  defaultComposing
                  atIndex={inlineAdd.index + inlineAdd.count}
                  onClose={() => setInlineAdd(null)}
                  onSubmit={(title, labelIds, at) => {
                    addCard(column.id, title, labelIds, at);
                    setInlineAdd((s) => (s ? { ...s, count: s.count + 1 } : s));
                  }}
                />
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground/70">
                  {isFiltered && column.cardIds.length > 0
                    ? t("filter.noMatch")
                    : t("column.empty")}
                </div>
                {inlineAddAllowed && (
                  <AddCardZone index={0} onInsert={handleInsertAt} />
                )}
              </div>
            )
          ) : (
            <SortableContext
              items={cardIds}
              strategy={verticalListSortingStrategy}
            >
              {/* Spacing comes from the 8px zones/spacers themselves (they
                  render in every mode) — a conditional space-y here would
                  shift the whole column on drag start. */}
              <ul className="py-1">
                {cards.map((card, i) => {
                  const cardLabels = resolveLabels(card.labelIds);
                  return (
                    <Fragment key={card.id}>
                      {inlineAdd?.index === i ? (
                        // Breathing room so the composer's top border
                        // never merges with the card above it.
                        <li className="py-1">
                          <CardComposer
                            key={`inline-${i}`}
                            labels={labels}
                            defaultComposing
                            atIndex={i + inlineAdd.count}
                            onClose={() => setInlineAdd(null)}
                            onSubmit={(title, labelIds, at) => {
                              addCard(column.id, title, labelIds, at);
                              setInlineAdd((s) =>
                                s ? { ...s, count: s.count + 1 } : s,
                              );
                            }}
                          />
                        </li>
                      ) : (
                        <AddCardZone
                          index={i}
                          interactive={inlineAddAllowed}
                          onInsert={handleInsertAt}
                        />
                      )}
                      <li>
                        <SortableCard
                          card={card}
                          labels={cardLabels}
                          highlight={highlight}
                          isCursor={card.id === cursorCardId}
                          onCardClick={
                            onCardClick ? handleCardClick : undefined
                          }
                          onCardDuplicate={handleCardDuplicate}
                          onCardArchive={archiveCard}
                        />
                      </li>
                    </Fragment>
                  );
                })}
                {count > 0 && inlineAdd?.index !== count && (
                  <AddCardZone
                    index={count}
                    interactive={inlineAddAllowed}
                    onInsert={handleInsertAt}
                  />
                )}
                {inlineAddAllowed && inlineAdd?.index === count && (
                  <li className="py-1">
                    <CardComposer
                      key={`inline-${count}`}
                      labels={labels}
                      defaultComposing
                      atIndex={inlineAdd.index + inlineAdd.count}
                      onClose={() => setInlineAdd(null)}
                      onSubmit={(title, labelIds, at) => {
                        addCard(column.id, title, labelIds, at);
                        setInlineAdd((s) =>
                          s ? { ...s, count: s.count + 1 } : s,
                        );
                      }}
                    />
                  </li>
                )}
              </ul>
            </SortableContext>
          )}
        </div>

        <footer className="px-2 pb-2 pt-1.5">
          <CardComposer
            columnId={column.id}
            labels={labels}
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

      <ConfirmDialog
        open={confirmArchiveCards}
        onOpenChange={setConfirmArchiveCards}
        title={t("column.archiveCardsTitle")}
        description={t("column.archiveCardsDescription", {
          title: column.title,
        })}
        confirmLabel={t("column.archiveCards")}
        onConfirm={() => archiveColumnCards(column.id)}
      />
    </>
  );
}

/**
 * Memoized (TASK-21.4.1). Everything it renders — the insert zones, the
 * column menu, the composer, four always-mounted dialogs — used to re-run
 * on every keystroke anywhere on the board, because the column looked its
 * cards up in the store and the store hands out a new board object each
 * time. It now takes them as props (`useCardList` keeps the array stable)
 * and reads only the actions context, which never changes.
 */
export const ColumnView = memo(ColumnViewBody);
