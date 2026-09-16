import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo } from "react";

import { CardItem } from "@/components/board/CardItem";
import type { Card, Label } from "@/types/kanban";

interface SortableCardProps {
  card: Card;
  /** Labels resolved from the board (multi-label support). */
  labels: Label[];
  /** Filter/search query highlighted on the card front. */
  highlight?: string;
  /** True when this card holds the j/k keyboard cursor (focus ring). */
  isCursor?: boolean;
  /** Fired when the rendered card is clicked — opens the card dialog. */
  onCardClick?: (cardId: string) => void;
  /** Fired by the hover duplicate button on the card. */
  onCardDuplicate?: (cardId: string) => void;
  /** Fired by the hover archive button on the card (TASK-18.1). */
  onCardArchive?: (cardId: string) => void;
  /** Blocks the hover duplicate (the card's column is full). */
  duplicateDisabled?: boolean;
  /** Tooltip text shown while `duplicateDisabled`. */
  duplicateDisabledReason?: string;
}

/**
 * Makes a CardItem draggable/sortable via @dnd-kit. The sortable transform
 * (the lift + gap animation while dragging) is applied to the wrapper div,
 * not to the CardItem itself, so the card keeps its own styling intact.
 */
function SortableCardView({
  card,
  labels,
  highlight,
  isCursor,
  onCardClick,
  onCardDuplicate,
  onCardArchive,
  duplicateDisabled = false,
  duplicateDisabledReason,
}: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: { type: "card" } });

  return (
    <div
      ref={setNodeRef}
      // `touch-manipulation` keeps native scroll alive on the card while
      // removing double-tap zoom, so the TouchSensor's long-press can win
      // the gesture without blocking the column's swipe scroll (TASK-21.10).
      className="touch-manipulation"
      style={{
        transform: CSS.Transform.toString(transform),
        // No transition while active — the dragged card must follow the
        // pointer instantly, otherwise it smears/lags as the list reorders
        // under it. The transition only applies for the settle animation
        // after the drop.
        transition: isDragging ? undefined : transition,
      }}
      {...attributes}
      {...listeners}
    >
      <CardItem
        card={card}
        labels={labels}
        isDragging={isDragging}
        highlight={highlight}
        isCursor={isCursor}
        onClick={onCardClick}
        onDuplicate={onCardDuplicate}
        onArchive={onCardArchive}
        duplicateDisabled={duplicateDisabled}
        duplicateDisabledReason={duplicateDisabledReason}
      />
    </div>
  );
}

/**
 * Memoized together with CardItem (TASK-21.4): the column list re-renders
 * on every board change, and dnd-kit's own subscription already re-renders
 * this wrapper whenever the drag state that concerns it changes.
 */
export const SortableCard = memo(SortableCardView);
